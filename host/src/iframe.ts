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

// Injected listener: applies `--vessel-*` token updates pushed from the host
// (on a light/dark or theme toggle). Only accepts messages from the parent;
// it only mutates the iframe's own CSS variables, so there's no trust impact.
const THEME_LISTENER = `<script>(function(){window.addEventListener("message",function(e){if(e.source!==window.parent)return;var d=e.data;if(!d||d.type!=="vessel:theme"||!d.vars)return;var s=document.documentElement.style;for(var k in d.vars)s.setProperty(k,d.vars[k]);});})();</script>`;

export interface MountHandle {
  /** Detach the bridge and remove the iframe. */
  teardown(): void;
  /** Live-update the bundle's `--vessel-*` variables (no remount). */
  pushTheme(vars: Record<string, string>): void;
}

/**
 * Render the bundle's UI in a sandboxed iframe with a strict CSP, the bridge
 * wired to `runtime`, and (optionally) the active theme injected. Returns a
 * handle to tear down and to push live theme updates.
 */
export function mountBundleUi(
  container: HTMLElement,
  html: string,
  runtime: VesselRuntime,
  opts: BridgeOptions & { allowedOrigins?: string[]; themeCss?: string; bgColor?: string } = {},
): MountHandle {
  const token = newBridgeToken();
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${bundleCsp(opts.allowedOrigins ?? [])}">`;
  const themeBlock = opts.themeCss ? `<style id="vessel-theme">${opts.themeCss}</style>${THEME_LISTENER}` : "";
  const doc = injectIntoHead(html, cspMeta + themeBlock + bridgeShim(token));

  const iframe = document.createElement("iframe");
  // opaque origin, no host access. `allow-modals` lets bundle UIs use
  // window.print()/alert/confirm like an ordinary web page (Phase 12, for the
  // invoice example's print-to-PDF). It does NOT grant same-origin, popups,
  // downloads, top-navigation, or network — the isolation boundary (no host
  // access, default-deny egress, no writable handle) is unchanged; worst case a
  // bundle spams modal dialogs in its own tab, no worse than any web page.
  iframe.setAttribute("sandbox", "allow-scripts allow-modals");
  iframe.style.cssText = `border:0;width:100%;height:100%;display:block;background:${opts.bgColor ?? "#fff"}`;
  iframe.srcdoc = doc;

  const detach = attachBridge(iframe, runtime, token, opts);
  container.replaceChildren(iframe);

  return {
    teardown() {
      detach();
      iframe.remove();
    },
    pushTheme(vars) {
      iframe.contentWindow?.postMessage({ type: "vessel:theme", vars }, "*");
    },
  };
}
