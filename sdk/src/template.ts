// The `vessel new` scaffold, inlined so it survives bundling/publishing.
// A minimal, working FastAPI + SQLite to-do tool with a self-contained UI,
// written to teach the safe sqlite3-through-Python pattern.

const MAIN_PY = `"""Backend for {{NAME}} — an ordinary FastAPI app that stores data in SQLite.

Runs in Pyodide inside the Vessel host, but it's just normal Python: FastAPI for
the routes and the standard-library sqlite3 module for storage. The host saves
the SQLite file back into the .vessel bundle, so your data travels with the tool.

Three rules specific to Vessel:
  1. Every route must be 'async def' — Pyodide has no OS threads, and FastAPI
     would otherwise run plain 'def' routes in a threadpool (which fails here).
  2. Open the database at the manifest's data path (here: data/store.sqlite).
  3. Whatever you write to that file persists inside the .vessel when saved.

This example is a small to-do list. The _db / query_all / query_one / execute
helpers below are a tiny, safe wrapper around sqlite3 — copy the pattern for your
own tables.
"""

import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# The database file, relative to the bundle root. The host loads it from the
# bundle and writes it back when the user saves, so rows you insert here persist.
DB_PATH = Path("data/store.sqlite")


# --- SQLite helpers: a small, safe wrapper around the stdlib. Copy these. -----
def _db() -> sqlite3.Connection:
    # row_factory makes rows behave like dicts: row["title"] instead of row[1],
    # and dict(row) turns a row straight into JSON-friendly data.
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # enforce table relationships
    return conn


def query_all(sql: str, params: tuple = ()) -> list[dict]:
    # Run a SELECT and return all rows as dicts. 'params' fills the ? placeholders
    # in 'sql' — ALWAYS pass values this way (never f-strings or string +) so
    # user input can't be injected into the query.
    conn = _db()
    try:
        return [dict(row) for row in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def query_one(sql: str, params: tuple = ()) -> dict | None:
    # Run a SELECT and return the first row as a dict, or None.
    conn = _db()
    try:
        row = conn.execute(sql, params).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def execute(sql: str, params: tuple = ()) -> int:
    # Run an INSERT/UPDATE/DELETE, commit, and return the new row id (handy after
    # an INSERT). Parameterized, exactly like the read helpers.
    conn = _db()
    try:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


# --- Schema + seed. CREATE TABLE IF NOT EXISTS is safe to run on every start. -
def _init() -> None:
    execute(
        "CREATE TABLE IF NOT EXISTS tasks ("
        "  id    INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  title TEXT    NOT NULL,"
        "  done  INTEGER NOT NULL DEFAULT 0"
        ")"
    )
    # Seed a couple of rows the first time so the UI isn't empty.
    if query_one("SELECT COUNT(*) AS n FROM tasks")["n"] == 0:
        for title in ("Open this tool in the Vessel host", "Edit app/main.py to make it yours"):
            execute("INSERT INTO tasks (title) VALUES (?)", (title,))


_init()
app = FastAPI()


# Pydantic validates incoming JSON at the boundary (type + length here) before
# your code runs — reject bad input early.
class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


# The UI calls these with fetch('/api/...'); the host bridges each call straight
# into this app (no real network). Every route is async (rule 1 above).
@app.get("/api/tasks")
async def list_tasks() -> list[dict]:
    return query_all("SELECT id, title, done FROM tasks ORDER BY id")


@app.post("/api/tasks")
async def add_task(task: TaskIn) -> dict:
    new_id = execute("INSERT INTO tasks (title) VALUES (?)", (task.title,))
    return {"id": new_id, "title": task.title, "done": 0}


@app.post("/api/tasks/{task_id}/toggle")
async def toggle_task(task_id: int) -> dict:
    if query_one("SELECT id FROM tasks WHERE id = ?", (task_id,)) is None:
        raise HTTPException(status_code=404, detail="task not found")
    execute("UPDATE tasks SET done = 1 - done WHERE id = ?", (task_id,))
    return {"ok": True}


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int) -> dict:
    execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return {"ok": True}
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{{NAME}}</title>
    <!-- Colors come from the Vessel host's injected --vessel-* theme tokens +
         classless base styles, so this UI follows the host light/dark + theme.
         Prefer the tokens (or plain semantic HTML) over hardcoding colors. -->
    <style>
      body { margin: 0; padding: 24px; max-width: 560px;
             font-family: var(--vessel-font, system-ui, sans-serif); }
      h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
      p.hint { margin: 0 0 16px; font-size: 13px; color: var(--vessel-text-muted, #888); }
      .add { display: flex; gap: 8px; margin-bottom: 16px; }
      .add input { flex: 1; }
      ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      li { display: flex; align-items: center; gap: 10px; padding: 8px 10px;
           border: 1px solid var(--vessel-border, #ddd); border-radius: var(--vessel-radius, 8px); }
      li.done .title { text-decoration: line-through; color: var(--vessel-text-muted, #888); }
      .title { flex: 1; }
    </style>
  </head>
  <body>
    <h1>{{NAME}}</h1>
    <p class="hint">A FastAPI + SQLite to-do list. Edit <code>app/main.py</code> and <code>ui/index.html</code> to make it your own.</p>

    <form class="add" id="add">
      <input id="title" placeholder="Add a task…" maxlength="200" required />
      <button class="vessel-primary" type="submit">Add</button>
    </form>
    <ul id="list"></ul>

    <script>
      // Plain vanilla JS calling fetch('/api/...'). The host routes those calls
      // into the Python backend in-process (no real network is used).
      const list = document.getElementById("list");
      const toJson = (r) => r.json();

      async function load() {
        const tasks = await fetch("/api/tasks").then(toJson);
        list.replaceChildren(...tasks.map(renderTask));
      }

      function renderTask(task) {
        const li = document.createElement("li");
        if (task.done) li.className = "done";

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = Boolean(task.done);
        toggle.onchange = async () => {
          await fetch("/api/tasks/" + task.id + "/toggle", { method: "POST" });
          load();
        };

        const title = document.createElement("span");
        title.className = "title";
        title.textContent = task.title; // textContent (not innerHTML) for user text

        const del = document.createElement("button");
        del.className = "vessel-danger";
        del.textContent = "Delete";
        del.onclick = async () => {
          await fetch("/api/tasks/" + task.id, { method: "DELETE" });
          load();
        };

        li.append(toggle, title, del);
        return li;
      }

      document.getElementById("add").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("title");
        const title = input.value.trim();
        if (!title) return;
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title }),
        });
        input.value = "";
        load();
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
- \`app/main.py\` — the FastAPI backend (routes must be \`async def\`; see the
  \`query_all\` / \`query_one\` / \`execute\` SQLite helpers at the top)
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
