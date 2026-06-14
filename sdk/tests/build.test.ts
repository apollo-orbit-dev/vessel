import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, cpSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundle } from "@vessel/core";
import { buildBundle } from "../src/commands/build";

const EXAMPLE = fileURLToPath(new URL("../../examples/notes", import.meta.url));

describe("vessel build", () => {
  it("packages examples/notes into a host-valid .vessel", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "vessel-")), "notes.vessel");
    const result = await buildBundle({ dir: EXAMPLE, out });

    const bundle = readBundle(new Uint8Array(readFileSync(result))); // host loader must accept it
    expect(bundle.manifest.name).toBe("Notes");
    expect(Object.keys(bundle.files)).toContain("app/main.py");
    expect(Object.keys(bundle.files)).toContain("ui/index.html");
  });

  it("excludes built .vessel artifacts so a rebuild never nests a bundle", async () => {
    // Simulate the examples' layout: a previously-built <slug>.vessel committed
    // inside the source dir. The next build must not sweep it into the new zip.
    const dir = mkdtempSync(join(tmpdir(), "vessel-nest-"));
    cpSync(EXAMPLE, dir, { recursive: true });
    writeFileSync(join(dir, "notes.vessel"), "STALE BUNDLE BYTES");

    const out = join(mkdtempSync(join(tmpdir(), "vessel-")), "notes.vessel");
    const result = await buildBundle({ dir, out });

    const bundle = readBundle(new Uint8Array(readFileSync(result)));
    expect(Object.keys(bundle.files)).toContain("ui/index.html");
    expect(Object.keys(bundle.files).some((p) => p.endsWith(".vessel"))).toBe(false);
  });

  it("inlines local UI assets and drops them from the bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-inline-"));
    mkdirSync(join(dir, "ui"), { recursive: true });
    mkdirSync(join(dir, "app"), { recursive: true });
    mkdirSync(join(dir, "data"), { recursive: true });
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        format_version: 1, name: "Inline", version: "1.0.0",
        ui: "ui/index.html", backend: "app.main:app", data: "data/store.sqlite",
      }),
    );
    writeFileSync(
      join(dir, "ui", "index.html"),
      `<head><link rel="stylesheet" href="style.css">` +
        `<link rel="stylesheet" href="https://cdn/x.css"></head>` +
        `<body><script src="app.js"></script></body>`,
    );
    writeFileSync(join(dir, "ui", "app.js"), "window.X = 1;");
    writeFileSync(join(dir, "ui", "style.css"), "body{margin:0}");
    writeFileSync(join(dir, "app", "__init__.py"), "");
    writeFileSync(join(dir, "app", "main.py"), "app = object()");
    writeFileSync(join(dir, "data", "store.sqlite"), "");

    const out = join(mkdtempSync(join(tmpdir(), "vessel-")), "inline.vessel");
    const bundle = readBundle(new Uint8Array(readFileSync(await buildBundle({ dir, out }))));

    const html = new TextDecoder().decode(bundle.files["ui/index.html"]);
    expect(html).toContain("<script>window.X = 1;</script>");
    expect(html).toContain("<style>body{margin:0}</style>");
    expect(html).not.toContain('src="app.js"');
    expect(html).toContain('href="https://cdn/x.css"'); // remote left as-is
    // Inlined assets are dropped; the bundle is single-file UI.
    expect(Object.keys(bundle.files)).not.toContain("ui/app.js");
    expect(Object.keys(bundle.files)).not.toContain("ui/style.css");
  });

  it("rejects a directory without manifest.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-empty-"));
    await expect(buildBundle({ dir })).rejects.toThrow(/manifest/);
  });
});
