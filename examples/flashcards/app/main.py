"""Flashcards — a spaced-repetition deck as an ordinary FastAPI app.

A real author-stack bundle: FastAPI + stdlib sqlite3. The deck of cards AND each
card's SM-2 scheduling state (ease factor, interval, repetitions, due date) live
in SQLite and travel inside the .vessel file — so your progress survives a reopen
and the whole deck is something you can hand to a study buddy.

The host bridges the UI's fetch('/api/...') into this app inside Pyodide (see
host/src/bridge.ts, runtime.ts). All SQLite access uses parameterized queries.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop.

SM-2 (SuperMemo 2) scheduling
-----------------------------
Each card carries `ease` (ease factor, min 1.3), `interval` (days until next due),
`reps` (consecutive correct reviews), and `due` (a date string, YYYY-MM-DD). A
rating maps to a SuperMemo quality q in {Again:2, Hard:3, Good:4, Easy:5}; q < 3
resets the card to be relearned, q >= 3 advances it. This is the classic SM-2
formula, kept deliberately readable.
"""

import datetime
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, constr

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

# Rating -> SuperMemo quality grade. Same order the UI shows them in.
QUALITY = {"again": 2, "hard": 3, "good": 4, "easy": 5}

# An Icelandic travel deck — 32 cards, mirroring the prototype's persona.
SEED_DECK = "Icelandic — travel deck"
SEED_CARDS = [
    ("Takk fyrir", "Thank you", "“tahk FIH-rir” — also just “takk”."),
    ("Góðan daginn", "Good day / hello", "Daytime greeting; “góða nótt” at night."),
    ("Afsakið", "Excuse me", "To get attention or apologise politely."),
    ("Hvað kostar þetta?", "How much is this?", "Lit. “what costs this?”"),
    ("Ég skil ekki", "I don’t understand", "“yeh skil EH-kih.”"),
    ("Hvar er …?", "Where is …?", "Hvar er klósettið? — Where is the toilet?"),
    ("Já", "Yes", "“yow” — short and bright."),
    ("Nei", "No", "“nay.”"),
    ("Góða nótt", "Good night", "Said when parting at night."),
    ("Bless", "Goodbye", "Casual; “bless bless” is common."),
    ("Gerðu svo vel", "Here you go / please", "Offering something, or “you’re welcome”."),
    ("Fyrirgefðu", "Sorry / forgive me", "Apology, stronger than afsakið."),
    ("Talar þú ensku?", "Do you speak English?", "“TAH-lar thoo EN-skoo?”"),
    ("Ég heiti …", "My name is …", "Introduce yourself."),
    ("Hvað heitir þú?", "What is your name?", "Friendly, informal þú."),
    ("Vatn", "Water", "Tap water in Iceland is excellent."),
    ("Kaffi", "Coffee", "An Icelandic staple."),
    ("Bjór", "Beer", "“byohr.”"),
    ("Matur", "Food", "General word for food/meal."),
    ("Reikninginn, takk", "The bill, please", "At a café or restaurant."),
    ("Þetta er gott", "This is good", "Compliment a meal."),
    ("Hjálp!", "Help!", "Emergency; dial 112."),
    ("Lögregla", "Police", "“LUR-greg-la.”"),
    ("Sjúkrahús", "Hospital", "“SYOO-kra-hoos.”"),
    ("Flugvöllur", "Airport", "Keflavík is the main one."),
    ("Rúta", "Bus / coach", "Long-distance bus."),
    ("Sundlaug", "Swimming pool", "Geothermal pools are a daily ritual."),
    ("Norðurljós", "Northern lights", "“NOR-thur-lyohs.”"),
    ("Foss", "Waterfall", "As in Gullfoss, Skógafoss."),
    ("Jökull", "Glacier", "As in Vatnajökull."),
    ("Hver", "Hot spring", "Also “who” in another context."),
    ("Verið velkomin", "Welcome (to you all)", "Plural/polite welcome."),
]


def _today() -> str:
    return datetime.date.today().isoformat()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS deck ("
        "id INTEGER PRIMARY KEY CHECK (id = 1), "
        "name TEXT NOT NULL, "
        "streak INTEGER NOT NULL DEFAULT 0, "
        "studied_on TEXT)"  # last date a review happened (drives streak)
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS cards ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "position INTEGER NOT NULL, "
        "front TEXT NOT NULL, "
        "back TEXT NOT NULL, "
        "note TEXT NOT NULL DEFAULT '', "
        "ease REAL NOT NULL DEFAULT 2.5, "
        "interval INTEGER NOT NULL DEFAULT 0, "
        "reps INTEGER NOT NULL DEFAULT 0, "
        "due TEXT NOT NULL, "
        "last_rating TEXT)"
    )
    # Seed the deck on first open (empty DB). All new cards are due today.
    if con.execute("SELECT COUNT(*) FROM cards").fetchone()[0] == 0:
        today = _today()
        con.execute(
            "INSERT OR REPLACE INTO deck (id, name, streak, studied_on) VALUES (1, ?, 0, NULL)",
            (SEED_DECK,),
        )
        for pos, (front, back, note) in enumerate(SEED_CARDS):
            con.execute(
                "INSERT INTO cards (position, front, back, note, due) VALUES (?, ?, ?, ?, ?)",
                (pos, front, back, note, today),
            )
        con.commit()
    return con


def _sm2(ease: float, interval: int, reps: int, quality: int):
    """Classic SM-2 step. Returns (ease, interval_days, reps)."""
    if quality < 3:
        # Failed recall: relearn from the start, soonest possible.
        reps = 0
        interval = 0
    else:
        if reps == 0:
            interval = 1
        elif reps == 1:
            interval = 6
        else:
            interval = round(interval * ease)
        reps += 1
    # Ease-factor update (same for pass/fail), floored at 1.3.
    ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    if ease < 1.3:
        ease = 1.3
    return round(ease, 4), int(interval), int(reps)


def _due_count(con: sqlite3.Connection) -> int:
    return con.execute("SELECT COUNT(*) FROM cards WHERE due <= ?", (_today(),)).fetchone()[0]


def _interval_label(days: int) -> str:
    if days <= 0:
        return "<1 day"
    if days == 1:
        return "1 day"
    return f"{days} days"


def _preview_intervals(card: sqlite3.Row) -> dict:
    """What the next interval would be for each rating — shown under the buttons."""
    out = {}
    for rating, q in QUALITY.items():
        _e, ivl, _r = _sm2(card["ease"], card["interval"], card["reps"], q)
        out[rating] = _interval_label(ivl)
    return out


def _state(con: sqlite3.Connection) -> dict:
    con.row_factory = sqlite3.Row
    deck = con.execute("SELECT name, streak, studied_on FROM deck WHERE id = 1").fetchone()
    total = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    due = _due_count(con)
    done_today = total - due  # cards no longer due today = progress through the session
    card_row = con.execute(
        "SELECT id, front, back, note, ease, interval, reps FROM cards "
        "WHERE due <= ? ORDER BY due, position LIMIT 1",
        (_today(),),
    ).fetchone()
    card = None
    if card_row is not None:
        card = {
            "id": card_row["id"],
            "front": card_row["front"],
            "back": card_row["back"],
            "note": card_row["note"],
            "intervals": _preview_intervals(card_row),
        }
    return {
        "deck": deck["name"] if deck else SEED_DECK,
        "total": total,
        "due": due,
        "done": max(0, done_today),
        "streak": deck["streak"] if deck else 0,
        "card": card,
    }


class Rating(BaseModel):
    card_id: int
    rating: str  # one of QUALITY's keys


# Length caps keep a single card (and the whole deck) from ballooning the bundle;
# they also bound what the UI has to render. front/back are required and non-empty.
class CardIn(BaseModel):
    front: constr(strip_whitespace=True, min_length=1, max_length=200)
    back: constr(strip_whitespace=True, min_length=1, max_length=200)
    note: constr(strip_whitespace=True, max_length=500) = ""


class CardEdit(CardIn):
    card_id: int


class CardId(BaseModel):
    card_id: int


class DeckName(BaseModel):
    name: constr(strip_whitespace=True, min_length=1, max_length=200)


def _cards_list(con: sqlite3.Connection) -> list:
    con.row_factory = sqlite3.Row
    today = _today()
    rows = con.execute(
        "SELECT id, front, back, note, due, reps, interval FROM cards ORDER BY position, id"
    ).fetchall()
    out = []
    for row in rows:
        out.append(
            {
                "id": row["id"],
                "front": row["front"],
                "back": row["back"],
                "note": row["note"],
                "due": row["due"],
                "due_today": row["due"] <= today,
                "reps": row["reps"],
                "interval": row["interval"],
            }
        )
    return out


@app.get("/api/state")
async def get_state():
    con = _con()
    try:
        return _state(con)
    finally:
        con.close()


@app.post("/api/rate")
async def rate_card(r: Rating):
    if r.rating not in QUALITY:
        raise HTTPException(status_code=400, detail="invalid rating")
    con = _con()
    try:
        con.row_factory = sqlite3.Row
        card = con.execute(
            "SELECT id, ease, interval, reps FROM cards WHERE id = ?", (r.card_id,)
        ).fetchone()
        if card is None:
            raise HTTPException(status_code=404, detail="card not found")
        ease, interval, reps = _sm2(card["ease"], card["interval"], card["reps"], QUALITY[r.rating])
        # A failed card (interval 0) stays due today; a passed card moves out.
        due = (datetime.date.today() + datetime.timedelta(days=interval)).isoformat()
        con.execute(
            "UPDATE cards SET ease = ?, interval = ?, reps = ?, due = ?, last_rating = ? WHERE id = ?",
            (ease, interval, reps, due, r.rating, r.card_id),
        )
        # Streak: bump once per calendar day on the first review of the day.
        deck = con.execute("SELECT streak, studied_on FROM deck WHERE id = 1").fetchone()
        today = _today()
        if deck["studied_on"] != today:
            yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
            new_streak = deck["streak"] + 1 if deck["studied_on"] == yesterday else 1
            con.execute(
                "UPDATE deck SET streak = ?, studied_on = ? WHERE id = 1", (new_streak, today)
            )
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.post("/api/reset")
async def reset_progress():
    """Re-schedule every card to today and clear the session — start the deck over."""
    con = _con()
    try:
        today = _today()
        con.execute(
            "UPDATE cards SET ease = 2.5, interval = 0, reps = 0, due = ?, last_rating = NULL",
            (today,),
        )
        con.execute("UPDATE deck SET streak = 0, studied_on = NULL WHERE id = 1")
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.get("/api/cards")
async def list_cards():
    """The manage view: every card, in deck order, with its schedule status."""
    con = _con()
    try:
        return {"cards": _cards_list(con)}
    finally:
        con.close()


@app.post("/api/cards")
async def add_card(c: CardIn):
    """Add a card at the end of the deck, scheduled due today (a fresh SM-2 card)."""
    con = _con()
    try:
        today = _today()
        pos = con.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM cards").fetchone()[0]
        con.execute(
            "INSERT INTO cards (position, front, back, note, due) VALUES (?, ?, ?, ?, ?)",
            (pos, c.front, c.back, c.note, today),
        )
        con.commit()
        return {"cards": _cards_list(con)}
    finally:
        con.close()


@app.post("/api/cards/edit")
async def edit_card(c: CardEdit):
    """Edit a card's text. SM-2 schedule (ease/interval/reps/due) is left untouched —
    editing wording shouldn't penalise or reset what you've already learned."""
    con = _con()
    try:
        cur = con.execute(
            "UPDATE cards SET front = ?, back = ?, note = ? WHERE id = ?",
            (c.front, c.back, c.note, c.card_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="card not found")
        con.commit()
        return {"cards": _cards_list(con)}
    finally:
        con.close()


@app.post("/api/cards/delete")
async def delete_card(c: CardId):
    """Remove a card from the deck."""
    con = _con()
    try:
        cur = con.execute("DELETE FROM cards WHERE id = ?", (c.card_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="card not found")
        con.commit()
        return {"cards": _cards_list(con)}
    finally:
        con.close()


@app.post("/api/deck/rename")
async def rename_deck(d: DeckName):
    """Rename the single deck."""
    con = _con()
    try:
        con.execute("UPDATE deck SET name = ? WHERE id = 1", (d.name,))
        con.commit()
        return _state(con)
    finally:
        con.close()
