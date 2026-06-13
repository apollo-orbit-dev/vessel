// Feature-detection for the web-platform APIs Vessel's full experience needs.
// On Chromium all are present; Firefox/Safari lack the File System Access /
// File Handling APIs. That gap is what drives degraded mode: no
// promptless open-by-double-click and no silent save-back to the file.

export interface HostCapabilities {
  /** `showOpenFilePicker` — open a file and get a handle back. */
  filePicker: boolean;
  /** File Handling API: `launchQueue` delivers a handle when a file is opened. */
  fileHandling: boolean;
  /** Writable file handles (`createWritable`) — the promptless save-back path. */
  writableHandle: boolean;
}

// Only the members we probe. Typed loosely so a plain object can stand in
// during tests (and so we don't depend on lib.dom having every member).
interface ProbeScope {
  showOpenFilePicker?: unknown;
  launchQueue?: unknown;
  FileSystemFileHandle?: { prototype?: { createWritable?: unknown } };
}

/** Probe the host environment for the APIs the full experience depends on. */
export function detectCapabilities(scope: ProbeScope = globalThis as ProbeScope): HostCapabilities {
  return {
    filePicker: typeof scope.showOpenFilePicker === "function",
    fileHandling: scope.launchQueue != null,
    writableHandle: typeof scope.FileSystemFileHandle?.prototype?.createWritable === "function",
  };
}

/**
 * True when the host can do promptless open + save-back (Chromium). When false,
 * the host runs in degraded mode: file-input open + explicit download-to-save.
 * The writable handle is the load-bearing capability — without it there is no
 * silent persistence regardless of how the file was opened.
 */
export function isFullExperience(c: HostCapabilities): boolean {
  return c.filePicker && c.writableHandle;
}
