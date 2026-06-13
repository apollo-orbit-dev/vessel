import { describe, it, expect } from "vitest";
import { detectCapabilities, isFullExperience } from "../src/capabilities";

// A Chromium-like scope: all three APIs present.
const chromium = {
  showOpenFilePicker: () => {},
  launchQueue: { setConsumer() {} },
  FileSystemFileHandle: { prototype: { createWritable() {} } },
};

describe("detectCapabilities", () => {
  it("detects the full Chromium experience", () => {
    const c = detectCapabilities(chromium as never);
    expect(c).toEqual({ filePicker: true, fileHandling: true, writableHandle: true });
    expect(isFullExperience(c)).toBe(true);
  });

  it("detects a browser with no File System Access API as degraded", () => {
    const c = detectCapabilities({} as never);
    expect(c).toEqual({ filePicker: false, fileHandling: false, writableHandle: false });
    expect(isFullExperience(c)).toBe(false);
  });

  it("treats a read-only handle (no createWritable) as not full", () => {
    const c = detectCapabilities({
      showOpenFilePicker: () => {},
      FileSystemFileHandle: { prototype: {} },
    } as never);
    expect(c.filePicker).toBe(true);
    expect(c.writableHandle).toBe(false);
    expect(isFullExperience(c)).toBe(false);
  });

  it("a file picker without a writable handle is still degraded", () => {
    // Drag-and-drop / file-input works, but there's no silent save-back.
    const c = detectCapabilities({ showOpenFilePicker: () => {} } as never);
    expect(isFullExperience(c)).toBe(false);
  });
});
