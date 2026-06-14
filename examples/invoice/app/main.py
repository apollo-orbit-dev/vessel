"""Invoice — a fully editable invoice template as an ordinary FastAPI app.

A signed publisher tool (Ledgerleaf). The whole invoice — issuer, billed-to,
dates, line items, and tax rate — lives in the bundle's SQLite file and is fully
editable: people use it to make their own invoices. The host bridges the UI's
fetch('/api/...') into this app inside Pyodide, and saves the SQLite DB back into
the .vessel on save, so every edit survives a reopen.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop. All SQLite access is
parameterized.
"""

import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    # A single invoice (id = 1) plus its ordered line items.
    con.execute(
        "CREATE TABLE IF NOT EXISTS invoice ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "number TEXT NOT NULL, "
        "status TEXT NOT NULL DEFAULT 'Draft', "
        "from_name TEXT NOT NULL, "
        "from_lines TEXT NOT NULL, "
        "bill_name TEXT NOT NULL, "
        "bill_lines TEXT NOT NULL, "
        "issued TEXT NOT NULL, "
        "due TEXT NOT NULL, "
        "tax_rate REAL NOT NULL DEFAULT 8, "
        "note TEXT NOT NULL DEFAULT '')"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS line_item ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "invoice_id INTEGER NOT NULL REFERENCES invoice(id) ON DELETE CASCADE, "
        "position INTEGER NOT NULL, "
        "descr TEXT NOT NULL, "
        "detail TEXT NOT NULL DEFAULT '', "
        "qty INTEGER NOT NULL DEFAULT 0, "
        "rate REAL NOT NULL DEFAULT 0)"
    )
    # Seed the invoice on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM invoice").fetchone()[0] == 0:
        con.execute(
            "INSERT INTO invoice "
            "(id, number, status, from_name, from_lines, bill_name, bill_lines, "
            "issued, due, tax_rate, note) "
            "VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "2026-014",
                "Draft",
                "North Light Studio",
                "Reykjavík · studio@northlight.is\nKt. 540617-0290",
                "Hótel Vík",
                "Klettsvegur 1-5, 870 Vík",
                "2026-06-13",
                "2026-06-27",
                8,
                "Payment within 14 days to Reikningur 0133-26-004812. "
                "Thank you — it was a beautiful night to shoot.",
            ),
        )
        seed = [
            ("Aurora shoot — full evening", "6 hours on location, Vík", 1, 1200),
            ("Drone coverage", "permit + flight, coastal", 1, 450),
            ("Editing & retouch", "per delivered photo", 40, 14),
            ("Travel — Ring Road", "fuel + vehicle, 2 days", 2, 180),
        ]
        for pos, (descr, detail, qty, rate) in enumerate(seed):
            con.execute(
                "INSERT INTO line_item (invoice_id, position, descr, detail, qty, rate) "
                "VALUES (1, ?, ?, ?, ?, ?)",
                (pos, descr, detail, qty, rate),
            )
        con.commit()
    return con


# ---- validation models (boundary validation) --------------------------------

# Caps keep a single document sane; they are not security boundaries (the DB is
# the user's own file) but bound the size of persisted text and the numbers.
_TEXT = 4000  # multi-line blocks (from/billed-to lines, note)
_LINE = 400   # single-line fields (names, number, status, dates, item desc/detail)


class QtyUpdate(BaseModel):
    qty: int = Field(ge=0, le=1_000_000)


class InvoiceUpdate(BaseModel):
    """Header / meta fields. All optional so the UI can patch one at a time."""

    number: str | None = Field(default=None, max_length=_LINE)
    status: str | None = Field(default=None, max_length=_LINE)
    from_name: str | None = Field(default=None, max_length=_LINE)
    from_lines: str | None = Field(default=None, max_length=_TEXT)
    bill_name: str | None = Field(default=None, max_length=_LINE)
    bill_lines: str | None = Field(default=None, max_length=_TEXT)
    issued: str | None = Field(default=None, max_length=_LINE)
    due: str | None = Field(default=None, max_length=_LINE)
    note: str | None = Field(default=None, max_length=_TEXT)
    tax_rate: float | None = Field(default=None, ge=0, le=100)


class ItemCreate(BaseModel):
    descr: str = Field(default="", max_length=_LINE)
    detail: str = Field(default="", max_length=_LINE)
    qty: int = Field(default=0, ge=0, le=1_000_000)
    rate: float = Field(default=0, ge=0, le=1_000_000_000)


class ItemUpdate(BaseModel):
    """Patch one or more fields of one line item. All optional."""

    descr: str | None = Field(default=None, max_length=_LINE)
    detail: str | None = Field(default=None, max_length=_LINE)
    qty: int | None = Field(default=None, ge=0, le=1_000_000)
    rate: float | None = Field(default=None, ge=0, le=1_000_000_000)


# Column allow-lists: only these may be written, and they map model field ->
# DB column. Building SQL from this fixed map (never from request data) keeps
# the queries parameterized and the column names trusted.
_INVOICE_COLS = {
    "number": "number",
    "status": "status",
    "from_name": "from_name",
    "from_lines": "from_lines",
    "bill_name": "bill_name",
    "bill_lines": "bill_lines",
    "issued": "issued",
    "due": "due",
    "note": "note",
    "tax_rate": "tax_rate",
}
_ITEM_COLS = {"descr": "descr", "detail": "detail", "qty": "qty", "rate": "rate"}


def _invoice_payload(con: sqlite3.Connection) -> dict:
    row = con.execute(
        "SELECT number, status, from_name, from_lines, bill_name, bill_lines, "
        "issued, due, tax_rate, note FROM invoice WHERE id = 1"
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="invoice not found")
    items = [
        {"id": r[0], "desc": r[1], "detail": r[2], "qty": r[3], "rate": r[4]}
        for r in con.execute(
            "SELECT id, descr, detail, qty, rate FROM line_item "
            "WHERE invoice_id = 1 ORDER BY position, id"
        ).fetchall()
    ]
    tax_rate = row[8]
    subtotal = sum(i["qty"] * i["rate"] for i in items)
    tax = subtotal * tax_rate / 100
    return {
        "number": row[0],
        "status": row[1],
        "from": {"name": row[2], "lines": row[3]},
        "billed_to": {"name": row[4], "lines": row[5]},
        "issued": row[6],
        "due": row[7],
        "tax_rate": tax_rate,
        "note": row[9],
        "items": items,
        "subtotal": subtotal,
        "tax": tax,
        "total": subtotal + tax,
    }


@app.get("/api/invoice")
async def get_invoice():
    con = _con()
    try:
        return _invoice_payload(con)
    finally:
        con.close()


@app.patch("/api/invoice")
async def patch_invoice(body: InvoiceUpdate):
    """Update any subset of the invoice header/meta fields (incl. tax_rate)."""
    fields = body.model_dump(exclude_unset=True)
    sets = []
    vals = []
    for name, value in fields.items():
        col = _INVOICE_COLS.get(name)
        if col is None:
            continue  # unknown field — ignore
        sets.append(f"{col} = ?")
        vals.append(value)
    con = _con()
    try:
        if sets:
            vals.append(1)
            con.execute(
                f"UPDATE invoice SET {', '.join(sets)} WHERE id = ?", vals
            )
            con.commit()
        return _invoice_payload(con)
    finally:
        con.close()


@app.put("/api/items/{item_id}/qty")
async def update_qty(item_id: int, body: QtyUpdate):
    con = _con()
    try:
        cur = con.execute(
            "UPDATE line_item SET qty = ? WHERE id = ? AND invoice_id = 1",
            (body.qty, item_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="line item not found")
        con.commit()
        return _invoice_payload(con)
    finally:
        con.close()


@app.patch("/api/items/{item_id}")
async def patch_item(item_id: int, body: ItemUpdate):
    """Update any subset of a line item's fields (descr/detail/qty/rate)."""
    fields = body.model_dump(exclude_unset=True)
    sets = []
    vals = []
    for name, value in fields.items():
        col = _ITEM_COLS.get(name)
        if col is None:
            continue
        sets.append(f"{col} = ?")
        vals.append(value)
    con = _con()
    try:
        if sets:
            vals.extend([item_id])
            cur = con.execute(
                f"UPDATE line_item SET {', '.join(sets)} "
                "WHERE id = ? AND invoice_id = 1",
                vals,
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="line item not found")
            con.commit()
        else:
            # No-op patch: still confirm the item exists.
            exists = con.execute(
                "SELECT 1 FROM line_item WHERE id = ? AND invoice_id = 1",
                (item_id,),
            ).fetchone()
            if exists is None:
                raise HTTPException(status_code=404, detail="line item not found")
        return _invoice_payload(con)
    finally:
        con.close()


@app.post("/api/items")
async def add_item(body: ItemCreate):
    """Append a new line item to the invoice."""
    con = _con()
    try:
        next_pos = con.execute(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM line_item WHERE invoice_id = 1"
        ).fetchone()[0]
        con.execute(
            "INSERT INTO line_item (invoice_id, position, descr, detail, qty, rate) "
            "VALUES (1, ?, ?, ?, ?, ?)",
            (next_pos, body.descr, body.detail, body.qty, body.rate),
        )
        con.commit()
        return _invoice_payload(con)
    finally:
        con.close()


@app.delete("/api/items/{item_id}")
async def delete_item(item_id: int):
    """Remove a line item from the invoice."""
    con = _con()
    try:
        cur = con.execute(
            "DELETE FROM line_item WHERE id = ? AND invoice_id = 1",
            (item_id,),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="line item not found")
        con.commit()
        return _invoice_payload(con)
    finally:
        con.close()
