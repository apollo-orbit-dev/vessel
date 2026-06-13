import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBundle } from "../src/download";

// Runs in the node test env (no DOM), so stub the few DOM bits downloadBundle
// touches. Blob/URL are real Node globals (URL gets object-URL methods added).
let created: Blob | null;
let revoked: string | null;
let clickedName: string | null;
const anchor = { href: "", download: "", click: () => { clickedName = anchor.download; }, remove: () => {} };

beforeEach(() => {
  created = null;
  revoked = null;
  clickedName = null;
  anchor.href = "";
  anchor.download = "";
  vi.stubGlobal("document", {
    createElement: () => anchor,
    body: { appendChild: () => {} },
  });
  vi.stubGlobal("URL", {
    createObjectURL: (b: Blob) => {
      created = b;
      return "blob:mock-url";
    },
    revokeObjectURL: (u: string) => {
      revoked = u;
    },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("downloadBundle", () => {
  it("downloads the bytes as a zip Blob and revokes the object URL", () => {
    downloadBundle("notes.vessel", new Uint8Array([1, 2, 3, 4]));
    expect(created).toBeInstanceOf(Blob);
    expect(created!.size).toBe(4);
    expect(created!.type).toBe("application/zip");
    expect(anchor.href).toBe("blob:mock-url");
    expect(clickedName).toBe("notes.vessel");
    expect(revoked).toBeNull(); // revoke is deferred a tick
    vi.runAllTimers();
    expect(revoked).toBe("blob:mock-url");
  });

  it("appends a .vessel extension when the name lacks one", () => {
    downloadBundle("notes", new Uint8Array([0]));
    expect(clickedName).toBe("notes.vessel");
  });

  it("leaves an existing .vessel extension intact", () => {
    downloadBundle("my-tool.vessel", new Uint8Array([0]));
    expect(clickedName).toBe("my-tool.vessel");
  });
});
