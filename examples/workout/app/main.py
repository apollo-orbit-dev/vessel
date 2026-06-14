"""Workout Log — a per-day strength log with editable sets, reusable routines,
and a lbs/kg unit toggle, written as an ordinary FastAPI app backed by stdlib
sqlite3.

The log is organised by **day** (keyed by ISO date). Each day owns a list of
exercises; each exercise carries a target and a list of sets (weight × reps).
Weights are stored **canonically in kilograms** — the UI converts to the user's
selected unit (kg or lb) for display and converts entered values back to kg
before they're saved, so the volume math and PR detection always run in one unit.

The heaviest set of an exercise that meets or beats that exercise's previous best
(by name, across the whole history) is a PR. A side panel charts weekly training
volume aggregated across all days by ISO week; the current week's bar is the live
total for the week containing the selected day.

**Routines** are reusable, named, ordered templates (e.g. "Push A" = Bench /
OHP / Incline DB). Applying a routine to the selected day creates that day's
exercises from the template; the user then logs the sets.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop. All SQLite access uses
parameterized queries.
"""

import datetime
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Sane caps so a typo can't poison the volume math or the chart.
MAX_WEIGHT = 2000.0  # kg (canonical)
MAX_REPS = 1000
MAX_TEXT = 200  # chars for names / targets / title / meta

KG_PER_LB = 0.45359237  # exact
VALID_UNITS = {"kg", "lb"}

# Today's date is resolved at request time; this is only the seed anchor.
DEFAULT_TITLE = "Strength log"


def _clamp_weight(v: float) -> float:
    return max(0.0, min(float(v), MAX_WEIGHT))


def _clamp_reps(v: int) -> int:
    return max(0, min(int(v), MAX_REPS))


def _today_iso() -> str:
    return datetime.date.today().isoformat()


def _parse_iso(s: str) -> str:
    """Validate a YYYY-MM-DD string; raise 422 on anything else."""
    try:
        return datetime.date.fromisoformat(str(s)).isoformat()
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="invalid date (expected YYYY-MM-DD)")


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")

    # A workout day, keyed by ISO date. Each day has its own editable header.
    con.execute(
        "CREATE TABLE IF NOT EXISTS days ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "date TEXT NOT NULL UNIQUE, "
        "title TEXT NOT NULL DEFAULT '', "
        "meta TEXT NOT NULL DEFAULT '')"
    )
    # Exercises belong to a day.
    con.execute(
        "CREATE TABLE IF NOT EXISTS exercises ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "day_id INTEGER NOT NULL REFERENCES days(id) ON DELETE CASCADE, "
        "name TEXT NOT NULL, "
        "target TEXT NOT NULL DEFAULT '', "
        "best REAL NOT NULL DEFAULT 0, "  # canonical kg
        "position INTEGER NOT NULL DEFAULT 0)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS sets ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE CASCADE, "
        "weight REAL NOT NULL DEFAULT 0, "  # canonical kg
        "reps INTEGER NOT NULL DEFAULT 0, "
        "position INTEGER NOT NULL DEFAULT 0)"
    )
    # Reusable routine templates: a routine is an ordered list of exercise names.
    con.execute(
        "CREATE TABLE IF NOT EXISTS routines ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "position INTEGER NOT NULL DEFAULT 0)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS routine_exercises ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "routine_id INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE, "
        "name TEXT NOT NULL, "
        "target TEXT NOT NULL DEFAULT '', "
        "position INTEGER NOT NULL DEFAULT 0)"
    )
    # Single-row preferences (unit toggle persists here).
    con.execute(
        "CREATE TABLE IF NOT EXISTS prefs ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "unit TEXT NOT NULL DEFAULT 'kg')"
    )
    con.execute("INSERT OR IGNORE INTO prefs (id, unit) VALUES (1, 'kg')")

    # Seed a little history + starter routines on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM days").fetchone()[0] == 0:
        _seed(con)
        con.commit()
    return con


def _seed(con: sqlite3.Connection) -> None:
    today = datetime.date.today()

    # A few past days so history (and the weekly chart) has something to show.
    # Each: (days-ago, title, meta, [(name, target, best_kg, [(w_kg, reps), ...]), ...])
    day_seeds = [
        (
            14, "Strength log", "Pull day",
            [
                ("Deadlift", "3 × 5", 140.0, [(130, 5), (135, 5), (140, 3)]),
                ("Barbell row", "4 × 8", 70.0, [(67.5, 8), (70, 7)]),
            ],
        ),
        (
            12, "Strength log", "Push day",
            [
                ("Bench press", "4 × 6-8", 80.0, [(77.5, 8), (80, 6)]),
                ("Overhead press", "3 × 8", 50.0, [(47.5, 8), (50, 7)]),
            ],
        ),
        (
            7, "Strength log", "Leg day",
            [
                ("Squat", "5 × 5", 120.0, [(110, 5), (115, 5), (120, 4)]),
                ("Leg press", "3 × 12", 200.0, [(190, 12), (200, 10)]),
            ],
        ),
        (
            0, "Strength log", "Push day",
            [
                ("Bench press", "4 × 6-8", 82.5, [(80, 8), (82.5, 7), (85, 5)]),
                ("Overhead press", "3 × 8", 52.5, [(50, 8), (52.5, 7)]),
                ("Incline DB press", "3 × 10", 32, [(30, 10), (32, 9)]),
            ],
        ),
    ]
    for ago, title, meta, exercises in day_seeds:
        date = (today - datetime.timedelta(days=ago)).isoformat()
        day_id = con.execute(
            "INSERT INTO days (date, title, meta) VALUES (?, ?, ?)",
            (date, title, meta),
        ).lastrowid
        for pos, (name, target, best, sets) in enumerate(exercises):
            ex_id = con.execute(
                "INSERT INTO exercises (day_id, name, target, best, position) "
                "VALUES (?, ?, ?, ?, ?)",
                (day_id, name, target, best, pos),
            ).lastrowid
            for spos, (w, r) in enumerate(sets):
                con.execute(
                    "INSERT INTO sets (exercise_id, weight, reps, position) "
                    "VALUES (?, ?, ?, ?)",
                    (ex_id, w, r, spos),
                )

    # Starter routines (templates).
    routine_seeds = [
        ("Push A", [
            ("Bench press", "4 × 6-8"),
            ("Overhead press", "3 × 8"),
            ("Incline DB press", "3 × 10"),
        ]),
        ("Pull A", [
            ("Deadlift", "3 × 5"),
            ("Barbell row", "4 × 8"),
            ("Lat pulldown", "3 × 12"),
        ]),
    ]
    for rpos, (rname, items) in enumerate(routine_seeds):
        r_id = con.execute(
            "INSERT INTO routines (name, position) VALUES (?, ?)", (rname, rpos)
        ).lastrowid
        for ipos, (name, target) in enumerate(items):
            con.execute(
                "INSERT INTO routine_exercises (routine_id, name, target, position) "
                "VALUES (?, ?, ?, ?)",
                (r_id, name, target, ipos),
            )


# ---- helpers ----------------------------------------------------------------


def _get_unit(con: sqlite3.Connection) -> str:
    row = con.execute("SELECT unit FROM prefs WHERE id = 1").fetchone()
    return row[0] if row and row[0] in VALID_UNITS else "kg"


def _latest_date(con: sqlite3.Connection) -> str:
    """The most recent day on record, or today if there are none."""
    row = con.execute("SELECT date FROM days ORDER BY date DESC LIMIT 1").fetchone()
    return row[0] if row else _today_iso()


def _ensure_day(con: sqlite3.Connection, date: str) -> int:
    """Return the day id for `date`, creating an empty day if needed."""
    row = con.execute("SELECT id FROM days WHERE date = ?", (date,)).fetchone()
    if row is not None:
        return row[0]
    return con.execute(
        "INSERT INTO days (date, title, meta) VALUES (?, ?, '')",
        (date, DEFAULT_TITLE),
    ).lastrowid


def _exercise_payload(con: sqlite3.Connection, day_id: int) -> list[dict]:
    out = []
    rows = con.execute(
        "SELECT id, name, target, best FROM exercises WHERE day_id = ? "
        "ORDER BY position, id",
        (day_id,),
    ).fetchall()
    for ex_id, name, target, best in rows:
        sets = con.execute(
            "SELECT id, weight, reps FROM sets WHERE exercise_id = ? ORDER BY position, id",
            (ex_id,),
        ).fetchall()
        out.append(
            {
                "id": ex_id,
                "name": name,
                "target": target,
                "best": best,  # canonical kg
                "sets": [{"id": s[0], "w": s[1], "r": s[2]} for s in sets],
            }
        )
    return out


def _day_volume_kg(exercises: list[dict]) -> float:
    return sum(s["w"] * s["r"] for ex in exercises for s in ex["sets"])


def _iso_week_key(date: str) -> tuple[int, int]:
    d = datetime.date.fromisoformat(date)
    iso = d.isocalendar()
    return (iso[0], iso[1])  # (iso_year, iso_week)


def _volume_series(con: sqlite3.Connection, selected_date: str) -> list[float]:
    """Training volume (tonnes) aggregated by ISO week across all days, for the
    six-week window ending at the week containing `selected_date`. The last bar
    is the selected week (rendered live/current by the UI)."""
    # Per-day volume in kg, joined to its date.
    rows = con.execute(
        "SELECT d.date, COALESCE(SUM(s.weight * s.reps), 0) "
        "FROM days d "
        "LEFT JOIN exercises e ON e.day_id = d.id "
        "LEFT JOIN sets s ON s.exercise_id = e.id "
        "GROUP BY d.id"
    ).fetchall()

    by_week: dict[tuple[int, int], float] = {}
    for date, kg in rows:
        by_week[_iso_week_key(date)] = by_week.get(_iso_week_key(date), 0.0) + (kg or 0.0)

    # Build the six consecutive ISO weeks ending at the selected week.
    anchor = datetime.date.fromisoformat(selected_date)
    monday = anchor - datetime.timedelta(days=anchor.isoweekday() - 1)
    weeks = []
    for i in range(5, -1, -1):
        wk_monday = monday - datetime.timedelta(weeks=i)
        key = (wk_monday.isocalendar()[0], wk_monday.isocalendar()[1])
        weeks.append(round(by_week.get(key, 0.0) / 1000, 3))
    return weeks


def _day_dates(con: sqlite3.Connection) -> list[str]:
    return [d for (d,) in con.execute("SELECT date FROM days ORDER BY date").fetchall()]


def _routines_payload(con: sqlite3.Connection) -> list[dict]:
    out = []
    for r_id, name in con.execute(
        "SELECT id, name FROM routines ORDER BY position, id"
    ).fetchall():
        items = con.execute(
            "SELECT id, name, target FROM routine_exercises WHERE routine_id = ? "
            "ORDER BY position, id",
            (r_id,),
        ).fetchall()
        out.append(
            {
                "id": r_id,
                "name": name,
                "exercises": [
                    {"id": it[0], "name": it[1], "target": it[2]} for it in items
                ],
            }
        )
    return out


def _session_payload(con: sqlite3.Connection, date: str | None = None) -> dict:
    """Build the payload for a selected day. Defaults to the latest day on
    record. Keeps the historical top-level keys for backwards compatibility:
    title/meta, exercises[...], today_kg/today_t, volume_series."""
    if date is None:
        date = _latest_date(con)
    day_id = _ensure_day(con, date)
    con.commit()  # persist a freshly-created empty day

    row = con.execute("SELECT title, meta FROM days WHERE id = ?", (day_id,)).fetchone()
    title, meta = (row[0], row[1]) if row else (DEFAULT_TITLE, "")
    exercises = _exercise_payload(con, day_id)
    day_kg = _day_volume_kg(exercises)
    return {
        "title": title,
        "meta": meta,
        "date": date,
        "unit": _get_unit(con),
        "dates": _day_dates(con),
        "exercises": exercises,
        "today_kg": day_kg,  # canonical kg for the selected day
        "today_t": round(day_kg / 1000, 1),
        "volume_series": _volume_series(con, date),
        "routines": _routines_payload(con),
    }


def _require_day_exercise(con: sqlite3.Connection, exercise_id: int) -> int:
    row = con.execute(
        "SELECT day_id FROM exercises WHERE id = ?", (exercise_id,)
    ).fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail="exercise not found")
    return row[0]


def _exercise_date(con: sqlite3.Connection, exercise_id: int) -> str:
    day_id = _require_day_exercise(con, exercise_id)
    return con.execute("SELECT date FROM days WHERE id = ?", (day_id,)).fetchone()[0]


def _set_date(con: sqlite3.Connection, set_id: int) -> str:
    row = con.execute(
        "SELECT d.date FROM sets s "
        "JOIN exercises e ON e.id = s.exercise_id "
        "JOIN days d ON d.id = e.day_id "
        "WHERE s.id = ?",
        (set_id,),
    ).fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail="set not found")
    return row[0]


def _require_routine(con: sqlite3.Connection, routine_id: int) -> None:
    if con.execute("SELECT 1 FROM routines WHERE id = ?", (routine_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="routine not found")


# ---- request models ---------------------------------------------------------
# Bad numeric input coerces to 0 (then clamps); names/targets are length-bound;
# names must be non-empty after trimming. Weights arrive ALREADY in kg (the UI
# converts from the display unit before sending).


class SessionPatch(BaseModel):
    title: str
    meta: str

    @field_validator("title", "meta")
    @classmethod
    def _trim(cls, v: str) -> str:
        return str(v).strip()[:MAX_TEXT]


class ExerciseIn(BaseModel):
    name: str
    target: str = ""

    @field_validator("name", "target")
    @classmethod
    def _trim(cls, v: str) -> str:
        return str(v).strip()[:MAX_TEXT]


class SetIn(BaseModel):
    w: float = 0  # kg (canonical)
    r: int = 0

    @field_validator("w", mode="before")
    @classmethod
    def _coerce_w(cls, v) -> float:
        try:
            return _clamp_weight(v)
        except (TypeError, ValueError):
            return 0.0

    @field_validator("r", mode="before")
    @classmethod
    def _coerce_r(cls, v) -> int:
        try:
            return _clamp_reps(float(v))
        except (TypeError, ValueError):
            return 0


class UnitIn(BaseModel):
    unit: str

    @field_validator("unit")
    @classmethod
    def _check(cls, v: str) -> str:
        u = str(v).strip().lower()
        if u not in VALID_UNITS:
            raise ValueError("unit must be 'kg' or 'lb'")
        return u


class RoutineIn(BaseModel):
    name: str
    exercises: list[ExerciseIn] = []

    @field_validator("name")
    @classmethod
    def _trim(cls, v: str) -> str:
        return str(v).strip()[:MAX_TEXT]


# ---- routes -----------------------------------------------------------------


@app.get("/api/session")
async def get_session(date: str | None = None):
    """The selected day (defaults to the latest on record). Optional ?date=."""
    con = _con()
    iso = _parse_iso(date) if date else None
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.patch("/api/session")
async def patch_session(body: SessionPatch, date: str | None = None):
    """Edit the selected day's header (title / meta)."""
    con = _con()
    iso = _parse_iso(date) if date else _latest_date(con)
    day_id = _ensure_day(con, iso)
    con.execute(
        "UPDATE days SET title = ?, meta = ? WHERE id = ?",
        (body.title, body.meta, day_id),
    )
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.patch("/api/unit")
async def set_unit(body: UnitIn, date: str | None = None):
    """Persist the display unit preference (kg | lb)."""
    con = _con()
    con.execute("UPDATE prefs SET unit = ? WHERE id = 1", (body.unit,))
    con.commit()
    iso = _parse_iso(date) if date else None
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.post("/api/exercises")
async def add_exercise(body: ExerciseIn, date: str | None = None):
    """Add a new exercise (no sets yet) to the selected day."""
    if not body.name:
        raise HTTPException(status_code=422, detail="name is required")
    con = _con()
    iso = _parse_iso(date) if date else _latest_date(con)
    day_id = _ensure_day(con, iso)
    next_pos = con.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM exercises WHERE day_id = ?",
        (day_id,),
    ).fetchone()[0]
    con.execute(
        "INSERT INTO exercises (day_id, name, target, best, position) "
        "VALUES (?, ?, ?, 0, ?)",
        (day_id, body.name, body.target, next_pos),
    )
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.patch("/api/exercises/{exercise_id}")
async def edit_exercise(exercise_id: int, body: ExerciseIn):
    """Edit an exercise's name and/or target."""
    if not body.name:
        raise HTTPException(status_code=422, detail="name is required")
    con = _con()
    iso = _exercise_date(con, exercise_id)
    con.execute(
        "UPDATE exercises SET name = ?, target = ? WHERE id = ?",
        (body.name, body.target, exercise_id),
    )
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.delete("/api/exercises/{exercise_id}")
async def delete_exercise(exercise_id: int):
    """Delete an exercise and its sets (ON DELETE CASCADE)."""
    con = _con()
    iso = _exercise_date(con, exercise_id)
    con.execute("DELETE FROM exercises WHERE id = ?", (exercise_id,))
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.post("/api/exercises/{exercise_id}/sets")
async def add_set(exercise_id: int):
    """Duplicate the last set (canonical kg), or seed 20kg × 8 if none."""
    con = _con()
    iso = _exercise_date(con, exercise_id)

    last = con.execute(
        "SELECT weight, reps, position FROM sets WHERE exercise_id = ? "
        "ORDER BY position DESC, id DESC LIMIT 1",
        (exercise_id,),
    ).fetchone()
    if last is None:
        weight, reps, next_pos = 20.0, 8, 0
    else:
        weight, reps, next_pos = last[0], last[1], last[2] + 1

    con.execute(
        "INSERT INTO sets (exercise_id, weight, reps, position) VALUES (?, ?, ?, ?)",
        (exercise_id, weight, reps, next_pos),
    )
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.patch("/api/sets/{set_id}")
async def edit_set(set_id: int, body: SetIn):
    """Edit a set's weight (kg, already converted by the UI) and reps."""
    con = _con()
    iso = _set_date(con, set_id)
    con.execute(
        "UPDATE sets SET weight = ?, reps = ? WHERE id = ?",
        (body.w, body.r, set_id),
    )
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


@app.delete("/api/sets/{set_id}")
async def delete_set(set_id: int):
    """Delete a single set."""
    con = _con()
    iso = _set_date(con, set_id)
    con.execute("DELETE FROM sets WHERE id = ?", (set_id,))
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload


# ---- routines ---------------------------------------------------------------


@app.post("/api/routines")
async def create_routine(body: RoutineIn):
    """Create a routine (named, ordered list of exercises)."""
    if not body.name:
        raise HTTPException(status_code=422, detail="name is required")
    con = _con()
    next_pos = con.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM routines"
    ).fetchone()[0]
    r_id = con.execute(
        "INSERT INTO routines (name, position) VALUES (?, ?)", (body.name, next_pos)
    ).lastrowid
    for ipos, item in enumerate(body.exercises):
        if not item.name:
            continue
        con.execute(
            "INSERT INTO routine_exercises (routine_id, name, target, position) "
            "VALUES (?, ?, ?, ?)",
            (r_id, item.name, item.target, ipos),
        )
    con.commit()
    payload = {"routines": _routines_payload(con)}
    con.close()
    return payload


@app.patch("/api/routines/{routine_id}")
async def edit_routine(routine_id: int, body: RoutineIn):
    """Rename a routine and replace its exercise list."""
    if not body.name:
        raise HTTPException(status_code=422, detail="name is required")
    con = _con()
    _require_routine(con, routine_id)
    con.execute(
        "UPDATE routines SET name = ? WHERE id = ?", (body.name, routine_id)
    )
    con.execute(
        "DELETE FROM routine_exercises WHERE routine_id = ?", (routine_id,)
    )
    for ipos, item in enumerate(body.exercises):
        if not item.name:
            continue
        con.execute(
            "INSERT INTO routine_exercises (routine_id, name, target, position) "
            "VALUES (?, ?, ?, ?)",
            (routine_id, item.name, item.target, ipos),
        )
    con.commit()
    payload = {"routines": _routines_payload(con)}
    con.close()
    return payload


@app.delete("/api/routines/{routine_id}")
async def delete_routine(routine_id: int):
    """Delete a routine and its template exercises (ON DELETE CASCADE)."""
    con = _con()
    _require_routine(con, routine_id)
    con.execute("DELETE FROM routines WHERE id = ?", (routine_id,))
    con.commit()
    payload = {"routines": _routines_payload(con)}
    con.close()
    return payload


@app.post("/api/routines/{routine_id}/apply")
async def apply_routine(routine_id: int, date: str | None = None):
    """Create the routine's exercises (no sets) on the selected day, appended
    after any existing exercises. The routine's previous-best for an exercise
    name is carried over from history so PR badges still work."""
    con = _con()
    _require_routine(con, routine_id)
    iso = _parse_iso(date) if date else _latest_date(con)
    day_id = _ensure_day(con, iso)

    items = con.execute(
        "SELECT name, target FROM routine_exercises WHERE routine_id = ? "
        "ORDER BY position, id",
        (routine_id,),
    ).fetchall()

    next_pos = con.execute(
        "SELECT COALESCE(MAX(position), -1) + 1 FROM exercises WHERE day_id = ?",
        (day_id,),
    ).fetchone()[0]
    for name, target in items:
        # Carry the best previously-logged set weight for this exercise name.
        best_row = con.execute(
            "SELECT MAX(s.weight) FROM sets s "
            "JOIN exercises e ON e.id = s.exercise_id "
            "WHERE e.name = ?",
            (name,),
        ).fetchone()
        best = best_row[0] if best_row and best_row[0] is not None else 0.0
        con.execute(
            "INSERT INTO exercises (day_id, name, target, best, position) "
            "VALUES (?, ?, ?, ?, ?)",
            (day_id, name, target, best, next_pos),
        )
        next_pos += 1
    con.commit()
    payload = _session_payload(con, iso)
    con.close()
    return payload
