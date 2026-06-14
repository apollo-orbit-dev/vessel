"""Job Tracker — a pipeline board (Applied → Screen → Onsite → Offer) as a FastAPI app.

A real author-stack bundle: FastAPI + stdlib sqlite3, written exactly as it would be
against a normal server. The host bridges the UI's fetch('/api/...') into this app
inside Pyodide. Each job application is a row with a `stage` index; advancing a card
bumps that index and persists it back into the .vessel file — so a card you advanced
stays advanced after you close and reopen the bundle.

Beyond the advance chevron, the board supports full CRUD: add a job, edit it (company,
role, follow-up text/date, overdue flag), delete it, and move it to ANY stage (not just
advance-by-one). Every mutation persists back into the bundle and survives reopen.

Routes are `async def` on purpose: Pyodide has no OS threads, and FastAPI dispatches
*sync* (`def`) routes to a threadpool, which raises "can't start new thread". Async
routes run inline on the event loop. All SQLite access uses parameterized queries.
"""

import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

DB = "data/store.sqlite"  # relative to the bundle root (the bridge chdir's into /bundle)

STAGES = ["Applied", "Screen", "Onsite", "Offer"]
LAST_STAGE = len(STAGES) - 1
VALID_STAGES = set(range(len(STAGES)))  # allowlist: {0, 1, 2, 3}

# Length caps for user-supplied text (validated at the boundary by Pydantic).
COMPANY_MAX = 120
ROLE_MAX = 120
FOLLOW_MAX = 120
HUE_MIN, HUE_MAX = 0, 360
DAYS_MAX = 3650  # ~10 years; a sane ceiling so "days ago" can't be absurd

app = FastAPI()


def _con() -> sqlite3.Connection:
    con = sqlite3.connect(DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS jobs ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "company TEXT NOT NULL, "
        "role TEXT NOT NULL DEFAULT '', "
        "hue INTEGER NOT NULL DEFAULT 230, "
        "stage INTEGER NOT NULL DEFAULT 0, "
        "days INTEGER NOT NULL DEFAULT 0, "
        "follow TEXT, "
        "overdue INTEGER NOT NULL DEFAULT 0)"
    )
    # Seed a board of applications across stages on first open (empty DB).
    if con.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0:
        seed = [
            # company,      role,                 hue, stage, days, follow,                overdue
            ("Datasette",   "Founding engineer",  230, 2, 18, "Thank-you note",     0),
            ("Recurse",     "Tooling, contract",  155, 1,  9, "Reply to recruiter", 1),
            ("Fly.io",      "Platform eng",        25, 0,  4, None,                 0),
            ("Val Town",    "Full-stack",         300, 3, 27, "Review offer",       0),
            ("Observable",  "Frontend",           200, 0,  2, None,                 0),
            ("Replicate",   "ML infra",            40, 1, 14, "Take-home due",      0),
            ("Hex",         "Data apps",          280, 2, 21, "Schedule onsite",    0),
        ]
        con.executemany(
            "INSERT INTO jobs (company, role, hue, stage, days, follow, overdue) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            seed,
        )
        con.commit()
    return con


def _job_dict(row) -> dict:
    return {
        "id": row[0],
        "company": row[1],
        "role": row[2],
        "hue": row[3],
        "stage": row[4],
        "days": row[5],
        "follow": row[6],
        "overdue": bool(row[7]),
    }


def _norm_follow(value):
    """Trim a follow-up string; empty/whitespace → None (no chip)."""
    if value is None:
        return None
    value = value.strip()
    return value or None


class AdvanceIn(BaseModel):
    id: int


class MoveIn(BaseModel):
    id: int
    stage: int

    @field_validator("stage")
    @classmethod
    def stage_in_allowlist(cls, v: int) -> int:
        if v not in VALID_STAGES:
            raise ValueError(f"stage must be one of {sorted(VALID_STAGES)}")
        return v


class JobIn(BaseModel):
    """Create/edit payload. Company is required & non-empty; everything else is
    bounded. `stage` is validated against the allowlist."""

    company: str = Field(min_length=1, max_length=COMPANY_MAX)
    role: str = Field(default="", max_length=ROLE_MAX)
    hue: int = Field(default=230, ge=HUE_MIN, le=HUE_MAX)
    stage: int = Field(default=0)
    days: int = Field(default=0, ge=0, le=DAYS_MAX)
    follow: str | None = Field(default=None, max_length=FOLLOW_MAX)
    overdue: bool = Field(default=False)

    @field_validator("company")
    @classmethod
    def company_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("company must not be blank")
        return v

    @field_validator("role")
    @classmethod
    def role_trim(cls, v: str) -> str:
        return v.strip()

    @field_validator("stage")
    @classmethod
    def stage_in_allowlist(cls, v: int) -> int:
        if v not in VALID_STAGES:
            raise ValueError(f"stage must be one of {sorted(VALID_STAGES)}")
        return v


@app.get("/api/board")
async def get_board():
    """Return the stage labels, the jobs grouped by stage, and per-stage counts."""
    con = _con()
    rows = con.execute(
        "SELECT id, company, role, hue, stage, days, follow, overdue "
        "FROM jobs ORDER BY days ASC, id ASC"
    ).fetchall()
    con.close()

    columns = [{"stage": s, "index": i, "jobs": []} for i, s in enumerate(STAGES)]
    for row in rows:
        job = _job_dict(row)
        si = job["stage"]
        if 0 <= si < len(columns):
            columns[si]["jobs"].append(job)
    counts = [len(c["jobs"]) for c in columns]
    return {"stages": STAGES, "columns": columns, "counts": counts}


@app.post("/api/advance")
async def advance_job(body: AdvanceIn):
    """Advance a job to the next stage and persist it. Offer (last stage) is a no-op."""
    con = _con()
    row = con.execute("SELECT stage FROM jobs WHERE id = ?", (body.id,)).fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail="job not found")

    stage = row[0]
    if stage >= LAST_STAGE:
        con.close()
        return {"ok": True, "stage": stage}

    new_stage = stage + 1
    # On reaching Offer, surface a "Review offer" follow-up; advancing clears overdue.
    if new_stage == LAST_STAGE:
        con.execute(
            "UPDATE jobs SET stage = ?, follow = ?, overdue = 0 WHERE id = ?",
            (new_stage, "Review offer", body.id),
        )
    else:
        con.execute(
            "UPDATE jobs SET stage = ?, overdue = 0 WHERE id = ?",
            (new_stage, body.id),
        )
    con.commit()
    con.close()
    return {"ok": True, "stage": new_stage}


@app.post("/api/move")
async def move_job(body: MoveIn):
    """Move a job to ANY stage (0..3), not just advance-by-one. Persists."""
    con = _con()
    row = con.execute("SELECT stage FROM jobs WHERE id = ?", (body.id,)).fetchone()
    if row is None:
        con.close()
        raise HTTPException(status_code=404, detail="job not found")
    con.execute("UPDATE jobs SET stage = ? WHERE id = ?", (body.stage, body.id))
    con.commit()
    con.close()
    return {"ok": True, "stage": body.stage}


@app.post("/api/jobs")
async def create_job(body: JobIn):
    """Add a new job to the board and persist it. Returns the created row."""
    con = _con()
    cur = con.execute(
        "INSERT INTO jobs (company, role, hue, stage, days, follow, overdue) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            body.company,
            body.role,
            body.hue,
            body.stage,
            body.days,
            _norm_follow(body.follow),
            1 if body.overdue else 0,
        ),
    )
    con.commit()
    new_id = cur.lastrowid
    row = con.execute(
        "SELECT id, company, role, hue, stage, days, follow, overdue "
        "FROM jobs WHERE id = ?",
        (new_id,),
    ).fetchone()
    con.close()
    return {"ok": True, "job": _job_dict(row)}


@app.patch("/api/jobs/{job_id}")
async def edit_job(job_id: int, body: JobIn):
    """Edit an existing job (company, role, follow-up text/date, overdue, stage, hue,
    days) and persist it. Returns the updated row."""
    con = _con()
    exists = con.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if exists is None:
        con.close()
        raise HTTPException(status_code=404, detail="job not found")
    con.execute(
        "UPDATE jobs SET company = ?, role = ?, hue = ?, stage = ?, days = ?, "
        "follow = ?, overdue = ? WHERE id = ?",
        (
            body.company,
            body.role,
            body.hue,
            body.stage,
            body.days,
            _norm_follow(body.follow),
            1 if body.overdue else 0,
            job_id,
        ),
    )
    con.commit()
    row = con.execute(
        "SELECT id, company, role, hue, stage, days, follow, overdue "
        "FROM jobs WHERE id = ?",
        (job_id,),
    ).fetchone()
    con.close()
    return {"ok": True, "job": _job_dict(row)}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: int):
    """Delete a job and persist the removal."""
    con = _con()
    cur = con.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    con.commit()
    deleted = cur.rowcount
    con.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="job not found")
    return {"ok": True}
