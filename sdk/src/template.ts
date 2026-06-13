// The `vessel new` scaffold, inlined so it survives bundling/publishing.
// A minimal, working FastAPI + SQLite note tool with a self-contained UI.

const MAIN_PY = `"""Backend for {{NAME}} — an ordinary FastAPI app.

Runs in Pyodide inside the Vessel host. Two rules to remember:
  - routes must be \`async def\` (Pyodide has no threads), and
  - use stdlib sqlite3 against the manifest's data path.
"""

import sqlite3
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel, Field

DB_PATH = Path("data/store.sqlite")
MAX_BODY_LEN = 10_000


class Note(BaseModel):
    body: str = Field(default="", max_length=MAX_BODY_LEN)


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes ("
        "  id   INTEGER PRIMARY KEY CHECK (id = 1),"
        "  body TEXT NOT NULL DEFAULT ''"
        ")"
    )
    conn.execute("INSERT OR IGNORE INTO notes (id, body) VALUES (1, '')")
    conn.commit()
    return conn


app = FastAPI()


@app.get("/api/note")
async def get_note() -> Note:
    conn = _conn()
    try:
        row = conn.execute("SELECT body FROM notes WHERE id = 1").fetchone()
        return Note(body=row[0] if row else "")
    finally:
        conn.close()


@app.post("/api/note")
async def post_note(note: Note) -> dict:
    conn = _conn()
    try:
        conn.execute("UPDATE notes SET body = ? WHERE id = 1", (note.body,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "body": note.body}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{NAME}}</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
      h1 { font-size: 15px; font-weight: 600; margin: 0; }
      p { margin: 0; font-size: 12px; opacity: 0.6; }
      textarea { font: inherit; padding: 10px; min-height: 200px; resize: vertical; }
      .row { display: flex; gap: 10px; align-items: center; }
      button { font: inherit; padding: 8px 16px; cursor: pointer; }
      #status { font-size: 12px; opacity: 0.7; }
    </style>
  </head>
  <body>
    <h1>{{NAME}}</h1>
    <p>An ordinary <code>fetch('/api/note')</code> UI backed by FastAPI + SQLite.</p>
    <textarea id="note" placeholder="Type a note, then Save…"></textarea>
    <div class="row">
      <button id="save">Save</button>
      <span id="status"></span>
    </div>
    <script>
      const $note = document.getElementById("note");
      const $status = document.getElementById("status");
      async function load() {
        const res = await fetch("/api/note");
        $note.value = (await res.json()).body || "";
        $status.textContent = "loaded";
      }
      document.getElementById("save").addEventListener("click", async () => {
        $status.textContent = "saving…";
        const res = await fetch("/api/note", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: $note.value }),
        });
        $status.textContent = res.ok ? "saved" : "error: " + res.status;
      });
      load();
    </script>
  </body>
</html>
`;

const README_MD = `# {{NAME}}

A Vessel tool bundle (FastAPI + SQLite + a self-contained UI).

## Develop
\`\`\`bash
vessel dev      # run locally with host-parity (Pyodide) + hot reload
\`\`\`

## Build
\`\`\`bash
vessel build    # package into {{SLUG}}.vessel — open it in the Vessel host
\`\`\`

## Layout
- \`manifest.json\` — identity, entry points, declared packages/capabilities
- \`app/main.py\` — the FastAPI backend (routes must be \`async def\`)
- \`ui/index.html\` — the UI (a single self-contained file in v1)
- \`data/store.sqlite\` — the database that travels inside the bundle
`;

const GITIGNORE = `*.vessel
__pycache__/
*.pyc
.venv/
.DS_Store
`;

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "bundle";
}

/** The scaffold's files (relative path -> contents) for a project named `name`. */
export function templateFiles(name: string): Record<string, string | Uint8Array> {
  const sub = (s: string) => s.replaceAll("{{NAME}}", name).replaceAll("{{SLUG}}", slug(name));
  const manifest = {
    format_version: 1,
    name,
    version: "0.1.0",
    ui: "ui/index.html",
    backend: "app.main:app",
    data: "data/store.sqlite",
    python: ">=3.12",
    packages: ["fastapi"],
  };
  return {
    "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    "app/__init__.py": "",
    "app/main.py": sub(MAIN_PY),
    "ui/index.html": sub(INDEX_HTML),
    "data/store.sqlite": new Uint8Array(0),
    "README.md": sub(README_MD),
    ".gitignore": GITIGNORE,
  };
}
