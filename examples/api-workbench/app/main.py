"""API Workbench backend.

The headline of this bundle: the OUTBOUND HTTP call is made here, in the
Python backend, not in the browser UI. That sidesteps the CORS wall that
browser-only request tools fight — the backend is not a browser origin, so the
target API's CORS headers are irrelevant.

Outbound mechanism (important Pyodide reality):
  In Pyodide, Python cannot open raw TCP sockets, so libraries like `httpx` /
  `requests` cannot make real network calls through their default transports.
  The supported path is the browser's `fetch`, reached from Python via
  `pyodide.http.pyfetch` (which calls `js.fetch` under the hood). The Vessel
  host wraps the worker's `fetch` with its default-deny egress allowlist, so
  routing through `pyfetch` is ALSO what earns the security guarantee: a request
  to an origin not declared in `manifest.capabilities.network` is rejected by
  the host before it leaves the worker. We therefore use `pyfetch` (no `httpx`).

All SQL is parameterized. All routes are `async def` (Pyodide has no threads).
"""

import json
import sqlite3
import time
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root
app = FastAPI()

METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"}

# Origins this bundle is allowed to reach. Kept in sync with
# manifest.capabilities.network — used only to give a friendly hint in the UI;
# the actual enforcement is the host egress policy, not this list.
ALLOWED_ORIGINS = [
    "https://api.github.com",
    "https://jsonplaceholder.typicode.com",
    "https://httpbin.org",
    "https://api.publicapis.org",
]


# --------------------------------------------------------------------------- DB
def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(
        """
        CREATE TABLE IF NOT EXISTS collection (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS request (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id  INTEGER NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
            name           TEXT NOT NULL,
            method         TEXT NOT NULL,
            url            TEXT NOT NULL,
            query_params   TEXT NOT NULL DEFAULT '[]',
            headers        TEXT NOT NULL DEFAULT '[]',
            body_mode      TEXT NOT NULL DEFAULT 'none',
            body           TEXT NOT NULL DEFAULT '',
            updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS history (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        TEXT NOT NULL DEFAULT (datetime('now')),
            method    TEXT NOT NULL,
            url       TEXT NOT NULL,
            status    INTEGER
        );
        """
    )
    con.commit()
    _seed(con)
    return con


def _seed(con: sqlite3.Connection) -> None:
    """Seed a starter collection on first open so the bundle is useful empty."""
    have = con.execute("SELECT COUNT(*) FROM collection").fetchone()[0]
    if have:
        return
    cur = con.execute("INSERT INTO collection (name) VALUES (?)", ("Sample requests",))
    cid = cur.lastrowid
    samples = [
        (
            "Get a post (JSONPlaceholder)",
            "GET",
            "https://jsonplaceholder.typicode.com/posts/1",
            "[]",
            "[]",
            "none",
            "",
        ),
        (
            "Create a post (JSONPlaceholder)",
            "POST",
            "https://jsonplaceholder.typicode.com/posts",
            "[]",
            json.dumps([{"key": "Content-Type", "value": "application/json"}]),
            "json",
            json.dumps({"title": "hello", "body": "from vessel", "userId": 1}, indent=2),
        ),
        (
            "GitHub repo (api.github.com)",
            "GET",
            "https://api.github.com/repos/pyodide/pyodide",
            "[]",
            "[]",
            "none",
            "",
        ),
        (
            "Inspect request (httpbin)",
            "GET",
            "https://httpbin.org/get",
            json.dumps([{"key": "demo", "value": "vessel"}]),
            "[]",
            "none",
            "",
        ),
    ]
    con.executemany(
        "INSERT INTO request "
        "(collection_id, name, method, url, query_params, headers, body_mode, body) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(cid, *s) for s in samples],
    )
    con.commit()


# ------------------------------------------------------------------- Pydantic
class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class KV(BaseModel):
    key: str = Field(max_length=400)
    value: str = Field(max_length=4000)


class RequestIn(BaseModel):
    collection_id: int
    name: str = Field(min_length=1, max_length=200)
    method: str = Field(max_length=10)
    url: str = Field(min_length=1, max_length=2000)
    query_params: list[KV] = []
    headers: list[KV] = []
    body_mode: str = Field(default="none", max_length=10)
    body: str = Field(default="", max_length=200_000)


class SendIn(BaseModel):
    method: str = Field(max_length=10)
    url: str = Field(min_length=1, max_length=2000)
    query_params: list[KV] = []
    headers: list[KV] = []
    body_mode: str = Field(default="none", max_length=10)
    body: str = Field(default="", max_length=200_000)


def _norm_method(m: str) -> str:
    m = (m or "GET").upper()
    if m not in METHODS:
        raise HTTPException(status_code=400, detail=f"Unsupported method: {m}")
    return m


# ----------------------------------------------------------------- Collections
@app.get("/api/collections")
async def list_collections():
    con = _con()
    cols = con.execute(
        "SELECT id, name FROM collection ORDER BY id"
    ).fetchall()
    out = []
    for cid, name in cols:
        reqs = con.execute(
            "SELECT id, name, method, url, query_params, headers, body_mode, body "
            "FROM request WHERE collection_id = ? ORDER BY id",
            (cid,),
        ).fetchall()
        out.append(
            {
                "id": cid,
                "name": name,
                "requests": [
                    {
                        "id": r[0],
                        "name": r[1],
                        "method": r[2],
                        "url": r[3],
                        "query_params": json.loads(r[4]),
                        "headers": json.loads(r[5]),
                        "body_mode": r[6],
                        "body": r[7],
                    }
                    for r in reqs
                ],
            }
        )
    con.close()
    return {"collections": out, "allowed_origins": ALLOWED_ORIGINS}


@app.post("/api/collections")
async def create_collection(payload: CollectionIn):
    con = _con()
    cur = con.execute("INSERT INTO collection (name) VALUES (?)", (payload.name,))
    con.commit()
    cid = cur.lastrowid
    con.close()
    return {"id": cid, "name": payload.name}


@app.put("/api/collections/{cid}")
async def rename_collection(cid: int, payload: CollectionIn):
    con = _con()
    con.execute("UPDATE collection SET name = ? WHERE id = ?", (payload.name, cid))
    con.commit()
    con.close()
    return {"ok": True}


@app.delete("/api/collections/{cid}")
async def delete_collection(cid: int):
    con = _con()
    con.execute("DELETE FROM collection WHERE id = ?", (cid,))
    con.commit()
    con.close()
    return {"ok": True}


# -------------------------------------------------------------------- Requests
@app.post("/api/requests")
async def create_request(payload: RequestIn):
    method = _norm_method(payload.method)
    con = _con()
    cur = con.execute(
        "INSERT INTO request "
        "(collection_id, name, method, url, query_params, headers, body_mode, body, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
        (
            payload.collection_id,
            payload.name,
            method,
            payload.url,
            json.dumps([kv.model_dump() for kv in payload.query_params]),
            json.dumps([kv.model_dump() for kv in payload.headers]),
            payload.body_mode,
            payload.body,
        ),
    )
    con.commit()
    rid = cur.lastrowid
    con.close()
    return {"id": rid}


@app.put("/api/requests/{rid}")
async def update_request(rid: int, payload: RequestIn):
    method = _norm_method(payload.method)
    con = _con()
    con.execute(
        "UPDATE request SET name = ?, method = ?, url = ?, query_params = ?, "
        "headers = ?, body_mode = ?, body = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        (
            payload.name,
            method,
            payload.url,
            json.dumps([kv.model_dump() for kv in payload.query_params]),
            json.dumps([kv.model_dump() for kv in payload.headers]),
            payload.body_mode,
            payload.body,
            rid,
        ),
    )
    con.commit()
    con.close()
    return {"ok": True}


@app.delete("/api/requests/{rid}")
async def delete_request(rid: int):
    con = _con()
    con.execute("DELETE FROM request WHERE id = ?", (rid,))
    con.commit()
    con.close()
    return {"ok": True}


# --------------------------------------------------------------------- History
@app.get("/api/history")
async def list_history():
    con = _con()
    rows = con.execute(
        "SELECT id, ts, method, url, status FROM history ORDER BY id DESC LIMIT 100"
    ).fetchall()
    con.close()
    return {
        "history": [
            {"id": r[0], "ts": r[1], "method": r[2], "url": r[3], "status": r[4]}
            for r in rows
        ]
    }


@app.delete("/api/history")
async def clear_history():
    con = _con()
    con.execute("DELETE FROM history")
    con.commit()
    con.close()
    return {"ok": True}


def _log_history(method: str, url: str, status: Optional[int]) -> None:
    con = _con()
    con.execute(
        "INSERT INTO history (method, url, status) VALUES (?, ?, ?)",
        (method, url, status),
    )
    con.commit()
    con.close()


def _build_url(url: str, params: list[KV]) -> str:
    """Append query params with the stdlib (no network dependency)."""
    from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl

    pairs = [(kv.key, kv.value) for kv in params if kv.key]
    if not pairs:
        return url
    parts = urlparse(url)
    existing = parse_qsl(parts.query, keep_blank_values=True)
    query = urlencode(existing + pairs)
    return urlunparse(parts._replace(query=query))


async def _do_fetch(method: str, url: str, headers: dict, body):
    """Make the real outbound call via the browser fetch bridge.

    Uses pyodide.http.pyfetch -> js.fetch, which the Vessel host has wrapped
    with its default-deny egress allowlist. A request to an undeclared origin
    is rejected here (a JsException / TypeError from the wrapper) — we translate
    that into a clear 'blocked by egress' message rather than failing silently.
    """
    from pyodide.http import pyfetch  # available whenever Pyodide is the runtime

    kwargs: dict = {"method": method}
    if headers:
        kwargs["headers"] = headers
    if body is not None and method not in ("GET", "HEAD"):
        kwargs["body"] = body

    started = time.monotonic()
    resp = await pyfetch(url, **kwargs)
    elapsed_ms = round((time.monotonic() - started) * 1000)

    resp_headers = {}
    try:
        # resp.js_response.headers is a JS Headers object; iterate it.
        for pair in resp.js_response.headers:
            resp_headers[str(pair[0])] = str(pair[1])
    except Exception:
        pass

    text = await resp.string()
    return resp.status, resp_headers, text, elapsed_ms


@app.post("/api/send")
async def send(payload: SendIn):
    method = _norm_method(payload.method)
    full_url = _build_url(payload.url, payload.query_params)

    headers = {}
    for kv in payload.headers:
        if kv.key:
            headers[kv.key] = kv.value

    body = None
    if payload.body_mode in ("raw", "json") and method not in ("GET", "HEAD"):
        body = payload.body
        if payload.body_mode == "json" and "content-type" not in {
            k.lower() for k in headers
        }:
            headers["Content-Type"] = "application/json"

    try:
        status, resp_headers, text, elapsed_ms = await _do_fetch(
            method, full_url, headers, body
        )
    except Exception as exc:  # noqa: BLE001 — surface a clean message to the UI
        msg = str(exc)
        blocked = "egress" in msg.lower() or "not allowed by this bundle" in msg.lower()
        _log_history(method, full_url, None)
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "blocked": blocked,
                "error": msg,
                "url": full_url,
            },
        )

    _log_history(method, full_url, status)
    return {
        "ok": True,
        "status": status,
        "headers": resp_headers,
        "body": text,
        "elapsed_ms": elapsed_ms,
        "url": full_url,
    }
