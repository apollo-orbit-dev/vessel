import { useTheme, MONO } from "../theme";
import { VesselGlyph } from "./primitives";

/** First-run boot screen, shown while the Python runtime loads. */
export function BootBody({ note }: { note?: string }) {
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
        gap: 18,
      }}
    >
      <VesselGlyph size={34} />
      <div style={{ fontSize: 14.5, fontWeight: 540, color: t.text }}>Starting runtime…</div>
      <div
        style={{
          width: 240,
          height: 3,
          borderRadius: 3,
          background: t.hair,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          className="vsl-indeterminate"
          style={{ position: "absolute", top: 0, bottom: 0, width: "40%", borderRadius: 3, background: t.accent }}
        />
      </div>
      <div style={{ font: `11.5px ${MONO}`, color: t.textMuted, letterSpacing: "-0.01em" }}>
        {note ?? "python 3.12 · first launch only"}
      </div>
    </div>
  );
}
