import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const UIFONT = '"Geist Sans", "Segoe UI", system-ui, sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", monospace';

/** Theme tokens — every color/shadow the chrome uses. Light/dark = a token swap. */
export interface Tokens {
  name: "light" | "dark";
  bar: string;
  barBorder: string;
  appBg: string;
  toolBg: string;
  toolHeader: string;
  toolTop: string;
  text: string;
  textMid: string;
  textMuted: string;
  hair: string;
  hairStrong: string;
  field: string;
  fieldBorder: string;
  fieldText: string;
  chip: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  onAccent: string;
  ok: string;
  closeHover: string;
  winBorder: string;
  winShadow: string;
}

export const vesselLight: Tokens = {
  name: "light",
  bar: "#f5f5f4",
  barBorder: "#e4e4e1",
  appBg: "#f5f5f4",
  toolBg: "#ffffff",
  toolHeader: "#fbfbfa",
  toolTop: "inset 0 1px 0 rgba(0,0,0,0.025)",
  text: "#26282b",
  textMid: "#5b5e63",
  textMuted: "#8a8d92",
  hair: "#e9e9e6",
  hairStrong: "#dededa",
  field: "#ffffff",
  fieldBorder: "#dadad7",
  fieldText: "#26282b",
  chip: "#f1f1ef",
  accent: "oklch(0.55 0.09 230)",
  accentSoft: "oklch(0.55 0.09 230 / 0.10)",
  accentBorder: "oklch(0.55 0.09 230 / 0.30)",
  onAccent: "#ffffff",
  ok: "oklch(0.58 0.07 155)",
  closeHover: "#e2453a",
  winBorder: "#d0d0cc",
  winShadow: "0 18px 50px -12px rgba(20,22,28,0.28), 0 4px 12px rgba(20,22,28,0.10)",
};

export const vesselDark: Tokens = {
  name: "dark",
  bar: "#26282b",
  barBorder: "#34373b",
  appBg: "#26282b",
  toolBg: "#1c1e21",
  toolHeader: "#212327",
  toolTop: "inset 0 1px 0 rgba(0,0,0,0.22)",
  text: "#e7e8ea",
  textMid: "#aeb1b6",
  textMuted: "#7e8186",
  hair: "#303338",
  hairStrong: "#3a3d42",
  field: "#26282b",
  fieldBorder: "#3c3f44",
  fieldText: "#e7e8ea",
  chip: "#2e3135",
  accent: "oklch(0.70 0.10 230)",
  accentSoft: "oklch(0.70 0.10 230 / 0.16)",
  accentBorder: "oklch(0.70 0.10 230 / 0.40)",
  onAccent: "#16181b",
  ok: "oklch(0.72 0.09 155)",
  closeHover: "#e2453a",
  winBorder: "#000000",
  winShadow: "0 18px 50px -12px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35)",
};

export type Appearance = "light" | "dark" | "system";

const STORAGE_KEY = "vessel.appearance";

const TokensContext = createContext<Tokens>(vesselLight);
const AppearanceContext = createContext<{
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
}>({ appearance: "system", setAppearance: () => {} });

export const useTheme = (): Tokens => useContext(TokensContext);
export const useAppearance = () => useContext(AppearanceContext);

function prefersDark(): boolean {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(
    () => (localStorage.getItem(STORAGE_KEY) as Appearance | null) ?? "system",
  );
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setAppearance = (a: Appearance) => {
    setAppearanceState(a);
    localStorage.setItem(STORAGE_KEY, a);
  };

  const dark = appearance === "dark" || (appearance === "system" && systemDark);
  const tokens = dark ? vesselDark : vesselLight;

  // Keep the document background in sync so there's no flash around the chrome.
  useEffect(() => {
    document.body.style.background = tokens.appBg;
    document.body.style.color = tokens.text;
  }, [tokens]);

  const appearanceValue = useMemo(() => ({ appearance, setAppearance }), [appearance]);

  return (
    <AppearanceContext.Provider value={appearanceValue}>
      <TokensContext.Provider value={tokens}>{children}</TokensContext.Provider>
    </AppearanceContext.Provider>
  );
}
