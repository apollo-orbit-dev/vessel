import * as Comlink from "comlink";
import type { BundleParts, VesselRuntime } from "@vessel/core";
import type { RuntimeWorkerApi } from "./runtime.worker";

export interface WorkerRuntime {
  /** Async runtime proxy (dispatch/snapshotDb forward to the worker). */
  runtime: VesselRuntime;
  /** Boot Pyodide + the bundle inside the worker, locked to `allowedOrigins`. */
  init(bundle: BundleParts, allowedOrigins: string[]): Promise<void>;
  /** Tear the worker down. */
  terminate(): void;
}

/**
 * Spawn a Web Worker that hosts Pyodide + the bundle's ASGI app, and return an
 * async `VesselRuntime` that proxies to it over Comlink. The bundle's Python
 * never runs in the host's main thread.
 */
export function createWorkerRuntime(): WorkerRuntime {
  const worker = new Worker(new URL("./runtime.worker.ts", import.meta.url), { type: "module" });
  const api = Comlink.wrap<RuntimeWorkerApi>(worker);
  return {
    runtime: {
      dispatch: (req) => api.dispatch(req),
      snapshotDb: () => api.snapshotDb(),
    },
    init: (bundle, allowedOrigins) => api.init(bundle, allowedOrigins),
    terminate: () => worker.terminate(),
  };
}
