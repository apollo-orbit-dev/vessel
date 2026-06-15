# Setup

> Updated each phase as the project gains setup steps. Covers the host dev
> server, the example-bundle build, and the test suite.

## Prerequisites
- **Node** ≥ 20 (developed on Node 24). npm comes with it.
- A **Chromium** browser (Chrome/Edge) for the full host experience — the File
  Handling API, `launchQueue` writable handle, and PWA install are Chromium-only.
  Firefox/Safari run in **degraded mode** (file-input open + download-to-save; see
  the host UI's banner).
- Network on the first `dev`/`build` run: host `predev`/`prebuild` runs
  `scripts/vendor-pyodide.mjs`, which downloads the Pyodide wheel set into the
  gitignored `host/public/pyodide/` once (cached after; `--force` to refresh).
  At runtime the host then loads Pyodide **same-origin** from `/app/pyodide/` —
  no third-party CDN, so it works behind corporate proxies that block/strip CORS
  on CDNs.

No Python toolchain is needed to run a bundle — the backend runs inside Pyodide.

## Repo layout (npm workspaces)
- `core/` — `@vessel/core`: the format + runtime shared by host and SDK (manifest schema, zip-safety, bundle read/write, the Pyodide ASGI bridge harness).
- `host/` — `@vessel/host`: the installable PWA.
- `sdk/` — `@vessel/sdk`: the `vessel` CLI.

## First-time setup
```bash
npm install     # at the repo ROOT — installs all workspaces
```

## Commands (run from `host/`, or with `-w @vessel/host` from root)
| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server for the host PWA. The host is based at `/app/`, so it serves at http://localhost:5173/app/ (Vite prints the URL). |
| `npm run build` | Production build of the host into `host/dist/`. |
| `npm run preview` | Serve the production build (needed to exercise the offline service worker; the SW is disabled in dev). |
| `npm run build:bundle` | Assemble `examples/notes/` into `tests/fixtures/notes.vessel`. |
| `npm test` | Run the Vitest suite (unit + a smoke test that boots Pyodide in Node; `pretest` rebuilds the example bundle). |
| `npm run typecheck` | `tsc --noEmit` over the host sources. |

`npm test` requires network on first run (it micropip-installs FastAPI).

**Cross-browser degradation check (manual, dev-only).** Playwright is not a
committed dependency. To verify the degraded path on real Firefox:

```
cd host
npm i -D --no-save playwright && npx playwright install firefox
npm run dev                       # in another shell (http://localhost:5173)
node scripts/verify-degraded.mjs  # drives Firefox through open → run → download-to-save
```

On Linux this needs Firefox's system libs (`sudo npx playwright install-deps`,
or `apt-get install libasound2t64`).

**Regenerating the icon PNGs (only when the source SVGs change).** `sharp` is not
a committed dependency either. The app/file-handler icon PNGs in
`host/public/` are generated from `icon.svg` / `icon-maskable.svg` /
`vessel-file.svg`; the output PNGs are committed. To regenerate:

```
npm i -D --no-save sharp
node host/scripts/gen-icons.mjs   # rewrites host/public/*.png
```

## Landing page (`site/`)

A static marketing page (no build step). Preview it with any static server:

```
python3 -m http.server 8099 --directory site   # then open http://localhost:8099
```

Fonts load from Google Fonts (Geist) with a system-font fallback; the deployment
origin is not yet chosen.

## Running the host locally
1. `cd host && npm run dev`
2. Open the printed URL in **Chromium**.
3. Click **Open .vessel…** and pick `tests/fixtures/notes.vessel` (build it first
   with `npm run build:bundle` if it isn't there), or **drag-drop** it onto the window.
   - The file picker / OS launch give a **writable handle** → promptless save.
     Drag-drop (or any browser without the File System Access API) has no handle →
     the host falls back to **download-to-save**.

## SDK (the `vessel` CLI)
Build the CLI, then author bundles (full guide: `docs/sdk.md`):
```bash
npm run build -w @vessel/sdk          # -> sdk/dist/cli.mjs
node sdk/dist/cli.mjs new "My Tool"   # scaffold
node sdk/dist/cli.mjs dev examples/notes   # dev server (host parity + reload)
node sdk/dist/cli.mjs build examples/notes # -> notes.vessel
```
(Once published, this is just `vessel new` / `dev` / `build`.)

## The example bundles
- `examples/notes/` is a real **FastAPI** app (`app/main.py`, `async def`
  routes — Pyodide has no threads, so sync routes are not supported) + stdlib
  `sqlite3`, with a self-contained `ui/index.html`. `npm run build:bundle`
  packages it into `tests/fixtures/notes.vessel`.
- `examples/` also holds **ten full example tools** (budget, flashcards,
  csv-explorer, invoice, recipe-planner, habits, crm, job-tracker, workout,
  journal) — each a working `.vessel` with full create/edit/delete, committed as a
  ready-to-open `examples/<slug>/<slug>.vessel`. See `examples/README.md`. Rebuild
  any with `node sdk/dist/cli.mjs build examples/<slug>`.
- **Signing:** `csv-explorer` + `invoice` are signed with an **example** key in
  `examples/.keys/` — `example.pub` is committed (shareable); the secret
  `example.key` is gitignored (a throwaway example identity, not a real publisher
  key). Re-sign with `… build examples/<slug> --sign examples/.keys/example.key`
  (needs the secret key, so only the machine that ran `vessel keygen` can).
- **Functional smoke** for the ten tools (boots each through the real
  fetch→ASGI→SQLite bridge, exercises full CRUD + persistence): it is heavy
  (~11 Pyodide boots, needs network) so it is **gated** and skipped by the default
  `npm test`. Run it on demand from `host/`:
  `SMOKE_EXAMPLES=1 npx vitest run examples-smoke`.

## Trying the full OS-association loop (Chromium, manual)
The promptless double-click → open → save loop needs the PWA installed:
1. `npm run build` and serve `host/dist/` over **https or localhost** (e.g.
   `npx vite preview`). File Handling requires a secure context.
2. Install the PWA (address-bar install icon).
3. Double-click a `.vessel` in the OS file manager → it opens in the host with a
   writable handle; editing + Save writes back to the same file with no prompt.

> Note: PWA install + file association + writable-handle save are verified by hand
> in Chromium. The automated suite covers the loader, the bridge, and the
> save→reopen round-trip at the data layer (see `host/tests/`).
