import { describe, it, expect } from "vitest";
import { zipSync } from "fflate";
import { parseManifest, readBundle, isSafeBundlePath, BundleError } from "@vessel/core";

const enc = (s: string) => new TextEncoder().encode(s);
const manifestBytes = (o: unknown) => enc(JSON.stringify(o));

const VALID_MANIFEST = {
  format_version: 1,
  name: "Test Tool",
  version: "0.0.0",
  ui: "ui/index.html",
  backend: "app.main:app",
  data: "data/store.sqlite",
};

function validFiles(overrides: Record<string, Uint8Array> = {}) {
  return {
    "manifest.json": manifestBytes(VALID_MANIFEST),
    "ui/index.html": enc("<!doctype html><title>t</title>"),
    "app/main.py": enc("app = 1\n"),
    "data/store.sqlite": new Uint8Array(0),
    ...overrides,
  };
}

describe("parseManifest", () => {
  it("accepts a valid v1 manifest", () => {
    const m = parseManifest(manifestBytes(VALID_MANIFEST));
    expect(m.name).toBe("Test Tool");
    expect(m.backend).toBe("app.main:app");
  });

  it("accepts optional capabilities/packages", () => {
    const m = parseManifest(
      manifestBytes({
        ...VALID_MANIFEST,
        packages: ["fastapi"],
        capabilities: { network: ["https://api.weather.gov"], print: true },
      }),
    );
    expect(m.packages).toEqual(["fastapi"]);
    expect(m.capabilities?.network?.[0]).toContain("https://");
  });

  it("strips unknown keys (forward-compat)", () => {
    const m = parseManifest(manifestBytes({ ...VALID_MANIFEST, future_field: 42 }));
    expect(m).not.toHaveProperty("future_field");
  });

  it.each([
    ["wrong format_version", { ...VALID_MANIFEST, format_version: 2 }],
    ["missing name", { ...VALID_MANIFEST, name: undefined }],
    ["empty name", { ...VALID_MANIFEST, name: "" }],
    ["traversal in ui", { ...VALID_MANIFEST, ui: "../etc/passwd" }],
    ["absolute data path", { ...VALID_MANIFEST, data: "/abs/store.sqlite" }],
    ["backend not module:attr", { ...VALID_MANIFEST, backend: "app.main" }],
    ["non-https network", { ...VALID_MANIFEST, capabilities: { network: ["http://x.test"] } }],
  ])("rejects %s", (_label, bad) => {
    expect(() => parseManifest(manifestBytes(bad))).toThrow(BundleError);
  });

  it("rejects non-JSON", () => {
    expect(() => parseManifest(enc("{not json"))).toThrow(BundleError);
  });
});

describe("readBundle", () => {
  it("accepts a well-formed bundle", () => {
    const b = readBundle(zipSync(validFiles()));
    expect(b.manifest.name).toBe("Test Tool");
    expect(Object.keys(b.files)).toContain("app/main.py");
  });

  it("rejects a zip-slip entry path", () => {
    const files = { ...validFiles(), "../evil.txt": enc("pwned") };
    expect(() => readBundle(zipSync(files))).toThrow(BundleError);
  });

  it("rejects when manifest.json is missing", () => {
    const files = validFiles();
    delete (files as Record<string, Uint8Array>)["manifest.json"];
    expect(() => readBundle(zipSync(files))).toThrow(/missing manifest/);
  });

  it("rejects when a declared part is absent", () => {
    const files = validFiles();
    delete (files as Record<string, Uint8Array>)["data/store.sqlite"];
    expect(() => readBundle(zipSync(files))).toThrow(/data file/);
  });

  it("rejects when the backend module is absent", () => {
    const files = validFiles();
    delete (files as Record<string, Uint8Array>)["app/main.py"];
    expect(() => readBundle(zipSync(files))).toThrow(/backend module/);
  });

  it("rejects non-ZIP input", () => {
    expect(() => readBundle(enc("definitely not a zip"))).toThrow(BundleError);
  });
});

describe("isSafeBundlePath", () => {
  it.each(["ui/index.html", "app/main.py", "a/b/c.txt", "app/"])("allows %s", (p) => {
    expect(isSafeBundlePath(p)).toBe(true);
  });
  it.each(["../x", "/abs", "a/../b", "C:\\x", "a\\b", "", "a/./b", "wéird"])(
    "rejects %s",
    (p) => {
      expect(isSafeBundlePath(p)).toBe(false);
    },
  );
});
