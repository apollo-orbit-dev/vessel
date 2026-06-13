import { useState } from "react";
import { useTheme, UIFONT, MONO } from "../theme";
import { Button, VesselGlyph, TrustMark, Dot } from "./primitives";
import { IconFolder, IconChevR } from "./icons";
import type { RecentEntry } from "./MenuBar";

function RecentRow({ entry, onOpen }: { entry: RecentEntry; onOpen: () => void }) {
  const t = useTheme();
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        textAlign: "left",
        padding: "11px 12px",
        borderRadius: 9,
        border: "1px solid transparent",
        background: hov ? t.toolBg : "transparent",
        cursor: "pointer",
        boxShadow: hov ? `0 0 0 1px ${t.hair}` : "none",
        transition: "background .12s, box-shadow .12s",
        font: UIFONT,
      }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          flex: "0 0 auto",
          background: t.chip,
          border: `1px solid ${t.hair}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `600 11px ${MONO}`,
          color: t.textMid,
        }}
      >
        .v
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: t.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {entry.name}
        </div>
        <div style={{ marginTop: 3 }}>
          <TrustMark trust="unsigned" compact />
        </div>
      </div>
      {entry.time && (
        <span style={{ font: `11.5px ${MONO}`, color: t.textMuted, flex: "0 0 auto", letterSpacing: "-0.01em" }}>
          {entry.time}
        </span>
      )}
      <span style={{ color: hov ? t.textMid : t.textMuted, flex: "0 0 auto", opacity: hov ? 1 : 0.45, transition: "opacity .12s" }}>
        <IconChevR size={15} />
      </span>
    </button>
  );
}

export function LauncherBody({
  recents,
  onOpen,
  onOpenRecent,
  offlineReady,
}: {
  recents: RecentEntry[];
  onOpen: () => void;
  onOpenRecent: (entry: RecentEntry) => void;
  offlineReady?: boolean;
}) {
  const t = useTheme();
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: t.appBg,
        padding: "0 40px",
        overflow: "auto",
      }}
    >
      <div style={{ width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 16,
            border: `1px solid ${t.hairStrong}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: t.toolBg,
          }}
        >
          <VesselGlyph size={30} />
        </div>
        <div style={{ marginTop: 20, fontSize: 16, fontWeight: 560, color: t.text }}>No tool open</div>
        <div style={{ marginTop: 6, fontSize: 13, color: t.textMuted, textAlign: "center", lineHeight: 1.5 }}>
          Open a <span style={{ font: `12.5px ${MONO}`, color: t.textMid }}>.vessel</span> file to run its tool. Each file
          carries its own app and data.
        </div>
        <div style={{ marginTop: 22 }}>
          <Button kind="primary" icon={<IconFolder size={16} />} onClick={onOpen}>
            Open a .vessel…
          </Button>
        </div>
        <div style={{ marginTop: 11, fontSize: 12, color: t.textMuted }}>or drop a file onto this window</div>
        {offlineReady && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <Dot color={t.ok} size={6} />
            <span style={{ font: `11px ${MONO}`, color: t.textMuted, letterSpacing: "-0.01em" }}>
              runtime cached · offline ready
            </span>
          </div>
        )}

        {recents.length > 0 && (
          <div style={{ width: "100%", marginTop: 40 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 8px" }}>
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: t.textMuted }}>
                Recent
              </span>
              <span style={{ flex: 1, height: 1, background: t.hair }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {recents.map((r) => (
                <RecentRow key={r.id} entry={r} onOpen={() => onOpenRecent(r)} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
