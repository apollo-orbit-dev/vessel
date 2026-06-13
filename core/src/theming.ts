// Bundle theming. A small CSS-variable contract (`--vessel-*`) plus a classless
// base stylesheet that the host injects into every bundle iframe, so plain
// semantic HTML is themed and follows the host's light/dark + selected theme.
// Shared by the host (live, with toggle) and `vessel dev` (default theme).
//
// Tokens are camelCase here and emitted as kebab-case CSS vars
// (textMuted -> --vessel-text-muted). Built-in themes carry light + dark maps.

export type ThemeMode = "light" | "dark";

export interface ThemeTokens {
  bg: string; // page background
  surface: string; // cards / panels / buttons
  field: string; // input / control background
  text: string; // primary text
  textMuted: string; // secondary text, placeholders
  border: string; // hairlines, control borders
  accent: string; // primary action / focus / links
  accentText: string; // text on an accent fill
  ok: string; // success
  danger: string; // destructive / error
  radius: string; // control border-radius (CSS length)
  font: string; // UI font stack (no external fonts — CSP font-src is data: only)
  fontMono: string; // monospace stack
}

export interface VesselTheme {
  id: string;
  label: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const BUILTIN_THEMES: VesselTheme[] = [
  {
    id: "default",
    label: "Default",
    light: {
      bg: "#f5f5f4", surface: "#ffffff", field: "#ffffff", text: "#26282b",
      textMuted: "#8a8d92", border: "#dededa", accent: "oklch(0.55 0.09 230)",
      accentText: "#ffffff", ok: "oklch(0.58 0.07 155)", danger: "#e2453a",
      radius: "8px", font: SANS, fontMono: MONO,
    },
    dark: {
      bg: "#1c1e21", surface: "#26282b", field: "#2e3135", text: "#e7e8ea",
      textMuted: "#7e8186", border: "#3a3d42", accent: "oklch(0.70 0.10 230)",
      accentText: "#16181b", ok: "oklch(0.72 0.09 155)", danger: "#e2453a",
      radius: "8px", font: SANS, fontMono: MONO,
    },
  },
  {
    id: "slate",
    label: "Slate",
    light: {
      bg: "#f1f5f9", surface: "#ffffff", field: "#ffffff", text: "#0f172a",
      textMuted: "#64748b", border: "#e2e8f0", accent: "#2563eb",
      accentText: "#ffffff", ok: "#16a34a", danger: "#dc2626",
      radius: "8px", font: SANS, fontMono: MONO,
    },
    dark: {
      bg: "#0f172a", surface: "#1e293b", field: "#1e293b", text: "#e2e8f0",
      textMuted: "#94a3b8", border: "#334155", accent: "#60a5fa",
      accentText: "#0b1220", ok: "#4ade80", danger: "#f87171",
      radius: "8px", font: SANS, fontMono: MONO,
    },
  },
  {
    id: "warm",
    label: "Warm",
    light: {
      bg: "#faf6f0", surface: "#fffdf9", field: "#fffdf9", text: "#3b322a",
      textMuted: "#9b8e7e", border: "#e9ddcd", accent: "#b4530a",
      accentText: "#ffffff", ok: "#4d7c0f", danger: "#c2410c",
      radius: "10px", font: SANS, fontMono: MONO,
    },
    dark: {
      bg: "#211b15", surface: "#2a231b", field: "#2a231b", text: "#ece3d6",
      textMuted: "#a89a86", border: "#3d3328", accent: "#f59e0b",
      accentText: "#211b15", ok: "#a3e635", danger: "#fb923c",
      radius: "10px", font: SANS, fontMono: MONO,
    },
  },
];

const camelToVar = (k: string): string => "--vessel-" + k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

export function getTheme(themeId: string): VesselTheme {
  return BUILTIN_THEMES.find((t) => t.id === themeId) ?? BUILTIN_THEMES[0];
}

/** The `--vessel-*` token map for a theme + mode (for live postMessage updates). */
export function bundleThemeVars(themeId: string, mode: ThemeMode, overrides?: Partial<ThemeTokens>): Record<string, string> {
  const tokens = { ...getTheme(themeId)[mode], ...overrides };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tokens)) out[camelToVar(k)] = v;
  return out;
}

// Classless base stylesheet — themes plain semantic HTML via the tokens. Low
// specificity (element selectors) so an author's own CSS overrides cleanly.
const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;padding:20px;background:var(--vessel-bg);color:var(--vessel-text);font-family:var(--vessel-font);font-size:14px;line-height:1.5}
h1,h2,h3{line-height:1.25;font-weight:600}h1{font-size:1.5rem}h2{font-size:1.25rem}h3{font-size:1.05rem}
a{color:var(--vessel-accent);text-decoration:none}a:hover{text-decoration:underline}
hr{border:none;border-top:1px solid var(--vessel-border);margin:16px 0}
label{font-size:13px}
input,textarea,select{font:inherit;color:var(--vessel-text);background:var(--vessel-field);border:1px solid var(--vessel-border);border-radius:var(--vessel-radius);padding:8px 10px}
textarea{resize:vertical}
input::placeholder,textarea::placeholder{color:var(--vessel-text-muted)}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--vessel-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--vessel-accent) 22%,transparent)}
button{font:inherit;cursor:pointer;color:var(--vessel-text);background:var(--vessel-surface);border:1px solid var(--vessel-border);border-radius:var(--vessel-radius);padding:8px 14px;transition:background .12s,border-color .12s}
button:hover:not(:disabled){border-color:var(--vessel-accent)}
button:disabled{opacity:.5;cursor:default}
.vessel-primary{background:var(--vessel-accent);color:var(--vessel-accent-text);border-color:transparent}
.vessel-primary:hover:not(:disabled){filter:brightness(.95);border-color:transparent}
.vessel-danger{background:var(--vessel-danger);color:#fff;border-color:transparent}
.vessel-card{background:var(--vessel-surface);border:1px solid var(--vessel-border);border-radius:var(--vessel-radius);padding:16px}
.vessel-muted{color:var(--vessel-text-muted)}
code,pre{font-family:var(--vessel-font-mono)}
pre{background:var(--vessel-surface);border:1px solid var(--vessel-border);border-radius:var(--vessel-radius);padding:12px;overflow:auto}
table{border-collapse:collapse}th,td{border-bottom:1px solid var(--vessel-border);padding:8px 10px;text-align:left}
`;

/**
 * Full CSS to inject into a bundle: the `:root` token block, plus the base
 * stylesheet unless `includeBase` is false (the bundle opted out via
 * `manifest.base_styles`).
 */
export function resolveBundleThemeCss(
  themeId: string,
  mode: ThemeMode,
  overrides?: Partial<ThemeTokens>,
  includeBase = true,
): string {
  const vars = bundleThemeVars(themeId, mode, overrides);
  const root = ":root{" + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";") + "}";
  return includeBase ? root + BASE_CSS : root;
}

/** A bundle-declared theme override: partial tokens for light and/or dark. */
export interface BundleThemeOverride {
  light?: Partial<ThemeTokens>;
  dark?: Partial<ThemeTokens>;
}

const TOKEN_KEYS: (keyof ThemeTokens)[] = [
  "bg", "surface", "field", "text", "textMuted", "border",
  "accent", "accentText", "ok", "danger", "radius", "font", "fontMono",
];

// Token values are injected into `:root{ --vessel-x: VALUE }`, so they MUST NOT
// be able to break out of the declaration (`;}`), escape the <style> (`<>`), or
// load remote content (`url(...)`). Whitelist colors / lengths / font stacks.
const SAFE_VALUE = /^[A-Za-z0-9 #%.,()'"\-]{1,120}$/;

function safeTokenValue(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!SAFE_VALUE.test(s)) return null;
  if (/url\(/i.test(s) || s.includes("/*")) return null;
  return s;
}

/**
 * Parse + validate a bundle's `theme.json` as token *values* (never raw CSS).
 * Unknown keys are ignored; an unsafe value throws (the host then ignores the
 * theme rather than injecting attacker-controlled CSS).
 */
export function parseBundleTheme(raw: Uint8Array | string): BundleThemeOverride {
  const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("theme.json is not valid JSON");
  }
  if (!json || typeof json !== "object") throw new Error("theme.json must be an object");
  const out: BundleThemeOverride = {};
  for (const mode of ["light", "dark"] as const) {
    const m = (json as Record<string, unknown>)[mode];
    if (m == null) continue;
    if (typeof m !== "object") throw new Error(`theme.${mode} must be an object`);
    const tokens: Partial<ThemeTokens> = {};
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (!TOKEN_KEYS.includes(k as keyof ThemeTokens)) continue;
      const safe = safeTokenValue(v);
      if (safe === null) throw new Error(`theme.${mode}.${k}: unsafe or invalid token value`);
      tokens[k as keyof ThemeTokens] = safe;
    }
    out[mode] = tokens;
  }
  return out;
}
