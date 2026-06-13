import { unzipSync, zipSync } from "fflate";
import { BundleError } from "./errors";
import { backendModulePaths, parseManifest } from "./manifest";
import { precheckZip } from "./zipsafe";
import type { BundleParts, VesselRuntime } from "./types";

/**
 * Parse and validate a `.vessel` (ZIP) into its manifest and files.
 *
 * Order matters for safety: bound the archive (precheckZip) before
 * decompressing, then validate the manifest schema, then confirm the parts the
 * manifest declares actually exist. Every failure is a user-safe BundleError.
 */
export function readBundle(bytes: Uint8Array): BundleParts {
  precheckZip(bytes);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new BundleError("invalid bundle: could not read ZIP contents");
  }

  const manifestRaw = files["manifest.json"];
  if (!manifestRaw) throw new BundleError("invalid bundle: missing manifest.json");
  const manifest = parseManifest(manifestRaw);

  // The manifest is a contract: the parts it points at must be present.
  if (!files[manifest.ui]) {
    throw new BundleError(`invalid bundle: ui file "${manifest.ui}" not found`);
  }
  if (!files[manifest.data]) {
    throw new BundleError(`invalid bundle: data file "${manifest.data}" not found`);
  }
  if (!backendModulePaths(manifest.backend).some((p) => files[p])) {
    throw new BundleError(`invalid bundle: backend module for "${manifest.backend}" not found`);
  }

  return { manifest, files };
}

/** Re-assemble a `.vessel` (ZIP) from a set of files. */
export function writeBundle(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

/**
 * Snapshot the live SQLite DB back into the bundle's files and re-zip.
 * Returns the new `.vessel` bytes. Generic (no browser APIs) — the host writes
 * the result to its file handle; the SDK could use it for export.
 */
export async function rebuildBundle(bundle: BundleParts, runtime: VesselRuntime): Promise<Uint8Array> {
  const files = { ...bundle.files, [bundle.manifest.data]: await runtime.snapshotDb() };
  return writeBundle(files);
}
