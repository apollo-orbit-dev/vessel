import { describe, it, expect } from "vitest";
import { inlineHtml, findLocalRefs } from "../src/inline";

const enc = (s: string) => new TextEncoder().encode(s);

describe("inlineHtml", () => {
  it("inlines local script src and stylesheet link", () => {
    const files = {
      "ui/app.js": enc("console.log('hi')"),
      "ui/style.css": enc("body{color:red}"),
    } as Record<string, Uint8Array>;
    const html = `<head><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body>`;
    const r = inlineHtml(html, "ui/index.html", files);
    expect(r.html).toContain("<style>body{color:red}</style>");
    expect(r.html).toContain("<script>console.log('hi')</script>");
    expect(r.html).not.toContain('src="app.js"');
    expect(r.inlined.sort()).toEqual(["ui/app.js", "ui/style.css"]);
    expect(r.warnings).toEqual([]);
  });

  it("escapes a </script> terminator inside inlined JS", () => {
    const files = { "ui/a.js": enc("var s = '</script>';") } as Record<string, Uint8Array>;
    const r = inlineHtml(`<script src="a.js"></script>`, "ui/index.html", files);
    expect(r.html).not.toContain("</script>';"); // raw terminator must be escaped
    expect(r.html).toContain("<\\/script");
  });

  it("preserves type=module on inlined scripts", () => {
    const files = { "ui/m.js": enc("export const x = 1") } as Record<string, Uint8Array>;
    const r = inlineHtml(`<script type="module" src="m.js"></script>`, "ui/index.html", files);
    expect(r.html).toContain('<script type="module">export const x = 1</script>');
  });

  it("leaves remote and data: references untouched", () => {
    const html =
      `<link rel="stylesheet" href="https://cdn/x.css">` +
      `<script src="//cdn/x.js"></script>` +
      `<script src="data:text/javascript,1"></script>`;
    const r = inlineHtml(html, "ui/index.html", {});
    expect(r.html).toBe(html);
    expect(r.inlined).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("warns and leaves the tag when a local asset is missing", () => {
    const r = inlineHtml(`<script src="missing.js"></script>`, "ui/index.html", {});
    expect(r.inlined).toEqual([]);
    expect(r.html).toContain('src="missing.js"');
    expect(r.warnings.join(" ")).toMatch(/missing local asset/);
  });

  it("refuses path traversal out of the bundle root", () => {
    const files = { "secret.js": enc("nope") } as Record<string, Uint8Array>;
    const r = inlineHtml(`<script src="../../secret.js"></script>`, "ui/index.html", files);
    expect(r.inlined).toEqual([]);
    expect(r.html).toContain('src="../../secret.js"');
  });

  it("warns when an inlined module imports other local files (no graph bundling)", () => {
    const files = { "ui/m.js": enc(`import { y } from "./other.js";\nconsole.log(y)`) } as Record<string, Uint8Array>;
    const r = inlineHtml(`<script type="module" src="m.js"></script>`, "ui/index.html", files);
    expect(r.inlined).toEqual(["ui/m.js"]);
    expect(r.warnings.join(" ")).toMatch(/module graphs are not bundled/);
  });
});

describe("findLocalRefs", () => {
  it("returns local script/style refs and ignores external", () => {
    const html =
      `<link rel="stylesheet" href="a.css">` +
      `<link rel="stylesheet" href="https://cdn/b.css">` +
      `<link rel="icon" href="favicon.ico">` +
      `<script src="a.js"></script>` +
      `<script src="https://cdn/c.js"></script>`;
    const refs = findLocalRefs(html);
    expect(refs).toEqual([
      { kind: "script", ref: "a.js" },
      { kind: "style", ref: "a.css" },
    ]);
  });
});
