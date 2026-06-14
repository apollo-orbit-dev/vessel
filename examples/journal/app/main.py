"""Journal — a reading timeline of dated entries with server-side full-text search.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it would
be against a normal server. The host bridges the UI's fetch('/api/...') into this
app inside Pyodide (see host/src/bridge.ts, runtime.ts). Entries live in SQLite
and travel inside the .vessel file; the host writes the DB back on save.

Full-text search is the showcase. We PREFER SQLite FTS5: an `entries_fts` virtual
table mirrors title+body and is queried with MATCH. Pyodide's bundled SQLite may
not be compiled with FTS5, so the CREATE VIRTUAL TABLE is wrapped in try/except —
if it raises, we fall back to a parameterized LIKE search over title+body. The
active path is detected ONCE at init and remembered in `SEARCH_MODE`. Either way
the search runs server-side and returns the matching entries plus counts; match
highlighting (<mark>) is done in the UI, not from FTS offsets.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop. All SQL is parameterized.
"""

import re
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Set once by _init(): "fts5" if the virtual table built, else "like".
SEARCH_MODE: str | None = None

# The mood vocabulary — a fixed small set. The UI draws a categorical dot per mood
# (see MOOD_HUE in ui/index.html); keep these two lists in sync.
MOODS = {"still", "awed", "wary", "good", "tired"}

# A loose "Day · Mon DD" date-label shape (e.g. "Thu · Jun 12"). We don't parse it
# into a real date — the bundle can't read wall-clock reliably — we only sanity-check
# the string so a row can't carry markup or runaway length.
_DATE_RE = re.compile(r"^[A-Za-z0-9·,.\- ]{1,40}$")
_TIME_RE = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")  # 24-hour HH:MM


class EntryIn(BaseModel):
    """Validated payload for create/update. Title OR body must be non-empty; mood is
    constrained to MOODS; date/time are format-checked (not parsed into real dates)."""

    title: str = ""
    body: str = ""
    mood: str = "good"
    date: str
    time: str

    @field_validator("title")
    @classmethod
    def _title_cap(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 200:
            raise ValueError("title too long (max 200)")
        return v

    @field_validator("body")
    @classmethod
    def _body_cap(cls, v: str) -> str:
        v = v.strip()
        if len(v) > 8000:
            raise ValueError("body too long (max 8000)")
        return v

    @field_validator("mood")
    @classmethod
    def _mood_ok(cls, v: str) -> str:
        if v not in MOODS:
            raise ValueError(f"mood must be one of {sorted(MOODS)}")
        return v

    @field_validator("date")
    @classmethod
    def _date_ok(cls, v: str) -> str:
        v = v.strip()
        if not _DATE_RE.match(v):
            raise ValueError("date label has an unexpected format")
        return v

    @field_validator("time")
    @classmethod
    def _time_ok(cls, v: str) -> str:
        v = v.strip()
        if not _TIME_RE.match(v):
            raise ValueError("time must be HH:MM (24-hour)")
        return v

    def require_content(self) -> None:
        """At least one of title/body must carry text (an empty entry is meaningless)."""
        if not self.title and not self.body:
            raise HTTPException(status_code=422, detail="title or body must be non-empty")

# Seed entries (Iceland / road-trip persona — placeholder copy). Each row is
# (date_label, time, title, mood, body). `mood` drives the categorical dot.
_SEED = [
    ("Thu · Jun 12", "23:40", "Aurora over the cabin", "still",
     "The KP finally cleared 3 and the cloud broke around eleven. We drove past the second bridge and killed the headlights. Green at first, then a ribbon of pink that none of the photos caught. Stood in the cold long after the camera battery died."),
    ("Wed · Jun 11", "20:15", "Glacier lagoon", "awed",
     "Zodiac out among the icebergs at Jökulsárlón — older ice is the deep blue, the guide said it has had the air pressed out of it over centuries. Diamond Beach after: black sand, clear ice, low gold light. Hands frozen, worth it."),
    ("Tue · Jun 10", "18:02", "Reynisfjara, carefully", "wary",
     "Black sand and the basalt columns. The sneaker waves are no joke — a sign every ten metres and you still see people turn their backs to the sea. Stayed well up the beach. Wind picked up on the drive into Vík."),
    ("Mon · Jun 09", "21:30", "Ring Road, south leg", "good",
     "Left Reykjavík late. Seljalandsfoss first — walked the path behind the curtain and got thoroughly soaked. Topped up fuel at Hvolsvöllur, the last station for a while. Cabin at Höfn by dark, lamb stew, early night."),
    ("Sun · Jun 08", "08:50", "Landing", "tired",
     "Keflavík at six in a flat grey light that could have been any hour. Picked up the 4×4, learned the heater controls in the car park. Coffee that cost more than breakfast. The whole island ahead of us."),
    ("Sat · Jun 07", "16:20", "Blue Lagoon stop", "good",
     "Broke the drive from the airport at the lagoon. Milky water the colour of the sky, silica mud on the face, a swim-up counter. Touristy and we knew it and did it anyway. Felt the long flight wash off."),
    ("Fri · Jun 06", "11:05", "Thórsmörk hike", "awed",
     "Crossed the glacial river on the bus — water up to the wheel arches. The valley opens between three glaciers and the moss runs impossibly green up the slopes. Birch scrub, braided rivers, not a straight line anywhere."),
    ("Thu · Jun 05", "19:45", "Geysir and Gullfoss", "good",
     "Strokkur went off every few minutes, a blue dome then the plume. Gullfoss louder than I expected — you feel it in the boardwalk before you see the second drop. Golden Circle in an afternoon, classic for a reason."),
    ("Wed · Jun 04", "22:10", "Long light", "still",
     "Sun barely set. Walked the harbour at eleven and it was still bright enough to read by. The body has no idea what time it is. Wrote postcards I will probably carry home unsent."),
    ("Tue · Jun 03", "09:30", "Packing, again", "tired",
     "Repacked the duffel for the third time. Wool layers, waterproofs, the good boots. Weather here flips four times a day, everyone says. Left room for nothing and brought it anyway."),
    ("Mon · Jun 02", "14:15", "Whale watching, Húsavík", "awed",
     "Humpbacks off the bow within twenty minutes. A fluke up, then nothing, then a breach far out that the whole boat gasped at. Cold spray, hot chocolate, the skipper narrating in two languages."),
    ("Sun · Jun 01", "17:40", "Mývatn, sulphur and steam", "wary",
     "The mud pots at Hverir hiss and bubble and the smell gets into your clothes. Stayed on the marked paths — the crust is thin in places. Pseudocraters around the lake after, oddly peaceful by contrast."),
    ("Sat · May 31", "12:50", "Dettifoss", "awed",
     "The most powerful waterfall in Europe and it does not let you forget it. Grey glacial water over a basalt lip, mist that soaks you from forty metres. Walked back along the canyon rim in silence."),
    ("Fri · May 30", "20:00", "Akureyri evening", "good",
     "Northern capital, they call it. Botanical garden still in bloom this far up. Heart-shaped red lights at the crossings. A good fish soup and a quiet beer by the fjord."),
    ("Thu · May 29", "15:25", "Highlands turned back", "wary",
     "Tried the F-road toward Askja. Two river crossings in and the third looked wrong — brown, fast, no clear line. Turned the 4×4 around. Better a missed crater than a stranded car. The interior keeps its own counsel."),
]


def _init() -> sqlite3.Connection:
    """Open the DB, build the schema, seed on first open, and pick the search mode."""
    global SEARCH_MODE
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS entries ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "date_label TEXT NOT NULL, "
        "time TEXT NOT NULL, "
        "title TEXT NOT NULL DEFAULT '', "
        "mood TEXT NOT NULL DEFAULT 'good', "
        "body TEXT NOT NULL DEFAULT '', "
        "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )

    # Seed a couple of dozen dated entries on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 0:
        con.executemany(
            "INSERT INTO entries (date_label, time, title, mood, body) VALUES (?, ?, ?, ?, ?)",
            _SEED,
        )
        con.commit()

    # Decide the search path once. Prefer FTS5; fall back to LIKE if the build
    # lacks it (Pyodide's bundled SQLite often does).
    if SEARCH_MODE is None:
        SEARCH_MODE = _setup_fts(con)
    return con


def _setup_fts(con: sqlite3.Connection) -> str:
    """Try to build an FTS5 index over title+body. Return 'fts5' or 'like'."""
    try:
        con.execute(
            "CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5("
            "title, body, content='entries', content_rowid='id')"
        )
        # Keep the FTS shadow in sync with the base table via triggers.
        con.executescript(
            "CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN "
            "  INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body); "
            "END; "
            "CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN "
            "  INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body); "
            "END; "
            "CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN "
            "  INSERT INTO entries_fts(entries_fts, rowid, title, body) VALUES('delete', old.id, old.title, old.body); "
            "  INSERT INTO entries_fts(rowid, title, body) VALUES (new.id, new.title, new.body); "
            "END;"
        )
        # (Re)populate from the base table so the index covers seeded rows.
        con.execute("INSERT INTO entries_fts(entries_fts) VALUES('delete-all')")
        con.execute("INSERT INTO entries_fts(rowid, title, body) SELECT id, title, body FROM entries")
        con.commit()
        return "fts5"
    except sqlite3.OperationalError:
        # FTS5 not compiled in — drop anything partial and use LIKE.
        try:
            con.execute("DROP TABLE IF EXISTS entries_fts")
            con.commit()
        except sqlite3.OperationalError:
            pass
        return "like"


def _row(r) -> dict:
    return {
        "id": r[0],
        "date": r[1],
        "time": r[2],
        "title": r[3],
        "mood": r[4],
        "body": r[5],
    }


def _fts_query(q: str) -> str:
    """Build a safe FTS5 MATCH expression: prefix-match each token, quoted to
    neutralize FTS operator syntax (AND/OR/NEAR/-, quotes)."""
    tokens = [t for t in q.replace('"', " ").split() if t]
    if not tokens:
        return ""
    return " ".join(f'"{t}"*' for t in tokens)


@app.get("/api/entries")
async def list_entries(q: str = ""):
    """List entries newest-first. With ?q=... run the full-text search server-side
    and return only matching rows plus counts (total index size + match count)."""
    con = _init()
    total = con.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
    query = q.strip()

    if not query:
        rows = con.execute(
            "SELECT id, date_label, time, title, mood, body FROM entries ORDER BY id DESC"
        ).fetchall()
        con.close()
        return {"entries": [_row(r) for r in rows], "total": total,
                "matches": 0, "query": "", "search_mode": SEARCH_MODE}

    if SEARCH_MODE == "fts5":
        match = _fts_query(query)
        if not match:
            con.close()
            return {"entries": [], "total": total, "matches": 0,
                    "query": query, "search_mode": SEARCH_MODE}
        rows = con.execute(
            "SELECT e.id, e.date_label, e.time, e.title, e.mood, e.body "
            "FROM entries_fts f JOIN entries e ON e.id = f.rowid "
            "WHERE entries_fts MATCH ? ORDER BY e.id DESC",
            (match,),
        ).fetchall()
    else:
        like = f"%{query}%"  # parameterized LIKE — no string interpolation into SQL
        rows = con.execute(
            "SELECT id, date_label, time, title, mood, body FROM entries "
            "WHERE title LIKE ? OR body LIKE ? ORDER BY id DESC",
            (like, like),
        ).fetchall()

    con.close()
    return {"entries": [_row(r) for r in rows], "total": total,
            "matches": len(rows), "query": query, "search_mode": SEARCH_MODE}


@app.post("/api/entries")
async def create_entry(entry: EntryIn):
    """Add a new entry. Pydantic validates the payload; require_content() rejects an
    entry with neither title nor body. The FTS index follows via the AFTER INSERT
    trigger (fts5 mode) or is queried live (like mode) — nothing extra to do here."""
    entry.require_content()
    con = _init()
    cur = con.execute(
        "INSERT INTO entries (date_label, time, title, mood, body) VALUES (?, ?, ?, ?, ?)",
        (entry.date, entry.time, entry.title, entry.mood, entry.body),
    )
    new_id = cur.lastrowid
    con.commit()
    row = con.execute(
        "SELECT id, date_label, time, title, mood, body FROM entries WHERE id = ?",
        (new_id,),
    ).fetchone()
    con.close()
    return {"entry": _row(row)}


@app.put("/api/entries/{entry_id}")
async def update_entry(entry_id: int, entry: EntryIn):
    """Edit an existing entry. The AFTER UPDATE trigger re-syncs the FTS shadow row
    (delete old terms, insert new) in fts5 mode; like mode reads the base table live."""
    entry.require_content()
    con = _init()
    exists = con.execute("SELECT 1 FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if not exists:
        con.close()
        raise HTTPException(status_code=404, detail="entry not found")
    con.execute(
        "UPDATE entries SET date_label = ?, time = ?, title = ?, mood = ?, body = ? "
        "WHERE id = ?",
        (entry.date, entry.time, entry.title, entry.mood, entry.body, entry_id),
    )
    con.commit()
    row = con.execute(
        "SELECT id, date_label, time, title, mood, body FROM entries WHERE id = ?",
        (entry_id,),
    ).fetchone()
    con.close()
    return {"entry": _row(row)}


@app.delete("/api/entries/{entry_id}")
async def delete_entry(entry_id: int):
    """Remove an entry. The AFTER DELETE trigger drops its FTS shadow row in fts5
    mode; like mode just no longer finds it in the base table."""
    con = _init()
    exists = con.execute("SELECT 1 FROM entries WHERE id = ?", (entry_id,)).fetchone()
    if not exists:
        con.close()
        raise HTTPException(status_code=404, detail="entry not found")
    con.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
    con.commit()
    con.close()
    return {"ok": True, "id": entry_id}
