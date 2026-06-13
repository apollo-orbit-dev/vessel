import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Pyodide is loaded from CDN at runtime, not bundled.
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Pyodide boot + micropip install of FastAPI can take a while.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
