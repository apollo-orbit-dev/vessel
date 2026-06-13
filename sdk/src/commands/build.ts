import { statSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import {
  writeBundle,
  readBundle,
  signBundleFiles,
  BundleError,
  type Manifest,
  type KeyPairB64,
} from "@vessel/core";
import { collectDir } from "../source";
import { slug } from "../template";

export interface BuildOptions {
  dir: string;
  out?: string;
  /** Path to a keypair file from `vessel keygen` to sign the bundle. */
  sign?: string;
}

/** Package a bundle source directory into a validated `.vessel`. Returns the output path. */
export async function buildBundle(opts: BuildOptions): Promise<string> {
  const srcDir = resolve(opts.dir);
  if (!statSync(srcDir).isDirectory()) {
    throw new BundleError(`not a directory: ${opts.dir}`);
  }

  const files = collectDir(srcDir);
  if (!files["manifest.json"]) {
    throw new BundleError(`no manifest.json found in ${opts.dir}`);
  }

  if (opts.sign) {
    let kp: KeyPairB64;
    try {
      kp = JSON.parse(readFileSync(resolve(opts.sign), "utf8")) as KeyPairB64;
    } catch {
      throw new BundleError(`could not read signing key: ${opts.sign}`);
    }
    // Record the signer in the manifest BEFORE signing, so it's covered.
    const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
    manifest.signed_by = `ed25519:${kp.pub}`;
    files["manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + "\n");
    const { signature } = await signBundleFiles(files, kp);
    files["signature.sig"] = signature;
  }

  const bytes = writeBundle(files);
  // The build must not emit anything the host would reject: validate the
  // artifact with the host's own loader (manifest schema, zip-safety, parts).
  const parsed = readBundle(bytes);

  const out = opts.out
    ? resolve(opts.out)
    : join(process.cwd(), `${slug((parsed.manifest as Manifest).name)}.vessel`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  return out;
}
