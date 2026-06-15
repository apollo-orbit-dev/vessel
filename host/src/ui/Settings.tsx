import type { ReactNode } from "react";
import { BUILTIN_THEMES } from "@vessel/core";
import { useTheme, useAppearance, UIFONT, MONO } from "../theme";
import { Button, Toggle, SegText } from "./primitives";
import { IconClose } from "./icons";

export interface Prefs {
  cache: boolean;
  warnNet: boolean;
  multiWin: boolean;
  theme: string; // active built-in bundle theme id
  source: "encoded" | "cdn"; // where the Pyodide runtime loads from
}

function PrefRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderTop: `1px solid ${t.hair}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: t.text }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
      </div>
      <div style={{ flex: "0 0 auto" }}>{children}</div>
    </div>
  );
}

const SECTION: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
};

/** Settings panel — Appearance, runtime caching, and the network-permission
 *  prompt are functional; the multi-window toggle is stored but not yet wired. */
export function Settings({
  prefs,
  onToggle,
  onSetTheme,
  onSetSource,
  onClose,
}: {
  prefs: Prefs;
  onToggle: (key: "cache" | "warnNet" | "multiWin") => void;
  onSetTheme: (id: string) => void;
  onSetSource: (id: "encoded" | "cdn") => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { appearance, setAppearance } = useAppearance();
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(15,17,21,0.34)", backdropFilter: "blur(1.5px)" }} />
      <div
        style={{
          position: "relative",
          width: 480,
          maxHeight: "86%",
          background: t.toolBg,
          borderRadius: 12,
          border: `1px solid ${t.hairStrong}`,
          boxShadow: t.winShadow,
          overflow: "hidden",
          font: UIFONT,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", padding: "16px 18px", borderBottom: `1px solid ${t.hair}` }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: t.text }}>Settings</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: t.textMid, display: "flex", alignItems: "center", justifyContent: "center" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.chip)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <IconClose size={13} sw={1.6} />
          </button>
        </div>

        <div style={{ padding: "6px 22px 8px" }}>
          <div style={{ padding: "16px 0 4px" }}>
            <div style={{ ...SECTION, color: t.textMuted, marginBottom: 12 }}>Appearance</div>
            <SegText
              value={appearance}
              onChange={setAppearance}
              options={[
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" },
                { id: "system", label: "System" },
              ]}
            />
            <div style={{ ...SECTION, color: t.textMuted, margin: "16px 0 10px" }}>Theme</div>
            <SegText
              value={prefs.theme}
              onChange={onSetTheme}
              options={BUILTIN_THEMES.map((th) => ({ id: th.id, label: th.label }))}
            />
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 8, lineHeight: 1.45 }}>
              Applies to tools that use the Vessel theme. Light/dark follows Appearance.
            </div>
          </div>

          <div style={{ marginTop: 14, marginBottom: 4 }}>
            <div style={{ ...SECTION, color: t.textMuted, marginBottom: 2 }}>Runtime &amp; security</div>
            <PrefRow label="Keep runtime cached for offline use" hint="Tools open without a network connection. Uses ~14 MB.">
              <Toggle on={prefs.cache} onClick={() => onToggle("cache")} />
            </PrefRow>
            <PrefRow label="Ask before a tool accesses the network" hint="Prompt for each new domain a tool tries to reach.">
              <Toggle on={prefs.warnNet} onClick={() => onToggle("warnNet")} />
            </PrefRow>
            <PrefRow label="Open each tool in its own window" hint="Matches the double-click-to-open behavior of .vessel files.">
              <Toggle on={prefs.multiWin} onClick={() => onToggle("multiWin")} />
            </PrefRow>
            <div style={{ ...SECTION, color: t.textMuted, margin: "16px 0 10px" }}>Runtime source</div>
            <SegText
              value={prefs.source}
              onChange={(id) => onSetSource(id as "encoded" | "cdn")}
              options={[
                { id: "encoded", label: "This site" },
                { id: "cdn", label: "CDN" },
              ]}
            />
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 8, lineHeight: 1.45 }}>
              Where the Python runtime downloads from. <strong>This site</strong> (default) serves it from
              getvessel.dev and works behind strict corporate proxies; <strong>CDN</strong> uses jsdelivr.
              Takes effect the next time you open a tool.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", padding: "14px 18px", borderTop: `1px solid ${t.hair}`, background: t.toolHeader }}>
          <span style={{ font: `11px ${MONO}`, color: t.textMuted }}>{`Vessel ${__APP_VERSION__} · runtime python 3.12`}</span>
          <div style={{ flex: 1 }} />
          <Button kind="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
