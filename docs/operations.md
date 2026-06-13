# Operations

> Filled in as the project develops. For Vessel, "operations" is mostly about releasing the host and the SDK, not running a server.

## Host (PWA) deployment
Target: static site at a single canonical origin (origin TBD).
- Build command: `npm run build -w @vessel/host` → static output in `host/dist/`.
- Hosting: TBD (GitHub Pages or self-hosted). Must be served over https/localhost — the File Handling API needs a secure context.
- The origin matters: it's the install identity and influences the bundle virtual-origin / service-worker scope.

## SDK / CLI release
- Package name: TBD (to be reserved on npm).
- Publish process: TBD.

## Runtime pinning
- The Pyodide version is pinned in `host/src/runtime.worker.ts` and the service-worker cache key (`host/public/sw.js`). Verified wheel hashes: TBD.

## Backup / restore
- N/A for the host (stateless static site). User data lives in users' own `.vessel` files.

## Troubleshooting
- TBD
