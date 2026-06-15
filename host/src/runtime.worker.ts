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

// Pyodide is self-hosted SAME-ORIGIN (vendored into public/pyodide/ by
// host/scripts/vendor-pyodide.mjs → served at /app/pyodide/). Loading it from
// our own origin instead of a third-party CDN avoids the failure class where a
// corporate proxy strips CORS on cross-origin fetches (or sinkholes the CDN):
// the host page already loads same-origin, so the runtime does too. The patched
// pyodide-lock.json keeps a jsdelivr fallback for non-vendored (exotic) wheels.
// The pinned version lives in the `pyodide` npm dep that vendoring copies from.
const PYODIDE_BASE = "/app/pyodide/";

let runtime: VesselRuntime | null = null;

const api = {
  // `allowedOrigins` is the host's post-consent effective allowlist (declared
  // domains the user approved; empty if denied or none declared).
  async init(bundle: BundleParts, allowedOrigins: string[]): Promise<void> {
    const mod = await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`);
    const pyodide = (await mod.loadPyodide({ indexURL: PYODIDE_BASE })) as PyodideLike;
    runtime = await createRuntime(pyodide, bundle, {
      // Default-deny egress: lock the worker's fetch/XHR before any bundle code.
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
