"""Budget — a personal budget tracker as an ordinary FastAPI app.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it would
be against a normal server. The host bridges the UI's fetch('/api/...') into this
app inside Pyodide (see host/src/bridge.ts, runtime.ts). Categories and
transactions live in SQLite and survive reopen; the design prototype kept them in
JS constants, here they are persisted into the .vessel file. All SQLite access
uses parameterized queries.

The privacy pitch: financial data lives inside this one file and never touches a
server — the backend runs entirely in the browser's WASM sandbox.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop.

Each transaction carries a real ISO date (`tx_date`, YYYY-MM-DD). The month a
transaction belongs to is derived from that date (`substr(tx_date, 1, 7)` =>
YYYY-MM). The UI selects a month and the summary, category bars, and list all
reflect the selected month.
"""

import sqlite3

from datetime import date

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Default monthly budget context (the design's "June 2026 · personal"). These are
# now persisted in the `settings` table and editable via PUT /api/settings; the
# constants below only seed an empty DB.
MONTHLY_BUDGET = 2800
PROJECTION = 2780  # forecast cap for the current month
PERIOD_LABEL = "personal"

# Allowed per-category hues (oklch H) the UI offers as a ramp. Validated at the
# boundary so a category can't carry an arbitrary hue.
ALLOWED_HUES = [230, 95, 255, 155, 300, 25, 60, 200, 130, 330]

# Per-category hue (oklch H) — mirrors the prototype's PB_CATS ramp.
SEED_CATEGORIES = [
    ("Housing", 230),
    ("Food", 95),
    ("Transport", 255),
    ("Health", 155),
    ("Fun", 300),
]

# Seed transactions across three months (Apr/May/Jun 2026) so switching months is
# meaningful. (tx_date ISO, merchant, category, amount).
SEED_TX = [
    # June 2026
    ("2026-06-12", "Whole Foods", "Food", 84),
    ("2026-06-11", "Rent — June", "Housing", 1450),
    ("2026-06-11", "Shell — fuel", "Transport", 52),
    ("2026-06-10", "Climbing gym", "Health", 65),
    ("2026-06-09", "Sushi — Friday", "Fun", 58),
    ("2026-06-08", "Trader Joe’s", "Food", 112),
    ("2026-06-07", "Concert tickets", "Fun", 96),
    ("2026-06-06", "Monthly bus pass", "Transport", 78),
    ("2026-06-05", "Electric bill", "Housing", 74),
    ("2026-06-04", "Pharmacy", "Health", 26),
    ("2026-06-03", "Streaming bundle", "Fun", 31),
    ("2026-06-02", "Coffee beans", "Food", 22),
    # May 2026
    ("2026-05-28", "Rent — May", "Housing", 1450),
    ("2026-05-26", "Costco run", "Food", 184),
    ("2026-05-22", "Dentist", "Health", 140),
    ("2026-05-19", "Gas — road trip", "Transport", 96),
    ("2026-05-15", "Farmers market", "Food", 47),
    ("2026-05-11", "Movie night", "Fun", 38),
    ("2026-05-06", "Electric bill", "Housing", 71),
    ("2026-05-03", "Train tickets", "Transport", 64),
    # April 2026
    ("2026-04-29", "Rent — April", "Housing", 1450),
    ("2026-04-24", "Grocery haul", "Food", 156),
    ("2026-04-20", "Yoga membership", "Health", 89),
    ("2026-04-16", "Weekend getaway", "Fun", 210),
    ("2026-04-10", "Electric bill", "Housing", 68),
    ("2026-04-04", "Bus pass", "Transport", 78),
]

# 6-month spend trend (the prototype's PB_TREND). Static history for the chart —
# the early months that predate the seeded transactions.
SEED_TREND = [
    ("Jan", 2360),
    ("Feb", 2210),
    ("Mar", 2540),
]


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS categories ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL UNIQUE, "
        "hue INTEGER NOT NULL)"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS transactions ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "tx_date TEXT NOT NULL, "
        "merchant TEXT NOT NULL, "
        "category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, "
        "amount INTEGER NOT NULL CHECK (amount >= 0), "
        "created_at TEXT NOT NULL DEFAULT (datetime('now')))"
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS trend ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "month TEXT NOT NULL, "
        "amount INTEGER NOT NULL)"
    )
    # Single-row settings: monthly budget, forecast projection, and period label.
    con.execute(
        "CREATE TABLE IF NOT EXISTS settings ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "budget INTEGER NOT NULL CHECK (budget >= 0), "
        "projection INTEGER NOT NULL CHECK (projection >= 0), "
        "period TEXT NOT NULL)"
    )
    con.execute(
        "INSERT OR IGNORE INTO settings (id, budget, projection, period) VALUES (1, ?, ?, ?)",
        (MONTHLY_BUDGET, PROJECTION, PERIOD_LABEL),
    )
    # Seed everything on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM categories").fetchone()[0] == 0:
        cat_id = {}
        for name, hue in SEED_CATEGORIES:
            cat_id[name] = con.execute(
                "INSERT INTO categories (name, hue) VALUES (?, ?)", (name, hue)
            ).lastrowid
        for tx_date, merchant, cat, amount in SEED_TX:
            con.execute(
                "INSERT INTO transactions (tx_date, merchant, category_id, amount) "
                "VALUES (?, ?, ?, ?)",
                (tx_date, merchant, cat_id[cat], amount),
            )
        for month, amount in SEED_TREND:
            con.execute("INSERT INTO trend (month, amount) VALUES (?, ?)", (month, amount))
        con.commit()
    return con


# Three-letter month abbreviations for the trend chart labels.
_MONTH_ABBR = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]


def _month_abbr(month: str) -> str:
    """`'2026-06'` -> `'Jun'` (best-effort; falls back to the raw string)."""
    try:
        return _MONTH_ABBR[int(month[5:7]) - 1]
    except (ValueError, IndexError):
        return month


def _month_label(month: str) -> str:
    """`'2026-06'` -> `'June 2026'`."""
    full = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ]
    try:
        return f"{full[int(month[5:7]) - 1]} {month[0:4]}"
    except (ValueError, IndexError):
        return month


class TxIn(BaseModel):
    # A real ISO date (YYYY-MM-DD). Pydantic's `date` parses+validates it at the
    # boundary; the transaction's month is derived from it server-side.
    tx_date: date
    merchant: str = Field(min_length=1, max_length=120)
    category_id: int = Field(ge=1)
    amount: int = Field(ge=0, le=10_000_000)


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    hue: int = Field(ge=0, le=360)


class CategoryRename(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    hue: int = Field(ge=0, le=360)


class SettingsIn(BaseModel):
    budget: int = Field(ge=0, le=10_000_000)
    period: str = Field(min_length=1, max_length=120)


def _categories(con: sqlite3.Connection) -> list[dict]:
    rows = con.execute("SELECT id, name, hue FROM categories ORDER BY id").fetchall()
    return [{"id": r[0], "name": r[1], "hue": r[2]} for r in rows]


def _settings(con: sqlite3.Connection) -> dict:
    r = con.execute("SELECT budget, projection, period FROM settings WHERE id = 1").fetchone()
    return {"budget": r[0], "projection": r[1], "period": r[2]}


def _months(con: sqlite3.Connection) -> list[str]:
    """Distinct YYYY-MM months that have transactions, newest first."""
    rows = con.execute(
        "SELECT DISTINCT substr(tx_date, 1, 7) AS m FROM transactions ORDER BY m DESC"
    ).fetchall()
    return [r[0] for r in rows]


@app.get("/api/state")
async def get_state(month: str | None = None):
    """Everything the UI needs in one call, scoped to a single month.

    `?month=YYYY-MM` selects the month; omitting it defaults to the latest month
    that has transactions. The summary, category bars, and transaction list all
    reflect the selected month; the 6-month trend chart spans recent months and
    highlights the selected one when present.
    """
    con = _con()
    cfg = _settings(con)
    budget = cfg["budget"]
    projection = cfg["projection"]
    cats = _categories(con)

    months = _months(con)
    # Validate the requested month against the set with data; otherwise default to
    # the latest month (or current month if the DB is somehow empty).
    if month is not None and month in months:
        selected = month
    elif months:
        selected = months[0]
    else:
        selected = date.today().strftime("%Y-%m")

    tx_rows = con.execute(
        "SELECT t.id, t.tx_date, t.merchant, t.category_id, c.name, c.hue, t.amount "
        "FROM transactions t JOIN categories c ON c.id = t.category_id "
        "WHERE substr(t.tx_date, 1, 7) = ? "
        "ORDER BY t.tx_date DESC, t.id DESC",
        (selected,),
    ).fetchall()
    transactions = [
        {
            "id": r[0],
            "date": r[1],
            "day": _day_label(r[1]),
            "merchant": r[2],
            "category_id": r[3],
            "category": r[4],
            "hue": r[5],
            "amount": r[6],
        }
        for r in tx_rows
    ]

    # By-category totals for the selected month (descending), aggregated in SQL.
    by_cat_rows = con.execute(
        "SELECT c.name, c.hue, COALESCE(SUM(t.amount), 0) AS total "
        "FROM categories c LEFT JOIN transactions t "
        "  ON t.category_id = c.id AND substr(t.tx_date, 1, 7) = ? "
        "GROUP BY c.id ORDER BY total DESC",
        (selected,),
    ).fetchall()
    by_category = [
        {"name": r[0], "hue": r[1], "amount": r[2]} for r in by_cat_rows if r[2] > 0
    ]

    spent = con.execute(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE substr(tx_date, 1, 7) = ?",
        (selected,),
    ).fetchone()[0]

    # Per-month totals from transactions, oldest first, for the trend chart.
    month_totals = {
        r[0]: r[1]
        for r in con.execute(
            "SELECT substr(tx_date, 1, 7) AS m, SUM(amount) "
            "FROM transactions GROUP BY m"
        ).fetchall()
    }

    # Trend: stored static history (pre-seed months) + the live per-month totals.
    trend = [
        {"month": r[0], "amount": r[1], "key": None, "current": False}
        for r in con.execute("SELECT month, amount FROM trend ORDER BY id").fetchall()
    ]
    for m in sorted(month_totals):
        trend.append(
            {
                "month": _month_abbr(m),
                "amount": month_totals[m],
                "key": m,
                "current": m == selected,
            }
        )

    con.close()
    return {
        "period": cfg["period"],
        "month": selected,
        "month_label": _month_label(selected),
        "months": months,
        "budget": budget,
        "projection": projection,
        "spent": spent,
        "left": budget - spent,
        "categories": cats,
        "transactions": transactions,
        "by_category": by_category,
        "trend": trend,
        "allowed_hues": ALLOWED_HUES,
    }


def _day_label(iso: str) -> str:
    """`'2026-06-12'` -> `'Jun 12'` for compact display in the list."""
    try:
        return f"{_month_abbr(iso[0:7])} {int(iso[8:10]):02d}"
    except (ValueError, IndexError):
        return iso


@app.post("/api/transactions")
async def add_transaction(tx: TxIn):
    con = _con()
    exists = con.execute(
        "SELECT 1 FROM categories WHERE id = ?", (tx.category_id,)
    ).fetchone()
    if exists is None:
        con.close()
        raise HTTPException(status_code=400, detail="unknown category")
    tx_id = con.execute(
        "INSERT INTO transactions (tx_date, merchant, category_id, amount) "
        "VALUES (?, ?, ?, ?)",
        (tx.tx_date.isoformat(), tx.merchant, tx.category_id, tx.amount),
    ).lastrowid
    con.commit()
    con.close()
    return {"id": tx_id, "ok": True}


@app.put("/api/transactions/{tx_id}")
async def edit_transaction(tx_id: int, tx: TxIn):
    con = _con()
    if con.execute("SELECT 1 FROM transactions WHERE id = ?", (tx_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="unknown transaction")
    if con.execute("SELECT 1 FROM categories WHERE id = ?", (tx.category_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=400, detail="unknown category")
    con.execute(
        "UPDATE transactions SET tx_date = ?, merchant = ?, category_id = ?, amount = ? "
        "WHERE id = ?",
        (tx.tx_date.isoformat(), tx.merchant, tx.category_id, tx.amount, tx_id),
    )
    con.commit()
    con.close()
    return {"ok": True}


@app.delete("/api/transactions/{tx_id}")
async def delete_transaction(tx_id: int):
    con = _con()
    con.execute("DELETE FROM transactions WHERE id = ?", (tx_id,))
    con.commit()
    con.close()
    return {"ok": True}


@app.post("/api/categories")
async def add_category(cat: CategoryIn):
    if cat.hue not in ALLOWED_HUES:
        raise HTTPException(status_code=400, detail="hue not in allowed ramp")
    con = _con()
    name = cat.name.strip()
    if not name:
        con.close()
        raise HTTPException(status_code=400, detail="name required")
    if con.execute(
        "SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE", (name,)
    ).fetchone():
        con.close()
        raise HTTPException(status_code=409, detail="a category with that name already exists")
    cat_id = con.execute(
        "INSERT INTO categories (name, hue) VALUES (?, ?)", (name, cat.hue)
    ).lastrowid
    con.commit()
    con.close()
    return {"id": cat_id, "ok": True}


@app.put("/api/categories/{cat_id}")
async def rename_category(cat_id: int, cat: CategoryRename):
    if cat.hue not in ALLOWED_HUES:
        raise HTTPException(status_code=400, detail="hue not in allowed ramp")
    con = _con()
    name = cat.name.strip()
    if not name:
        con.close()
        raise HTTPException(status_code=400, detail="name required")
    if con.execute("SELECT 1 FROM categories WHERE id = ?", (cat_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="unknown category")
    if con.execute(
        "SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND id != ?", (name, cat_id)
    ).fetchone():
        con.close()
        raise HTTPException(status_code=409, detail="a category with that name already exists")
    con.execute(
        "UPDATE categories SET name = ?, hue = ? WHERE id = ?", (name, cat.hue, cat_id)
    )
    con.commit()
    con.close()
    return {"ok": True}


@app.delete("/api/categories/{cat_id}")
async def delete_category(cat_id: int):
    """Delete a category. Blocked if any transaction still references it — the
    user must reassign or remove those transactions first. Chosen over cascade
    so a rename/hue mistake can't silently wipe spending history."""
    con = _con()
    if con.execute("SELECT 1 FROM categories WHERE id = ?", (cat_id,)).fetchone() is None:
        con.close()
        raise HTTPException(status_code=404, detail="unknown category")
    used = con.execute(
        "SELECT COUNT(*) FROM transactions WHERE category_id = ?", (cat_id,)
    ).fetchone()[0]
    if used:
        con.close()
        raise HTTPException(
            status_code=409,
            detail=f"category is used by {used} transaction(s) — reassign or delete them first",
        )
    con.execute("DELETE FROM categories WHERE id = ?", (cat_id,))
    con.commit()
    con.close()
    return {"ok": True}


@app.put("/api/settings")
async def update_settings(s: SettingsIn):
    con = _con()
    period = s.period.strip()
    if not period:
        con.close()
        raise HTTPException(status_code=400, detail="period required")
    con.execute(
        "UPDATE settings SET budget = ?, period = ? WHERE id = 1", (s.budget, period)
    )
    con.commit()
    con.close()
    return {"ok": True}
