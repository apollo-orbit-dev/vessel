"""Regex Tester — test Python `re` patterns against sample text, with a saved
pattern library that travels inside the .vessel file.

The showcase angle is that this runs the *real* CPython `re` engine (Pyodide is
CPython on WebAssembly), so named groups, `(?P<name>...)`, `\b`, possessive-free
backtracking and Python flavour all behave exactly as they do on a server — not
JavaScript's RegExp. The UI sends a pattern + flags + sample text; the backend
compiles with `re.compile`, runs `finditer`, and returns every match with its
character span and its capture groups (named and numbered). The UI highlights the
spans over HTML-escaped text — no raw user text is ever inserted as HTML.

A compile failure is NOT a 500: we catch `re.error` and return a structured
{"ok": false, "error": "..."} so the UI can show the message inline.

Saved patterns live in SQLite (data/store.sqlite), parameterized throughout, and
seed a handful of useful starters on first open. Routes are `async def` because
Pyodide has no OS threads (a sync route would be sent to a threadpool and raise
"can't start new thread").
"""

import re
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator

DB = "data/store.sqlite"  # relative to the bundle root
app = FastAPI()

# The four flags we expose. Keys are the single-letter forms the UI toggles; the
# values are the real `re` flags. VERBOSE/IGNORECASE/MULTILINE/DOTALL only.
FLAG_MAP = {
    "i": re.IGNORECASE,
    "m": re.MULTILINE,
    "s": re.DOTALL,
    "x": re.VERBOSE,
}
VALID_FLAGS = set(FLAG_MAP)

MAX_PATTERN = 2000
MAX_SAMPLE = 50000
MAX_NAME = 120
MAX_NOTE = 1000

# A guard so a pathological pattern over a long sample can't return an unbounded
# payload (and to keep the UI responsive). Matching itself is bounded by the
# sample length; this caps the number of match objects serialized.
MAX_MATCHES = 5000

# Seed patterns for the library on first open. (name, pattern, flags, note).
_SEED = [
    ("Email address",
     r"[\w.+-]+@[\w-]+\.[\w.-]+",
     "i",
     "A pragmatic, not RFC-perfect, email matcher. Try it on a paragraph of contacts."),
    ("URL (http/https)",
     r"https?://[^\s/$.?#].[^\s]*",
     "i",
     "Matches bare http(s) URLs. The leading class avoids matching a stray '://'."),
    ("IPv4 address",
     r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b",
     "",
     "Octet-validated IPv4 (0-255 per part). Numbered group repeats the octet."),
    ("Date YYYY-MM-DD",
     r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})",
     "",
     "ISO-ish date with NAMED groups year/month/day — see them in the match list."),
    ("Hex colour",
     r"#(?:[0-9a-f]{3}|[0-9a-f]{6})\b",
     "i",
     "#abc or #aabbcc. The 'i' flag lets it match upper- or lower-case hex."),
    ("Verbose phone (US)",
     "\n".join([
         r"\(?\d{3}\)?    # area code, optional parens",
         r"[\s.-]?        # separator",
         r"\d{3}          # prefix",
         r"[\s.-]?        # separator",
         r"\d{4}          # line number",
     ]),
     "x",
     "Uses the VERBOSE (x) flag: whitespace ignored, '#' starts a comment. Toggle x off to see it break."),
]


def _con() -> sqlite3.Connection:
    """Open the DB, build the schema, and seed the starter library on first open."""
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS patterns ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "pattern TEXT NOT NULL, "
        "flags TEXT NOT NULL DEFAULT '', "
        "note TEXT NOT NULL DEFAULT '', "
        "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    if con.execute("SELECT COUNT(*) FROM patterns").fetchone()[0] == 0:
        con.executemany(
            "INSERT INTO patterns (name, pattern, flags, note) VALUES (?, ?, ?, ?)",
            _SEED,
        )
        con.commit()
    return con


def _normalize_flags(raw: str) -> str:
    """Reduce a flags string to the allowed single letters, de-duplicated, ordered.
    Anything outside i/m/s/x is dropped (whitelist)."""
    seen = []
    for ch in (raw or "").lower():
        if ch in VALID_FLAGS and ch not in seen:
            seen.append(ch)
    # stable canonical order
    return "".join(c for c in "imsx" if c in seen)


def _compile(pattern: str, flags: str):
    """Compile with the mapped flags. Returns (regex, None) or (None, error_msg)."""
    bits = 0
    for ch in flags:
        bits |= FLAG_MAP[ch]
    try:
        return re.compile(pattern, bits), None
    except re.error as exc:
        # re.error stringifies to a clear human message incl. position, e.g.
        # "missing ), unterminated subpattern at position 3".
        return None, str(exc)


def _row(r) -> dict:
    return {
        "id": r[0],
        "name": r[1],
        "pattern": r[2],
        "flags": r[3],
        "note": r[4],
    }


# ---- regex testing ----------------------------------------------------------

class TestIn(BaseModel):
    pattern: str
    flags: str = ""
    text: str = ""

    @field_validator("pattern")
    @classmethod
    def _pat_ok(cls, v: str) -> str:
        if len(v) > MAX_PATTERN:
            raise ValueError(f"pattern too long (max {MAX_PATTERN})")
        return v

    @field_validator("text")
    @classmethod
    def _text_ok(cls, v: str) -> str:
        if len(v) > MAX_SAMPLE:
            raise ValueError(f"sample text too long (max {MAX_SAMPLE})")
        return v

    @field_validator("flags")
    @classmethod
    def _flags_ok(cls, v: str) -> str:
        return _normalize_flags(v)


@app.post("/api/test")
async def test_pattern(body: TestIn):
    """Compile `pattern` with `flags` and run it over `text`. Returns every match
    with its span [start,end) and its capture groups. A bad pattern returns
    {"ok": false, "error": ...} rather than raising, so the UI shows it inline."""
    regex, err = _compile(body.pattern, body.flags)
    if err is not None:
        return {"ok": False, "error": err}

    # Map group index -> name (if any), so the UI can label numbered/named groups.
    index_to_name = {idx: name for name, idx in regex.groupindex.items()}

    matches = []
    truncated = False
    for m in regex.finditer(body.text):
        if len(matches) >= MAX_MATCHES:
            truncated = True
            break
        groups = []
        # group(0) is the whole match; 1..N are the captures.
        for gi in range(1, regex.groups + 1):
            span = m.span(gi)
            groups.append({
                "index": gi,
                "name": index_to_name.get(gi),
                # value is None when the group did not participate in the match
                "value": m.group(gi),
                "start": span[0],
                "end": span[1],
            })
        matches.append({
            "start": m.start(),
            "end": m.end(),
            "value": m.group(0),
            "groups": groups,
            # an empty match (e.g. `a*` against "") still advances; flag it so the
            # UI can show a zero-width caret rather than a 0-length highlight.
            "empty": m.start() == m.end(),
        })

    return {
        "ok": True,
        "match_count": len(matches),
        "group_count": regex.groups,
        "group_names": [index_to_name.get(i) for i in range(1, regex.groups + 1)],
        "matches": matches,
        "truncated": truncated,
        "flags": body.flags,
    }


# ---- saved pattern library --------------------------------------------------

class PatternIn(BaseModel):
    name: str
    pattern: str
    flags: str = ""
    note: str = ""

    @field_validator("name")
    @classmethod
    def _name_ok(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        if len(v) > MAX_NAME:
            raise ValueError(f"name too long (max {MAX_NAME})")
        return v

    @field_validator("pattern")
    @classmethod
    def _pat_ok(cls, v: str) -> str:
        if not v:
            raise ValueError("pattern is required")
        if len(v) > MAX_PATTERN:
            raise ValueError(f"pattern too long (max {MAX_PATTERN})")
        return v

    @field_validator("note")
    @classmethod
    def _note_ok(cls, v: str) -> str:
        v = v.strip()
        if len(v) > MAX_NOTE:
            raise ValueError(f"note too long (max {MAX_NOTE})")
        return v

    @field_validator("flags")
    @classmethod
    def _flags_ok(cls, v: str) -> str:
        return _normalize_flags(v)


@app.get("/api/patterns")
async def list_patterns():
    """List saved patterns, newest first."""
    con = _con()
    rows = con.execute(
        "SELECT id, name, pattern, flags, note FROM patterns ORDER BY id DESC"
    ).fetchall()
    con.close()
    return {"patterns": [_row(r) for r in rows]}


@app.post("/api/patterns")
async def create_pattern(p: PatternIn):
    """Save a new pattern to the library."""
    con = _con()
    cur = con.execute(
        "INSERT INTO patterns (name, pattern, flags, note) VALUES (?, ?, ?, ?)",
        (p.name, p.pattern, p.flags, p.note),
    )
    new_id = cur.lastrowid
    con.commit()
    row = con.execute(
        "SELECT id, name, pattern, flags, note FROM patterns WHERE id = ?",
        (new_id,),
    ).fetchone()
    con.close()
    return {"pattern": _row(row)}


@app.put("/api/patterns/{pattern_id}")
async def update_pattern(pattern_id: int, p: PatternIn):
    """Edit a saved pattern."""
    con = _con()
    exists = con.execute("SELECT 1 FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
    if not exists:
        con.close()
        raise HTTPException(status_code=404, detail="pattern not found")
    con.execute(
        "UPDATE patterns SET name = ?, pattern = ?, flags = ?, note = ? WHERE id = ?",
        (p.name, p.pattern, p.flags, p.note, pattern_id),
    )
    con.commit()
    row = con.execute(
        "SELECT id, name, pattern, flags, note FROM patterns WHERE id = ?",
        (pattern_id,),
    ).fetchone()
    con.close()
    return {"pattern": _row(row)}


@app.delete("/api/patterns/{pattern_id}")
async def delete_pattern(pattern_id: int):
    """Remove a saved pattern."""
    con = _con()
    exists = con.execute("SELECT 1 FROM patterns WHERE id = ?", (pattern_id,)).fetchone()
    if not exists:
        con.close()
        raise HTTPException(status_code=404, detail="pattern not found")
    con.execute("DELETE FROM patterns WHERE id = ?", (pattern_id,))
    con.commit()
    con.close()
    return {"ok": True, "id": pattern_id}
