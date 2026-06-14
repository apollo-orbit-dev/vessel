import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBundle } from "@vessel/core";
import { buildBundle } from "../src/commands/build";
import { analyze } from "../src/commands/inspect";

const NOTES = fileURLToPath(new URL("../../examples/notes", import.meta.url));
const enc = (s: string) => new TextEncoder().encode(s);

describe("vessel inspect (analyze)", () => {
  it("reports manifest, sizes, and unsigned status for a built bundle", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "vessel-insp-")), "notes.vessel");
    await buildBundle({ dir: NOTES, out });

    const r = await analyze(out);
    expect(r.manifest.name).toBe("Notes");
    expect(r.signing.signed).toBe(false);
    expect(r.files.some((f) => f.path === "ui/index.html")).toBe(true);
    expect(r.files.some((f) => f.path === "app/main.py")).toBe(true);
    expect(r.totalUncompressed).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]); // notes is self-contained + complete
  });

  it("warns when the UI still references a separate local asset", async () => {
    const files: Record<string, Uint8Array> = {
      "manifest.json": enc(
        JSON.stringify({
          format_version: 1,
          name: "Split",
          version: "1.0.0",
          ui: "ui/index.html",
          backend: "app.main:app",
          data: "data/store.sqlite",
        }),
      ),
      "ui/index.html": enc(`<script src="app.js"></script>`),
      "app/__init__.py": enc(""),
      "app/main.py": enc("app = object()"),
      "data/store.sqlite": enc(""),
    };
    const out = join(mkdtempSync(join(tmpdir(), "vessel-insp2-")), "split.vessel");
    writeFileSync(out, writeBundle(files));

    const r = await analyze(out);
    expect(r.warnings.join(" ")).toMatch(/references local script "app\.js"/);
  });
});
