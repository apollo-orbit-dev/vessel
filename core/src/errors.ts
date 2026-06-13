/**
 * Raised when a bundle is malformed, hostile, or fails validation.
 *
 * Carries a short, user-safe message (no internal paths, no stack details for
 * the end user). The host surfaces `.message`; it must never leak host
 * filesystem paths or schema internals to bundle-derived output.
 */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}
