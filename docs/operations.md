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

## Runtime pinning
- The Pyodide version is pinned by the `pyodide` npm dep (`host/package.json`) and the service-worker cache key (`host/public/sw.js`). `PYODIDE_BASE` in `host/src/runtime.worker.ts` points at the same-origin `/app/pyodide/`.
- **Pyodide is self-hosted, not loaded from a CDN.** `host/scripts/vendor-pyodide.mjs` (run automatically via host `prebuild`/`predev`, and in the deploy workflow) populates the gitignored `host/public/pyodide/` with the Pyodide core (copied from the pinned npm dep) + the dependency closure of the examples' packages (downloaded from the pinned Pyodide CDN at build time), and writes a patched `pyodide-lock.json` that keeps a jsdelivr fallback for non-vendored (exotic) wheels. Vite copies `host/public/pyodide/` → `dist/pyodide/` → the deploy serves it at `/app/pyodide/`. To bump Pyodide: update the `pyodide` dep, then `node host/scripts/vendor-pyodide.mjs --force` and the SW cache key. Verified wheel hashes: TBD.

## Backup / restore
- N/A for the host (stateless static site). User data lives in users' own `.vessel` files.

## Troubleshooting
- TBD
