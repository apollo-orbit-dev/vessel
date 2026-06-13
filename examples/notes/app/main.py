"""Notes — a multi-notebook note store as an ordinary FastAPI app.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it would
be against a normal server. The host bridges the UI's fetch('/api/...') into this
app inside Pyodide (see host/src/bridge.ts, runtime.ts). Notebooks group notes;
the sidebar lists them. All SQLite access uses parameterized queries.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop.
"""

import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("CREATE TABLE IF NOT EXISTS notebooks (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)")
    con.execute(
        "CREATE TABLE IF NOT EXISTS notes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "notebook_id INTEGER NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE, "
        "title TEXT NOT NULL DEFAULT 'Untitled', "
        "body TEXT NOT NULL DEFAULT '', "
        "updated_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    # Seed a couple of notebooks + notes on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM notebooks").fetchone()[0] == 0:
        seed = {
            "Personal": [
                ("Welcome", "This whole app — UI, Python, and these notes — lives inside the .vessel file."),
                ("Groceries", "milk\neggs\ncoffee"),
            ],
            "Work": [("Standup", "- ship themes\n- review the bridge")],
        }
        for name, notes in seed.items():
            nb_id = con.execute("INSERT INTO notebooks (name) VALUES (?)", (name,)).lastrowid
            for title, body in notes:
                con.execute(
                    "INSERT INTO notes (notebook_id, title, body) VALUES (?, ?, ?)",
                    (nb_id, title, body),
                )
        con.commit()
    return con


class NotebookIn(BaseModel):
    name: str


class NoteIn(BaseModel):
    notebook_id: int
    title: str = "Untitled"


class NoteUpdate(BaseModel):
    title: str
    body: str


@app.get("/api/notebooks")
async def list_notebooks():
    con = _con()
    out = []
    for nb_id, name in con.execute("SELECT id, name FROM notebooks ORDER BY id").fetchall():
        notes = con.execute(
            "SELECT id, title FROM notes WHERE notebook_id = ? ORDER BY id", (nb_id,)
        ).fetchall()
        out.append({"id": nb_id, "name": name, "notes": [{"id": n[0], "title": n[1]} for n in notes]})
    con.close()
    return out


@app.post("/api/notebooks")
async def create_notebook(nb: NotebookIn):
    con = _con()
    nb_id = con.execute("INSERT INTO notebooks (name) VALUES (?)", (nb.name,)).lastrowid
    con.commit()
    con.close()
    return {"id": nb_id, "name": nb.name, "notes": []}


@app.get("/api/notes/{note_id}")
async def get_note(note_id: int):
    con = _con()
    row = con.execute("SELECT id, notebook_id, title, body FROM notes WHERE id = ?", (note_id,)).fetchone()
    con.close()
    if row is None:
        raise HTTPException(status_code=404, detail="note not found")
    return {"id": row[0], "notebook_id": row[1], "title": row[2], "body": row[3]}


@app.post("/api/notes")
async def create_note(note: NoteIn):
    con = _con()
    note_id = con.execute(
        "INSERT INTO notes (notebook_id, title) VALUES (?, ?)", (note.notebook_id, note.title)
    ).lastrowid
    con.commit()
    con.close()
    return {"id": note_id, "notebook_id": note.notebook_id, "title": note.title, "body": ""}


@app.put("/api/notes/{note_id}")
async def update_note(note_id: int, note: NoteUpdate):
    con = _con()
    con.execute(
        "UPDATE notes SET title = ?, body = ?, updated_at = datetime('now') WHERE id = ?",
        (note.title, note.body, note_id),
    )
    con.commit()
    con.close()
    return {"ok": True}


@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int):
    con = _con()
    con.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    con.commit()
    con.close()
    return {"ok": True}
