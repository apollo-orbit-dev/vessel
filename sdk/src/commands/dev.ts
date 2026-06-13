import { createServer, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { watch } from "chokidar";
import {
  writeBundle,
  readBundle,
  createRuntime,
  resolveBundleThemeCss,
  type PyodideLike,
  type VesselRuntime,
} from "@vessel/core";
import { collectDir } from "../source";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

export function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

const RELOAD_SNIPPET =
  `<script>new EventSource("/__vessel_reload").addEventListener("message",()=>location.reload())</script>`;

/** Inject the live-reload client before </body> (or append). Pure — unit-tested. */
export function injectReloadScript(html: string): string {
  return html.includes("</body>")
    ? html.replace("</body>", RELOAD_SNIPPET + "</body>")
    : html + RELOAD_SNIPPET;
}

// Dev parity: inject the default theme (light) so authors see the same
// `--vessel-*` tokens + base component styles the host provides. No live toggle
// in dev (there's no host chrome here).
const THEME_STYLE = `<style>${resolveBundleThemeCss("default", "light")}</style>`;

/** Inject the default theme stylesheet after <head> (or prepend). Pure. */
export function injectThemeStyle(html: string): string {
  const head = html.match(/<head[^>]*>/i);
  if (head?.index !== undefined) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + THEME_STYLE + html.slice(at);
  }
  return THEME_STYLE + html;
}

export interface DevOptions {
  dir: string;
  port?: number;
}

/** Run a local dev server with host parity (Pyodide-in-Node) + hot reload. */
export async function dev(opts: DevOptions): Promise<void> {
  const srcDir = resolve(opts.dir);
  const port = opts.port ?? 5174;

  const { loadPyodide } = await import("pyodide");
  const pyodide = (await loadPyodide()) as unknown as PyodideLike;

  let runtime: VesselRuntime;
  async function rebuild(): Promise<void> {
    // Round-trip through the format so dev validates exactly like the host.
    const bundle = readBundle(writeBundle(collectDir(srcDir)));
    runtime = await createRuntime(pyodide, bundle);
  }
  await rebuild();

  const clients = new Set<ServerResponse>();
  const broadcastReload = () => clients.forEach((r) => r.write("data: reload\n\n"));

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    if (path === "/__vessel_reload") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (path.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
      try {
        const r = await runtime.dispatch({
          method: req.method ?? "GET",
          path: path + url.search,
          headers,
          body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null,
        });
        res.writeHead(r.status, { "content-type": "application/json", ...r.headers });
        res.end(r.body);
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
      return;
    }

    // Serve the UI from disk (live), defaulting "/" to ui/index.html.
    const rel = path === "/" ? "ui/index.html" : decodeURIComponent(path.replace(/^\//, ""));
    const file = join(srcDir, rel);
    if (!file.startsWith(srcDir + sep) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const ct = contentType(file);
    res.writeHead(200, { "content-type": ct });
    res.end(
      ct === "text/html"
        ? injectReloadScript(injectThemeStyle(readFileSync(file, "utf8")))
        : readFileSync(file),
    );
  });

  await new Promise<void>((r) => server.listen(port, r));
  console.log(`vessel dev → http://localhost:${port}   (serving ${srcDir})`);

  const watcher = watch([join(srcDir, "app"), join(srcDir, "ui"), join(srcDir, "manifest.json")], {
    ignoreInitial: true,
  });
  watcher.on("all", async (_evt, file) => {
    const isBackend = file.includes(`${sep}app${sep}`) || file.endsWith("manifest.json");
    if (isBackend) {
      try {
        await rebuild();
        console.log("reloaded backend");
      } catch (e) {
        console.error(`reload failed: ${String(e)}`);
      }
    }
    broadcastReload();
  });
}
