import { useTheme, MONO } from "../theme";

/** Bottom-center confirmation pill. */
export function Toast({ message }: { message: string }) {
  const t = useTheme();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 22,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 80,
      }}
    >
      <div
        style={{
          background: t.text,
          color: t.appBg,
          font: `12.5px ${MONO}`,
          padding: "9px 14px",
          borderRadius: 8,
          boxShadow: t.winShadow,
          letterSpacing: "-0.01em",
        }}
      >
        {message}
      </div>
    </div>
  );
}
