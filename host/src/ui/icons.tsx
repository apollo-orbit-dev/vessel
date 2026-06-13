import type { CSSProperties, ReactNode } from "react";

// Minimal stroked glyphs, currentColor, simple shapes only.
interface IcoProps {
  d?: string;
  size?: number;
  sw?: number;
  fill?: string;
  children?: ReactNode;
  vb?: number;
  style?: CSSProperties;
}

export function Ico({ d, size = 16, sw = 1.5, fill, children, vb = 24, style }: IcoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      fill={fill || "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden="true"
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

type P = Omit<IcoProps, "d" | "children">;

export const IconClose = (p: P) => (
  <Ico {...p} vb={12} sw={1.1}>
    <line x1="3" y1="3" x2="9" y2="9" />
    <line x1="9" y1="3" x2="3" y2="9" />
  </Ico>
);
export const IconCheck = (p: P) => <Ico {...p} d="M5 12.5l4.2 4.2L19 7" />;
export const IconLock = (p: P) => (
  <Ico {...p}>
    <rect x="5" y="11" width="14" height="9" rx="1.6" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Ico>
);
export const IconFolder = (p: P) => (
  <Ico {...p} d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.8A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5z" />
);
export const IconChevR = (p: P) => <Ico {...p} d="M9 5l7 7-7 7" />;
export const IconGlobe = (p: P) => (
  <Ico {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.3 2.4 14.7 0 17M12 3.5c-2.4 2.3-2.4 14.7 0 17" />
  </Ico>
);
