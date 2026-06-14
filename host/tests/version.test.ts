import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Proves the Vite `define` wiring (Phase 13): the host UI reads its version from
// the injected __APP_VERSION__, which must equal host/package.json's version.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

describe("host version single-source", () => {
  it("injects package.json version as __APP_VERSION__", () => {
    expect(__APP_VERSION__).toBe(pkg.version);
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
  });
});
