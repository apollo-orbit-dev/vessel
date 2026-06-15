# Operations

> Filled in as the project develops. For Vessel, "operations" is mostly about releasing the host and the SDK, not running a server.

## Host (PWA) deployment
Served from **getvessel.dev** via GitHub Pages (GitHub Actions source). Layout: the landing page at `/`, the host PWA at `/app/`.
- Deploy: `.github/workflows/deploy.yml` runs on push to `main` — builds the host (Vite `base: /app/`), assembles `site/` → `/` + `host/dist/` → `/app/`, writes the `CNAME` + `.nojekyll`, and publishes via `actions/deploy-pages`.
- DNS: apex `getvessel.dev` → GitHub Pages (A `185.199.108–111.153`, AAAA `2606:50c0:8000–8003::153`). `.dev` is HTTPS-only; the cert is auto-provisioned.
- The origin is the PWA install identity and sets the service-worker / file-handling scope (`/app/`).

## SDK / CLI release
- Package name: TBD (to be reserved on npm).
- Publish process: TBD.

## Runtime pinning & source
- The Pyodide version is pinned by the `pyodide` npm dep (`host/package.json`) and the service-worker cache key (`host/public/sw.js`).
- **Runtime source is a user setting** ("Runtime source" in host Settings, persisted in `localStorage` `vessel.prefs`): **`encoded`** (default, same-origin) or **`cdn`** (jsdelivr). The worker (`host/src/runtime.worker.ts`) branches on it.
- **Self-hosted (encoded), not a CDN.** `host/scripts/vendor-pyodide.mjs` (run via host `prebuild`/`predev` + the deploy) populates the gitignored `host/public/pyodide/`: raw core (`pyodide.mjs`/`.asm.js`/`.asm.wasm`) + the **XOR-encoded** stdlib & wheel closure of the examples' packages as `<name>.enc` (downloaded from the pinned CDN at build) + a patched `pyodide-lock.json` (vendored packages keep relative `.bin`/`.whl` names → the worker maps `<name>`→`<name>.enc` and decodes; exotic packages fall back to jsdelivr). Vite copies it → `dist/pyodide/` → served at `/app/pyodide/`.
- **Why encoded:** the XOR scramble (obfuscation, **not** encryption; key in both the vendor script and the worker) hides the ZIP signature so proxies that block archive downloads by content still pass it. Combined with same-origin, the `encoded` default boots behind CORS-stripping proxies, CDN sinkholes, **and** archive-content-blocking DLP proxies.
- To bump Pyodide: update the `pyodide` dep, then `node host/scripts/vendor-pyodide.mjs --force` and the SW cache key. Verified wheel hashes: TBD.

## Backup / restore
- N/A for the host (stateless static site). User data lives in users' own `.vessel` files.

## Troubleshooting
- TBD
