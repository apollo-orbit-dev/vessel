import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { generateKeyPair, BundleError } from "@vessel/core";

export interface KeygenOptions {
  name: string;
}

/** Generate an Ed25519 signing keypair: <name>.key (secret) + <name>.pub (share). */
export async function keygen(opts: KeygenOptions): Promise<{ keyFile: string; pubFile: string }> {
  const keyFile = resolve(`${opts.name}.key`);
  const pubFile = resolve(`${opts.name}.pub`);
  if (existsSync(keyFile)) throw new BundleError(`refusing to overwrite ${opts.name}.key`);

  const kp = await generateKeyPair();
  writeFileSync(keyFile, JSON.stringify(kp, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(pubFile, kp.pub + "\n");
  return { keyFile, pubFile };
}
