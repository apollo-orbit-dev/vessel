# The Vessel SDK (`vessel` CLI)

Author `.vessel` tool bundles without reading this repo. The CLI is
`@vessel/sdk` (bin `vessel`); it shares the format/runtime code with the host
via `@vessel/core`, so what builds is exactly what the host opens.

## Commands
| Command | What it does |
|---|---|
| `vessel new <name> [dir]` | Scaffold a project (FastAPI + SQLite + a self-contained UI). |
| `vessel dev [dir] [-p port]` | Local dev server with **host parity** (runs the backend in Pyodide-in-Node) + hot reload. |
| `vessel build [dir] [-o out.vessel] [--sign key]` | Package a source dir into a `.vessel`, re-validated with the host's own loader; inlines local UI assets (see below); `--sign` adds an Ed25519 signature. |
| `vessel inspect <file.vessel> [--json]` | Examine a built bundle without running it: manifest, capabilities, declared packages, per-file sizes, signing status, and validation warnings. `--json` for tooling. |
| `vessel keygen <name>` | Generate an Ed25519 signing keypair → `<name>.key` (secret) + `<name>.pub` (share). |

## A bundle source directory
```
mytool/
├── manifest.json        # identity, entry points, declared packages
├── app/main.py          # FastAPI app — routes must be `async def`
├── ui/index.html        # the UI entry; may reference local ui/*.js + *.css —
│                        #   `vessel build` inlines them into one self-contained file
└── data/store.sqlite    # the database that travels in the bundle
```
You can split the UI into `ui/index.html` + local `<script src>` / `<link rel="stylesheet">`
files; `vessel build` inlines them so the shipped bundle is a single self-contained
`index.html` (the host serves only that file). Remote (`https://…`) and `data:` refs are
left as-is. ES-module *graphs* aren't flattened — keep module UIs flat or pre-bundle them.

See `docs/format.md` for the manifest schema and limits.

## Typical loop
```bash
vessel new "My Tool"        # -> ./my-tool
cd my-tool
vessel dev                  # http://localhost:5174 — edit, it reloads
vessel build                # -> my-tool.vessel — open it in the Vessel host
```

## Parity rules (because the backend runs in Pyodide)
- Routes must be **`async def`** — Pyodide has no OS threads (sync routes get
  dispatched to a threadpool and fail).
- `sqlite3` works (the runtime loads it); declared `packages` are resolved by
  micropip, including the Pyodide-provided closure (e.g. FastAPI).
- Request/response only — no WebSockets/streaming in v1.

`vessel dev` runs the same Pyodide as the host, so "works in dev" means "works
in the host." A backend reload re-reads the source, which resets the dev DB to
the on-disk `data/store.sqlite`.

## Notes
- Not yet published to npm (the publish name is pending). For now it runs from
  the monorepo: `node sdk/dist/cli.mjs <cmd>` after `npm run build -w @vessel/sdk`.
- Single-file UI inlining and Ed25519 signing (`vessel keygen` / `build --sign`)
  are implemented. Deferred: build-time package validation + wheel vendoring for
  offline bundles, and ES-module graph bundling (transitive *Python* deps already
  resolve at load via micropip). See `open_items.md`.
