import { isSafeBundlePath } from "@vessel/core";

// Inline an author's local <script src> / <link rel=stylesheet> references into a
// single self-contained index.html at build time.
//
// Why: `vessel dev` serves any file under the source dir from disk, so a
// multi-file UI works in dev — but the built bundle/host only serves the manifest
// `ui` file. Without inlining, a multi-file UI works in dev then silently breaks
// when packaged. Inlining keeps the host's "one self-contained file" contract
// while letting authors split their UI into files.
//
// Scope (v1): flat single-file JS/CSS only. We inline a referenced file's text;
// we do NOT bundle ES-module graphs (an inlined module that itself imports other
// local files gets a warning, not flattening — that needs a real JS bundler).

export interface InlineResult {
  html: string;
  /** In-bundle paths that were inlined and should be dropped from the bundle. */
  inlined: string[];
  warnings: string[];
}

/** True for refs the build must not touch: remote URLs, protocol-relative, data:, any scheme. */
function isExternal(ref: string): boolean {
  return ref.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref);
}

/** Resolve a local href/src (relative to the html file's dir) to an in-bundle path, or null. */
function resolveInBundle(htmlPath: string, ref: string): string | null {
  const clean = ref.split("?")[0].split("#")[0];
  if (!clean) return null;
  let p: string;
  if (clean.startsWith("/")) {
    p = clean.slice(1); // absolute = bundle root
  } else {
    const dir = htmlPath.includes("/") ? htmlPath.slice(0, htmlPath.lastIndexOf("/")) : "";
    p = dir ? `${dir}/${clean}` : clean;
  }
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // escapes the bundle root
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const norm = parts.join("/");
  return isSafeBundlePath(norm) ? norm : null;
}

const decoder = new TextDecoder();

/** Read a JS string attribute value out of an HTML attribute blob. */
function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

/**
 * Inline local script/stylesheet references in `html` (at in-bundle path `htmlPath`)
 * using the collected bundle `files`. Pure — returns new HTML + bookkeeping.
 */
export function inlineHtml(
  html: string,
  htmlPath: string,
  files: Record<string, Uint8Array>,
): InlineResult {
  const inlined: string[] = [];
  const warnings: string[] = [];

  const tryAsset = (ref: string, kind: "script" | "style"): string | null => {
    if (isExternal(ref)) return null; // remote/data: left untouched
    const path = resolveInBundle(htmlPath, ref);
    if (!path) {
      warnings.push(`could not resolve local ${kind} reference "${ref}" — left as-is`);
      return null;
    }
    if (!files[path]) {
      warnings.push(`${kind} references missing local asset "${ref}" (${path}) — left as-is; it will NOT be served by the host`);
      return null;
    }
    return path;
  };

  // <script ...src="...">...</script>  (src scripts have no meaningful body)
  let out = html.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*?)>\s*<\/script\s*>/gi,
    (whole, pre: string, ref: string, post: string) => {
      const path = tryAsset(ref, "script");
      if (!path) return whole;
      const code = decoder.decode(files[path]);
      if (/^\s*(import|export)\b/m.test(code) || /\bfrom\s+["']\.{1,2}\//.test(code)) {
        warnings.push(`"${ref}" looks like an ES module that imports other local files; inlined as-is but module graphs are not bundled (keep the UI flat, or pre-bundle it)`);
      }
      const isModule = /\btype\s*=\s*["']module["']/i.test(pre + post);
      inlined.push(path);
      // Escape the terminator so script content can't break out of the tag.
      const safe = code.replace(/<\/script/gi, "<\\/script");
      return `<script${isModule ? ' type="module"' : ""}>${safe}</script>`;
    },
  );

  // <link rel="stylesheet" href="...">  (void element, no closing tag)
  out = out.replace(/<link\b([^>]*)>/gi, (whole, attrs: string) => {
    const rel = (attr(attrs, "rel") || "").toLowerCase();
    if (rel !== "stylesheet") return whole;
    const ref = attr(attrs, "href");
    if (!ref) return whole;
    const path = tryAsset(ref, "style");
    if (!path) return whole;
    const css = decoder.decode(files[path]);
    inlined.push(path);
    const safe = css.replace(/<\/style/gi, "<\\/style");
    return `<style>${safe}</style>`;
  });

  return { html: out, inlined, warnings };
}

/**
 * Find local (non-external) <script src>/<link stylesheet> references in `html`.
 * Used by `vessel inspect` to flag a bundle whose UI still points at separate
 * files — the host serves only the manifest `ui` file, so those would 404.
 */
export function findLocalRefs(html: string): { kind: "script" | "style"; ref: string }[] {
  const refs: { kind: "script" | "style"; ref: string }[] = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*?>\s*<\/script\s*>/gi)) {
    if (!isExternal(m[1])) refs.push({ kind: "script", ref: m[1] });
  }
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    if ((attr(m[1], "rel") || "").toLowerCase() !== "stylesheet") continue;
    const ref = attr(m[1], "href");
    if (ref && !isExternal(ref)) refs.push({ kind: "style", ref });
  }
  return refs;
}
