"""CSV Explorer — open a CSV, work on it in real SQL, save it back into the file.

The showcase is SQLite doing real work with no server: filtering and sorting are
*actual* parameterized SQL run inside Pyodide against a DB that lives in the
.vessel file. You can import an arbitrary CSV (paste or pick a file), which
**rebuilds the table** to the CSV's own columns, then filter / sort / add / edit
/ delete rows over whatever columns are now present.

Schema strategy — a single dynamic table `data`:
  - On first open the DB is empty, so we seed ~4,800 synthetic "stations" rows
    with a *seeded* deterministic generator (stable across reopens) into a `data`
    table whose columns are (station, region, elev, wind, temp, road, updated).
  - Importing a CSV DROPs and rebuilds `data` (REPLACE) or appends to it
    (APPEND, only when the headers match). Every imported column is created as
    TEXT for simplicity — we do not infer types. A hidden INTEGER PRIMARY KEY
    `id` is always present for stable ordering and row addressing; it is never
    exposed as a data column.

Security — this tool takes user data and builds SQL:
  - Column names are NEVER interpolated from raw user input. The set of real
    columns is read live from `PRAGMA table_info(data)` (the allowlist). Any
    sort target or per-cell reference is validated against that allowlist and
    rejected otherwise; identifiers that pass are double-quoted with internal
    quotes escaped.
  - All row VALUES go through parameterized queries. LIKE metacharacters are
    escaped so a literal % or _ matches literally.
  - Imports are capped (see CAP_* below) and oversized/malformed CSV is rejected
    with a clear message before any table is touched.

Routes are `async def` on purpose: Pyodide has no OS threads, so FastAPI's
threadpool dispatch for sync routes raises "can't start new thread".
"""

import csv
import io
import random
import re
import sqlite3
import time

from fastapi import FastAPI
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Import caps — rejected with a clear message before the table is touched.
CAP_ROWS = 50_000          # max data rows per import
CAP_COLS = 64              # max columns
CAP_CELL = 2_000           # max characters per cell
CAP_BYTES = 8_000_000      # max raw CSV payload size (~8 MB)
CAP_NAME = 64              # max characters per column name

DIRECTIONS = {"asc": "ASC", "desc": "DESC"}

# A column name is only ever used as an identifier after it passes this check
# AND is confirmed present in the live allowlist. Keep it conservative.
_NAME_OK = re.compile(r"^[A-Za-z][A-Za-z0-9_ .\-]{0,%d}$" % (CAP_NAME - 1))

# ---------------------------------------------------------------------------
# Seed data (Iceland-flavoured placeholder copy) — identical dataset to before.
# ---------------------------------------------------------------------------
SEED_COLS = ["station", "region", "elev", "wind", "temp", "road", "updated"]

_PREFIX = [
    "Reykja", "Hvols", "Vík", "Kirkju", "Höfn", "Egils", "Möðru", "Akur",
    "Mý", "Hvera", "Kjöl", "Ísa", "Hólma", "Stykkis", "Borgar", "Kefla",
    "Sel", "Grinda", "Þings", "Skafta", "Breiða", "Land", "Eski", "Norð",
]
_SUFFIX = [
    "vík", "völlur", "nes", "fjörður", "staðir", "dalur", "hólmur", "eyri",
    "vatn", "vellir", "ur", "bær", "höfn", "sandur", "klaustur", "tunga",
]
_REGIONS = [
    "Höfuðborg", "Suðurland", "Austurland", "Norðurland", "Hálendi",
    "Vestfirðir", "Vesturland", "Suðurnes",
]


def _generate_rows(n: int = 4800) -> list[tuple]:
    """Build n deterministic station rows (all stored as TEXT). Seeded -> stable."""
    rng = random.Random(20260613)  # fixed seed -> reproducible dataset
    rows: list[tuple] = []
    for _ in range(n):
        station = rng.choice(_PREFIX) + rng.choice(_SUFFIX)
        region = rng.choice(_REGIONS)
        highland = region in ("Hálendi", "Austurland")
        elev = rng.randint(300, 740) if highland else rng.randint(3, 120)
        wind = round(rng.uniform(2.0, 19.0), 1)
        temp = round(9.0 - elev / 90.0 + rng.uniform(-2.5, 2.5), 1)
        if wind > 16 or temp < -3:
            road = "Closed"
        elif temp < 0:
            road = "Ice"
        elif wind > 11:
            road = "Wind"
        else:
            road = "Open"
        hh = rng.randint(13, 14)
        mm = rng.randint(0, 59)
        updated = f"{hh:02d}:{mm:02d}"
        # store every value as TEXT so the dynamic schema is uniform
        rows.append((station, region, str(elev), str(wind), str(temp), road, updated))
    return rows


# ---------------------------------------------------------------------------
# Dynamic-table helpers
# ---------------------------------------------------------------------------
def _quote_ident(name: str) -> str:
    """Double-quote a SQLite identifier, escaping embedded quotes."""
    return '"' + name.replace('"', '""') + '"'


def _live_columns(con: sqlite3.Connection) -> list[str]:
    """The live column allowlist, in order — read straight from the table.

    `id` (the hidden primary key) is excluded; everything else is a data column.
    Returns [] if the `data` table does not exist yet.
    """
    try:
        info = con.execute("PRAGMA table_info(data)").fetchall()
    except sqlite3.OperationalError:
        return []
    return [r[1] for r in info if r[1] != "id"]


def _create_data_table(con: sqlite3.Connection, columns: list[str]) -> None:
    """(Re)create the `data` table with the given TEXT columns + hidden id."""
    cols_sql = ", ".join(f"{_quote_ident(c)} TEXT" for c in columns)
    con.execute("DROP TABLE IF EXISTS data")
    con.execute(
        f"CREATE TABLE data (id INTEGER PRIMARY KEY AUTOINCREMENT, {cols_sql})"
    )


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    if not _live_columns(con):
        # Empty DB -> seed the default stations dataset.
        _create_data_table(con, SEED_COLS)
        placeholders = ", ".join("?" for _ in SEED_COLS)
        cols = ", ".join(_quote_ident(c) for c in SEED_COLS)
        con.executemany(
            f"INSERT INTO data ({cols}) VALUES ({placeholders})",
            _generate_rows(),
        )
        con.commit()
    return con


def _resolve_col(name: str, allow: list[str]) -> str | None:
    """Return the canonical column name if it is in the live allowlist, else None."""
    return name if name in allow else None


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class Query(BaseModel):
    filter: str = Field(default="", max_length=200)
    sort: str = Field(default="", max_length=CAP_NAME)
    dir: str = "asc"
    limit: int = Field(default=300, ge=1, le=1000)


class RowIn(BaseModel):
    # values keyed by column name; unknown keys are dropped, missing default to ""
    values: dict[str, str] = Field(default_factory=dict)


class RowEdit(RowIn):
    id: int


class ImportIn(BaseModel):
    text: str = Field(default="", max_length=CAP_BYTES)
    mode: str = "replace"  # "replace" | "append"


# ---------------------------------------------------------------------------
# Read routes
# ---------------------------------------------------------------------------
@app.get("/api/meta")
async def meta():
    con = _con()
    cols = _live_columns(con)
    total = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]
    con.close()
    # `columns` stays an int for back-compat; `column_names` is additive.
    return {"total": total, "columns": len(cols), "column_names": cols}


@app.post("/api/query")
async def query(q: Query):
    con = _con()
    allow = _live_columns(con)
    if not allow:
        con.close()
        return {"rows": [], "total": 0, "shown": 0, "scanned": 0,
                "elapsed_ms": 0.0, "columns": []}

    # Sort target validated against the live allowlist; fall back to first column.
    col = _resolve_col(q.sort, allow) or allow[0]
    direction = DIRECTIONS.get(q.dir, "ASC")

    where = ""
    params: list = []
    needle = q.filter.strip()
    if needle:
        # Parameterized LIKE across *every* current column. Escape the LIKE
        # metacharacters so a literal % or _ in the query matches literally.
        esc = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        like = f"%{esc}%"
        clauses = [f"{_quote_ident(c)} LIKE ? ESCAPE '\\'" for c in allow]
        where = " WHERE " + " OR ".join(clauses)
        params = [like] * len(allow)

    started = time.perf_counter()
    total = con.execute(f"SELECT COUNT(*) FROM data{where}", params).fetchone()[0]

    select_cols = ", ".join(_quote_ident(c) for c in allow)
    sql = (
        f"SELECT id, {select_cols} FROM data{where} "
        f"ORDER BY {_quote_ident(col)} {direction}, id ASC LIMIT ?"
    )
    fetched = con.execute(sql, [*params, q.limit]).fetchall()
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    con.close()

    out = []
    for r in fetched:
        rid = r[0]
        rec = {c: r[i + 1] for i, c in enumerate(allow)}
        rec["id"] = rid
        out.append(rec)

    return {
        "rows": out,
        "total": total,
        "shown": len(out),
        "scanned": total,
        "elapsed_ms": elapsed_ms,
        "columns": allow,
    }


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------
def _coerce_values(values: dict, allow: list[str]) -> dict[str, str]:
    """Keep only allowlisted columns; coerce each to a capped string."""
    out: dict[str, str] = {}
    for c in allow:
        v = values.get(c, "")
        if v is None:
            v = ""
        v = str(v)
        if len(v) > CAP_CELL:
            v = v[:CAP_CELL]
        out[c] = v
    return out


@app.post("/api/rows")
async def add_row(row: RowIn):
    con = _con()
    allow = _live_columns(con)
    if not allow:
        con.close()
        return {"ok": False, "error": "No columns."}
    vals = _coerce_values(row.values, allow)
    cols = ", ".join(_quote_ident(c) for c in allow)
    placeholders = ", ".join("?" for _ in allow)
    cur = con.execute(
        f"INSERT INTO data ({cols}) VALUES ({placeholders})",
        [vals[c] for c in allow],
    )
    con.commit()
    new_id = cur.lastrowid
    con.close()
    return {"ok": True, "id": new_id}


@app.put("/api/rows")
async def edit_row(row: RowEdit):
    con = _con()
    allow = _live_columns(con)
    if not allow:
        con.close()
        return {"ok": False, "error": "No columns."}
    vals = _coerce_values(row.values, allow)
    sets = ", ".join(f"{_quote_ident(c)} = ?" for c in allow)
    cur = con.execute(
        f"UPDATE data SET {sets} WHERE id = ?",
        [*[vals[c] for c in allow], row.id],
    )
    con.commit()
    changed = cur.rowcount
    con.close()
    if changed == 0:
        return {"ok": False, "error": "No such row."}
    return {"ok": True}


class RowDelete(BaseModel):
    id: int


@app.post("/api/rows/delete")
async def delete_row(row: RowDelete):
    con = _con()
    cur = con.execute("DELETE FROM data WHERE id = ?", (row.id,))
    con.commit()
    changed = cur.rowcount
    con.close()
    if changed == 0:
        return {"ok": False, "error": "No such row."}
    return {"ok": True}


# ---------------------------------------------------------------------------
# CSV import
# ---------------------------------------------------------------------------
def _parse_csv(text: str) -> tuple[list[str], list[list[str]]]:
    """Parse CSV text -> (header, rows). Raises ValueError with a clear message."""
    if not text.strip():
        raise ValueError("CSV is empty.")
    if len(text.encode("utf-8", "ignore")) > CAP_BYTES:
        raise ValueError(f"CSV is too large (max {CAP_BYTES // 1_000_000} MB).")

    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise ValueError("CSV has no header row.")

    header = [h.strip() for h in header]
    if not header or all(h == "" for h in header):
        raise ValueError("CSV header row is empty.")
    if len(header) > CAP_COLS:
        raise ValueError(f"Too many columns (max {CAP_COLS}).")

    # Fill in blank/duplicate header names so every column is addressable + unique.
    seen: dict[str, int] = {}
    cols: list[str] = []
    for i, h in enumerate(header):
        name = h if h else f"column_{i + 1}"
        if not _NAME_OK.match(name):
            # Replace disallowed chars; keep it a valid identifier.
            name = re.sub(r"[^A-Za-z0-9_ .\-]", "_", name)
            if not name or not name[0].isalpha():
                name = "col_" + name
            name = name[:CAP_NAME]
            if not _NAME_OK.match(name):
                name = f"column_{i + 1}"
        base = name
        n = seen.get(base.lower(), 0)
        while name.lower() in (c.lower() for c in cols):
            n += 1
            name = f"{base}_{n}"[:CAP_NAME]
        seen[base.lower()] = n
        cols.append(name)

    width = len(cols)
    rows: list[list[str]] = []
    for raw in reader:
        if len(rows) >= CAP_ROWS:
            raise ValueError(f"Too many rows (max {CAP_ROWS:,}).")
        # normalise width: pad short rows, truncate long ones
        cells = list(raw[:width]) + [""] * (width - len(raw))
        capped = []
        for cell in cells:
            cell = "" if cell is None else str(cell)
            if len(cell) > CAP_CELL:
                cell = cell[:CAP_CELL]
            capped.append(cell)
        rows.append(capped)

    return cols, rows


@app.post("/api/import")
async def import_csv(payload: ImportIn):
    mode = payload.mode if payload.mode in ("replace", "append") else "replace"
    try:
        cols, rows = _parse_csv(payload.text)
    except ValueError as e:
        return {"ok": False, "error": str(e)}

    con = _con()
    try:
        if mode == "append":
            existing = _live_columns(con)
            # Append only when the incoming header matches the current columns.
            if [c.lower() for c in cols] != [c.lower() for c in existing]:
                con.close()
                return {
                    "ok": False,
                    "error": "Append needs matching columns. "
                             f"Current: {', '.join(existing)}.",
                }
            target = existing  # keep canonical existing names
        else:
            _create_data_table(con, cols)
            target = cols

        col_sql = ", ".join(_quote_ident(c) for c in target)
        placeholders = ", ".join("?" for _ in target)
        con.executemany(
            f"INSERT INTO data ({col_sql}) VALUES ({placeholders})",
            rows,
        )
        con.commit()
        total = con.execute("SELECT COUNT(*) FROM data").fetchone()[0]
        live = _live_columns(con)
    finally:
        con.close()

    return {
        "ok": True,
        "mode": mode,
        "imported": len(rows),
        "total": total,
        "columns": live,
    }
