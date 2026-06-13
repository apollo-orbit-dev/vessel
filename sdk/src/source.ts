import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Files never packaged into a bundle (editor/OS/Python cruft).
export const SKIP_DIRS = new Set(["__pycache__", ".git", "node_modules", ".venv", "dist"]);

/** Read a bundle source dir into an in-zip path -> bytes map. */
export function collectDir(dir: string): Record<string, Uint8Array> {
  const acc: Record<string, Uint8Array> = {};
  const walk = (cur: string) => {
    for (const name of readdirSync(cur)) {
      if (name.startsWith(".") || SKIP_DIRS.has(name)) continue;
      const full = join(cur, name);
      if (statSync(full).isDirectory()) walk(full);
      else acc[relative(dir, full).split(sep).join("/")] = new Uint8Array(readFileSync(full));
    }
  };
  walk(dir);
  return acc;
}
