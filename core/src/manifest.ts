import { z } from "zod";
import { BundleError } from "./errors";
import { isSafeBundlePath } from "./zipsafe";

// manifest.json v1. Unknown keys are stripped (additive forward-compat); known
// keys are validated strictly. See docs/format.md for the prose spec.

const bundlePath = z
  .string()
  .max(1024)
  .refine(isSafeBundlePath, "must be a safe relative path");

const httpsUrl = z.string().refine((s) => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}, "must be a valid https URL");

// "module:attr" — dotted Python module path, then an attribute identifier.
const backendTarget = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*$/,
    "must be 'module:attr'",
  );

// PyPI/Pyodide distribution names.
const packageName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "invalid package name");

export const manifestV1 = z.object({
  format_version: z.literal(1),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(64),
  ui: bundlePath,
  backend: backendTarget,
  data: bundlePath,
  python: z.string().max(32).optional(),
  packages: z.array(packageName).max(200).optional(),
  capabilities: z
    .object({
      network: z.array(httpsUrl).max(50).optional(),
      clipboard: z.boolean().optional(),
      print: z.boolean().optional(),
    })
    .optional(),
  publisher: z.string().max(200).optional(),
  signed_by: z.string().max(512).optional(),
});

export type Manifest = z.infer<typeof manifestV1>;

/** Parse + validate raw manifest.json bytes, or throw a user-safe BundleError. */
export function parseManifest(raw: Uint8Array): Manifest {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new BundleError("invalid bundle: manifest.json is not valid JSON");
  }
  const result = manifestV1.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? issue.path.join(".") : "manifest";
    throw new BundleError(`invalid manifest: ${where}: ${issue.message}`);
  }
  return result.data;
}

/** Candidate in-bundle file paths for a "module:attr" backend target. */
export function backendModulePaths(backend: string): string[] {
  const mod = backend.split(":")[0].replace(/\./g, "/");
  return [`${mod}.py`, `${mod}/__init__.py`];
}
