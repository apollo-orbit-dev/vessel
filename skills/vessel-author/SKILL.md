---
name: vessel-author
description: Use when authoring, building, packaging, or debugging a Vessel ".vessel" tool bundle — a single ZIP carrying a FastAPI/Python backend (run in Pyodide/WebAssembly), a self-contained HTML UI, and a SQLite database — including writing its manifest.json, structuring the backend, or fixing a bundle the Vessel host rejects.
---

# Authoring a Vessel `.vessel` bundle

## Overview
A `.vessel` is a ZIP archive (OPC/`.xlsx`-style) that carries a tool's UI, a Python **FastAPI** backend, and a **SQLite** database in one file. The host opens it, runs the backend in **Pyodide** (CPython on WebAssembly) inside the browser, renders the UI in a sandboxed iframe, and saves the database **back into the same file**. There is no server — everything runs client-side. The single most common failure is an invented `manifest.json`; use the exact v1 schema below.

## Bundle layout
```
mytool.vessel  (ZIP, manifest.json at the root)
├── manifest.json      # required
├── ui/index.html      # required: UI entry — `vessel build` inlines local ui/*.js + *.css into it
├── app/main.py        # required: the FastAPI backend module
├── app/__init__.py    # include so `app` imports as a package
├── data/store.sqlite  # required: ships in the bundle (may be empty)
└── icon.png           # optional
```

## `manifest.json` (format v1 — use these EXACT keys)
Flat top-level keys. Unknown keys are ignored; known keys are validated strictly.

| Key | Required | Value |
|---|---|---|
| `format_version` | yes | the **number** `1` (not `"1.0"`) |
| `name` | yes | string, 1–200 chars |
| `version` | yes | string, 1–64 chars |
| `ui` | yes | safe relative path to the UI HTML, e.g. `"ui/index.html"` |
| `backend` | yes | `"module:attr"` — a **dotted** Python module path and an ASGI attribute, e.g. `"app.main:app"` (module must exist as `app/main.py` or `app/main/__init__.py`) |
| `data` | yes | safe relative path to the SQLite DB, e.g. `"data/store.sqlite"` |
| `packages` | no | array of PyPI/Pyodide distribution names to load, e.g. `["fastapi"]` |
| `python` | no | advisory version string, e.g. `">=3.12"` |
| `capabilities` | no | `{ "network": ["https://api.example.com"], "clipboard": false, "print": false }` |
| `publisher` | no | string, ≤200 chars |
| `signed_by` | no | `"ed25519:<base64 pubkey>"` (set by `vessel build --sign`) |

Paths must be **safe relative paths**: no leading `/`, no `..`, no backslashes; chars `A–Z a–z 0–9 . _ - /` only.

## Hard constraints (these break bundles if ignored)
- **`async def` routes only.** Pyodide has no OS threads; FastAPI sends sync (`def`) routes to a threadpool, which raises "can't start new thread". Every route must be `async def`.
- **Declare every package** in `packages`. Nothing is auto-installed except stdlib. `micropip` loads the dependency closure for listed dists (FastAPI pulls pydantic etc.), but you must list the top-level ones (at minimum `"fastapi"`).
- **Single self-contained `ui/index.html` (the host serves only this file).** You can split your source into local `ui/*.js` + `*.css` — `vessel build` inlines local `<script src>` / `<link rel="stylesheet">` into `index.html` for you (remote `https://…` and `data:` refs are left as-is). ES-module *graphs* aren't bundled: keep a module UI flat or pre-bundle it (esbuild/Vite). If you hand-zip a bundle instead of using `vessel build`, you must inline everything yourself — anything not in `index.html` won't be served.
- **SQLite via stdlib `sqlite3`**, opened at the manifest `data` path **relative to the bundle root** (e.g. `"data/store.sqlite"`). The host persists this file back into the `.vessel` on save. Ship the file even if empty (a 0-byte file is a valid new DB).
- **Default-deny network.** Bundle code (Python and UI) can reach only the `https` origins listed in `capabilities.network`. Omit it and there is no network — which is fine, because the UI talks to the backend over an in-process bridge, not the network (see below).
- **Request/response only** — no WebSockets or streaming responses in v1.

## The UI ↔ backend bridge
The UI calls `fetch('/api/...')`; the host intercepts these and dispatches them **in-process** into the ASGI app (no real network is used). So define ordinary FastAPI routes (e.g. `GET /api/note`) and call them from the UI with `fetch('/api/note')`. Routes that don't start with the API path are still your app's — there's no host-injected prefix to account for.

## Theming (free — don't hardcode colors)
The host injects `--vessel-*` CSS variables + a classless base stylesheet, themed
to the user's selected theme and light/dark mode and **re-themed live** on toggle.
So write **plain semantic HTML** — `button`, `input`, `select`, `textarea`,
headings, `table`, `code` are styled automatically and match the host. Do **not**
hardcode colors; rely on the base styles or use `var(--vessel-…)`. Tokens:
`--vessel-bg`, `--vessel-surface`, `--vessel-field`, `--vessel-text`,
`--vessel-text-muted`, `--vessel-border`, `--vessel-accent`, `--vessel-accent-text`,
`--vessel-ok`, `--vessel-danger`, `--vessel-radius`, `--vessel-font`,
`--vessel-font-mono`. Utility classes: `.vessel-primary` (accent button),
`.vessel-danger`, `.vessel-card`, `.vessel-muted`. Optional brand theme: ship a
`theme.json` (`{ "light": {…}, "dark": {…} }` — partial token values) and set
`manifest.theme` to its path; light/dark stays user-controlled. `base_styles:
false` opts out of the base styles.

**Gotcha — icon-only buttons:** the base stylesheet sets `button { padding: 8px
14px; }`. A fixed-size icon-only `<button>` (e.g. `width:22px;height:22px`) with no
padding override collapses its content box to 0 under `box-sizing:border-box`, so
the icon renders invisibly. Always set `padding: 0` on small icon-only buttons.

## Complete minimal example
**`manifest.json`**
```json
{
  "format_version": 1,
  "name": "Notes",
  "version": "1.0.0",
  "ui": "ui/index.html",
  "backend": "app.main:app",
  "data": "data/store.sqlite",
  "python": ">=3.12",
  "packages": ["fastapi"]
}
```

**`app/__init__.py`** — empty file.

**`app/main.py`**
```python
import sqlite3
from fastapi import FastAPI
from pydantic import BaseModel

DB = "data/store.sqlite"  # relative to the bundle root
app = FastAPI()

def _con():
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS note "
        "(id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL DEFAULT '')"
    )
    con.execute("INSERT OR IGNORE INTO note (id, body) VALUES (1, '')")
    con.commit()
    return con

class Note(BaseModel):
    body: str

@app.get("/api/note")
async def get_note():
    con = _con()
    row = con.execute("SELECT body FROM note WHERE id = 1").fetchone()
    con.close()
    return {"body": row[0] if row else ""}

@app.post("/api/note")
async def save_note(note: Note):
    con = _con()
    con.execute("UPDATE note SET body = ? WHERE id = 1", (note.body,))  # parameterized
    con.commit()
    con.close()
    return {"ok": True}
```

**`ui/index.html`** (self-contained)
```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Notes</title></head>
  <body>
    <textarea id="note" rows="10" cols="40"></textarea>
    <button id="save" class="vessel-primary">Save</button>
    <script>
      const note = document.getElementById("note");
      fetch("/api/note").then((r) => r.json()).then((d) => (note.value = d.body));
      document.getElementById("save").onclick = () =>
        fetch("/api/note", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: note.value }),
        });
    </script>
  </body>
</html>
```

**`data/store.sqlite`** — create an empty file (the backend builds the schema on first run).

## Packaging & validating
Zip the directory with `manifest.json` at the root and the `.vessel` extension. If you have the Vessel SDK (the `vessel` CLI — run it from a clone of the repo until it's published to npm), prefer `vessel new` to scaffold, `vessel dev` to run with host parity, and `vessel build <dir>` to package — `build` re-validates with the host's own loader and fails on a bad bundle. The host rejects any bundle that fails manifest validation, has an unsafe path, or exceeds the limits (64 MB compressed / 256 MB uncompressed / 128 MB per entry / 10,000 entries; ZIP64 unsupported).

## Common mistakes
| Mistake | Fix |
|---|---|
| Invented manifest keys (`manifestVersion`, `entry`, `runtime`, `database`, `permissions`, `id`) | Use the flat v1 schema above; `format_version` is the number `1` |
| `backend` as a file path (`"app/main.py"`) | `backend` is dotted `module:attr` (`"app.main:app"`) |
| Sync `def` routes | `async def` only — Pyodide has no threads |
| Forgot `packages` | List every top-level PyPI dist (at least `"fastapi"`) or it won't load |
| Hand-zipped multi-file UI (host serves only the ui file) | Build with `vessel build` (it inlines local JS/CSS), or inline manually |
| `permissions.network: []` | `capabilities.network: ["https://…"]`; omit entirely for no network |
| WebSockets / streaming responses | Request/response only in v1 |
| Opening the DB at an absolute path | Open it at the relative `data/...` path from the manifest |
