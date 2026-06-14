import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readBundle,
  verifyBundle,
  backendModulePaths,
  BundleError,
  type Manifest,
} from "@vessel/core";
import { findLocalRefs } from "../inline";

export interface InspectOptions {
  file: string;
  json?: boolean;
}

interface Report {
  file: string;
  diskBytes: number;
  manifest: Manifest;
  signing: { signed: boolean; valid: boolean; publisher?: string; fingerprint?: string };
  packages: string[];
  files: { path: string; bytes: number }[];
  totalUncompressed: number;
  byTopDir: Record<string, number>;
  warnings: string[];
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Statically analyze a built .vessel and return a structured report. Never runs bundle code. */
export async function analyze(file: string): Promise<Report> {
  const path = resolve(file);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(path));
  } catch {
    throw new BundleError(`cannot read bundle: ${file}`);
  }

  // readBundle re-runs the host loader (zip-safety + manifest schema), so a bad
  // bundle fails here with the same error the host would give.
  const { manifest, files } = readBundle(bytes);
  const m = manifest as Manifest;
  const signing = await verifyBundle(files, m);

  const entries = Object.entries(files)
    .map(([p, b]) => ({ path: p, bytes: b.length }))
    .sort((a, b) => b.bytes - a.bytes);
  const totalUncompressed = entries.reduce((s, e) => s + e.bytes, 0);
  const byTopDir: Record<string, number> = {};
  for (const e of entries) {
    const top = e.path.includes("/") ? `${e.path.split("/")[0]}/` : e.path;
    byTopDir[top] = (byTopDir[top] ?? 0) + e.bytes;
  }

  const warnings: string[] = [];
  const modPaths = backendModulePaths(m.backend);
  if (!modPaths.some((c) => files[c])) {
    warnings.push(`backend "${m.backend}": no module file in the bundle (looked for ${modPaths.join(", ")})`);
  }
  if (!files[m.data]) warnings.push(`data file "${m.data}" is missing from the bundle`);
  if (!files[m.ui]) {
    warnings.push(`ui file "${m.ui}" is missing from the bundle`);
  } else {
    const html = new TextDecoder().decode(files[m.ui]);
    for (const r of findLocalRefs(html)) {
      warnings.push(
        `ui references local ${r.kind} "${r.ref}" — the host serves only ${m.ui}, so this would 404. ` +
          `Run \`vessel build\` (it inlines local assets) or inline it manually.`,
      );
    }
  }
  if (bytes.length > 32 * 1024 * 1024) warnings.push(`bundle is large: ${fmtBytes(bytes.length)} on disk`);

  return {
    file: path,
    diskBytes: bytes.length,
    manifest: m,
    signing,
    packages: m.packages ?? [],
    files: entries,
    totalUncompressed,
    byTopDir,
    warnings,
  };
}

/** `vessel inspect <file.vessel> [--json]` */
export async function inspect(opts: InspectOptions): Promise<void> {
  const r = await analyze(opts.file);
  if (opts.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  const m = r.manifest;
  const L: string[] = [];
  L.push(`${m.name}  v${m.version}   (${fmtBytes(r.diskBytes)} on disk)`);
  L.push(`  format_version: ${m.format_version}${m.python ? `   python: ${m.python}` : ""}`);
  L.push(`  ui:      ${m.ui}`);
  L.push(`  backend: ${m.backend}`);
  L.push(`  data:    ${m.data}`);

  // Signing
  if (r.signing.signed) {
    const mark = r.signing.valid ? "✓ valid" : "✗ INVALID";
    L.push(`  signed:  ${mark}${r.signing.publisher ? ` · ${r.signing.publisher}` : ""}${r.signing.fingerprint ? `  (key ${r.signing.fingerprint})` : ""}`);
  } else {
    L.push(`  signed:  no`);
  }

  // Capabilities
  const cap = m.capabilities ?? {};
  const net = cap.network ?? [];
  L.push("");
  L.push(`Capabilities:`);
  L.push(`  network:   ${net.length ? net.join(", ") : "none (default-deny)"}`);
  L.push(`  clipboard: ${cap.clipboard ? "yes" : "no"}    print: ${cap.print ? "yes" : "no"}`);

  // Packages
  L.push("");
  L.push(`Packages (declared; transitive deps resolve at load via micropip):`);
  L.push(`  ${r.packages.length ? r.packages.join(", ") : "(none beyond stdlib)"}`);

  // Files / sizes
  L.push("");
  L.push(`Files (${r.files.length}, ${fmtBytes(r.totalUncompressed)} uncompressed):`);
  for (const e of r.files) L.push(`  ${fmtBytes(e.bytes).padStart(9)}  ${e.path}`);
  const dirs = Object.entries(r.byTopDir).sort((a, b) => b[1] - a[1]);
  if (dirs.length > 1) {
    L.push(`  — by area: ` + dirs.map(([d, n]) => `${d} ${fmtBytes(n)}`).join("  ·  "));
  }

  // Warnings
  L.push("");
  if (r.warnings.length === 0) {
    L.push(`✓ No warnings.`);
  } else {
    L.push(`⚠ ${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}:`);
    for (const w of r.warnings) L.push(`  - ${w}`);
  }

  console.log(L.join("\n"));
}
