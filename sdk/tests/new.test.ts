import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBundle } from "@vessel/core";
import { newBundle } from "../src/commands/new";
import { buildBundle } from "../src/commands/build";

describe("vessel new", () => {
  it("scaffolds a project that builds into a host-valid bundle", async () => {
    const parent = mkdtempSync(join(tmpdir(), "vessel-new-"));
    const dir = newBundle({ name: "My Tool", dir: join(parent, "my-tool") });

    // Scaffold has the expected parts.
    for (const f of ["manifest.json", "app/main.py", "ui/index.html", "data/store.sqlite"]) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    // Routes are async (the Pyodide no-threads rule).
    const mainPy = readFileSync(join(dir, "app/main.py"), "utf8");
    expect(mainPy).toContain("async def");
    // Scaffold teaches the reusable SQLite helpers + the safe pattern.
    for (const helper of ["def query_all", "def query_one", "def execute"]) {
      expect(mainPy).toContain(helper);
    }
    expect(mainPy).toContain("VALUES (?)"); // parameterized placeholders
    // No string-built SQL (f-strings / % / .format into a query) — the anti-pattern.
    expect(mainPy).not.toMatch(/(execute|query_all|query_one)\(\s*f["']/);
    expect(mainPy).not.toMatch(/\.format\(/);

    // It builds, and the host loader accepts the result with the chosen name.
    const out = await buildBundle({ dir, out: join(parent, "out.vessel") });
    const bundle = readBundle(new Uint8Array(readFileSync(out)));
    expect(bundle.manifest.name).toBe("My Tool");
  });

  it("refuses a non-empty target directory", () => {
    const parent = mkdtempSync(join(tmpdir(), "vessel-new2-"));
    newBundle({ name: "First", dir: join(parent, "x") });
    expect(() => newBundle({ name: "Second", dir: join(parent, "x") })).toThrow(/not empty/);
  });
});
