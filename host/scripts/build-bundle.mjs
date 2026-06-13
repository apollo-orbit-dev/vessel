// Assemble examples/notes/ into tests/fixtures/notes.vessel (a ZIP).
// Exposed as buildBundle() so the smoke test can build in-memory too.
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const srcDir = join(repoRoot, "examples", "notes");
const outFile = join(repoRoot, "tests", "fixtures", "notes.vessel");

function collect(dir, base, acc) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      collect(full, base, acc);
    } else {
      const rel = relative(base, full).split(sep).join("/");
      acc[rel] = new Uint8Array(readFileSync(full));
    }
  }
  return acc;
}

/** Build the example bundle and return its `.vessel` (ZIP) bytes. */
export function buildBundle() {
  return zipSync(collect(srcDir, srcDir, {}));
}

// When run directly, also write the artifact to disk for the browser host.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = buildBundle();
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, bytes);
  console.log(`wrote ${outFile} (${bytes.length} bytes)`);
}
