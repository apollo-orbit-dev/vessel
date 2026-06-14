import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Single source of truth for the host version: package.json, injected as
// __APP_VERSION__ at build/test time so the UI never hardcodes it (Phase 13).
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Served from a sub-path on the canonical origin (getvessel.dev/app/); the
  // landing page owns the root. Affects built asset URLs + the SW/manifest scope.
  base: "/app/",
  // Pyodide is loaded from CDN at runtime, not bundled.
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pyodide boot + micropip install of FastAPI can take a while.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
