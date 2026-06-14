"""Habits — a habit / streak tracker as an ordinary FastAPI app.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it would
be against a normal server. The host bridges the UI's fetch('/api/...') into this
app inside Pyodide (see host/src/bridge.ts, runtime.ts). Each habit owns a hue and
a set of completed day-indices (0..20, 20 = today); a "streak" counts back from
today until the first missed day. Everything — habits and their per-day completion
state — lives in the SQLite DB and survives a reopen. All access is parameterized.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop.
"""

import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)

DAYS = 21  # number of day-cells shown
TODAY = DAYS - 1  # index 20 is "today"; the streak counts back from here

NAME_MAX = 80  # max habit-name length, enforced at the boundary (Pydantic)
HUE_MIN, HUE_MAX = 0, 359  # categorical hue is an oklch hue angle, whole degrees

app = FastAPI()


def _seed_done(pattern: list[int]) -> list[int]:
    """Expand a weekly on/off pattern into the set of done day-indices (0..20)."""
    return [i for i in range(DAYS) if pattern[i % len(pattern)]]


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS habits ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "hue INTEGER NOT NULL, "
        "position INTEGER NOT NULL DEFAULT 0)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS completions ("
        "habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE, "
        "day INTEGER NOT NULL, "
        "PRIMARY KEY (habit_id, day))"
    )
    # Seed a few habits + some completed days on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM habits").fetchone()[0] == 0:
        seed = [
            ("Write 500 words", 230, [1, 1, 1, 0, 1, 1, 1]),
            ("Stretch", 155, [1, 1, 1, 1, 1, 1, 0]),
            ("No phone before 9", 280, [1, 0, 1, 1, 0, 1, 1]),
            ("Read 20 pages", 40, [1, 1, 0, 1, 1, 1, 1]),
            ("Walk 8k steps", 200, [1, 1, 1, 1, 0, 0, 1]),
        ]
        for pos, (name, hue, pattern) in enumerate(seed):
            habit_id = con.execute(
                "INSERT INTO habits (name, hue, position) VALUES (?, ?, ?)",
                (name, hue, pos),
            ).lastrowid
            for day in _seed_done(pattern):
                con.execute(
                    "INSERT INTO completions (habit_id, day) VALUES (?, ?)",
                    (habit_id, day),
                )
        con.commit()
    return con


def _streak(done: set[int]) -> int:
    """Consecutive completed days counting back from today (index TODAY)."""
    n = 0
    for i in range(TODAY, -1, -1):
        if i in done:
            n += 1
        else:
            break
    return n


class ToggleIn(BaseModel):
    habit_id: int
    day: int


# Validation at the boundary (whitelist): a non-empty, length-capped name and a
# whole-degree hue inside the oklch hue range. Pydantic rejects anything else
# with a 422 before any SQL runs.
class HabitIn(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    hue: int = Field(ge=HUE_MIN, le=HUE_MAX)


def _habit_payload(con: sqlite3.Connection, habit_id: int, name: str, hue: int) -> dict:
    """Shape a single habit the same way list_habits does (with done + streak)."""
    done = {
        r[0]
        for r in con.execute(
            "SELECT day FROM completions WHERE habit_id = ?", (habit_id,)
        ).fetchall()
    }
    return {
        "id": habit_id,
        "name": name,
        "hue": hue,
        "done": sorted(done),
        "streak": _streak(done),
    }


@app.get("/api/habits")
async def list_habits():
    con = _con()
    rows = con.execute(
        "SELECT id, name, hue FROM habits ORDER BY position, id"
    ).fetchall()
    out = []
    for habit_id, name, hue in rows:
        done = {
            r[0]
            for r in con.execute(
                "SELECT day FROM completions WHERE habit_id = ?", (habit_id,)
            ).fetchall()
        }
        out.append(
            {
                "id": habit_id,
                "name": name,
                "hue": hue,
                "done": sorted(done),
                "streak": _streak(done),
            }
        )
    con.close()
    return {"days": DAYS, "today": TODAY, "habits": out}


@app.post("/api/toggle")
async def toggle(t: ToggleIn):
    # Validate the day-index at the boundary: whitelist 0..DAYS-1.
    if not (0 <= t.day < DAYS):
        raise HTTPException(status_code=422, detail="day out of range")
    con = _con()
    if con.execute(
        "SELECT 1 FROM habits WHERE id = ?", (t.habit_id,)
    ).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="habit not found")
    existing = con.execute(
        "SELECT 1 FROM completions WHERE habit_id = ? AND day = ?",
        (t.habit_id, t.day),
    ).fetchone()
    if existing:
        con.execute(
            "DELETE FROM completions WHERE habit_id = ? AND day = ?",
            (t.habit_id, t.day),
        )
        on = False
    else:
        con.execute(
            "INSERT INTO completions (habit_id, day) VALUES (?, ?)",
            (t.habit_id, t.day),
        )
        on = True
    con.commit()
    done = {
        r[0]
        for r in con.execute(
            "SELECT day FROM completions WHERE habit_id = ?", (t.habit_id,)
        ).fetchall()
    }
    con.close()
    return {"habit_id": t.habit_id, "day": t.day, "on": on, "streak": _streak(done)}


@app.post("/api/habits")
async def create_habit(h: HabitIn):
    """Add a habit. name/hue validated by HabitIn (non-empty, capped, in range)."""
    name = h.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is empty")
    con = _con()
    # New habits sort after the existing ones.
    pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM habits").fetchone()[0]
    habit_id = con.execute(
        "INSERT INTO habits (name, hue, position) VALUES (?, ?, ?)",
        (name, h.hue, pos),
    ).lastrowid
    con.commit()
    out = _habit_payload(con, habit_id, name, h.hue)
    con.close()
    return out


@app.put("/api/habits/{habit_id}")
async def update_habit(habit_id: int, h: HabitIn):
    """Rename / re-hue a habit. Completion state is untouched."""
    name = h.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name is empty")
    con = _con()
    if con.execute("SELECT 1 FROM habits WHERE id = ?", (habit_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="habit not found")
    con.execute(
        "UPDATE habits SET name = ?, hue = ? WHERE id = ?",
        (name, h.hue, habit_id),
    )
    con.commit()
    out = _habit_payload(con, habit_id, name, h.hue)
    con.close()
    return out


@app.delete("/api/habits/{habit_id}")
async def delete_habit(habit_id: int):
    """Delete a habit and (via ON DELETE CASCADE) all of its completions."""
    con = _con()
    if con.execute("SELECT 1 FROM habits WHERE id = ?", (habit_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="habit not found")
    con.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    con.commit()
    con.close()
    return {"deleted": habit_id}
