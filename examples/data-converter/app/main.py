"""Data Converter — convert & validate JSON / YAML / TOML, entirely local.

A FastAPI backend that runs inside Pyodide (CPython on WebAssembly) in the
browser. Nothing it touches leaves the machine — devs paste config files and
API payloads here, and the data goes nowhere (the manifest declares no network
capability, so egress is default-denied by the host).

Parsing uses the three formats' native Python support:
  - JSON: stdlib `json`
  - TOML read: stdlib `tomllib` (Python 3.11+; Pyodide 0.29.4 ships 3.13)
  - TOML write: `tomli-w` (pure-Python wheel)
  - YAML read/write: `pyyaml`

Routes are `async def`: Pyodide has no OS threads, and FastAPI dispatches sync
(`def`) routes to a threadpool, which raises "can't start new thread".

Security notes:
  - YAML is parsed with `yaml.safe_load` ONLY — never `yaml.load`/FullLoader —
    so a malicious document cannot construct arbitrary Python objects.
  - All SQLite access is parameterized (no string-built queries).
  - Parse failures return a clear, line-accurate 200 payload ({"ok": false,...}),
    never a 500 stack trace.
"""

import json
import sqlite3
import tomllib  # stdlib TOML *reader* (Python 3.11+)

import tomli_w  # pure-Python TOML *writer*
import yaml  # pyyaml
from fastapi import FastAPI
from pydantic import BaseModel

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

FORMATS = ("json", "yaml", "toml")
MAX_INPUT = 1_000_000  # 1 MB cap on pasted input — sane ceiling for config/payloads


# --------------------------------------------------------------------------- DB


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS history ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "label TEXT NOT NULL DEFAULT '', "
        "in_format TEXT NOT NULL, "
        "body TEXT NOT NULL, "
        "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    # Seed one illustrative snippet on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM history").fetchone()[0] == 0:
        sample = (
            '{\n'
            '  "service": "web",\n'
            '  "replicas": 3,\n'
            '  "ports": [8080, 8443],\n'
            '  "env": { "LOG_LEVEL": "info", "DEBUG": false }\n'
            '}'
        )
        con.execute(
            "INSERT INTO history (label, in_format, body) VALUES (?, ?, ?)",
            ("Sample payload", "json", sample),
        )
        con.commit()
    return con


# ----------------------------------------------------------------------- parse


class ParseError(Exception):
    """Carries a human-readable message and, when known, a 1-based line/col."""

    def __init__(self, message: str, line: int | None = None, col: int | None = None):
        super().__init__(message)
        self.message = message
        self.line = line
        self.col = col


def parse_input(text: str, fmt: str):
    """Parse `text` as `fmt`. Raise ParseError (clean message) on failure."""
    if fmt == "json":
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise ParseError(e.msg, e.lineno, e.colno) from None
    if fmt == "yaml":
        try:
            # safe_load: no arbitrary object construction from untrusted YAML.
            return yaml.safe_load(text)
        except yaml.YAMLError as e:
            line = col = None
            mark = getattr(e, "problem_mark", None)
            if mark is not None:
                line, col = mark.line + 1, mark.column + 1
            msg = getattr(e, "problem", None) or str(e).split("\n")[0]
            raise ParseError(msg, line, col) from None
    if fmt == "toml":
        try:
            return tomllib.loads(text)
        except tomllib.TOMLDecodeError as e:
            # tomllib messages often end with "(at line N, column M)".
            raise ParseError(str(e)) from None
    raise ParseError(f"unknown format: {fmt}")


def detect_format(text: str) -> str:
    """Best-effort auto-detect. Tries JSON, then TOML, then YAML.

    YAML is the most permissive grammar (it accepts bare scalars and most TOML),
    so it is tried last to avoid swallowing JSON/TOML inputs.
    """
    stripped = text.strip()
    if not stripped:
        return "json"
    # JSON: object/array/quoted-string starts are a strong, cheap signal.
    if stripped[0] in "{[":
        try:
            json.loads(text)
            return "json"
        except json.JSONDecodeError:
            pass
    else:
        try:
            json.loads(text)
            return "json"
        except json.JSONDecodeError:
            pass
    try:
        tomllib.loads(text)
        return "toml"
    except tomllib.TOMLDecodeError:
        pass
    try:
        yaml.safe_load(text)
        return "yaml"
    except yaml.YAMLError:
        pass
    return "json"  # fall back; the caller will surface the JSON parse error


# --------------------------------------------------------------------- emitters


def _ensure_toml_serializable(value):
    """TOML has no top-level scalar/array and no null. Surface a clear reason
    instead of letting tomli_w raise an opaque error."""
    if not isinstance(value, dict):
        raise ParseError("TOML output requires a top-level table (object/map).")


def emit(value, fmt: str) -> str:
    if fmt == "json":
        return json.dumps(value, indent=2, ensure_ascii=False, sort_keys=False)
    if fmt == "yaml":
        return yaml.safe_dump(value, sort_keys=False, allow_unicode=True, default_flow_style=False)
    if fmt == "toml":
        _ensure_toml_serializable(value)
        try:
            return tomli_w.dumps(value)
        except (TypeError, ValueError) as e:
            # e.g. None/null is not representable in TOML.
            raise ParseError(f"cannot represent value as TOML: {e}") from None
    raise ParseError(f"unknown format: {fmt}")


# ------------------------------------------------------------------- path query


def _split_path(path: str) -> list:
    """Tokenize a dotted + bracket path into keys (str) and indices (int).

    Supports: `users[0].name`, `services.web.ports[1]`, `a.b`, `list[2][0]`,
    and quoted keys with dots inside brackets, e.g. `data["a.b"].c`.
    Raises ParseError on malformed syntax.
    """
    tokens: list = []
    i, n = 0, len(path)
    while i < n:
        ch = path[i]
        if ch == ".":
            i += 1
            continue
        if ch == "[":
            j = path.find("]", i)
            if j == -1:
                raise ParseError(f"unclosed '[' at position {i} in path")
            inner = path[i + 1 : j].strip()
            if len(inner) >= 2 and inner[0] in "\"'" and inner[-1] == inner[0]:
                tokens.append(inner[1:-1])  # quoted string key
            else:
                try:
                    tokens.append(int(inner))
                except ValueError:
                    raise ParseError(
                        f"bracket index must be an integer or quoted key, got '{inner}'"
                    ) from None
            i = j + 1
            continue
        # bare key: read until the next '.' or '['
        j = i
        while j < n and path[j] not in ".[":
            j += 1
        key = path[i:j]
        if key == "":
            raise ParseError(f"empty path segment at position {i}")
        tokens.append(key)
        i = j
    return tokens


def query_path(value, path: str):
    """Pure-Python traversal of a parsed structure. Returns (found, result)."""
    tokens = _split_path(path)
    cur = value
    walked = ""
    for tok in tokens:
        if isinstance(tok, int):
            walked += f"[{tok}]"
            if not isinstance(cur, list):
                raise ParseError(f"'{walked}': cannot index a {type(cur).__name__} with [{tok}]")
            if tok < -len(cur) or tok >= len(cur):
                raise ParseError(f"'{walked}': index {tok} out of range (length {len(cur)})")
            cur = cur[tok]
        else:
            walked += f".{tok}" if walked else tok
            if not isinstance(cur, dict):
                raise ParseError(f"'{walked}': cannot read key '{tok}' from a {type(cur).__name__}")
            if tok not in cur:
                raise ParseError(f"'{walked}': key '{tok}' not found")
            cur = cur[tok]
    return cur


# ----------------------------------------------------------------------- models


class ConvertIn(BaseModel):
    text: str
    in_format: str = "auto"  # "auto" | "json" | "yaml" | "toml"


class QueryIn(BaseModel):
    text: str
    in_format: str = "auto"
    path: str


class SaveIn(BaseModel):
    label: str = ""
    in_format: str
    body: str


def _err(message: str, line=None, col=None):
    return {"ok": False, "error": message, "line": line, "col": col}


# ----------------------------------------------------------------------- routes


@app.post("/api/convert")
async def convert(body: ConvertIn):
    if len(body.text) > MAX_INPUT:
        return _err(f"input too large ({len(body.text)} bytes; max {MAX_INPUT})")
    fmt = body.in_format if body.in_format in FORMATS else None
    if body.in_format == "auto" or fmt is None:
        if body.in_format not in ("auto",) and body.in_format not in FORMATS:
            return _err(f"unknown input format: {body.in_format}")
        fmt = detect_format(body.text)
    if not body.text.strip():
        return _err("input is empty")
    try:
        value = parse_input(body.text, fmt)
    except ParseError as e:
        return _err(e.message, e.line, e.col)

    outputs = {}
    for target in FORMATS:
        try:
            outputs[target] = {"ok": True, "text": emit(value, target)}
        except ParseError as e:
            outputs[target] = {"ok": False, "error": e.message}
    return {"ok": True, "detected": fmt, "outputs": outputs}


@app.post("/api/query")
async def run_query(body: QueryIn):
    if len(body.text) > MAX_INPUT:
        return _err(f"input too large ({len(body.text)} bytes; max {MAX_INPUT})")
    if not body.text.strip():
        return _err("input is empty")
    fmt = body.in_format if body.in_format in FORMATS else detect_format(body.text)
    try:
        value = parse_input(body.text, fmt)
    except ParseError as e:
        return _err(e.message, e.line, e.col)
    if not body.path.strip():
        return _err("path is empty")
    try:
        result = query_path(value, body.path.strip())
    except ParseError as e:
        return _err(e.message)
    return {
        "ok": True,
        "detected": fmt,
        "result_json": json.dumps(result, indent=2, ensure_ascii=False),
        "type": type(result).__name__,
    }


@app.get("/api/history")
async def list_history():
    con = _con()
    rows = con.execute(
        "SELECT id, label, in_format, body, created_at FROM history ORDER BY id DESC LIMIT 50"
    ).fetchall()
    con.close()
    return [
        {"id": r[0], "label": r[1], "in_format": r[2], "body": r[3], "created_at": r[4]}
        for r in rows
    ]


@app.post("/api/history")
async def save_history(body: SaveIn):
    if body.in_format not in FORMATS:
        return _err(f"unknown input format: {body.in_format}")
    if len(body.body) > MAX_INPUT:
        return _err("snippet too large to save")
    con = _con()
    new_id = con.execute(
        "INSERT INTO history (label, in_format, body) VALUES (?, ?, ?)",
        (body.label[:200], body.in_format, body.body),
    ).lastrowid
    # Keep history small: trim to the most recent 50 rows.
    con.execute(
        "DELETE FROM history WHERE id NOT IN "
        "(SELECT id FROM history ORDER BY id DESC LIMIT 50)"
    )
    con.commit()
    con.close()
    return {"ok": True, "id": new_id}


@app.delete("/api/history/{item_id}")
async def delete_history(item_id: int):
    con = _con()
    con.execute("DELETE FROM history WHERE id = ?", (item_id,))
    con.commit()
    con.close()
    return {"ok": True}
