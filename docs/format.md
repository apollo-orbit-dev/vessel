# The `.vessel` bundle format — v1

A `.vessel` file is a ZIP archive (OPC/`.xlsx`-style: zipped parts + a manifest)
carrying a tool's UI, its Python backend, and its SQLite data together. This is
the authoritative spec for **format version 1**.

> The loader (`core/src/bundle.ts`, `manifest.ts`, `zipsafe.ts`) enforces
> everything below. `capabilities.network` is **enforced**: bundle code (Python
> and UI) can only reach the declared https origins — default-deny. Other
> capabilities (clipboard/print) are declared, not yet enforced.

## Layout
```
mytool.vessel  (ZIP)
├── manifest.json          # required: identity, entry points, capabilities
├── ui/index.html          # required: self-contained UI entry (see UI note)
├── app/main.py            # required: the backend module (exposes the ASGI app)
├── data/store.sqlite      # required: the database that travels with the file
├── wheels/                # optional: vendored wheels (later)
├── icon.png               # optional
└── signature.sig          # optional: Ed25519 signature over the other files
```

### UI note (v1)
The shipped UI entry must be a **single self-contained HTML file** — the host
serves only the manifest `ui` file into the sandboxed iframe; external
`assets/*.js|css` are not served in v1 (a service-worker virtual-origin
transport would lift this at the host level).

At **authoring** time you don't have to inline by hand: `vessel build` inlines
local `<script src>` / `<link rel="stylesheet">` into `index.html` (remote
`https://…` and `data:` refs are left as-is). ES-module *graphs* are not
bundled. Hand-built bundles (not via `vessel build`) must inline everything
themselves. `vessel inspect` warns if a bundle's UI still references a separate
local asset.

## Entry paths
Every path inside a bundle (manifest `ui`/`data`, and every ZIP entry) must be a
**safe relative path**:
- relative — no leading `/`, no Windows drive (`C:`), no backslashes;
- charset limited to `A–Z a–z 0–9 . _ - /`;
- no empty, `.`, or `..` segments (no path traversal / zip-slip).

## `manifest.json`
```jsonc
{
  "format_version": 1,                       // required: must be exactly 1
  "name": "Substation Battery Sizing",       // required: 1–200 chars
  "version": "1.4.0",                         // required: 1–64 chars
  "ui": "ui/index.html",                      // required: safe relative path
  "backend": "app.main:app",                  // required: "module:attr" (ASGI app)
  "data": "data/store.sqlite",                // required: safe relative path
  "python": ">=3.12",                         // optional: ≤32 chars (advisory in v1)
  "packages": ["fastapi", "numpy"],           // optional: ≤200 dist names
  "capabilities": {                           // optional (declared, not enforced in v1)
    "network": ["https://api.weather.gov"],   // optional: ≤50 https URLs
    "clipboard": false,                       // optional
    "print": true                             // optional
  },
  "publisher": "BA Engineers LLC",            // optional: ≤200 chars
  "signed_by": "ed25519:…",                   // optional: ≤512 chars
  "theme": "theme.json",                      // optional: path to a token-value theme (see Theming)
  "base_styles": true                         // optional: default true; false = no base component CSS
}
```

- `backend` is `module:attr` — a dotted Python module path and an attribute that
  is an ASGI callable. The named module must exist in the bundle as
  `<module>.py` or `<module>/__init__.py`.
- `packages` are PyPI/Pyodide distribution names (`^[A-Za-z0-9][A-Za-z0-9._-]*$`).
- Unknown manifest keys are ignored (additive forward-compatibility); known keys
  are validated strictly. A future format will bump `format_version`.

## Backend notes (Pyodide constraints)
The backend runs in Pyodide (CPython on WASM), which shapes what authors can do:
- **`async def` routes only.** Pyodide has no OS threads. FastAPI/Starlette
  dispatch *sync* (`def`) routes to a threadpool, which raises "can't start new
  thread". Define routes as `async def` so they run on the event loop.
- **`sqlite3`** is available (the host loads it as a runtime baseline) — use it
  as normal stdlib; the DB file is the manifest's `data` path, relative to the
  bundle root.
- **`packages`** are resolved by `micropip` at load time, including the
  dependency closure for distributions Pyodide provides (verified for FastAPI,
  incl. the `pydantic-core` wasm wheel). If a transitive Pyodide-provided
  dependency isn't pulled automatically, list it explicitly in `packages`.
- **Request/response only** — no WebSockets or streaming responses in v1.

## Theming
The host injects a standard set of **`--vessel-*` CSS variables** plus a
**classless base stylesheet** into every bundle UI, themed to the user's selected
theme and light/dark mode — and **re-themes live** when the user toggles. So plain
semantic HTML (`button`, `input`, `select`, `textarea`, headings, `table`, `code`…)
is styled automatically; an author writes no colors and the tool matches the host.

Tokens: `--vessel-bg`, `--vessel-surface`, `--vessel-field`, `--vessel-text`,
`--vessel-text-muted`, `--vessel-border`, `--vessel-accent`, `--vessel-accent-text`,
`--vessel-ok`, `--vessel-danger`, `--vessel-radius`, `--vessel-font`,
`--vessel-font-mono`. Utility classes: `.vessel-primary` (accent button),
`.vessel-danger`, `.vessel-card`, `.vessel-muted`. Style with `var(--vessel-…)` for
custom elements; override the base styles with your own CSS (it wins by order).

**Author theme (optional).** Set `manifest.theme` to a `theme.json` in the bundle:
```json
{ "light": { "accent": "#7c3aed" }, "dark": { "accent": "#a78bfa" } }
```
It is **partial** (merged over the Default theme) and applies to your tool while
**light/dark stays user-controlled**. Values are validated as **token values**
(colors / lengths / font stacks) — not arbitrary CSS — so a theme can't inject
styles or load remote content; an invalid value makes the host ignore the theme.
Set `base_styles: false` to drop the base component styles (you supply your own).

## Signing (optional, Ed25519)
A bundle may be signed: `manifest.signed_by` holds `ed25519:<base64 public key>`
and `signature.sig` holds an Ed25519 signature over a canonical encoding of all
other files (so any change — including to the manifest — breaks it). The host
verifies on open and badges the bundle **signed** (valid), **unsigned** (none),
or **invalid signature** (present but doesn't verify — treated as a warning, not
downgraded to unsigned). A valid signature proves the bundle is tamper-free and
identifies the signing key; mapping that key to a *trusted* publisher is a
host-side trusted-key step (not yet built). Sign with `vessel build --sign`.

## Limits (loader-enforced)
| Limit | Value |
|---|---|
| Compressed `.vessel` size | 64 MB |
| Total uncompressed size | 256 MB |
| Per-entry uncompressed size | 128 MB |
| Entry count | 10,000 |
| ZIP64 | unsupported in v1 |

Bundles exceeding a limit, containing an unsafe path, or failing manifest
validation are rejected with a user-safe error and are not run.
