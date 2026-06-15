# Architecture

## Current state
Vessel is an installable **host** PWA that opens `.vessel` bundles, runs them in
an isolated sandbox, and persists their data back into the file. The repo is an
npm-workspaces monorepo — `core/` (shared format + runtime), `host/` (the PWA),
and `sdk/` (the authoring CLI) — plus a static landing page in `site/`.

**Runtime.** A bundle's Python runs in a **Web Worker** (`host/src/runtime.worker.ts`,
via Comlink), off the host's main thread. The worker loads Pyodide **same-origin**
from `/app/pyodide/` (self-hosted — vendored at build by `host/scripts/vendor-pyodide.mjs`,
no third-party CDN at runtime), mounts the
bundle's sources + SQLite DB, and serves the bundle's FastAPI/Starlette app
through a `fetch`→ASGI bridge (`core/src/runtime.ts`). The bundle's UI renders in
a **sandboxed, opaque-origin iframe**; its `fetch('/api/...')` calls ride a
token-gated postMessage transport (`host/src/bridge.ts`) to the worker.

**Trust + isolation.** Network egress is **default-deny**: a host-controlled
fetch/XHR wrapper (`core/src/egress.ts`) plus the iframe's CSP limit a bundle to
the `https` origins it declares in `capabilities.network`, and a **per-bundle
consent prompt** (`host/src/ui/PermissionModal.tsx`, `permission.ts`) gates them.
Bundles can be **Ed25519-signed** (`core/src/sign.ts`; `vessel keygen` /
`build --sign`); the host verifies and badges them signed / unsigned /
tamper-**invalid**. The host never hands its writable file handle to bundle code.

**Persistence + save.** With a writable file handle (Chromium's File Handling
API / picker) the host autosaves promptlessly, snapshotting SQLite back into the
ZIP and writing atomically (temp-then-swap). Without one (Firefox/Safari, or a
drag-dropped file) it falls back to **download-to-save** —
`host/src/capabilities.ts` detects which.

**Offline.** A service worker (`host/public/sw.js`) caches the app shell +
Pyodide so the host and cached-dependency bundles run with no network
(best-effort runtime cache).

**Host UI.** A themed (light/dark/system) React shell — menu bar, launcher with
recents, boot screen, the tool surface, and a Settings panel (`host/src/ui/`,
`theme.tsx`), built to the design spec in `docs/design/host-ui/`.

## Repository layout
- `core/` — `@vessel/core`, the format + runtime shared by host and SDK: manifest v1 schema (`parseManifest`), zip-safety (entry-path whitelist + pre-expansion size guard), bundle read/write (validated load + re-zip), the Pyodide ASGI bridge harness (`createRuntime`), `egress.ts` (fetch/XHR allowlist), `sign.ts` (Ed25519 via WebCrypto).
- `host/` — `@vessel/host`, the **React + Vite** PWA importing `@vessel/core`. Key modules: `src/App.tsx` (orchestrates open/boot/tool/save + permission flow), `src/main.tsx` (React entry), `src/theme.tsx` + `src/ui/` (chrome: menu bar, launcher, boot, sandbox, settings, permission modal, primitives), `src/runtime-client.ts` + `src/runtime.worker.ts` (Pyodide in a Web Worker via Comlink), `src/bridge.ts` (token-gated postMessage transport), `src/iframe.ts` (sandboxed iframe + CSP), `src/save.ts` (writable-handle atomic write) + `src/download.ts` (degraded download-to-save) + `src/autosave.ts` (debounced/manual save state), `src/capabilities.ts` (cross-browser feature detection), `src/permission.ts` + `src/recents.ts` (idb), `public/sw.js` (offline cache). Tests in `host/tests/`.
- `sdk/` — `@vessel/sdk`, bin `vessel` (`new`/`dev`/`build`/`keygen`); see `docs/sdk.md`.
- `site/` — the static landing page.

## Example bundle
- `examples/notes/` — a hand-authored example bundle: a real FastAPI `app/main.py`
  (`async def` routes), a self-contained `ui/index.html`, an empty
  `data/store.sqlite`, and `manifest.json`. `npm run build:bundle` packages it
  into `tests/fixtures/notes.vessel` (via `host/scripts/build-bundle.mjs`).

## Pyodide realities
`sqlite3` is unvendored from the stdlib in Pyodide and is loaded via
`loadPackage`; `micropip.install` resolves a package's dependency closure
(verified for FastAPI, incl. the `pydantic-core` wasm wheel). Pyodide has **no OS
threads**, so bundle routes must be `async def` — FastAPI dispatches sync routes
to a threadpool, which fails under Pyodide. See `docs/format.md`.

## Components
Vessel is three things, not one app:

| Component | What it is | Where it runs |
|-----------|------------|---------------|
| **Host** | Installable PWA that opens `.vessel` files, runs the runtime, and persists data back to the file | The user's browser (Chromium for the full experience) |
| **Bundle format** | `.vessel` — a ZIP with `manifest.json` (OPC/`.xlsx`-style) carrying a UI build, Python backend, and a SQLite DB | n/a (a file) |
| **SDK / CLI** | `vessel new` / `dev` / `build` — scaffolds, dev-loops, and packages bundles | Author's machine (Node) |

## How a bundle runs (data flow)
1. OS routes a double-clicked `.vessel` to the installed host via the File Handling API; `launchQueue` delivers a **writable** `FileSystemFileHandle`.
2. The host unzips the bundle in memory, validates `manifest.json`, and mounts the SQLite DB and Python sources into Pyodide's virtual filesystem (in the worker).
3. The bundle's React UI renders inside a **sandboxed iframe**.
4. UI `fetch('/api/...')` calls are intercepted and dispatched into the bundle's **FastAPI/Starlette ASGI app** running in **Pyodide** (the `fetch`→ASGI bridge). Python reads/writes SQLite via stdlib `sqlite3`.
5. On save, the host snapshots the SQLite bytes back into the ZIP and writes to the handle — no prompt (or, without a writable handle, prompts a download).

See the ASCII diagram and full detail in `docs/design.md`.

## Stack
| Layer | Choice | Why |
|-------|--------|-----|
| Host runtime | Installable PWA (File Handling API, `launchQueue`, OPFS, service worker) | Writable launch handle gives promptless save + real file association |
| Backend runtime | Pyodide (CPython + stdlib `sqlite3`) | Runs the author's Python + SQLite unmodified; no separate DB engine needed |
| Backend framework | FastAPI / Starlette (ASGI), in-process | Authors write ordinary FastAPI; host bridges `fetch`→ASGI |
| Frontend | React + Vite (author's choice) | Host only needs the static build; renders it sandboxed |
| Bundle format | ZIP + `manifest.json` (`.vessel`) | Mirrors `.xlsx`; data travels in the file; tooling-friendly |
| SDK / CLI | Node / TypeScript | Standard authoring toolchain; npm distribution |
| Signing | Ed25519 | Lets an org trust internal publishers without trusting the world |

## Deployment target
Open source. Host served as a static PWA from one canonical origin; SDK published to npm; spec lives in-repo. No server backend.

## Notable constraints
- **Chromium** gives the full experience (File Handling + writable launch handle → double-click open + promptless save). Firefox/Safari run **degraded**: file-input open + download-to-save, no recents. Same sandbox/runtime either way.
- **Package coverage** is limited to Pyodide-loadable wheels (numpy/scipy/pandas fine; exotic native libs not).
- **Security is the whole ballgame** — untrusted code from files. The host↔bundle isolation boundary is the most safety-critical surface. See `docs/design.md` (Security model).

---

This document describes the current system. Implementation lives in `core/`, `host/`, and `sdk/`.
