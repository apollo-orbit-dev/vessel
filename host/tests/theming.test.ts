import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, getTheme, bundleThemeVars, resolveBundleThemeCss, parseBundleTheme } from "@vessel/core";

describe("bundle theming", () => {
  it("ships the built-in themes incl. a default", () => {
    expect(BUILTIN_THEMES.map((t) => t.id)).toContain("default");
    expect(BUILTIN_THEMES.length).toBeGreaterThanOrEqual(2);
  });

  it("emits camelCase tokens as kebab-case --vessel-* vars", () => {
    const vars = bundleThemeVars("default", "light");
    expect(vars["--vessel-bg"]).toBeTruthy();
    expect(vars["--vessel-text-muted"]).toBeTruthy();
    expect(vars["--vessel-accent-text"]).toBeTruthy();
    expect(vars["--vessel-font-mono"]).toBeTruthy();
  });

  it("light and dark differ for the same theme", () => {
    expect(bundleThemeVars("default", "light")["--vessel-bg"]).not.toEqual(
      bundleThemeVars("default", "dark")["--vessel-bg"],
    );
  });

  it("unknown theme id falls back to default", () => {
    expect(getTheme("nope").id).toBe("default");
  });

  it("partial overrides win over the base theme", () => {
    const vars = bundleThemeVars("default", "light", { accent: "#ff0000" });
    expect(vars["--vessel-accent"]).toBe("#ff0000");
    expect(vars["--vessel-bg"]).toBe(bundleThemeVars("default", "light")["--vessel-bg"]); // untouched
  });

  it("resolveBundleThemeCss includes :root vars + the base stylesheet", () => {
    const css = resolveBundleThemeCss("default", "dark");
    expect(css).toContain(":root{");
    expect(css).toContain("--vessel-bg:");
    expect(css).toContain("button{"); // base component styles
    expect(css).toContain(".vessel-primary{");
  });

  it("includeBase=false drops the base stylesheet (vars only)", () => {
    const css = resolveBundleThemeCss("default", "light", undefined, false);
    expect(css).toContain(":root{");
    expect(css).not.toContain("button{");
  });
});

describe("parseBundleTheme", () => {
  it("parses a partial light/dark theme of token values", () => {
    const t = parseBundleTheme(JSON.stringify({ light: { accent: "#ff00aa" }, dark: { accent: "oklch(0.7 0.1 20)" } }));
    expect(t.light?.accent).toBe("#ff00aa");
    expect(t.dark?.accent).toBe("oklch(0.7 0.1 20)");
  });

  it("ignores unknown token keys", () => {
    const t = parseBundleTheme(JSON.stringify({ light: { accent: "#fff", evil: "x" } }));
    expect(t.light?.accent).toBe("#fff");
    expect((t.light as Record<string, string>).evil).toBeUndefined();
  });

  it("rejects CSS-injection / breakout values", () => {
    for (const bad of [
      "red;} body{display:none", // declaration breakout (;{})
      "url(http://evil.test/x.png)", // remote load
      "</style><script>alert(1)</script>", // escape the style element (<>/)
    ]) {
      expect(() => parseBundleTheme(JSON.stringify({ light: { accent: bad } }))).toThrow();
    }
  });

  it("throws on non-JSON", () => {
    expect(() => parseBundleTheme("{not json")).toThrow();
  });
});
