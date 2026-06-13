import { attachBridge, bridgeShim, newBridgeToken, type BridgeOptions } from "./bridge";
import type { VesselRuntime } from "@vessel/core";

/**
 * Content-Security-Policy applied to the bundle's UI document.
 *
 * `connect-src` is the egress line: it lists the manifest-declared https origins
 * the UI may reach, or `'none'` when the bundle declares no network. The
 * `/api/*` bridge keeps working regardless because it rides postMessage, which
 * CSP does not gate. The worker enforces the same allowlist on the Python side.
 *
 * `script-src/style-src 'unsafe-inline'` is required because v1 bundle UIs are
 * single self-contained HTML files (inline script/style), plus our injected
 * shim. Hashes/nonces become possible once the SDK emits built bundles.
 */
export function bundleCsp(allowedOrigins: string[]): string {
  const connect = allowedOrigins.length ? allowedOrigins.join(" ") : "'none'";
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data:",
    "font-src data:",
    `connect-src ${connect}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "object-src 'none'",
  ].join("; ");
}

/** Default-deny CSP (no network) — also the base the tests assert against. */
export const BUNDLE_CSP = bundleCsp([]);

/**
 * Insert `inject` immediately after the document's <head> (so the CSP meta and
 * shim precede the bundle's own scripts/styles). Falls back to after <html>,
 * then to prepending. Pure — unit-tested.
 */
export function injectIntoHead(html: string, inject: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag?.index !== undefined) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + inject + html.slice(at);
  }
  return inject + html;
}

/**
 * Render the bundle's UI in a sandboxed iframe with a strict CSP and the bridge
 * wired to `runtime`. Returns a teardown function.
 */
export function mountBundleUi(
  container: HTMLElement,
  html: string,
  runtime: VesselRuntime,
  opts: BridgeOptions & { allowedOrigins?: string[] } = {},
): () => void {
  const token = newBridgeToken();
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${bundleCsp(opts.allowedOrigins ?? [])}">`;
  const doc = injectIntoHead(html, cspMeta + bridgeShim(token));

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts"); // opaque origin, no host access
  iframe.style.cssText = "border:0;width:100%;height:100%;display:block;background:#fff";
  iframe.srcdoc = doc;

  const detach = attachBridge(iframe, runtime, token, opts);
  container.replaceChildren(iframe);

  return () => {
    detach();
    iframe.remove();
  };
}
