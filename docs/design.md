# Vessel — Design Document

> A browser-installable runtime host that opens self-contained web-tool bundles.
> *Working name; `Vessel` and the `.vessel` extension are placeholders — swap in whatever fits your naming canon.*

## Thesis

Recreate the thing that makes Excel portable — **an installed interpreter plus a zipped data file** — but for real web-tech tools. You install one small PWA once (the "engine"). After that, any `.vessel` file (the "document") opens by double-click, runs a React UI backed by a Python/SQLite backend, keeps its data *inside the file*, and saves changes back to that same file with no prompt. The runtime lives in the host, not in every bundle, so individual tools stay small and the heavy parts download once.

The whole project is a bet that the Excel model — ubiquitous engine + portable zipped document — is the right shape, and that today's web platform (File Handling API, `launchQueue`, OPFS, Pyodide, WASM SQLite) finally has every piece needed to build it without a server and without waiting for a standard.

## Goals and non-goals

**Goals**
- One passable file per tool; the data travels *in* the file.
- Double-click to open via real OS file association.
- Install the host once; never install anything per-tool.
- Works fully offline after first run.
- Frictionless save back to the same file (no per-session picker).
- A tool author's real stack — FastAPI + SQLite + React — runs essentially unmodified.
- An open, documented bundle format anyone can target.
- A defensible sandbox: opening an untrusted bundle must be safe by default.

**Non-goals**
- Not a general container runtime. No arbitrary Linux binaries, no kernel emulation.
- Not a multi-user server platform. Single user, single file, local.
- Not a W3C standard. A pragmatic convention, like `.xlsx` was before OOXML was ratified.
- Not trying to support every Python package — only what Pyodide can load.

## Architecture

```
  ┌──────────────────────────────────────────────────────────────┐
  │  OS file manager:  double-click  mytool.vessel                 │
  └───────────────────────────────┬──────────────────────────────┘
                                   │ file_handlers + launchQueue
                                   ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  VESSEL HOST  (installed PWA, served from a static origin)     │
  │                                                                │
  │   launch handler ──► FileSystemFileHandle (read + WRITE)       │
  │        │                                                       │
  │        ▼                                                       │
  │   bundle loader (unzip in memory: fflate / zip.js)             │
  │        │                                                       │
  │        ├──► manifest.json  ── validate, read capabilities      │
  │        ├──► data/store.sqlite ──► Pyodide virtual FS           │
  │        └──► app/*.py ──────────► Pyodide virtual FS            │
  │                                                                │
  │   ┌────────────── Pyodide (CPython + stdlib sqlite3) ───────┐  │
  │   │   import app.main:app   (a FastAPI/Starlette ASGI app)  │  │
  │   └─────────────────────────▲───────────────────────────────┘  │
  │                             │ ASGI scope / receive / send       │
  │   fetch-to-ASGI bridge ─────┘                                   │
  │        ▲                                                       │
  │        │ postMessage / scoped service-worker fetch             │
  │   ┌────┴─────────────────────────────────────────────────┐    │
  │   │  sandboxed iframe:  the bundle's React UI (untrusted) │    │
  │   │  does ordinary  fetch('/api/...')                     │    │
  │   └──────────────────────────────────────────────────────┘    │
  │                                                                │
  │   service worker: precaches Pyodide core + common wheels       │
  │   (download once → offline forever)                            │
  │                                                                │
  │   save: snapshot sqlite → rewrite zip entry → write handle     │
  └──────────────────────────────────────────────────────────────┘
```

Five moving parts:

1. **The host PWA.** Served from a static origin you control (GitHub Pages, S3, or self-hosted). Installed once. Its manifest declares `file_handlers` for `.vessel` so the OS routes the file to it. The **Pyodide runtime + common wheel set are self-hosted from that same origin** (vendored at build into `/app/pyodide/`, not pulled from a third-party CDN) — so the runtime loads wherever the host page loads, including behind corporate proxies that block/strip CORS on CDN fetches. A service worker caches them (same-origin) so everything works offline and loads instantly on subsequent runs.

2. **The launch handler.** `launchQueue.setConsumer(params => …)` receives `params.files`, each a `FileSystemFileHandle`. Crucially, the handle delivered on launch is **writable** with permission, which is what kills the save prompt. The host reads the bundle and, on save, writes back to this same handle.

3. **The bundle loader.** Unzips the `.vessel` in memory, validates `manifest.json`, mounts the SQLite file and Python sources into Pyodide's virtual filesystem.

4. **The runtime + bridge.** Pyodide runs CPython with the built-in `sqlite3`. The bundle's backend is an ordinary ASGI app (FastAPI/Starlette). The host intercepts the UI's `fetch('/api/...')` calls and dispatches them straight into that ASGI app in-process — no socket, no server. The author writes normal FastAPI; the host does the translation.

5. **The UI host.** The bundle's React build renders inside a sandboxed iframe, isolated from the host page, talking to the bridge over a controlled channel.

## Bundle format (`.vessel`)

A ZIP archive with a defined layout — the same philosophy as `.xlsx`/OPC: a zip with a manifest and well-known parts.

```
mytool.vessel  (ZIP)
├── manifest.json          # required: identity, entry points, capabilities
├── ui/                    # static frontend build (index.html + assets)
│   └── index.html
├── app/                   # Python package; backend lives here
│   └── main.py            # exposes `app` — an ASGI callable
├── data/
│   └── store.sqlite       # the database that travels with the file
├── wheels/                # optional: vendored wheels for offline / extra deps
├── icon.png               # optional
└── signature.sig          # optional: Ed25519 signature over the bundle
```

**`manifest.json` schema (v1 sketch):**

```jsonc
{
  "format_version": 1,
  "name": "Substation Battery Sizing",
  "version": "1.4.0",
  "ui": "ui/index.html",
  "backend": "app.main:app",          // module:attr for the ASGI app
  "data": "data/store.sqlite",
  "python": ">=3.12",
  "packages": ["numpy", "pvlib"],     // resolved from Pyodide / wheels/
  "capabilities": {
    "network": ["https://api.weather.gov"],  // egress allowlist; default: none
    "clipboard": false,
    "print": true
  },
  "publisher": "BA Engineers LLC",
  "signed_by": "ed25519:…"            // optional
}
```

The manifest is the trust and capability boundary. Anything not declared is denied.

## The bridge contract

The single most important design choice, because it determines whether other people can author bundles without learning a bespoke API.

**Decision: the host emulates HTTP; authors write ordinary FastAPI.** The UI does `fetch('/api/whatever')` exactly as it would against a real backend. The host catches that request and dispatches it into the bundle's ASGI app by constructing the ASGI `scope`/`receive`/`send` and awaiting the app in Pyodide, then returns the response to the iframe. Two viable transports:

- **Scoped service-worker fetch.** The service worker intercepts requests under the bundle's virtual origin and forwards them to the bridge. Cleanest — the UI's `fetch` is untouched.
- **postMessage RPC.** The iframe posts the request to the host, which runs it and posts the response back; a tiny shim in the bundle wraps `fetch`. Simpler to reason about; slightly less transparent.

Either way the author target is "write a FastAPI app, read/write SQLite with `sqlite3`, return JSON." That familiarity is the adoption lever. SQLite access is just stdlib `sqlite3` against the mounted `data/store.sqlite`; on save the host snapshots those bytes back into the zip.

Out of scope for v1: long-lived websockets and streaming responses. Request/response only.

## Persistence and save model

- **Writable launch handle** → save writes back to the same file with no prompt. This is the entire reason to prefer the PWA over a bare page or an extension.
- **Autosave**, debounced, with explicit Save and a dirty indicator. Engineers expect Excel-like "it's saved."
- **Atomic writes**: serialize sqlite → assemble new zip → write to a temp handle → swap, so a crash mid-save never corrupts the file.
- **In-file history (optional, Excel-grade nicety)**: keep the last N sqlite snapshots inside the zip for undo / point-in-time recovery, pruned by size.
- **Fallback path** when the file wasn't opened via launch (e.g., drag-dropped, or on a browser without File Handling): fall back to `showSaveFilePicker` once, then reuse the handle for the session.

## Security model

> **Implemented:** sandboxed iframe + CSP, Pyodide in a Web Worker,
> **default-deny egress** (manifest allowlist enforced via a worker fetch/XHR
> wrapper + iframe `connect-src`), **per-bundle capability prompts**, and optional
> **Ed25519 signing** with signed/unsigned/invalid badging. Deferred: a
> trusted-key "verified publisher" list, a worker-level network CSP, and reliable
> offline precache.

This is the project's existential constraint. A format that opens a file and runs its embedded code with persistence is, historically, *the* malware pattern (Office macros, ActiveX). If the safety story isn't airtight and legible, the project shouldn't ship. Design principles:

- **Bundle code is untrusted, always.** The UI runs in a `sandbox`ed iframe with no same-origin access to the host and a strict CSP. The Python runs inside Pyodide, which is itself a WASM sandbox with no host filesystem and no arbitrary syscalls.
- **No ambient disk access.** The bundle can only touch its *own* data inside the zip. The writable file handle is held by the host, never handed to bundle code.
- **Default-deny network.** Pyodide's network calls route through a host-controlled fetch that enforces the manifest's egress allowlist. No declaration → no network. (This mirrors a VLAN allowlist mindset: nothing talks out unless you said it could.)
- **Capability prompts.** On first open of a bundle that requests network/clipboard/etc., the host shows what it wants and who (if anyone) signed it. Decisions are remembered per bundle.
- **Optional signing.** Bundles can be signed with Ed25519; an org distributes a publisher public key, and the host badges bundles as *signed by X* vs *unsigned*. Lets a firm trust its internal authors without trusting the world.
- **Pinned supply chain.** Host pins the Pyodide version and verifies wheel hashes.

The honest framing for users: *opening a `.vessel` is closer to opening a web page than running an .exe — it's sandboxed, it can't see your disk, and it only reaches the network you allow.* If that sentence isn't defensibly true, fix the design until it is.

## Offline strategy

Service worker precaches Pyodide core plus a curated common wheel set on install. Bundles needing packages outside that set vendor wheels in `wheels/`. First run requires network to populate the cache; thereafter the host and any cached-dependency bundle run fully offline. Cache is versioned to the pinned Pyodide release.

## Browser support and degradation

| Capability | Chrome / Edge | Firefox / Safari |
|---|---|---|
| Install as PWA | ✅ | partial |
| File association (`file_handlers`) | ✅ | ❌ |
| Writable launch handle | ✅ | ❌ |
| Open via in-app picker | ✅ | ✅ |
| Save via `showSaveFilePicker` | ✅ | ❌ (download fallback) |
| Pyodide + SQLite runtime | ✅ | ✅ |

Chromium gets the full Excel-like experience. Elsewhere, the runtime still works; you lose double-click association and frictionless save, degrading to "open from inside the app, save by download." The host can also emit a **single-file HTML export** of any bundle (the all-in-one fallback) for recipients who have nothing installed — your universal lowest-common-denominator handoff.

## Authoring experience (the SDK)

Adoption lives or dies on the dev loop. Ship a CLI alongside the host:

- `vessel new` — scaffold a tool: FastAPI app, React+Vite UI, sample SQLite schema, manifest.
- `vessel dev` — run a local dev server that **emulates the host bridge** (same `fetch('/api/...')` → ASGI path) with hot reload, so authoring feels like normal web dev.
- `vessel build` — package `ui/` + `app/` + `data/` + manifest into a `.vessel`, optionally sign it.

Dev/host parity is the rule: anything that works under `vessel dev` must behave identically when opened in the host. A Vite plugin can handle the UI build and inline assets.

## Reference toolchain

- Runtime: **Pyodide** (CPython + `sqlite3`), run in a Web Worker to keep the UI responsive.
- Zip: **fflate** (tiny, fast) or **zip.js**.
- Worker RPC: **Comlink**.
- Handle persistence across sessions: **idb-keyval**.
- Sample backend: **FastAPI / Starlette**. Sample UI: **React + Vite**.
- Host app itself: keep it light; vanilla or a minimal React shell.
- License: **Apache-2.0** for host + SDK + format spec. Permissive plus a patent grant maximizes adoption and lets others build authoring tools on top. A runtime/format wants to be everywhere.

## Status

The host, the `.vessel` v1 format, and the `vessel` SDK are implemented: the
open → edit → save → reopen loop, a validated loader, the `fetch`→ASGI bridge,
the sandboxed-iframe UI, debounced atomic autosave, default-deny egress with
per-bundle consent, Ed25519 signing, an offline service-worker cache, and
cross-browser degradation (file-input open + download-to-save on Firefox/Safari).
Deferred: a single-file HTML export, reliable offline precache, a trusted-key
"verified publisher" list, and a worker-level network CSP.

## Open questions and risks

- **Pyodide weight and cold start.** Mitigated by SW precache and lazy package loading, but first run is multi-MB and a few seconds. Document it; don't hide it.
- **Package coverage.** Only Pyodide-provided or pure-Python wheels load. numpy/scipy/pandas are fine; pvlib is largely pure Python and should work; anything depending on exotic native libraries won't. Maintain a known-good package list.
- **Bridge fidelity.** Request/response is straightforward; streaming and websockets are not, and are deliberately deferred.
- **File Handling reach.** It's Chromium-only and still a relatively niche platform feature; OS association UX varies by platform and may need user setup. The degradation path matters.
- **Trust UX is the whole ballgame.** If "should I open this `.vessel`?" isn't answered clearly and safely every time, the project becomes a malware delivery mechanism — exactly what the platform spent two decades hardening against. The security model isn't a later-phase nicety; it's the reason the project is allowed to exist.
- **Concurrency / heavy compute.** Single Pyodide worker is fine for calculators; long jobs need worker pooling or chunking.

## Prior art to study

- **TiddlyWiki** — the original single-file, self-saving app; the spiritual ancestor of the whole idea.
- **Datasette** — the Python + SQLite packaging-and-publishing model done well.
- **container2wasm** — the heavyweight cousin (full container emulation); useful as the boundary of what you're explicitly *not* doing.
- **`.xlsx` / OPC** — the format philosophy you're consciously imitating.
