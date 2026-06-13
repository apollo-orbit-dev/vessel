import type { Manifest } from "./manifest";

// Default-deny network egress for bundle code. The bundle's Python (via
// `js.fetch`/pyfetch) and any XHR are only allowed to reach the https origins
// the manifest declares in `capabilities.network`. Everything else — other
// origins, http, relative URLs — is blocked.

/** The distinct https origins a bundle is allowed to reach (from its manifest). */
export function allowedOrigins(manifest: Manifest): string[] {
  const set = new Set<string>();
  for (const entry of manifest.capabilities?.network ?? []) {
    try {
      const u = new URL(entry);
      if (u.protocol === "https:") set.add(u.origin);
    } catch {
      /* manifest validation already requires https URLs; skip anything odd */
    }
  }
  return [...set];
}

/** True only for an absolute https URL whose origin is in `allowed`. */
export function isEgressAllowed(url: string, allowed: Set<string>): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && allowed.has(u.origin);
  } catch {
    return false; // relative or invalid -> deny
  }
}

function blockedLabel(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "a non-https or relative URL";
  }
}

/**
 * Replace `fetch` and `XMLHttpRequest.open` on `target` with allowlist-enforcing
 * wrappers (default-deny). Install this AFTER the runtime has finished loading
 * its own packages (those legitimately fetch from the Pyodide CDN) and BEFORE
 * bundle code runs. `target` is the worker global in the host.
 */
export function installEgressPolicy(target: any, allowed: Set<string>): void {
  const realFetch = typeof target.fetch === "function" ? target.fetch.bind(target) : null;
  target.fetch = (input: any, init?: any) => {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (!isEgressAllowed(url, allowed)) {
      return Promise.reject(
        new TypeError(`Vessel: network egress to ${blockedLabel(url)} is not allowed by this bundle`),
      );
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new TypeError("fetch is unavailable"));
  };

  const XHR = target.XMLHttpRequest;
  if (XHR?.prototype?.open) {
    const realOpen = XHR.prototype.open;
    XHR.prototype.open = function (this: unknown, method: string, url: string, ...rest: unknown[]) {
      if (!isEgressAllowed(String(url), allowed)) {
        throw new DOMException(
          `Vessel: network egress to ${blockedLabel(String(url))} is not allowed by this bundle`,
          "SecurityError",
        );
      }
      return realOpen.call(this, method, url, ...rest);
    };
  }
}
