# vessel-cli

The authoring CLI for **[Vessel](https://getvessel.dev)** — a runtime *host* that opens
self-contained `.vessel` bundles. A bundle is one passable file (a ZIP) carrying a UI, a
Python/**FastAPI** backend, and a **SQLite** database — with the data living *inside the file*.
Install the host once, and any `.vessel` opens by double-click, runs in the browser (Python via
**Pyodide**/WebAssembly), and saves its data back to the same file.

This package gives you the `vessel` command to build those bundles.

## Install

```bash
npm install -g vessel-cli
vessel --help
```

(The package is `vessel-cli`; the command it installs is `vessel`.)

## Commands

| Command | What it does |
|---|---|
| `vessel new <name> [dir]` | Scaffold a project (FastAPI + SQLite + a self-contained UI). |
| `vessel dev [dir] [-p port]` | Local dev server with **host parity** (runs the backend in Pyodide) + hot reload. |
| `vessel build [dir] [-o out.vessel] [--sign key]` | Package a source dir into a `.vessel`; inlines local UI assets; `--sign` adds an Ed25519 signature. |
| `vessel inspect <file.vessel> [--json]` | Examine a built bundle (manifest, capabilities, packages, sizes, signing, warnings) — no code runs. |
| `vessel keygen <name>` | Generate an Ed25519 signing keypair. |

## Quick start

```bash
vessel new "My Tool"        # -> ./my-tool
cd my-tool
vessel dev                  # http://localhost:5174 — edit, it reloads
vessel build                # -> my-tool.vessel — open it in the Vessel host
```

## Authoring rules (the backend runs in Pyodide)

- Routes must be **`async def`** — Pyodide has no OS threads.
- Declare every top-level package in `manifest.json` `packages` (at least `"fastapi"`); micropip
  resolves the transitive closure at load.
- The shipped UI is a single self-contained `index.html` — but `vessel build` inlines your local
  `<script src>` / `<link rel="stylesheet">` for you, so you can split your source.
- Use parameterized SQL; style with the host's `--vessel-*` theme tokens (don't hardcode colors).

See the full format and design docs in the [repository](https://github.com/apollo-orbit-dev/vessel).

## License

Apache-2.0
