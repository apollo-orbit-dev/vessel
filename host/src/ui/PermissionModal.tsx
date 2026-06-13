import { useTheme, UIFONT, MONO } from "../theme";
import { Button, Dot, type Trust } from "./primitives";
import { IconGlobe, IconLock } from "./icons";

export type PermissionChoice = "always" | "once" | "deny";

/**
 * Capability prompt shown when a bundle that declares network is opened. Lists
 * the exact origins it may reach and who (if anyone) signed it; the choice is
 * remembered per bundle (Allow always). Signed bundles show their publisher;
 * unsigned bundles are marked as such.
 */
export function PermissionModal({
  name,
  origins,
  trust,
  publisher,
  onChoice,
}: {
  name: string;
  origins: string[];
  trust: Trust;
  publisher?: string;
  onChoice: (choice: PermissionChoice) => void;
}) {
  const t = useTheme();
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 75, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(15,17,21,0.34)", backdropFilter: "blur(1.5px)" }} />
      <div
        style={{
          position: "relative",
          width: 440,
          background: t.toolBg,
          borderRadius: 12,
          border: `1px solid ${t.hairStrong}`,
          boxShadow: t.winShadow,
          overflow: "hidden",
          font: UIFONT,
        }}
      >
        <div style={{ padding: "24px 26px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                background: t.accentSoft,
                border: `1px solid ${t.accentBorder}`,
                color: t.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
            >
              <IconGlobe size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: t.text }}>Allow network access?</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {name}
              </div>
            </div>
          </div>

          <p style={{ margin: "18px 0 12px", fontSize: 13, lineHeight: 1.55, color: t.textMid }}>
            This tool wants to reach {origins.length === 1 ? "one domain" : `${origins.length} domains`}. It cannot
            connect to anything else.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {origins.map((o) => {
              let host = o;
              try {
                host = new URL(o).host;
              } catch {
                /* show as-is */
              }
              return (
                <div
                  key={o}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px 13px",
                    borderRadius: 8,
                    background: t.chip,
                    border: `1px solid ${t.hair}`,
                  }}
                >
                  <Dot color={t.ok} size={7} />
                  <span style={{ font: `13px ${MONO}`, color: t.text, letterSpacing: "-0.01em" }}>{host}</span>
                  <span style={{ marginLeft: "auto", font: `11px ${MONO}`, color: t.textMuted }}>HTTPS only</span>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              marginTop: 14,
              color: trust === "invalid" ? t.closeHover : t.textMid,
            }}
          >
            <IconLock size={13} />
            <span style={{ fontSize: 12 }}>
              {trust === "signed" ? (
                <>
                  Signed by <span style={{ fontWeight: 600, color: t.text }}>{publisher ?? "an unverified key"}</span>
                </>
              ) : trust === "invalid" ? (
                <>⚠ Invalid signature — this bundle may have been modified.</>
              ) : (
                <span style={{ color: t.textMuted }}>
                  Unsigned bundle — you are trusting whoever gave you this file.
                </span>
              )}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 18px", borderTop: `1px solid ${t.hair}`, background: t.toolHeader }}>
          <Button kind="ghost" onClick={() => onChoice("deny")}>
            Deny
          </Button>
          <div style={{ flex: 1 }} />
          <Button kind="secondary" onClick={() => onChoice("once")}>
            Allow once
          </Button>
          <Button kind="primary" onClick={() => onChoice("always")}>
            Allow always
          </Button>
        </div>
      </div>
    </div>
  );
}
