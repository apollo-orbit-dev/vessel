"""Notes — a one-row note store as an ordinary FastAPI app.

This is a real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as
it would be against a normal server. The host bridges the UI's fetch('/api/...')
into this app inside Pyodide (see host/src/bridge.ts, runtime.ts).

Input is validated by a Pydantic model (type + max length); SQLite access uses
parameterized queries.
"""

import sqlite3
from pathlib import Path

from fastapi import FastAPI
from pydantic import BaseModel, Field

# Relative to the bundle root; the bridge chdir's into /bundle before importing.
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


# Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
# dispatches *sync* (`def`) routes to a threadpool (anyio.to_thread), which
# raises "can't start new thread". Async routes run inline on the event loop.
# (sqlite calls here are brief and synchronous, which is fine.)
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
