import { mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { BundleError } from "@vessel/core";
import { templateFiles, slug } from "../template";

export interface NewOptions {
  name: string;
  dir?: string;
}

/** Scaffold a new bundle project. Returns the created directory path. */
export function newBundle(opts: NewOptions): string {
  const name = opts.name.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/.test(name)) {
    throw new BundleError("invalid project name (use letters, digits, spaces, . _ -)");
  }
  const target = resolve(opts.dir ?? slug(name));
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new BundleError(`directory is not empty: ${target}`);
  }

  for (const [rel, content] of Object.entries(templateFiles(name))) {
    const full = join(target, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return target;
}
