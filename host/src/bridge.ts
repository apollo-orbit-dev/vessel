import type { AsgiRequest, AsgiResponse, VesselRuntime } from "@vessel/core";

// The fetch->ASGI bridge transport (postMessage). The bundle UI runs in a
// sandboxed (opaque-origin) iframe; the host injects `bridgeShim` so the
// author's ordinary `fetch('/api/...')` is forwarded here and dispatched into
// the in-Pyodide ASGI app.
//
// Hardening notes:
// - Inbound (iframe->host): we accept a message only if it comes from our
//   iframe's window, its origin is the opaque "null", it carries the per-load
//   token, and its shape validates.
// - Outbound (host->iframe): targetOrigin must be "*" because an opaque origin
//   cannot be named as a target (spec limitation). The per-load token gates
//   acceptance on the shim side, so "*" cannot be abused to inject responses.

const MAX_PATH = 8192;
const MAX_HEADERS = 100;

export interface ParsedRequest {
  id: string;
  req: AsgiRequest;
}

/** A 128-bit per-load token, hex-encoded. */
export function newBridgeToken(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validate an inbound request message. Returns the parsed request, or null if
 * the message must be ignored (wrong token/shape/type). Pure — unit-tested.
 */
export function parseRequestMessage(data: unknown, token: string): ParsedRequest | null {
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.__vessel !== "request" || m.token !== token) return null;
  if (typeof m.id !== "string" && typeof m.id !== "number") return null;
  if (typeof m.method !== "string" || !/^[A-Za-z]{1,16}$/.test(m.method)) return null;
  if (typeof m.path !== "string" || m.path.length === 0 || m.path.length > MAX_PATH) return null;
  if (m.path[0] !== "/") return null;

  const headers: Record<string, string> = {};
  if (m.headers && typeof m.headers === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(m.headers as Record<string, unknown>)) {
      if (typeof v !== "string") continue;
      if (++n > MAX_HEADERS) break;
      headers[k] = v;
    }
  }
  const body = typeof m.body === "string" ? m.body : null;
  return { id: String(m.id), req: { method: m.method, path: m.path, headers, body } };
}

/** The script injected into the bundle document. Token-gated; uses postMessage. */
export function bridgeShim(token: string): string {
  return `<script>
(function () {
  var TOKEN = ${JSON.stringify(token)};
  var _fetch = window.fetch ? window.fetch.bind(window) : null;
  var seq = 0, pending = {};
  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.__vessel !== "response" || m.token !== TOKEN) return;
    var r = pending[m.id]; if (!r) return; delete pending[m.id];
    r({ status: m.status, headers: m.headers, body: m.body });
  });
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var u; try { u = new URL(url, location.href); } catch (_) { u = null; }
    var pathname = u ? u.pathname : String(url).split("?")[0];
    var full = u ? u.pathname + u.search : url;
    if (pathname.indexOf("/api/") !== 0) {
      return _fetch ? _fetch(input, init) : Promise.reject(new Error("network disabled"));
    }
    var method = (init && init.method) ||
      (typeof input !== "string" && input && input.method) || "GET";
    var body = init && init.body != null ? String(init.body) : null;
    var headers = {};
    if (init && init.headers) { new Headers(init.headers).forEach(function (v, k) { headers[k] = v; }); }
    var id = TOKEN + ":" + (++seq);
    return new Promise(function (resolve) {
      pending[id] = resolve;
      parent.postMessage(
        { __vessel: "request", token: TOKEN, id: id, method: method, path: full, headers: headers, body: body },
        "*"
      );
    }).then(function (r) { return new Response(r.body, { status: r.status, headers: r.headers }); });
  };
})();
</script>`;
}

export interface BridgeOptions {
  afterDispatch?: (req: AsgiRequest, res: AsgiResponse) => void;
}

/**
 * Wire the host side of the bridge to a sandboxed iframe: validate inbound
 * messages, dispatch into the runtime, post the response back (token-gated).
 * Returns a detach function.
 */
export function attachBridge(
  iframe: HTMLIFrameElement,
  runtime: VesselRuntime,
  token: string,
  opts: BridgeOptions = {},
): () => void {
  async function onMessage(ev: MessageEvent) {
    if (ev.source !== iframe.contentWindow) return; // only our frame
    if (ev.origin !== "null") return; // sandboxed iframe => opaque origin
    const parsed = parseRequestMessage(ev.data, token);
    if (!parsed) return;

    let res: AsgiResponse;
    try {
      res = await runtime.dispatch(parsed.req);
    } catch (e) {
      res = { status: 500, headers: {}, body: JSON.stringify({ error: String(e) }) };
    }
    // "*" is required (opaque-origin target); the token gates acceptance.
    iframe.contentWindow?.postMessage(
      { __vessel: "response", token, id: parsed.id, ...res },
      "*",
    );
    opts.afterDispatch?.(parsed.req, res);
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
