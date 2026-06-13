import { BundleError } from "./errors";

// Caps that bound a hostile bundle. The pre-expansion check (precheckZip) reads
// declared sizes from the ZIP central directory *before* decompressing, so an
// honest-but-huge bundle is rejected without being expanded into memory.
export const MAX_COMPRESSED = 64 * 1024 * 1024; // 64 MB .vessel on disk
export const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024; // 256 MB expanded
export const MAX_ENTRY_UNCOMPRESSED = 128 * 1024 * 1024; // 128 MB per file
export const MAX_ENTRIES = 10_000;

/**
 * A safe relative path for a bundle entry. Whitelist, not blacklist:
 * - non-empty, no NUL, charset limited to [A-Za-z0-9._-/]
 * - relative (no leading "/"), no Windows drive, no backslashes
 * - no "." or ".." segments (zip-slip / path traversal)
 * A single trailing "/" (directory marker) is allowed and ignored.
 * The allowed charset is part of the format spec (docs/format.md).
 */
export function isSafeBundlePath(p: string): boolean {
  if (!p || p.includes("\0")) return false;
  if (p.includes("\\")) return false;
  if (p.startsWith("/")) return false;
  if (/^[A-Za-z]:/.test(p)) return false; // windows drive letter
  const norm = p.endsWith("/") ? p.slice(0, -1) : p;
  if (!/^[A-Za-z0-9._\-/]+$/.test(norm)) return false;
  return !norm.split("/").some((s) => s === "" || s === "." || s === "..");
}

/**
 * Validate a `.vessel` ZIP from its central directory before decompressing:
 * compressed-size cap, entry count, per-entry and total uncompressed caps, and
 * path safety for every entry name. Rejects ZIP64 (unsupported in v1).
 *
 * This is a pre-expansion guard. A zip that *lies* about its declared sizes
 * could still expand beyond the cap at decompress time — a streaming hard-abort
 * is the follow-up hardening. Honest bundles and the common bomb shapes are
 * rejected here.
 */
export function precheckZip(bytes: Uint8Array): void {
  if (bytes.length > MAX_COMPRESSED) {
    throw new BundleError("invalid bundle: file is too large");
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Locate the End Of Central Directory record (scanning back over any comment).
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - (22 + 0xffff));
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new BundleError("invalid bundle: not a valid ZIP archive");

  const entryCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || cdOffset === 0xffffffff) {
    throw new BundleError("unsupported bundle: ZIP64 is not supported");
  }
  if (entryCount > MAX_ENTRIES) {
    throw new BundleError("invalid bundle: too many entries");
  }

  const CDH_SIG = 0x02014b50;
  let p = cdOffset;
  let total = 0;
  const decoder = new TextDecoder();
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== CDH_SIG) {
      throw new BundleError("invalid bundle: corrupt central directory");
    }
    const uncompSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    if (uncompSize === 0xffffffff) {
      throw new BundleError("unsupported bundle: ZIP64 is not supported");
    }
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (!isSafeBundlePath(name)) {
      throw new BundleError(`invalid bundle: unsafe entry path ${JSON.stringify(name)}`);
    }
    if (uncompSize > MAX_ENTRY_UNCOMPRESSED) {
      throw new BundleError(`invalid bundle: entry too large (${name})`);
    }
    total += uncompSize;
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new BundleError("invalid bundle: contents expand too large");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
}
