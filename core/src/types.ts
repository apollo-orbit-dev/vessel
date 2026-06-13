// Shared types for the host runtime.

/** A request handed to the fetch->ASGI bridge. */
export interface AsgiRequest {
  method: string;
  /** Path, optionally including a query string (e.g. "/api/note?x=1"). */
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A response produced by the bundle's ASGI app. */
export interface AsgiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

// The manifest type and its validation live in manifest.ts (Zod). Re-exported
// here so types.ts stays the single import hub for host types.
import type { Manifest } from "./manifest";
export type { Manifest };

/** A parsed bundle: its manifest plus every file keyed by its in-zip path. */
export interface BundleParts {
  manifest: Manifest;
  files: Record<string, Uint8Array>;
}

/** A running bundle backend the host can talk to. Async so it can live behind
 *  a Web Worker (host) or run in-process (SDK dev, on Node Pyodide). */
export interface VesselRuntime {
  dispatch(req: AsgiRequest): Promise<AsgiResponse>;
  /** Current bytes of the bundle's SQLite DB, read from the Pyodide FS. */
  snapshotDb(): Promise<Uint8Array>;
}
