"""Personal CRM — people, last-contacted dates, notes, and contact history.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it
would be against a normal server. The host bridges the UI's fetch('/api/...')
into this app inside Pyodide (see host/src/bridge.ts, runtime.ts). All SQLite
access uses parameterized queries.

The genuinely useful part is the "90-day" query: last contact is stored as a
real DATE, and "days since" is computed in SQL from the stored date — never a
frozen day count. So "needs follow-up" (days > 90) stays correct as time passes,
and "Log contact" simply writes today's date, which resets the clock for real.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop.
"""

import re
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)

# Number of days without contact after which a person "needs follow-up".
FOLLOW_UP_DAYS = 90

app = FastAPI()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS people ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "relationship TEXT NOT NULL DEFAULT '', "
        "hue INTEGER NOT NULL DEFAULT 230, "
        "tags TEXT NOT NULL DEFAULT '', "          # comma-separated
        "note TEXT NOT NULL DEFAULT '', "
        "last_contacted TEXT NOT NULL DEFAULT (date('now')))"  # real DATE (YYYY-MM-DD)
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS history ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE, "
        "entry TEXT NOT NULL, "
        "method TEXT NOT NULL DEFAULT 'other', "  # one of CONTACT_METHODS
        "occurred_on TEXT NOT NULL DEFAULT (date('now')))"
    )
    # Migrate older DBs that predate the `method` column (additive, safe to re-run).
    cols = {r[1] for r in con.execute("PRAGMA table_info(history)").fetchall()}
    if "method" not in cols:
        con.execute("ALTER TABLE history ADD COLUMN method TEXT NOT NULL DEFAULT 'other'")
    if con.execute("SELECT COUNT(*) FROM people").fetchone()[0] == 0:
        _seed(con)
    return con


def _seed(con: sqlite3.Connection) -> None:
    """Seed several people + history on first open (empty DB).

    `days_ago` is how long since last contact *as of first open*. We store it as
    an actual date (date('now', '-Nd')) so the day-count is computed live and the
    90-day logic stays genuine. History entries are stored with real dates too.
    """
    seed = [
        {
            "name": "Sigrún Bjarnadóttir",
            "relationship": "Former colleague · Reykjavík",
            "hue": 230,
            "tags": "work,mentor",
            "note": "Owed her a coffee since the conference. Knows everyone in the "
                    "grid-ops world — worth keeping warm.",
            "days_ago": 124,
            "history": [("Coffee", "in_person", 124), ("Email intro", "email", 150)],
        },
        {
            "name": "Marco DeLuca",
            "relationship": "College roommate",
            "hue": 25,
            "tags": "friend",
            "note": "New baby. Send the photo book. Always up for a climbing trip.",
            "days_ago": 38,
            "history": [("Call", "call", 38), ("Climbing", "in_person", 92)],
        },
        {
            "name": "Aðalheiður Pálsdóttir",
            "relationship": "Studio client",
            "hue": 155,
            "tags": "client",
            "note": "Hótel Vík shoot went well — follow up about the autumn campaign.",
            "days_ago": 12,
            "history": [("Invoice sent", "email", 12), ("Shoot", "in_person", 20)],
        },
        {
            "name": "Tom Becker",
            "relationship": "Old manager",
            "hue": 280,
            "tags": "work",
            "note": "Reference for future work. Moved to Berlin. Long overdue.",
            "days_ago": 156,
            "history": [("LinkedIn", "other", 156)],
        },
        {
            "name": "Priya Nair",
            "relationship": "Climbing partner",
            "hue": 40,
            "tags": "friend",
            "note": "Planning the autumn Dolomites trip. Book huts early.",
            "days_ago": 21,
            "history": [("Gym", "in_person", 21), ("Trip plan", "text", 42)],
        },
        {
            "name": "Jón Ásgeirsson",
            "relationship": "Accountant",
            "hue": 200,
            "tags": "admin",
            "note": "Q2 numbers due. Send the studio receipts.",
            "days_ago": 95,
            "history": [("Email", "email", 95)],
        },
    ]
    for p in seed:
        pid = con.execute(
            "INSERT INTO people (name, relationship, hue, tags, note, last_contacted) "
            "VALUES (?, ?, ?, ?, ?, date('now', ?))",
            (p["name"], p["relationship"], p["hue"], p["tags"], p["note"],
             f"-{p['days_ago']} days"),
        ).lastrowid
        for entry, method, days in p["history"]:
            con.execute(
                "INSERT INTO history (person_id, entry, method, occurred_on) "
                "VALUES (?, ?, ?, date('now', ?))",
                (pid, entry, method, f"-{days} days"),
            )
    con.commit()


def _tags(raw: str) -> list[str]:
    return [t for t in (raw or "").split(",") if t]


# Field length caps — keep stored text bounded (these are personal-use sizes, not
# security limits, but they stop a runaway paste from bloating the bundle file).
_NAME_MAX = 120
_REL_MAX = 160
_NOTE_MAX = 4000
_TAG_MAX = 40
_TAGS_MAX = 20
_ENTRY_MAX = 200

# A simple YYYY-MM-DD shape check; SQLite's date() normalizes/validates the value.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Fixed set of contact methods. Stored verbatim on each history row; the UI maps
# these to a label + icon. "other" is the default/fallback (also used for the
# auto-generated "Added to CRM" entry).
CONTACT_METHODS = ("email", "call", "text", "in_person", "other")


def _norm_tags(raw) -> str:
    """Accept a list[str] or comma string; return a clean comma-separated string.

    Drops blanks/dupes, strips whitespace, removes commas inside a tag (they are
    the separator), caps each tag and the total count.
    """
    if isinstance(raw, str):
        items = raw.split(",")
    elif isinstance(raw, list):
        items = raw
    else:
        items = []
    out: list[str] = []
    seen: set[str] = set()
    for t in items:
        t = str(t).replace(",", " ").strip()[:_TAG_MAX].strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
        if len(out) >= _TAGS_MAX:
            break
    return ",".join(out)


# Computed days-since-contact, straight from the stored date. CAST to int floors
# the fractional julianday difference to whole days.
_DAYS_SQL = "CAST(julianday('now') - julianday(last_contacted) AS INTEGER)"


class LogContact(BaseModel):
    # Optional free-text label for the history entry; defaults to a generic note.
    entry: str = Field(default="Logged contact", max_length=_ENTRY_MAX)
    # Contact method; whitelisted to the fixed CONTACT_METHODS set.
    method: str = Field(default="other")

    @field_validator("entry")
    @classmethod
    def _entry(cls, v: str) -> str:
        v = (v or "").strip()
        return v[:_ENTRY_MAX] or "Logged contact"

    @field_validator("method")
    @classmethod
    def _method(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in CONTACT_METHODS:
            raise ValueError(f"method must be one of {', '.join(CONTACT_METHODS)}")
        return v


class HistoryEdit(BaseModel):
    """Edit payload for a single history entry: note text, method, and date."""
    entry: str = Field(default="Logged contact", max_length=_ENTRY_MAX)
    method: str = Field(default="other")
    occurred_on: str = ""  # "" => leave date unchanged; else YYYY-MM-DD

    @field_validator("entry")
    @classmethod
    def _entry(cls, v: str) -> str:
        v = (v or "").strip()
        return v[:_ENTRY_MAX] or "Logged contact"

    @field_validator("method")
    @classmethod
    def _method(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if v not in CONTACT_METHODS:
            raise ValueError(f"method must be one of {', '.join(CONTACT_METHODS)}")
        return v

    @field_validator("occurred_on")
    @classmethod
    def _date(cls, v: str) -> str:
        v = (v or "").strip()
        if v and not _DATE_RE.match(v):
            raise ValueError("occurred_on must be YYYY-MM-DD")
        return v


class PersonIn(BaseModel):
    """Create payload: name required; the rest optional with sane defaults."""
    name: str = Field(min_length=1, max_length=_NAME_MAX)
    relationship: str = Field(default="", max_length=_REL_MAX)
    note: str = Field(default="", max_length=_NOTE_MAX)
    tags: list[str] | str = ""
    hue: int = Field(default=230, ge=0, le=360)
    last_contacted: str = ""  # "" => today; else YYYY-MM-DD

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v[:_NAME_MAX]

    @field_validator("relationship", "note")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("last_contacted")
    @classmethod
    def _date(cls, v: str) -> str:
        v = (v or "").strip()
        if v and not _DATE_RE.match(v):
            raise ValueError("last_contacted must be YYYY-MM-DD")
        return v


class PersonEdit(BaseModel):
    """Edit payload: same fields as create minus the contact date (that's owned
    by Log contact, so editing never silently resets the 90-day clock)."""
    name: str = Field(min_length=1, max_length=_NAME_MAX)
    relationship: str = Field(default="", max_length=_REL_MAX)
    note: str = Field(default="", max_length=_NOTE_MAX)
    tags: list[str] | str = ""
    hue: int = Field(default=230, ge=0, le=360)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v[:_NAME_MAX]

    @field_validator("relationship", "note")
    @classmethod
    def _strip(cls, v: str) -> str:
        return (v or "").strip()


@app.get("/api/people")
async def list_people():
    con = _con()
    rows = con.execute(
        f"SELECT id, name, relationship, hue, tags, {_DAYS_SQL} AS days "
        "FROM people ORDER BY days DESC, name"
    ).fetchall()
    con.close()
    out = []
    for pid, name, rel, hue, tags, days in rows:
        out.append({
            "id": pid,
            "name": name,
            "relationship": rel,
            "hue": hue,
            "tags": _tags(tags),
            "days": days,
            "overdue": days > FOLLOW_UP_DAYS,
        })
    return {"people": out, "follow_up_days": FOLLOW_UP_DAYS}


@app.get("/api/people/{person_id}")
async def get_person(person_id: int):
    con = _con()
    row = con.execute(
        f"SELECT id, name, relationship, hue, tags, note, {_DAYS_SQL} AS days "
        "FROM people WHERE id = ?",
        (person_id,),
    ).fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail="person not found")
    hist = con.execute(
        f"SELECT id, entry, method, occurred_on, "
        "CAST(julianday('now') - julianday(occurred_on) AS INTEGER) AS days "
        "FROM history WHERE person_id = ? ORDER BY occurred_on DESC, id DESC",
        (person_id,),
    ).fetchall()
    con.close()
    pid, name, rel, hue, tags, note, days = row
    return {
        "id": pid,
        "name": name,
        "relationship": rel,
        "hue": hue,
        "tags": _tags(tags),
        "note": note,
        "days": days,
        "overdue": days > FOLLOW_UP_DAYS,
        "history": [
            {"id": hid, "entry": e, "method": m, "occurred_on": on, "days": d}
            for hid, e, m, on, d in hist
        ],
    }


@app.post("/api/people/{person_id}/log")
async def log_contact(person_id: int, body: LogContact):
    con = _con()
    if con.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="person not found")
    # Set last-contacted to today: days-since recomputes to 0 and the overdue
    # flag clears, because it's all derived from this stored date.
    con.execute(
        "UPDATE people SET last_contacted = date('now') WHERE id = ?",
        (person_id,),
    )
    con.execute(
        "INSERT INTO history (person_id, entry, method, occurred_on) "
        "VALUES (?, ?, ?, date('now'))",
        (person_id, body.entry, body.method),
    )
    con.commit()
    con.close()
    return await get_person(person_id)


def _resync_last_contacted(con: sqlite3.Connection, person_id: int) -> None:
    """Set people.last_contacted to the most recent remaining history date.

    Editing or deleting history can change which contact is the newest, so the
    90-day clock is recomputed from the surviving rows. If a person has no
    history left, we leave last_contacted untouched (the prior stored date stays
    the source of truth), so an accidental empty-history state never silently
    marks everyone as contacted today.
    """
    row = con.execute(
        "SELECT MAX(occurred_on) FROM history WHERE person_id = ?",
        (person_id,),
    ).fetchone()
    newest = row[0] if row else None
    if newest:
        con.execute(
            "UPDATE people SET last_contacted = date(?) WHERE id = ?",
            (newest, person_id),
        )


@app.put("/api/people/{person_id}/history/{history_id}")
async def edit_history(person_id: int, history_id: int, body: HistoryEdit):
    con = _con()
    if con.execute(
        "SELECT 1 FROM history WHERE id = ? AND person_id = ?",
        (history_id, person_id),
    ).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="history entry not found")
    if body.occurred_on:
        # date() normalizes; COALESCE guards a nonsense calendar date back to the
        # existing value so a bad date can't blank the row.
        con.execute(
            "UPDATE history SET entry = ?, method = ?, "
            "occurred_on = COALESCE(date(?), occurred_on) WHERE id = ?",
            (body.entry, body.method, body.occurred_on, history_id),
        )
    else:
        con.execute(
            "UPDATE history SET entry = ?, method = ? WHERE id = ?",
            (body.entry, body.method, history_id),
        )
    _resync_last_contacted(con, person_id)
    con.commit()
    con.close()
    return await get_person(person_id)


@app.delete("/api/people/{person_id}/history/{history_id}")
async def delete_history(person_id: int, history_id: int):
    con = _con()
    if con.execute(
        "SELECT 1 FROM history WHERE id = ? AND person_id = ?",
        (history_id, person_id),
    ).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="history entry not found")
    con.execute("DELETE FROM history WHERE id = ?", (history_id,))
    _resync_last_contacted(con, person_id)
    con.commit()
    con.close()
    return await get_person(person_id)


@app.post("/api/people", status_code=201)
async def create_person(body: PersonIn):
    con = _con()
    tags = _norm_tags(body.tags)
    if body.last_contacted:
        # Validated to YYYY-MM-DD shape; date() normalizes (and yields NULL on a
        # nonsense calendar date, which the COALESCE guards back to today).
        pid = con.execute(
            "INSERT INTO people (name, relationship, hue, tags, note, last_contacted) "
            "VALUES (?, ?, ?, ?, ?, COALESCE(date(?), date('now')))",
            (body.name, body.relationship, body.hue, tags, body.note, body.last_contacted),
        ).lastrowid
    else:
        pid = con.execute(
            "INSERT INTO people (name, relationship, hue, tags, note, last_contacted) "
            "VALUES (?, ?, ?, ?, ?, date('now'))",
            (body.name, body.relationship, body.hue, tags, body.note),
        ).lastrowid
    con.execute(
        "INSERT INTO history (person_id, entry, occurred_on) VALUES (?, ?, date('now'))",
        (pid, "Added to CRM"),
    )
    con.commit()
    con.close()
    return await get_person(pid)


@app.put("/api/people/{person_id}")
async def update_person(person_id: int, body: PersonEdit):
    con = _con()
    if con.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="person not found")
    # last_contacted is intentionally NOT touched here — only Log contact moves it.
    con.execute(
        "UPDATE people SET name = ?, relationship = ?, hue = ?, tags = ?, note = ? "
        "WHERE id = ?",
        (body.name, body.relationship, body.hue, _norm_tags(body.tags), body.note,
         person_id),
    )
    con.commit()
    con.close()
    return await get_person(person_id)


@app.delete("/api/people/{person_id}")
async def delete_person(person_id: int):
    con = _con()
    if con.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="person not found")
    # History rows cascade (ON DELETE CASCADE + PRAGMA foreign_keys = ON in _con).
    con.execute("DELETE FROM people WHERE id = ?", (person_id,))
    con.commit()
    con.close()
    return {"ok": True, "deleted": person_id}
