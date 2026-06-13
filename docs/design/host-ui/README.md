# Handoff: Vessel — Host UI

## Overview
**Vessel** is an installable desktop PWA that acts as a universal *player* for self-contained
tool files (`.vessel` bundles), mirroring the Excel model: install the host once, then any
`.vessel` file opens by double-click, runs a full app (its own UI plus a Python/SQLite backend
in a sandboxed frame), and saves its data back into the file.

**Guiding principle:** the host is nearly invisible. When a tool is open the user should see the
**tool**, not a host wrapper. The host is just a thin window frame (titlebar + menu bar) plus a
launcher. Audience is electrical engineers — it should read like a precision instrument:
calm, flat, understated, professional.

This bundle documents five surfaces:
1. **Launcher** (no tool open)
2. **First-run boot** (runtime loading)
3. **Tool running** (example tool: *Substation Battery Sizing*)
4. **Permission prompt** (modal asking to allow network access)
5. **Settings / Preferences** (panel where appearance + runtime/security prefs live)

Plus the persistent host chrome shared by every state: an integrated **titlebar** and a thin
**menu bar**.

---

## About the Design Files
The files in this bundle are **design references created in HTML/React (via in-browser Babel)** —
prototypes showing intended look and behavior. **They are not production code to copy directly.**

The task is to **recreate these designs in Vessel's real codebase**, using its established
framework, component library, and patterns. If no front-end environment exists yet, choose the
most appropriate stack for an installable desktop PWA (e.g. React + Vite, or the team's preferred
framework) and implement the designs there.

In particular:
- The prototype loads React from a CDN and transpiles JSX in the browser — **do not** ship that
  setup. Use a real build.
- Styling in the prototype is **inline style objects** keyed off a theme tokens object. In the
  real app, translate these to the codebase's styling system (CSS variables, CSS modules,
  Tailwind, styled-components, etc.). The **token values** below are authoritative; the delivery
  mechanism is yours.
- `design-canvas.jsx` is **only a presentation harness** (a zoomable canvas used to show the
  frames side-by-side). It is **not part of the product** — ignore it when building.

---

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are intended as
shown. Recreate the UI faithfully using the codebase's libraries. Exact hex/oklch values, font
sizes, and spacing are given below and in `vessel-ui.jsx`.

---

## Design Tokens

Two themes (`light`, `dark`) plus a `system` mode that resolves to one of them via
`prefers-color-scheme`. Tokens are defined in `vessel-ui.jsx` as `vesselLight` / `vesselDark`.

### Typography
| Role | Family | Notes |
|---|---|---|
| UI / chrome / labels / headings | **Geist** | weights 400/500/540/600/700. `540` is used as a "medium-plus" for titlebar tool name. |
| All numeric & data values | **Geist Mono** | weights 400/500/600. Used for every number, status string, domain, shortcut, version, time. |

`letter-spacing: -0.01em` is applied to most mono numeric runs. The big result value uses
`-0.02em`.

> Rule of thumb the whole design follows: **any number the user reads is set in Geist Mono.**
> Prose, labels, and button text are Geist.

### Colors — Light
| Token | Value | Use |
|---|---|---|
| `bar` | `#f5f5f4` | titlebar + menu-bar background (host chrome) |
| `barBorder` | `#e4e4e1` | divider under titlebar and under menu bar |
| `appBg` | `#f5f5f4` | launcher / boot background |
| `toolBg` | `#ffffff` | tool sandbox surface (brighter than chrome = boundary cue) |
| `toolHeader` | `#fbfbfa` | tool's own header strip + results panel bg |
| `text` | `#26282b` | primary ink |
| `textMid` | `#5b5e63` | secondary ink (labels) |
| `textMuted` | `#8a8d92` | tertiary ink (hints, units, times) |
| `hair` | `#e9e9e6` | hairline dividers inside surfaces |
| `hairStrong` | `#dededa` | stronger hairline (modal/menu borders, empty-state ring) |
| `field` | `#ffffff` | input background |
| `fieldBorder` | `#dadad7` | input border |
| `chip` | `#f1f1ef` | hover fill, domain chip, recent-item icon bg |
| `accent` | `oklch(0.55 0.09 230)` | **the single accent** — slate-blue. Primary buttons, signed badge, active segment, toggle-on, menu checkmark |
| `accentSoft` | `oklch(0.55 0.09 230 / 0.10)` | accent tint fill (badge bg, active segment bg, glyph fill) |
| `accentBorder` | `oklch(0.55 0.09 230 / 0.30)` | accent tint border |
| `onAccent` | `#ffffff` | text on accent |
| `ok` | `oklch(0.58 0.07 155)` | "Saved" dot, verified dot (muted green) |
| `closeHover` | `#e2453a` | titlebar close-button hover only |
| `winBorder` | `#d0d0cc` | outer window border |
| `winShadow` | `0 18px 50px -12px rgba(20,22,28,0.28), 0 4px 12px rgba(20,22,28,0.10)` | window/modal elevation (presentation only) |
| `toolTop` | `inset 0 1px 0 rgba(0,0,0,0.025)` | faint top edge on tool surface |

### Colors — Dark
| Token | Value |
|---|---|
| `bar` | `#26282b` |
| `barBorder` | `#34373b` |
| `appBg` | `#26282b` |
| `toolBg` | `#1c1e21` (deeper than chrome = boundary cue) |
| `toolHeader` | `#212327` |
| `text` | `#e7e8ea` |
| `textMid` | `#aeb1b6` |
| `textMuted` | `#7e8186` |
| `hair` | `#303338` |
| `hairStrong` | `#3a3d42` |
| `field` | `#26282b` |
| `fieldBorder` | `#3c3f44` |
| `chip` | `#2e3135` |
| `accent` | `oklch(0.70 0.10 230)` (lifted a step in L/C to hold against dark chrome) |
| `accentSoft` | `oklch(0.70 0.10 230 / 0.16)` |
| `accentBorder` | `oklch(0.70 0.10 230 / 0.40)` |
| `onAccent` | `#16181b` |
| `ok` | `oklch(0.72 0.09 155)` |
| `winBorder` | `#000000` |
| `toolTop` | `inset 0 1px 0 rgba(0,0,0,0.22)` |

### Spacing / radius
- Spacing is informal but consistent: 6 / 8 / 10 / 12 / 16 / 18 / 20 / 22 / 26 / 28 / 40 px.
- Radius: inputs/segments `7–8`, buttons `7`, chips/badges `4`, menu & modal `9–12`, window `10`,
  recent rows `9`, toggles `11` (pill).
- Hairline borders are always `1px`.
- **Flat:** no gradients, no decorative shadows on content. The only shadows are window/modal
  elevation (`winShadow`) and the faint inset boundary edges.

### Window
- App window is **1100 × 720** (design size). Rounded `10px`, `1px solid winBorder`, `winShadow`.
- Titlebar height **40px**. Menu bar height **30px**. Tool area fills the rest.

---

## Host Chrome (shared by all states)

### Titlebar (40px) — "variant B"
Single integrated bar that doubles as the OS window titlebar (this is an installed PWA, so the
host bar *is* the titlebar with caption controls inset right).

Layout (left → right), `background: bar`, `border-bottom: 1px barBorder`:
- **Left cluster** (`padding: 0 12px`, `gap: 10`): app glyph; in **launcher** mode also the
  wordmark **"Vessel"** (Geist 600, 13px). In **tool** mode the left shows only the glyph.
- **Center (absolute, full-width centered, `pointer-events: none`)**: shown only in **tool**
  mode — the **signed badge** + tool name (Geist 540, 13px). Absolute positioning keeps it
  centered in the whole window regardless of left/right cluster widths.
- **Right cluster** (`padding-right: 8`): in **launcher**, the runtime status
  `runtime cached · offline ready` (Geist Mono 11.5px, `textMuted`). In **tool**, a `Saved`
  indicator: a 6px `ok`-colored dot + "Saved" (Geist 12px, `textMid`).
- **Caption controls**: three Windows-style buttons, each **46 × 40px**, glyphs in `textMid`.
  Hover fills `rgba(125,125,125,0.14)`; the **close** button hover fills `closeHover` with white
  glyph. Glyphs: minimize = horizontal line; maximize = square outline; close = X. 1.1px strokes.

### App glyph
A simple "vessel": rounded rect outline (`accent`, 1.6 stroke) with a horizontal fill line and a
soft `accentSoft` fill in the lower portion. Default 17px in the titlebar, 30px in the launcher
empty state, 34px on boot. **Keep it this simple — do not add detail.**

### Signed / unsigned indicator (`TrustMark`)
- **signed**: pill, `accentSoft` bg, `accentBorder` 1px, `accent` text, a small check glyph +
  "signed". Height 18px, font 11px/500.
- **unsigned**: pill, transparent bg, **dashed** `hairStrong` border, `textMuted` text, "unsigned".

### Menu bar (30px)
Thin desktop menu strip, `background: bar`, `border-bottom: 1px barBorder`, present in **launcher
and tool** (hidden only during boot). Top-level items are buttons (Geist 12.5px, `textMid`,
`padding: 0 10px`, radius 5). Hover raises text to `text`; the open item gets a `chip` fill.

Behavior:
- Click a top item to open its dropdown; click again to close.
- If a menu is already open, **hovering** a sibling top item switches to it.
- Click-outside and **Escape** close the menu.

**Dropdown** panel: `toolBg` bg, `1px hairStrong`, radius 9, `padding 5`, `winShadow`,
`min-width 224` (submenus 200). Items: Geist 13px, `padding 7px 10px`, radius 6, hover `chip`.
- Optional **left checkmark** column (13px, `accent`) for radio-style items (appearance).
- Optional **right shortcut** (Geist Mono 11px, `textMuted`).
- **Submenu** parent shows a right chevron and opens a flyout to the right on hover.
- **Disabled** items: `opacity 0.45`, `textMuted`, no hover, not clickable.
- **Separators**: 1px `hair`, `margin 5px 6px`.

#### Menu structure
**File**
- New Window — `Ctrl+N`
- Open… — `Ctrl+O`
- Open Recent ▸ — submenu of recent tools (see Recents data)
- ─
- Save — `Ctrl+S` *(disabled when no tool open)*
- Save a Copy… — `Ctrl+Shift+S` *(disabled when no tool open)*
- Reveal in Folder *(disabled when no tool open)*
- ─
- Settings… — `Ctrl+,`
- ─
- Close Tool — `Ctrl+W` *(disabled when no tool open)*

**View**
- Appearance ▸ → Light · Dark · Use System Setting *(radio; checkmark on active)*

**Help**
- About Vessel
- Runtime Status
- Documentation

---

## Screens / Views

### 1. Launcher (no tool open)
- **Purpose:** open a `.vessel` file, or re-open a recent one.
- **Layout:** titlebar + menu bar, then a flex column **centered** in the remaining area
  (`background: appBg`, `padding: 0 40px`), inner `max-width: 460px`.
- **Components (top → bottom):**
  - **Empty-state glyph**: 64×64 rounded-16 square, `1px hairStrong`, `toolBg` bg, containing the
    30px app glyph.
  - **"No tool open"** — Geist 16px/560, `text`. (`margin-top: 20`)
  - **Subtext** — Geist 13px, `textMuted`, centered, line-height 1.5: *"Open a `.vessel` file to
    run its tool. Each file carries its own app and data."* The token `.vessel` is set in Geist
    Mono 12.5px `textMid`.
  - **Primary button** *Open a .vessel…* with a folder icon. (`margin-top: 22`)
  - **Hint** — "or drop a file onto this window" (Geist 12px, `textMuted`).
  - **Recent** section (`margin-top: 40`, full width): a header row — "RECENT" (Geist 11px/600,
    uppercase, `0.07em` tracking, `textMuted`) followed by a 1px `hair` rule — then a list of
    recent rows (`gap: 2`).
  - **Recent row** (button, full width, `padding: 11px 12px`, radius 9): 34×34 radius-8 `chip`
    icon showing ".v" (Geist Mono 11px/600, `textMid`); name (Geist 13.5px/500) with a
    `TrustMark` beneath; right side shows last-opened time (Geist Mono 11.5px, `textMuted`) and a
    chevron. Hover: `toolBg` fill + `0 0 0 1px hair` ring; chevron fades in.

### 2. First-run boot
- **Purpose:** shown only on first launch while the Python runtime loads.
- **Layout:** **no titlebar, no menu bar** — fully minimal. Centered flex column on `appBg`,
  `gap: 18`.
- **Components:** 34px app glyph; **"Starting runtime…"** (Geist 14.5px/540, `text`); an
  **indeterminate bar** (240×3, radius 3, track `hair`, a 40%-wide `accent` fill animating L→R,
  ~1.15s loop); subtext `python 3.12 · 14.2 MB · first launch only` (Geist Mono 11.5px, `textMuted`).
- In the prototype, boot auto-advances to the tool after **1700ms**. In production, drive this off
  real runtime-ready state.

### 3. Tool running — example tool *Substation Battery Sizing*
> Everything below the menu bar is the **tool's own UI**, rendered in a **sandboxed frame**
> (separate app). It should look visually distinct from the host. The only host cue is the
> **surface shift** ("boundary C"): the tool surface is `toolBg`, a shade off the host chrome
> `bar`, with the menu-bar divider above doing the separating. No frame, no inset well.

- **Tool header** (`padding: 16px 22px`, `border-bottom: 1px hair`, `background: toolHeader`):
  title **"Substation Battery Sizing"** (Geist 16px/600, `-0.01em`) + meta `IEEE 485 · lead-acid`
  (Geist Mono 11.5px, `textMuted`).
- **Body**: CSS grid, two columns `1fr 360px`.
  - **Left — inputs** (`padding: 26px 28px`, `gap: 20`):
    - **System voltage** — label "System voltage" + mono unit "VDC"; a **segmented control**
      `48 / 125 / 250` (mono 13px; active segment `accentSoft` bg + `accent` text). Default **125**.
    - Row of two **number fields** (`1fr 1fr`, gap 18): **Connected load** (suffix "A", default
      **110**) and **Duty cycle** (suffix "min", default **150**).
    - Row of two: **Design margin** (suffix "%", default **12.5**) and **Aging factor** — a
      read-only display field (dashed border, `textMuted`) showing **1.25 ×**.
    - **Number field** styling: 38px tall, `1px fieldBorder`, radius 7, `field` bg; the value is
      Geist Mono 14px `fieldText`; the suffix is Geist Mono 12px `textMuted`.
    - At the bottom (`margin-top: auto`): a secondary button **Sync field temperature** (globe
      icon) + a "needs network" mono hint. **This button triggers the permission prompt.**
  - **Right — results** (`border-left: 1px hair`, `background: toolHeader`, `padding: 26px`):
    - Section label "REQUIRED CAPACITY" (Geist 11px/600, uppercase, `0.07em`, `textMuted`).
    - **Prominent value**: the computed Ah in Geist Mono **52px/600**, `-0.02em`, `text`, with a
      Geist Mono 18px "Ah" unit baseline-aligned. Default reads **387 Ah**.
    - Caption `positive plate, 8-hour rate @ 25 °C` (Geist Mono 11.5px, `textMuted`).
    - 1px `hair` rule, then four **result rows** (label Geist 12.5px `textMid` ↔ value Geist Mono
      13px/500 `text`): **Cells in series** (60), **Min terminal V** (105 V), **Backup runtime**
      (2.50 h), **Uncorrected** (275 Ah).

#### Tool computation (live)
All four results recompute as inputs change:
```
load    = Connected load (A)          // default 110
hours   = Duty cycle (min) / 60       // default 150 → 2.5
aging   = 1.25                        // fixed
margin  = Design margin (%)           // default 12.5
voltage = System voltage (VDC)        // default 125

requiredAh   = load * hours * aging * (1 + margin/100)   // → 386.7 ≈ 387
cells        = round(voltage / 2.08)                     // → 60
minTerminalV = round(voltage * 0.84)                     // → 105
uncorrected  = load * hours                              // → 275
runtime      = hours                                     // → 2.50 h
```
Non-numeric input coerces to 0. These constants are placeholder engineering values — confirm the
real IEEE-485 sizing math with the tool author; the **UI contract** is "few labeled inputs → one
prominent computed value + supporting figures, all numbers in mono."

### 4. Permission prompt (modal over dimmed tool)
- **Purpose:** approve a tool's request to reach one specific domain.
- **Scrim:** `rgba(15,17,21,0.34)` + `backdrop-filter: blur(1.5px)` over the tool.
- **Card:** 440px wide, `toolBg`, radius 12, `1px hairStrong`, `winShadow`.
  - **Header row:** 38×38 radius-9 `accentSoft` tile (`accentBorder`) with a globe icon in
    `accent`; title **"Allow network access?"** (Geist 16px/600) + subtitle "Substation Battery
    Sizing" (Geist 12px, `textMuted`).
  - **Body copy** (Geist 13px, line-height 1.55, `textMid`): *"This tool wants to reach a single
    domain to fetch ambient temperature. It cannot connect to anything else."*
  - **Domain chip** (`chip` bg, `1px hair`, radius 8, `padding 11px 13px`): an `ok` dot +
    `api.weather.gov` (Geist Mono 13px, `text`) + right-aligned "HTTPS only" (Geist Mono 11px,
    `textMuted`).
  - **Trust line** (Geist 12px, `textMid`): a lock icon + "Signed by **Westgrid Instruments** ·
    verified publisher". *("Westgrid Instruments" is placeholder publisher copy.)*
  - **Footer** (`border-top: 1px hair`, `background: toolHeader`): **Deny** (ghost, far left),
    spacer, **Allow once** (secondary), **Allow always** (primary accent).
- **Behavior:** Deny → toast "Network request denied"; Allow once / always → toast "Connected to
  api.weather.gov · 11 °C". Modal closes on any choice.

### 5. Settings / Preferences (panel)
Opened via **File ▸ Settings…**. Modal over scrim (same scrim as permission). Card 480px,
`toolBg`, radius 12, `1px hairStrong`, `winShadow`.
- **Header:** "Settings" (Geist 14.5px/600) + a close (X) button (hover `chip`).
- **Appearance** section: label (uppercase 11px/600 tracking, `textMuted`) + a **3-way segmented
  control** Light · Dark · System (Geist 12.5px; active = `accentSoft` bg + `accent` text). This
  is the canonical home of the light/dark switch; **View ▸ Appearance** is a shortcut to the same
  state.
- **Runtime & security** section — three rows, each a label + hint (Geist 13px/500 + 11.5px
  `textMuted`) and a **toggle** (38×22 pill; on = `accent`, knob white; 150ms slide):
  - "Keep runtime cached for offline use" — hint "Tools open without a network connection. Uses
    ~14 MB." (default **on**)
  - "Ask before a tool accesses the network" — hint "Prompt for each new domain a tool tries to
    reach." (default **on**)
  - "Open each tool in its own window" — hint "Matches the double-click-to-open behavior of
    .vessel files." (default **on**)
- **Footer** (`border-top: 1px hair`, `background: toolHeader`): version string
  `Vessel 0.4.1 · runtime python 3.12` (Geist Mono 11px, `textMuted`) + **Done** (primary).

---

## Interactions & Behavior

### Navigation / flow (prototype state machine)
`screen ∈ { launcher, boot, tool }`
- **Launcher → boot**: clicking *Open a .vessel…*, a recent row, or File ▸ Open (when no tool is
  open) sets `boot`, then after **1700ms** → `tool`. In production, replace the timer with real
  runtime-ready + tool-loaded signals. Boot is **first-launch only**; subsequent opens may skip
  straight to the tool once the runtime is cached.
- **tool → launcher**: File ▸ Close Tool.
- **New Window** / opening a file **while a tool is already open**: in the real app these open a
  **new OS window** (each `.vessel` is its own window, per the "Open each tool in its own window"
  pref). The prototype only shows a confirmation toast since it can't spawn OS windows.

### Menus
See "Menu bar" above. All actions dispatch through one handler; in the prototype non-navigation
actions (Save, Save a Copy, Reveal, About, Runtime Status, Documentation) surface a **toast**.
Wire these to real handlers.

### Appearance switching
`appearance ∈ { light, dark, system }`. `system` resolves via
`matchMedia('(prefers-color-scheme: dark)')`. Changing it (Settings segmented control or View ▸
Appearance) re-themes the entire app immediately. Persist this preference.

### Toasts
Bottom-center pill, `text` bg / `appBg` text, Geist Mono 12.5px, radius 8, `winShadow`. Auto
dismiss ~2.2–2.6s. Used for confirmations only — not for errors that need action.

### States to build that the prototype only hints at
- **Saving / Saved**: titlebar shows "Saved"; add a transient "Saving…" (dot → `textMuted`) on
  write.
- **Unsigned tool**: launcher + titlebar should show the `unsigned` variant of `TrustMark`; an
  unsigned tool opening may warrant its own caution affordance (not designed yet — ask).
- **Permission denied / offline / tool error**: not yet designed. Flag if needed.

---

## State Management
| State | Type | Trigger / notes |
|---|---|---|
| `appearance` | `'light' \| 'dark' \| 'system'` | Settings / View menu. **Persist.** Resolves to a theme. |
| `screen` | `'launcher' \| 'boot' \| 'tool'` | Open/close actions; boot is transient. |
| `permissionOpen` | boolean | Tool requests network (Sync field temperature). |
| `settingsOpen` | boolean | File ▸ Settings… / close. |
| `prefs` | `{ cache, warnNet, multiWin }` | Toggles in Settings. **Persist.** |
| `toast` | string \| null | Transient confirmations. |
| **Tool inputs** | `voltage, load, duty, margin` | Live-recomputed results (see formula). Owned by the tool, not the host. |

Host vs tool boundary: `appearance / screen / prefs / permission / settings` are **host** state.
The battery-sizing inputs and results are **tool** state living inside the sandboxed frame — in
the real product the tool is a separate app communicating with the host over a defined channel
(e.g. postMessage / IPC), and the host brokers things like the network-permission prompt.

---

## Recents data (placeholder)
```
[
  { name: 'Substation Battery Sizing',   signed: true,  time: '2h ago' },
  { name: 'Cable Ampacity — IEC 60287',  signed: true,  time: 'yesterday' },
  { name: 'Relay Coordination Notes',    signed: false, time: '3d ago' },
]
```

## Assets
- **Fonts:** Geist + Geist Mono (Google Fonts). In production, self-host or use the team's font
  pipeline.
- **Icons:** all drawn inline as minimal stroked SVG (currentColor, ~1.5 stroke): minimize /
  maximize / close, check, lock, three-dots, folder, chevron-right, globe, arrow. Replace with the
  codebase's icon set if it has equivalents; keep them monoline and understated.
- **No raster images.** The app glyph is the only brand mark — a simple rounded-rect "vessel".
- **Publisher name** "Westgrid Instruments", **version** "0.4.1", and the runtime figures
  (python 3.12, 14.2 MB) are placeholder copy.

## Files in this bundle
- `Vessel Host UI.html` — entry point; loads fonts, React (CDN), and the two JSX files below.
- `vessel-ui.jsx` — **the design system + all host components**: tokens (`vesselLight` /
  `vesselDark`), icons, `Button`, `TitleBar`, `MenuBar` (+ `MenuDropdown`, `buildMenus`),
  `TrustMark`, `VesselGlyph`, `LauncherBody`, `BootBody`, `Sandbox`, `BatteryTool`,
  `PermissionModal`, `Preferences`, `AppWindow`. **This is the primary reference file.**
- `vessel-app.jsx` — the interactive state machine (`VesselApp`) wiring the above together, plus
  the canvas composition of all frames. Read `VesselApp` for the behavior contract.
- `design-canvas.jsx` — **presentation harness only (ignore for the build).**

To view the reference: open `Vessel Host UI.html` in a browser. The top frame is the live,
clickable prototype; below it are pinned static frames of each state, a dark-mode pair, and the
top-bar / boundary explorations.
