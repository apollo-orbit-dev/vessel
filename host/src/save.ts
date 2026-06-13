/**
 * Write bytes back to a FileSystemFileHandle. For a launch handle this is
 * promptless; for a picked handle we request readwrite permission first.
 *
 * Atomicity: `createWritable()` writes to a temporary swap file and atomically
 * renames it over the target on `close()`. So a crash or error mid-write leaves
 * the original file intact (we never close a partial stream — any throw skips
 * `close()`, discarding the swap). A fully manual sibling-temp-then-rename would
 * need the parent *directory* handle, which `launchQueue` does not provide; the
 * built-in swap is the available atomic primitive.
 *
 * The host holds this handle and never exposes it to bundle code — that rule
 * is the core of the host<->bundle isolation boundary. Bundle assembly
 * (rebuildBundle) lives in @vessel/core; this is the host's browser-only
 * write path.
 */
export async function writeToHandle(
  handle: FileSystemFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  const perm = await (handle as any).queryPermission?.({ mode: "readwrite" });
  if (perm !== "granted") {
    const req = await (handle as any).requestPermission?.({ mode: "readwrite" });
    if (req !== "granted") {
      throw new Error("write permission denied for this file");
    }
  }
  const writable = await handle.createWritable();
  // bytes is a concrete ArrayBuffer-backed Uint8Array at runtime; the cast
  // sidesteps TS's ArrayBufferLike/SharedArrayBuffer generic strictness.
  await writable.write(bytes as unknown as BufferSource);
  await writable.close(); // atomic commit (swap-file rename)
}
