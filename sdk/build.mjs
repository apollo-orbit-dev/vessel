// Bundle the CLI to a single self-contained executable (dist/cli.mjs).
// @vessel/core (and its fflate/zod deps) are bundled in; pyodide/chokidar
// (added for `dev`) stay external — resolved from node_modules at runtime.
import { build } from "esbuild";
import { chmodSync } from "node:fs";

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: ["pyodide", "chokidar"],
  logLevel: "info",
});

chmodSync("dist/cli.mjs", 0o755);
