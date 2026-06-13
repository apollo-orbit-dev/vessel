// Ed25519 bundle signing/verification via WebCrypto (works in Node and the
// browser). The signature covers all bundle files except signature.sig itself,
// in a canonical (sorted, length-prefixed) encoding — so any change to any
// file, including the manifest, breaks verification (tamper-evidence).

const SIG_FILE = "signature.sig";
const PREFIX = "ed25519:";

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(str: string): Uint8Array {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Canonical bytes signed over: every file except signature.sig, name-sorted. */
function signingMessage(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files)
    .filter((n) => n !== SIG_FILE && !n.endsWith("/"))
    .sort();
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const name of names) {
    parts.push(enc.encode(`${name}\n`));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, files[name].length, false);
    parts.push(len);
    parts.push(files[name]);
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface KeyPairB64 {
  /** pkcs8 private key, base64 — keep secret. */
  priv: string;
  /** raw public key, base64 — distribute. */
  pub: string;
}

/** Generate an Ed25519 signing keypair (base64-encoded). */
export async function generateKeyPair(): Promise<KeyPairB64> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  return { priv: b64(priv), pub: b64(pub) };
}

/**
 * Sign a bundle's files. Returns the `signed_by` value (to set on the manifest)
 * and the signature bytes (to store as signature.sig). The caller signs the
 * files *after* setting signed_by on the manifest, so the manifest is covered.
 */
export async function signBundleFiles(
  files: Record<string, Uint8Array>,
  keypair: KeyPairB64,
): Promise<{ signedBy: string; signature: Uint8Array }> {
  const privKey = await crypto.subtle.importKey(
    "pkcs8",
    unb64(keypair.priv) as BufferSource,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("Ed25519", privKey, signingMessage(files) as BufferSource),
  );
  return { signedBy: PREFIX + keypair.pub, signature: sig };
}

export interface VerifyResult {
  /** A signature + signed_by are present. */
  signed: boolean;
  /** The signature verifies over the content (tamper-free). */
  valid: boolean;
  publisher?: string;
  /** Short hex of the signing public key, for out-of-band comparison. */
  fingerprint?: string;
}

/** Verify a bundle's signature against the public key in `manifest.signed_by`. */
export async function verifyBundle(
  files: Record<string, Uint8Array>,
  manifest: { signed_by?: string; publisher?: string },
): Promise<VerifyResult> {
  const sig = files[SIG_FILE];
  const signedBy = manifest.signed_by;
  if (!sig || !signedBy || !signedBy.startsWith(PREFIX)) return { signed: false, valid: false };
  try {
    const pubRaw = unb64(signedBy.slice(PREFIX.length));
    const key = await crypto.subtle.importKey("raw", pubRaw as BufferSource, { name: "Ed25519" }, false, [
      "verify",
    ]);
    const valid = await crypto.subtle.verify(
      "Ed25519",
      key,
      sig as BufferSource,
      signingMessage(files) as BufferSource,
    );
    const fingerprint = [...pubRaw.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
    return { signed: true, valid, publisher: manifest.publisher, fingerprint };
  } catch {
    return { signed: true, valid: false, publisher: manifest.publisher };
  }
}
