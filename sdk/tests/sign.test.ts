import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundle, verifyBundle } from "@vessel/core";
import { buildBundle } from "../src/commands/build";
import { keygen } from "../src/commands/keygen";

const EXAMPLE = fileURLToPath(new URL("../../examples/notes", import.meta.url));

describe("signing", () => {
  it("signs a bundle and verifies it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-sign-"));
    const { keyFile } = await keygen({ name: join(dir, "k") });
    const out = await buildBundle({ dir: EXAMPLE, out: join(dir, "signed.vessel"), sign: keyFile });

    const bundle = readBundle(new Uint8Array(readFileSync(out)));
    const v = await verifyBundle(bundle.files, bundle.manifest);
    expect(v.signed).toBe(true);
    expect(v.valid).toBe(true);
    expect(v.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("detects tampering after signing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-tamper-"));
    const { keyFile } = await keygen({ name: join(dir, "k") });
    const out = await buildBundle({ dir: EXAMPLE, out: join(dir, "s.vessel"), sign: keyFile });

    const bundle = readBundle(new Uint8Array(readFileSync(out)));
    bundle.files["app/main.py"] = new TextEncoder().encode("app = 'tampered'\n");
    const v = await verifyBundle(bundle.files, bundle.manifest);
    expect(v.signed).toBe(true);
    expect(v.valid).toBe(false); // signature no longer matches the content
  });

  it("reports unsigned for an unsigned bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-unsigned-"));
    const out = await buildBundle({ dir: EXAMPLE, out: join(dir, "u.vessel") });

    const bundle = readBundle(new Uint8Array(readFileSync(out)));
    const v = await verifyBundle(bundle.files, bundle.manifest);
    expect(v.signed).toBe(false);
  });
});
