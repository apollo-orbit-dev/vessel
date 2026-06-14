"""Recipe box + meal planner — a FastAPI backend over stdlib sqlite3.

A real author-stack bundle: recipes (each with ingredients grouped by aisle), a
7-day meal plan, and the checked-state of shopping items all live in the SQLite
DB that travels inside the .vessel file, so everything survives a reopen.

A day can hold *multiple* meals: the plan is a list of (day, recipe) rows, so a
day stacks however many recipes you drop on it.

The showcase here is the shopping list: it is *not* stored. It is a derived
relational aggregation computed server-side from whatever recipes are planned —
join plan -> recipes -> ingredients across *all* planned meals, collapse
duplicate items per aisle into a count (×N), and order by aisle. That join +
group-by is the point of the tool.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI
dispatches *sync* (`def`) routes to a threadpool, which raises "can't start new
thread". Async routes run inline on the event loop. All SQL is parameterized.
"""

import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)
app = FastAPI()

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
AISLE_ORDER = ["Produce", "Meat", "Dairy", "Pantry", "Frozen"]

# (name, time_min, serves, [tags], [(ingredient, aisle), ...])
SEED_RECIPES = [
    ("Lamb & barley stew", 55, 4, ["hearty", "batch"],
     [("Lamb shoulder", "Meat"), ("Pearl barley", "Pantry"), ("Carrots", "Produce"),
      ("Onion", "Produce"), ("Thyme", "Produce")]),
    ("Arctic char, roast", 30, 2, ["fish", "quick"],
     [("Arctic char", "Meat"), ("Lemon", "Produce"), ("Dill", "Produce"),
      ("Baby potatoes", "Produce")]),
    ("Skyr flatbread", 25, 3, ["veg"],
     [("Skyr", "Dairy"), ("Flour", "Pantry"), ("Cucumber", "Produce"),
      ("Olive oil", "Pantry")]),
    ("Pea & mint soup", 20, 4, ["veg", "quick"],
     [("Frozen peas", "Frozen"), ("Mint", "Produce"), ("Onion", "Produce"),
      ("Stock", "Pantry")]),
    ("Rye pancakes", 20, 2, ["breakfast"],
     [("Rye flour", "Pantry"), ("Eggs", "Dairy"), ("Skyr", "Dairy"),
      ("Berries", "Produce")]),
    ("Mushroom risotto", 40, 3, ["veg"],
     [("Arborio rice", "Pantry"), ("Mushrooms", "Produce"), ("Onion", "Produce"),
      ("Parmesan", "Dairy"), ("Stock", "Pantry")]),
]
# Starter plan: (day_index, 1-based seed recipe index) pairs. A day may appear
# more than once (multiple meals); days not listed start empty.
SEED_PLAN = [(0, 1), (2, 2), (2, 3), (5, 6)]


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "CREATE TABLE IF NOT EXISTS recipes ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL, "
        "time_min INTEGER NOT NULL, "
        "serves INTEGER NOT NULL, "
        "tags TEXT NOT NULL DEFAULT '')"  # comma-separated
    )
    con.execute(
        "CREATE TABLE IF NOT EXISTS ingredients ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE, "
        "item TEXT NOT NULL, "
        "aisle TEXT NOT NULL)"
    )
    # One row per planned meal: a day can hold many. Deleting a recipe removes
    # its planned meals (ON DELETE CASCADE), which rebuilds the shopping list.
    con.execute(
        "CREATE TABLE IF NOT EXISTS plan ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "day_index INTEGER NOT NULL CHECK (day_index BETWEEN 0 AND 6), "
        "recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE)"
    )
    # Checked shopping items, keyed by the derived "aisle|item" string.
    con.execute(
        "CREATE TABLE IF NOT EXISTS checks ("
        "item_key TEXT PRIMARY KEY)"
    )

    # Seed recipes + a starter plan on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM recipes").fetchone()[0] == 0:
        ids = []
        for name, time_min, serves, tags, ing in SEED_RECIPES:
            rid = con.execute(
                "INSERT INTO recipes (name, time_min, serves, tags) VALUES (?, ?, ?, ?)",
                (name, time_min, serves, ",".join(tags)),
            ).lastrowid
            ids.append(rid)
            for item, aisle in ing:
                con.execute(
                    "INSERT INTO ingredients (recipe_id, item, aisle) VALUES (?, ?, ?)",
                    (rid, item, aisle),
                )
        for di, slot in SEED_PLAN:
            con.execute(
                "INSERT INTO plan (day_index, recipe_id) VALUES (?, ?)",
                (di, ids[slot - 1]),
            )
        con.commit()
    return con


def _aisle_rank(aisle: str) -> int:
    return AISLE_ORDER.index(aisle) if aisle in AISLE_ORDER else len(AISLE_ORDER)


def _recipes(con) -> list[dict]:
    out = []
    for rid, name, time_min, serves, tags in con.execute(
        "SELECT id, name, time_min, serves, tags FROM recipes ORDER BY id"
    ).fetchall():
        out.append({
            "id": rid,
            "name": name,
            "time": time_min,
            "serves": serves,
            "tags": [t for t in tags.split(",") if t],
        })
    return out


def _plan(con) -> list[dict]:
    """One entry per weekday, each carrying its (possibly several) planned meals
    in insertion order. An empty day has an empty `meals` list."""
    days = [{"day": DAYS[di], "day_index": di, "meals": []} for di in range(7)]
    for plan_id, di, rid, name, time_min, serves in con.execute(
        "SELECT p.id, p.day_index, r.id, r.name, r.time_min, r.serves "
        "FROM plan p JOIN recipes r ON r.id = p.recipe_id "
        "ORDER BY p.day_index, p.id"
    ).fetchall():
        days[di]["meals"].append({
            "plan_id": plan_id,
            "recipe_id": rid,
            "name": name,
            "time": time_min,
            "serves": serves,
        })
    return days


def _shopping(con) -> list[dict]:
    """Derived aggregation: join *all* planned meals -> ingredients, collapse
    duplicates per aisle into counts, order by aisle then item. A recipe planned
    on multiple days contributes its ingredients each time. The host never stores
    this."""
    rows = con.execute(
        "SELECT i.aisle AS aisle, i.item AS item, COUNT(*) AS n "
        "FROM plan p "
        "JOIN ingredients i ON i.recipe_id = p.recipe_id "
        "GROUP BY i.aisle, i.item"
    ).fetchall()
    checked = {r[0] for r in con.execute("SELECT item_key FROM checks").fetchall()}
    items = []
    for aisle, item, n in rows:
        key = aisle + "|" + item
        items.append({"key": key, "aisle": aisle, "item": item, "n": n, "checked": key in checked})
    items.sort(key=lambda x: (_aisle_rank(x["aisle"]), x["item"].lower()))
    # Prune stale checks for items no longer on the list.
    live = {x["key"] for x in items}
    stale = checked - live
    if stale:
        con.executemany("DELETE FROM checks WHERE item_key = ?", [(k,) for k in stale])
        con.commit()
    # Group into aisle sections, preserving aisle order.
    groups: list[dict] = []
    by_aisle: dict[str, list] = {}
    for x in items:
        by_aisle.setdefault(x["aisle"], []).append(x)
    for aisle in sorted(by_aisle, key=_aisle_rank):
        groups.append({"aisle": aisle, "items": by_aisle[aisle]})
    return groups


def _state(con) -> dict:
    shopping = _shopping(con)
    total = sum(len(g["items"]) for g in shopping)
    checked = sum(1 for g in shopping for x in g["items"] if x["checked"])
    return {
        "recipes": _recipes(con),
        "plan": _plan(con),
        "shopping": shopping,
        "checked_count": checked,
        "total_items": total,
        "aisles": list(AISLE_ORDER),  # additive: fixed aisle set for the recipe editor
    }


class PlanIn(BaseModel):
    day_index: int = Field(ge=0, le=6)
    recipe_id: int


class ToggleIn(BaseModel):
    item_key: str


class IngredientIn(BaseModel):
    item: str = Field(min_length=1, max_length=80)
    aisle: str

    @field_validator("item")
    @classmethod
    def _strip_item(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("ingredient item must not be empty")
        return v

    @field_validator("aisle")
    @classmethod
    def _check_aisle(cls, v: str) -> str:
        if v not in AISLE_ORDER:
            raise ValueError("aisle must be one of " + ", ".join(AISLE_ORDER))
        return v


class RecipeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    time: int = Field(gt=0, le=100000)
    serves: int = Field(gt=0, le=10000)
    tags: list[str] = Field(default_factory=list, max_length=12)
    ingredients: list[IngredientIn] = Field(default_factory=list, max_length=60)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be empty")
        return v

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, v: list[str]) -> list[str]:
        out = []
        for t in v:
            t = t.strip()[:24]
            # commas would corrupt the comma-joined tags column
            t = t.replace(",", " ").strip()
            if t:
                out.append(t)
        return out[:12]


@app.get("/api/state")
async def get_state():
    con = _con()
    try:
        return _state(con)
    finally:
        con.close()


@app.post("/api/plan")
async def plan_recipe(body: PlanIn):
    """Add a meal: drop a recipe onto a given day (days can hold several).
    Returns fresh state."""
    con = _con()
    try:
        exists = con.execute(
            "SELECT 1 FROM recipes WHERE id = ?", (body.recipe_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="recipe not found")
        con.execute(
            "INSERT INTO plan (day_index, recipe_id) VALUES (?, ?)",
            (body.day_index, body.recipe_id),
        )
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.delete("/api/plan/meal/{plan_id}")
async def remove_meal(plan_id: int):
    """Remove a single planned meal by its plan row id, then return fresh state."""
    con = _con()
    try:
        con.execute("DELETE FROM plan WHERE id = ?", (plan_id,))
        con.commit()
        return _state(con)
    finally:
        con.close()


def _write_ingredients(con, recipe_id: int, ingredients: list[IngredientIn]) -> None:
    """Replace a recipe's ingredient rows (parameterized inserts)."""
    con.execute("DELETE FROM ingredients WHERE recipe_id = ?", (recipe_id,))
    con.executemany(
        "INSERT INTO ingredients (recipe_id, item, aisle) VALUES (?, ?, ?)",
        [(recipe_id, ing.item, ing.aisle) for ing in ingredients],
    )


@app.post("/api/recipes")
async def create_recipe(body: RecipeIn):
    """Add a new recipe (with its ingredients), then return fresh state."""
    con = _con()
    try:
        rid = con.execute(
            "INSERT INTO recipes (name, time_min, serves, tags) VALUES (?, ?, ?, ?)",
            (body.name, body.time, body.serves, ",".join(body.tags)),
        ).lastrowid
        _write_ingredients(con, rid, body.ingredients)
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.put("/api/recipes/{recipe_id}")
async def update_recipe(recipe_id: int, body: RecipeIn):
    """Edit a recipe and replace its ingredient rows. The shopping list (derived
    from ingredients) rebuilds automatically; stale checks are pruned in _state."""
    con = _con()
    try:
        exists = con.execute(
            "SELECT 1 FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="recipe not found")
        con.execute(
            "UPDATE recipes SET name = ?, time_min = ?, serves = ?, tags = ? WHERE id = ?",
            (body.name, body.time, body.serves, ",".join(body.tags), recipe_id),
        )
        _write_ingredients(con, recipe_id, body.ingredients)
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.delete("/api/recipes/{recipe_id}")
async def delete_recipe(recipe_id: int):
    """Delete a recipe. Its planned meals are removed (plan.recipe_id ON DELETE
    CASCADE) and its ingredient rows cascade too, so the shopping list rebuilds."""
    con = _con()
    try:
        exists = con.execute(
            "SELECT 1 FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
        if exists is None:
            raise HTTPException(status_code=404, detail="recipe not found")
        con.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        con.commit()
        return _state(con)
    finally:
        con.close()


@app.get("/api/recipes/{recipe_id}")
async def get_recipe(recipe_id: int):
    """Full recipe incl. ingredient rows, for populating the editor."""
    con = _con()
    try:
        row = con.execute(
            "SELECT id, name, time_min, serves, tags FROM recipes WHERE id = ?",
            (recipe_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="recipe not found")
        ings = con.execute(
            "SELECT item, aisle FROM ingredients WHERE recipe_id = ? ORDER BY id",
            (recipe_id,),
        ).fetchall()
        return {
            "id": row[0],
            "name": row[1],
            "time": row[2],
            "serves": row[3],
            "tags": [t for t in row[4].split(",") if t],
            "ingredients": [{"item": i[0], "aisle": i[1]} for i in ings],
        }
    finally:
        con.close()


@app.post("/api/check")
async def toggle_check(body: ToggleIn):
    """Toggle a shopping item's checked state (persisted)."""
    con = _con()
    try:
        present = con.execute(
            "SELECT 1 FROM checks WHERE item_key = ?", (body.item_key,)
        ).fetchone()
        if present:
            con.execute("DELETE FROM checks WHERE item_key = ?", (body.item_key,))
        else:
            con.execute(
                "INSERT OR IGNORE INTO checks (item_key) VALUES (?)", (body.item_key,)
            )
        con.commit()
        return _state(con)
    finally:
        con.close()
