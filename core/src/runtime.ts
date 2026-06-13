import type { AsgiRequest, AsgiResponse, BundleParts, VesselRuntime } from "./types";

/**
 * The subset of the Pyodide API the spike uses. Kept minimal and structural so
 * the same code runs against the CDN build (browser) and the `pyodide` npm
 * package (Node smoke test) without importing Pyodide's types here.
 */
export interface PyodideLike {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string, opts?: { encoding?: "binary" }): Uint8Array;
  };
  loadPackage(names: string | string[]): Promise<unknown>;
  pyimport(name: string): any;
  runPythonAsync(code: string): Promise<any>;
  globals: { set(name: string, value: unknown): void };
}

const BUNDLE_ROOT = "/bundle";

/**
 * Python harness that turns a JSON request into one ASGI request/response
 * cycle against the bundle's app. Request/response only — no streaming or
 * websockets (deliberately out of scope for v1).
 *
 * `__BACKEND__` is replaced with the manifest's "module:attr" target.
 */
const BRIDGE_PY = String.raw`
import importlib
import json
import os
import sys

os.chdir("${BUNDLE_ROOT}")
if "${BUNDLE_ROOT}" not in sys.path:
    sys.path.insert(0, "${BUNDLE_ROOT}")

_mod_name, _attr = "__BACKEND__".split(":")
# Drop any cached copy of the backend package so re-running this (e.g. vessel
# dev hot-reload, or opening a different bundle) re-reads the mounted sources.
_top = _mod_name.split(".")[0]
for _k in [k for k in sys.modules if k == _top or k.startswith(_top + ".")]:
    del sys.modules[_k]
_vessel_app = getattr(importlib.import_module(_mod_name), _attr)


async def vessel_dispatch(req_json):
    req = json.loads(req_json)
    method = (req.get("method") or "GET").upper()
    path = req.get("path") or "/"
    headers = req.get("headers") or {}
    body = req.get("body")
    body_bytes = (body or "").encode("utf-8")

    raw_path, _, query = path.partition("?")

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": raw_path,
        "raw_path": raw_path.encode("utf-8"),
        "query_string": query.encode("utf-8"),
        "root_path": "",
        "headers": [
            [str(k).lower().encode("utf-8"), str(v).encode("utf-8")]
            for k, v in headers.items()
        ],
        "client": ["127.0.0.1", 0],
        "server": ["vessel", 80],
    }

    _pending = [{"type": "http.request", "body": body_bytes, "more_body": False}]

    async def receive():
        if _pending:
            return _pending.pop(0)
        return {"type": "http.disconnect"}

    result = {"status": 500, "headers": {}, "chunks": []}

    async def send(message):
        if message["type"] == "http.response.start":
            result["status"] = message["status"]
            for k, v in message.get("headers", []):
                result["headers"][bytes(k).decode("latin-1")] = bytes(v).decode("latin-1")
        elif message["type"] == "http.response.body":
            result["chunks"].append(bytes(message.get("body", b"")))

    await _vessel_app(scope, receive, send)

    body_out = b"".join(result["chunks"]).decode("utf-8", "replace")
    return json.dumps(
        {"status": result["status"], "headers": result["headers"], "body": body_out}
    )
`;

/**
 * Mount a parsed bundle into Pyodide, install its packages, import its ASGI
 * app, and return a runtime that can dispatch requests and snapshot the DB.
 *
 * The caller supplies the Pyodide instance (CDN build in the browser, npm
 * package in tests), keeping this module environment-agnostic.
 */
export interface RuntimeOptions {
  /**
   * Called after the runtime's own packages are loaded but BEFORE bundle code
   * runs. The host uses this to lock down the worker's network to the
   * (post-consent) effective allowlist it has already decided; the SDK dev
   * server omits it.
   */
  installEgress?: () => void;
}

export async function createRuntime(
  pyodide: PyodideLike,
  bundle: BundleParts,
  opts: RuntimeOptions = {},
): Promise<VesselRuntime> {
  // Mount every bundle file under /bundle in Pyodide's virtual FS.
  pyodide.FS.mkdirTree(BUNDLE_ROOT);
  for (const [name, data] of Object.entries(bundle.files)) {
    if (name.endsWith("/")) continue; // directory entry
    const full = `${BUNDLE_ROOT}/${name}`;
    pyodide.FS.mkdirTree(full.slice(0, full.lastIndexOf("/")));
    pyodide.FS.writeFile(full, data);
  }

  // sqlite3 is unvendored from the Python stdlib in Pyodide, so it is always
  // loaded as a runtime baseline (Vessel is fundamentally Python + SQLite).
  const packages = bundle.manifest.packages ?? [];
  const base = ["sqlite3"];
  if (packages.length > 0) base.push("micropip");
  await pyodide.loadPackage(base);

  // micropip resolves a package's dependency closure from PyPI + the Pyodide
  // distribution (verified for FastAPI, incl. the pydantic-core wasm wheel). If
  // a transitive Pyodide-provided dep isn't auto-pulled (seen with bare
  // Starlette), the manifest must list it explicitly — computing the full
  // closure is a job for the SDK at build time.
  if (packages.length > 0) {
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(packages);
  }

  // Lock down egress now: package loading (above) is done, and bundle code
  // (the app import below + every dispatch) runs only after this point. The
  // caller closes over the post-consent effective allowlist.
  opts.installEgress?.();

  // Import the app and define the dispatch coroutine.
  await pyodide.runPythonAsync(BRIDGE_PY.replace("__BACKEND__", bundle.manifest.backend));

  const dbPath = `${BUNDLE_ROOT}/${bundle.manifest.data}`;

  return {
    async dispatch(req: AsgiRequest): Promise<AsgiResponse> {
      pyodide.globals.set("_vessel_req", JSON.stringify(req));
      const out = (await pyodide.runPythonAsync(
        "await vessel_dispatch(_vessel_req)",
      )) as string;
      return JSON.parse(out) as AsgiResponse;
    },

    async snapshotDb(): Promise<Uint8Array> {
      return pyodide.FS.readFile(dbPath, { encoding: "binary" });
    },
  };
}
