// Vendor the Pyodide runtime + the common wheel set into host/public/pyodide/,
// so the host loads them SAME-ORIGIN (from getvessel.dev/app/pyodide/) instead
// of cdn.jsdelivr.net. This removes the third-party CDN dependency at runtime —
// the failure class behind corporate proxies that strip CORS on cross-origin
// fetches (or sinkhole CDNs): the host page already loads same-origin, so the
// runtime will too.
//
// What it vendors:
//   - core: pyodide.mjs / .asm.js / .asm.wasm / python_stdlib.zip (from the
//     pinned `pyodide` npm package — no download needed for these).
//   - wheels: the dependency CLOSURE of the packages our shipped examples use
//     (fastapi, cryptography, pyyaml, tomli-w) + the runtime baseline
//     (sqlite3, micropip), downloaded from the pinned Pyodide CDN at build time.
//   - a PATCHED pyodide-lock.json: vendored packages keep relative file_names
//     (resolved same-origin); every OTHER package's file_name is rewritten to an
//     absolute jsdelivr URL, so an exotic third-party bundle still resolves its
//     wheels via the CDN when the network allows (graceful fallback).
//
// Build-time downloads hit the CDN (CI / a dev machine has open network); only
// the RUNTIME dependency is what we're eliminating. The output dir is gitignored
// and regenerated. Run automatically via host `predev`/`prebuild`; or directly:
//   node host/scripts/vendor-pyodide.mjs [--force]
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "node_modules", "pyodide");
const SRC_ALT = join(HERE, "..", "..", "node_modules", "pyodide"); // hoisted workspace install
const PKG = existsSync(join(SRC, "pyodide-lock.json")) ? SRC : SRC_ALT;
const DEST = join(HERE, "..", "public", "pyodide");

const VERSION = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const FORCE = process.argv.includes("--force");

// Packages our shipped examples declare, plus the always-loaded runtime baseline.
const SEEDS = ["fastapi", "cryptography", "pyyaml", "tomli-w", "sqlite3", "micropip"];
const CORE = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip"];

const norm = (s) => s.toLowerCase().replace(/[_.]/g, "-");

function closure(lock, seeds) {
  // Map normalized name -> package entry (lock keys are already normalized, but
  // be defensive).
  const byName = new Map();
  for (const [k, v] of Object.entries(lock.packages)) byName.set(norm(k), v);
  const want = new Set();
  const queue = [...seeds.map(norm)];
  while (queue.length) {
    const n = queue.shift();
    if (want.has(n)) continue;
    const pkg = byName.get(n);
    if (!pkg) {
      console.warn(`  ! seed/dep not in lock: ${n} (skipped)`);
      continue;
    }
    want.add(n);
    for (const dep of pkg.depends ?? []) queue.push(norm(dep));
  }
  return want;
}

async function download(file, dest) {
  if (existsSync(dest) && !FORCE) return false;
  const res = await fetch(CDN + file);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${CDN + file}`);
  writeFileSync(dest, new Uint8Array(await res.arrayBuffer()));
  return true;
}

const mb = (n) => (n / (1024 * 1024)).toFixed(1);

async function main() {
  mkdirSync(DEST, { recursive: true });
  const lock = JSON.parse(readFileSync(join(PKG, "pyodide-lock.json"), "utf8"));

  // 1. Core (copy from the npm package).
  for (const f of CORE) copyFileSync(join(PKG, f), join(DEST, f));
  console.log(`core: ${CORE.length} files copied (pyodide ${VERSION})`);

  // 2. Wheel closure (download from the pinned CDN).
  const want = closure(lock, SEEDS);
  // Resolve entries case-insensitively (lock keys are normalized, but be safe).
  const byName = new Map(Object.entries(lock.packages).map(([k, v]) => [norm(k), v]));
  const wheelFiles = [...want].map((n) => byName.get(n).file_name);
  let got = 0;
  for (const f of wheelFiles) if (await download(f, join(DEST, f))) got++;
  console.log(`wheels: ${wheelFiles.length} in closure (${got} downloaded, ${wheelFiles.length - got} cached)`);

  // 3. Patched lock: vendored packages stay relative (same-origin); everything
  //    else gets an absolute jsdelivr file_name (CDN fallback for exotic bundles).
  for (const [k, v] of Object.entries(lock.packages)) {
    if (!want.has(norm(k)) && v.file_name && !/^https?:\/\//.test(v.file_name)) {
      v.file_name = CDN + v.file_name;
    }
  }
  writeFileSync(join(DEST, "pyodide-lock.json"), JSON.stringify(lock));

  const total = [...CORE, ...wheelFiles].reduce((s, f) => s + statSync(join(DEST, f)).size, 0);
  console.log(`done → host/public/pyodide/  (~${mb(total)} MB; ${wheelFiles.length} wheels + core)`);
}

main().catch((e) => {
  console.error("vendor-pyodide failed:", e.message);
  process.exit(1);
});
