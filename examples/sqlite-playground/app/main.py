"""SQLite Playground — open any .sqlite file and explore it with real SQL.

The showcase is a database explorer that runs entirely client-side in Pyodide:
upload a SQLite file, browse its tables/columns, run SQL against it (read-only by
default), and see an auto-generated ER diagram from its foreign keys — with no
server. The bundle's *own* state (saved queries + a query history) lives in the
.vessel file itself and travels with it.

Two strictly separate databases:
  - The bundle's OWN store: `data/store.sqlite` (the manifest `data` path). It
    holds `saved_query` and `query_history`. The host persists this back into the
    .vessel on save. Only the backend touches it, only via parameterized SQL.
  - The IMPORTED database: the user's uploaded copy, written to a distinct temp
    path (`data/imported.sqlite`) and opened on a SEPARATE sqlite3 connection.
    Arbitrary user SQL runs ONLY against this connection — it can never see or
    touch `data/store.sqlite` because they are different files on different
    connections (no ATTACH is performed by us, and the editor is single-DB).

Security model (see CLAUDE.md "Security focus"):
  - Uploaded bytes are validated as real SQLite (16-byte magic header
    "SQLite format 3\\000") before being written anywhere.
  - Uploads are capped at 25 MB; larger payloads are rejected up front.
  - The SQL editor is READ-ONLY BY DEFAULT. We classify each statement and reject
    writes (INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/...) unless the caller passes
    allow_writes=true. Read-only mode also opens the imported DB via a
    `file:...?mode=ro` URI so the engine itself enforces it (belt and braces).
  - Arbitrary SQL against the *imported* DB is by design: it is the user's own
    file, fully isolated from the bundle's store. The safety boundary is
    isolation + read-only-default + type/size validation.

Routes are `async def` on purpose: Pyodide has no OS threads, so FastAPI's
threadpool dispatch for sync routes raises "can't start new thread".
"""

import base64
import os
import re
import sqlite3
import time

from fastapi import FastAPI
from pydantic import BaseModel, Field

# The bundle's OWN persistent store (saved queries + history). Travels in .vessel.
STORE_DB = "data/store.sqlite"
# The user's uploaded database — a distinct file, opened on its own connection.
IMPORTED_DB = "data/imported.sqlite"

# Upload limits / validation.
MAX_UPLOAD_BYTES = 25 * 1024 * 1024          # 25 MB hard cap
SQLITE_MAGIC = b"SQLite format 3\x00"        # 16-byte file header of every SQLite DB

# Browse paging.
MAX_PAGE = 200
DEFAULT_PAGE = 50

app = FastAPI()


# ---------------------------------------------------------------------------
# Bundle's OWN store (parameterized only)
# ---------------------------------------------------------------------------
def _store() -> sqlite3.Connection:
    """Open (and lazily seed the schema of) the bundle's own store."""
    con = sqlite3.connect(STORE_DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS saved_query ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  name TEXT NOT NULL,"
        "  sql TEXT NOT NULL,"
        "  created REAL NOT NULL"
        ")"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS query_history ("
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  sql TEXT NOT NULL,"
        "  ok INTEGER NOT NULL,"
        "  rows INTEGER NOT NULL DEFAULT 0,"
        "  ran REAL NOT NULL"
        ")"
    )
    con.commit()
    return con


# ---------------------------------------------------------------------------
# Imported DB helpers (fully isolated connection)
# ---------------------------------------------------------------------------
def _have_imported() -> bool:
    return os.path.exists(IMPORTED_DB) and os.path.getsize(IMPORTED_DB) > 0


def _open_imported(writable: bool) -> sqlite3.Connection:
    """Open the imported DB on its OWN connection.

    Read-only mode uses a `file:...?mode=ro` URI so SQLite itself blocks writes,
    independently of our statement classifier.
    """
    if writable:
        return sqlite3.connect(IMPORTED_DB)
    uri = "file:" + IMPORTED_DB + "?mode=ro"
    return sqlite3.connect(uri, uri=True)


# Statement classifier. We strip leading SQL comments/whitespace, then look at
# the first keyword. Read-only verbs: SELECT, PRAGMA, EXPLAIN, WITH (a CTE that
# ends in SELECT), VALUES. Everything else is treated as a write.
_READ_VERBS = {"SELECT", "PRAGMA", "EXPLAIN", "WITH", "VALUES"}
_LEADING_COMMENT = re.compile(
    r"^\s*(?:--[^\n]*\n|/\*.*?\*/|\s)+", re.DOTALL
)


def _strip_leading(sql: str) -> str:
    """Remove leading whitespace and SQL comments so we can read the first verb."""
    prev = None
    s = sql
    while s != prev:
        prev = s
        s = _LEADING_COMMENT.sub("", s, count=1)
    return s


def _is_write(sql: str) -> bool:
    """True if the statement would modify data/schema.

    Conservative: anything that is not a recognised read verb is a write. A
    `WITH ... ` CTE is only read-only if its outer statement is SELECT/VALUES.
    """
    head = _strip_leading(sql)
    m = re.match(r"([A-Za-z]+)", head)
    if not m:
        # No leading keyword (e.g. empty or only a comment) — nothing to run as a
        # write; treat as read so an empty editor doesn't trip the write guard.
        return False
    verb = m.group(1).upper()
    if verb not in _READ_VERBS:
        return True
    if verb == "WITH":
        # A CTE is a write if it drives INSERT/UPDATE/DELETE. Look for the outer
        # verb after the final closing paren of the CTE list. Cheap heuristic:
        # if the statement contains INSERT/UPDATE/DELETE as a standalone keyword,
        # treat as a write.
        if re.search(r"\b(INSERT|UPDATE|DELETE|REPLACE)\b", sql, re.IGNORECASE):
            return True
    if verb == "PRAGMA":
        # `PRAGMA foo = bar` can mutate engine state; but against a read-only
        # connection it is harmless and useful (e.g. table_info). The read-only
        # URI already blocks anything that would persist. Keep PRAGMA as read.
        return False
    return False


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UploadIn(BaseModel):
    # base64-encoded raw bytes of the .sqlite file
    data: str = Field(default="", max_length=MAX_UPLOAD_BYTES * 2)
    filename: str = Field(default="database.sqlite", max_length=255)


class BrowseIn(BaseModel):
    table: str = Field(default="", max_length=256)
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=DEFAULT_PAGE, ge=1, le=MAX_PAGE)


class RunIn(BaseModel):
    sql: str = Field(default="", max_length=100_000)
    allow_writes: bool = False
    limit: int = Field(default=500, ge=1, le=5000)


class SaveQueryIn(BaseModel):
    name: str = Field(default="", min_length=1, max_length=120)
    sql: str = Field(default="", min_length=1, max_length=100_000)


class DeleteIn(BaseModel):
    id: int


# ---------------------------------------------------------------------------
# Upload / import
# ---------------------------------------------------------------------------
@app.post("/api/import")
async def import_db(payload: UploadIn):
    """Validate and store an uploaded .sqlite file as the imported database."""
    if not payload.data:
        return {"ok": False, "error": "No file data received."}
    try:
        raw = base64.b64decode(payload.data, validate=True)
    except Exception:
        return {"ok": False, "error": "Upload was not valid base64."}

    if len(raw) > MAX_UPLOAD_BYTES:
        mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        return {"ok": False, "error": f"File is too large (max {mb} MB)."}
    if len(raw) < 16 or raw[:16] != SQLITE_MAGIC:
        return {
            "ok": False,
            "error": "That does not look like a SQLite database "
                     "(missing the 'SQLite format 3' file header).",
        }

    # Write to the dedicated imported path (never the bundle's own store).
    with open(IMPORTED_DB, "wb") as f:
        f.write(raw)

    # Confirm SQLite can actually open it (header alone is not a full guarantee).
    try:
        con = _open_imported(writable=False)
        n_tables = con.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
        con.close()
    except sqlite3.DatabaseError as e:
        # Remove the bad file so we don't leave a half-imported DB around.
        try:
            os.remove(IMPORTED_DB)
        except OSError:
            pass
        return {"ok": False, "error": f"Could not open database: {e}"}

    return {
        "ok": True,
        "filename": payload.filename,
        "bytes": len(raw),
        "tables": n_tables,
    }


@app.post("/api/close")
async def close_db():
    """Discard the currently imported database."""
    if _have_imported():
        try:
            os.remove(IMPORTED_DB)
        except OSError:
            pass
    return {"ok": True}


# ---------------------------------------------------------------------------
# Browse: tables, schema, rows
# ---------------------------------------------------------------------------
@app.get("/api/status")
async def status():
    return {"imported": _have_imported()}


@app.get("/api/tables")
async def tables():
    if not _have_imported():
        return {"ok": False, "error": "No database imported.", "tables": []}
    con = _open_imported(writable=False)
    try:
        rows = con.execute(
            "SELECT name, type FROM sqlite_master "
            "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' "
            "ORDER BY type, name"
        ).fetchall()
        out = []
        for name, typ in rows:
            try:
                # Quote the identifier read from sqlite_master (trusted source,
                # but quote defensively for names with special chars).
                cnt = con.execute(
                    f"SELECT COUNT(*) FROM {_quote_ident(name)}"
                ).fetchone()[0]
            except sqlite3.DatabaseError:
                cnt = None
            out.append({"name": name, "type": typ, "rows": cnt})
    finally:
        con.close()
    return {"ok": True, "tables": out}


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _table_exists(con: sqlite3.Connection, name: str) -> bool:
    row = con.execute(
        "SELECT 1 FROM sqlite_master "
        "WHERE type IN ('table','view') AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


@app.post("/api/schema")
async def schema(payload: BrowseIn):
    """Columns (name/type/pk) + a paginated sample of rows for one table."""
    if not _have_imported():
        return {"ok": False, "error": "No database imported."}
    if not payload.table:
        return {"ok": False, "error": "No table selected."}

    con = _open_imported(writable=False)
    try:
        # Validate the table name against the live catalogue (parameterized) so
        # we never interpolate an unverified identifier.
        if not _table_exists(con, payload.table):
            return {"ok": False, "error": "No such table."}

        qi = _quote_ident(payload.table)
        info = con.execute(f"PRAGMA table_info({qi})").fetchall()
        columns = [
            {"name": r[1], "type": r[2] or "", "notnull": bool(r[3]),
             "pk": bool(r[5])}
            for r in info
        ]
        total = con.execute(f"SELECT COUNT(*) FROM {qi}").fetchone()[0]
        cur = con.execute(
            f"SELECT * FROM {qi} LIMIT ? OFFSET ?",
            (payload.limit, payload.offset),
        )
        col_names = [d[0] for d in cur.description] if cur.description else []
        rows = [list(r) for r in cur.fetchall()]
    finally:
        con.close()

    return {
        "ok": True,
        "table": payload.table,
        "columns": columns,
        "col_names": col_names,
        "rows": rows,
        "total": total,
        "offset": payload.offset,
        "limit": payload.limit,
    }


# ---------------------------------------------------------------------------
# Run SQL (read-only by default)
# ---------------------------------------------------------------------------
@app.post("/api/run")
async def run_sql(payload: RunIn):
    if not _have_imported():
        return {"ok": False, "error": "No database imported."}
    sql = payload.sql.strip()
    if not sql:
        return {"ok": False, "error": "Query is empty."}

    is_write = _is_write(sql)
    if is_write and not payload.allow_writes:
        return {
            "ok": False,
            "error": "This looks like a write statement "
                     "(INSERT/UPDATE/DELETE/CREATE/...). Turn on 'Allow writes' "
                     "to run it against the imported copy.",
            "blocked_write": True,
        }

    # Open writable only when writes are explicitly allowed AND needed.
    writable = payload.allow_writes
    con = _open_imported(writable=writable)
    started = time.perf_counter()
    try:
        cur = con.execute(sql)
        if cur.description:  # a result set (SELECT/PRAGMA/EXPLAIN/...)
            col_names = [d[0] for d in cur.description]
            fetched = cur.fetchmany(payload.limit)
            rows = [list(r) for r in fetched]
            # Determine truncation cheaply: try to read one more row.
            truncated = cur.fetchone() is not None
            result = {
                "ok": True,
                "kind": "rows",
                "col_names": col_names,
                "rows": rows,
                "row_count": len(rows),
                "truncated": truncated,
            }
        else:  # a statement with no result set (write/DDL)
            con.commit()
            result = {
                "ok": True,
                "kind": "exec",
                "rowcount": cur.rowcount,
            }
    except sqlite3.DatabaseError as e:
        con.rollback()
        con.close()
        _record_history(sql, ok=False, rows=0)
        return {"ok": False, "error": str(e)}
    finally:
        if con:
            try:
                con.close()
            except sqlite3.ProgrammingError:
                pass

    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
    result["elapsed_ms"] = elapsed_ms
    _record_history(
        sql, ok=True,
        rows=result.get("row_count", result.get("rowcount", 0) or 0),
    )
    return result


# ---------------------------------------------------------------------------
# Auto ER diagram (schema + foreign keys)
# ---------------------------------------------------------------------------
@app.get("/api/diagram")
async def diagram():
    """Build a schema graph: tables (with columns) + foreign-key edges."""
    if not _have_imported():
        return {"ok": False, "error": "No database imported."}
    con = _open_imported(writable=False)
    try:
        names = [
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        ]
        nodes = []
        edges = []
        for name in names:
            qi = _quote_ident(name)
            info = con.execute(f"PRAGMA table_info({qi})").fetchall()
            cols = [
                {"name": r[1], "type": r[2] or "", "pk": bool(r[5])}
                for r in info
            ]
            nodes.append({"name": name, "columns": cols})
            for fk in con.execute(f"PRAGMA foreign_key_list({qi})").fetchall():
                # fk: (id, seq, table, from, to, on_update, on_delete, match)
                edges.append({
                    "from_table": name,
                    "from_col": fk[3],
                    "to_table": fk[2],
                    "to_col": fk[4],
                })
    finally:
        con.close()
    return {"ok": True, "nodes": nodes, "edges": edges}


# ---------------------------------------------------------------------------
# Saved queries + history (bundle's OWN store, parameterized only)
# ---------------------------------------------------------------------------
def _record_history(sql: str, ok: bool, rows: int) -> None:
    con = _store()
    con.execute(
        "INSERT INTO query_history (sql, ok, rows, ran) VALUES (?, ?, ?, ?)",
        (sql[:100_000], 1 if ok else 0, int(rows or 0), time.time()),
    )
    # Trim history to the most recent 100 entries.
    con.execute(
        "DELETE FROM query_history WHERE id NOT IN "
        "(SELECT id FROM query_history ORDER BY id DESC LIMIT 100)"
    )
    con.commit()
    con.close()


@app.get("/api/saved")
async def list_saved():
    con = _store()
    rows = con.execute(
        "SELECT id, name, sql, created FROM saved_query ORDER BY name"
    ).fetchall()
    con.close()
    return {"ok": True, "saved": [
        {"id": r[0], "name": r[1], "sql": r[2], "created": r[3]} for r in rows
    ]}


@app.post("/api/saved")
async def save_query(payload: SaveQueryIn):
    name = payload.name.strip()
    sql = payload.sql.strip()
    if not name:
        return {"ok": False, "error": "Name is required."}
    if not sql:
        return {"ok": False, "error": "SQL is required."}
    con = _store()
    cur = con.execute(
        "INSERT INTO saved_query (name, sql, created) VALUES (?, ?, ?)",
        (name, sql, time.time()),
    )
    con.commit()
    new_id = cur.lastrowid
    con.close()
    return {"ok": True, "id": new_id}


@app.post("/api/saved/delete")
async def delete_saved(payload: DeleteIn):
    con = _store()
    cur = con.execute("DELETE FROM saved_query WHERE id = ?", (payload.id,))
    con.commit()
    changed = cur.rowcount
    con.close()
    return {"ok": changed > 0}


@app.get("/api/history")
async def list_history():
    con = _store()
    rows = con.execute(
        "SELECT id, sql, ok, rows, ran FROM query_history ORDER BY id DESC LIMIT 100"
    ).fetchall()
    con.close()
    return {"ok": True, "history": [
        {"id": r[0], "sql": r[1], "ok": bool(r[2]), "rows": r[3], "ran": r[4]}
        for r in rows
    ]}


@app.post("/api/history/clear")
async def clear_history():
    con = _store()
    con.execute("DELETE FROM query_history")
    con.commit()
    con.close()
    return {"ok": True}
