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
- The Pyodide version is pinned in `host/src/runtime.worker.ts` and the service-worker cache key (`host/public/sw.js`). Verified wheel hashes: TBD.

## Backup / restore
- N/A for the host (stateless static site). User data lives in users' own `.vessel` files.

## Troubleshooting
- TBD
