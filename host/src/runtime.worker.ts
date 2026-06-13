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
// separately from the host page's own fetch. The worker loads
// Pyodide from the CDN itself; the host never runs bundle Python in its context.

const PYODIDE_VERSION = "0.29.4";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

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
