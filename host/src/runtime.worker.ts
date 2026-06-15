import * as Comlink from "comlink";
import {
  createRuntime,
  installEgressPolicy,
  type AsgiRequest,
  type AsgiResponse,
  type BundleParts,
  type PyodideLike,
  type VesselRuntime,
} from "@vessel/core";

// Pyodide runs HERE, in a Web Worker, off the host's main thread. This is the
// isolation seam the trust phase needs: the worker's network can be brokered
// separately from the host page's own fetch. The host never runs bundle Python
// in its context.

// Where Pyodide loads from, chosen by the host's "Runtime source" setting:
//  - "encoded" (default): SAME-ORIGIN /app/pyodide/, vendored by
//    host/scripts/vendor-pyodide.mjs. Archive assets (the stdlib + wheels) are
//    served XOR-obfuscated as `<name>.enc` and decoded here on the fly — so the
//    runtime loads even behind proxies that block archive downloads by content
//    (and, being same-origin, also past CORS-stripping proxies / CDN sinkholes).
//  - "cdn": the public jsdelivr CDN (the original path; an escape hatch / offload).
const PYODIDE_VERSION = "0.29.4"; // matches the pinned `pyodide` npm dep
const SAME_ORIGIN_BASE = "/app/pyodide/";
const CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// XOR is OBFUSCATION, not encryption — it only scrambles the ZIP signature so a
// content-inspecting proxy sees opaque bytes instead of an archive. No secret or
// trust claim rests on it. Keep in sync with host/scripts/vendor-pyodide.mjs.
const XOR_KEY = 0x5a;

/**
 * Make Pyodide's fetches of the encoded archive assets transparent: a request for
 * a `.bin`/`.whl` under /app/pyodide/ is served the XOR'd `<name>.enc` and decoded
 * back to the real bytes. Installed before loadPyodide; left in place (it's a pure
 * passthrough for any other URL, and the egress policy wraps on top of it later,
 * so bundle egress is unaffected). Only used in "encoded" mode.
 */
function installArchiveDecode(): void {
  const orig = self.fetch.bind(self);
  self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let path = "";
    try {
      path = new URL(url, self.location.href).pathname;
    } catch {
      /* leave path empty → passthrough */
    }
    if (path.startsWith(SAME_ORIGIN_BASE) && /\.(bin|whl)$/.test(path)) {
      return orig(`${url}.enc`).then(async (res) => {
        if (!res.ok) return res;
        const buf = new Uint8Array(await res.arrayBuffer());
        for (let i = 0; i < buf.length; i++) buf[i] ^= XOR_KEY;
        return new Response(buf, { headers: { "content-type": "application/octet-stream" } });
      });
    }
    return orig(input, init);
  };
}

let runtime: VesselRuntime | null = null;

const api = {
  // `allowedOrigins` is the host's post-consent effective allowlist (declared
  // domains the user approved; empty if denied or none declared). `source` is the
  // host's "Runtime source" pref ("encoded" default, or "cdn").
  async init(bundle: BundleParts, allowedOrigins: string[], source: "encoded" | "cdn" = "encoded"): Promise<void> {
    const encoded = source !== "cdn";
    const base = encoded ? SAME_ORIGIN_BASE : CDN_BASE;
    if (encoded) installArchiveDecode(); // intercept .bin/.whl → decode .enc
    const mod = await import(/* @vite-ignore */ `${base}pyodide.mjs`);
    const pyodide = (await mod.loadPyodide(
      // encoded mode serves the stdlib as python_stdlib.bin(.enc); the CDN ships it as python_stdlib.zip.
      encoded ? { indexURL: base, stdLibURL: `${base}python_stdlib.bin` } : { indexURL: base },
    )) as PyodideLike;
    runtime = await createRuntime(pyodide, bundle, {
      // Default-deny egress: lock the worker's fetch/XHR before any bundle code.
      // (Wraps on top of the decode passthrough above; bundle egress is unaffected.)
      installEgress: () => installEgressPolicy(self, new Set(allowedOrigins)),
    });
  },
  async dispatch(req: AsgiRequest): Promise<AsgiResponse> {
    if (!runtime) throw new Error("runtime not initialized");
    return runtime.dispatch(req);
  },
  async snapshotDb(): Promise<Uint8Array> {
    if (!runtime) throw new Error("runtime not initialized");
    return runtime.snapshotDb();
  },
};

export type RuntimeWorkerApi = typeof api;

Comlink.expose(api);
