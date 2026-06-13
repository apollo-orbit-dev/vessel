import { type CSSProperties, type ReactNode } from "react";
import { useTheme, UIFONT, MONO } from "../theme";
import { IconCheck } from "./icons";

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flex: "0 0 auto",
        display: "inline-block",
      }}
    />
  );
}

export function VesselGlyph({ size = 17 }: { size?: number }) {
  const t = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <rect x="3.5" y="2.5" width="13" height="15" rx="3" fill="none" stroke={t.accent} strokeWidth="1.6" />
      <path d="M3.5 11.5 H16.5" stroke={t.accent} strokeWidth="1.6" />
      <rect x="3.5" y="11.5" width="13" height="6" fill={t.accentSoft} />
    </svg>
  );
}

export type Trust = "signed" | "unsigned" | "invalid";

export function TrustMark({ trust, publisher, compact }: { trust: Trust; publisher?: string; compact?: boolean }) {
  const t = useTheme();
  const base = {
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 4,
    height: 18,
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 500,
    whiteSpace: "nowrap" as const,
  };
  if (trust === "signed") {
    return (
      <span
        title={publisher ? `Signed by ${publisher}` : "Signed"}
        style={{
          ...base,
          padding: compact ? "0 5px 0 4px" : "0 7px 0 5px",
          background: t.accentSoft,
          color: t.accent,
          border: `1px solid ${t.accentBorder}`,
          letterSpacing: "0.01em",
        }}
      >
        <IconCheck size={11} sw={2.2} />
        signed
      </span>
    );
  }
  if (trust === "invalid") {
    return (
      <span
        title="Signature does not match — this bundle may have been modified"
        style={{
          ...base,
          padding: "0 7px",
          background: "transparent",
          color: t.closeHover,
          border: `1px solid ${t.closeHover}`,
        }}
      >
        invalid signature
      </span>
    );
  }
  return (
    <span
      style={{ ...base, padding: "0 7px", background: "transparent", color: t.textMuted, border: `1px dashed ${t.hairStrong}` }}
    >
      unsigned
    </span>
  );
}

type ButtonKind = "primary" | "secondary" | "ghost";

export function Button({
  kind = "secondary",
  children,
  onClick,
  icon,
  full,
  disabled,
  style,
}: {
  kind?: ButtonKind;
  children?: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
  full?: boolean;
  disabled?: boolean;
  style?: CSSProperties;
}) {
  const t = useTheme();
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 36,
    padding: "0 16px",
    borderRadius: 7,
    font: `500 13.5px/1 ${UIFONT}`,
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
    width: full ? "100%" : "auto",
    opacity: disabled ? 0.5 : 1,
    transition: "background .12s, border-color .12s, color .12s",
    userSelect: "none",
  };
  const kinds: Record<ButtonKind, CSSProperties> = {
    primary: { background: t.accent, color: t.onAccent, border: "1px solid transparent" },
    secondary: { background: t.field, color: t.text, border: `1px solid ${t.fieldBorder}` },
    ghost: { background: "transparent", color: t.textMid, border: "1px solid transparent" },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...base, ...kinds[kind], ...style }}
      onMouseEnter={(e) => {
        if (disabled || kind === "primary") return;
        e.currentTarget.style.background = t.chip;
      }}
      onMouseLeave={(e) => {
        if (kind === "primary") return;
        e.currentTarget.style.background = kind === "ghost" ? "transparent" : t.field;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  const t = useTheme();
  return (
    <button
      onClick={onClick}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        border: "none",
        cursor: "pointer",
        flex: "0 0 auto",
        background: on ? t.accent : t.hairStrong,
        position: "relative",
        transition: "background .15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          transition: "left .15s",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
        }}
      />
    </button>
  );
}

export function SegText<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const t = useTheme();
  return (
    <div
      style={{
        display: "flex",
        border: `1px solid ${t.fieldBorder}`,
        borderRadius: 8,
        overflow: "hidden",
        height: 34,
        background: t.field,
      }}
    >
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              flex: 1,
              border: "none",
              borderLeft: i ? `1px solid ${t.fieldBorder}` : "none",
              cursor: "pointer",
              background: on ? t.accentSoft : "transparent",
              color: on ? t.accent : t.textMid,
              font: `12.5px ${UIFONT}`,
              fontWeight: on ? 600 : 500,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// Re-export caption icons grouping is unnecessary; expose mono for callers.
export { UIFONT, MONO };
