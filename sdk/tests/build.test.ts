import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
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

  it("rejects a directory without manifest.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-empty-"));
    await expect(buildBundle({ dir })).rejects.toThrow(/manifest/);
  });
});
