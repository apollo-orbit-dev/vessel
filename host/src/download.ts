// Degraded-mode save. Without a writable file handle (Firefox/Safari, or a
// drag-dropped file on any browser) the host can't write back to the original
// file, so it persists by downloading a fresh .vessel with the new DB baked in.
// The data still lives in the file the user keeps — the host never gains a
// silent write path, so this adds no capability bundle code could abuse.

/** Trigger a browser download of `bytes` as a `.vessel` file named `filename`. */
export function downloadBundle(filename: string, bytes: Uint8Array): void {
  const name = filename.endsWith(".vessel") ? filename : `${filename}.vessel`;
  // Concrete ArrayBuffer-backed Uint8Array at runtime; cast sidesteps TS's
  // ArrayBufferLike/SharedArrayBuffer strictness (same as save.ts).
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been handled so the download isn't cancelled.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
