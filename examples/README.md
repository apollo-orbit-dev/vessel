# Vessel example tools

Each folder here is a complete, working `.vessel` tool — a real **FastAPI**
backend (`app/main.py`, stdlib `sqlite3`, `async def` routes) plus a single
self-contained `ui/index.html` that talks to it over the host's in-process
bridge. Open the built `<slug>.vessel` in the [Vessel host](https://getvessel.dev/app/)
and it runs entirely in your browser, saving its data back into the file.

Every tool is **theme-driven** — it styles itself with the host's injected
`--vessel-*` tokens, so it follows the host's light/dark and theme automatically.
None hardcode colors. All data is seeded on first open and persists into the file.

| Tool | Folder | Signed | What it shows |
|---|---|---|---|
| **Notes** | [`notes/`](notes/) | — | The minimal reference bundle (notebooks + notes). |
| **Budget** | [`budget/`](budget/) | — | Local-first finances: transactions, categories, trend + forecast charts. |
| **Flashcards** | [`flashcards/`](flashcards/) | — | SM-2 spaced repetition; edit the deck, study, rate. |
| **CSV Explorer** | [`csv-explorer/`](csv-explorer/) | ✅ Tabula Labs | Real SQL filter/sort over thousands of rows; import your own CSV; edit rows. |
| **Invoice** | [`invoice/`](invoice/) | ✅ Ledgerleaf | A fully editable invoice template with live totals; print/PDF. |
| **Recipe Planner** | [`recipe-planner/`](recipe-planner/) | — | Recipes + a weekly plan; a shopping list aggregated from the plan. |
| **Habits** | [`habits/`](habits/) | — | A 21-day habit grid with streaks. |
| **Personal CRM** | [`crm/`](crm/) | — | Contacts with a genuine "haven't talked in 90 days" SQL query. |
| **Job Tracker** | [`job-tracker/`](job-tracker/) | — | A pipeline board (Applied → Screen → Onsite → Offer). |
| **Workout Log** | [`workout/`](workout/) | — | Sets, PRs, and a 6-week training-volume chart. |
| **Journal** | [`journal/`](journal/) | — | A dated journal with full-text search (SQLite FTS5, LIKE fallback) + highlight. |

Each tool supports the full create / edit / delete lifecycle of its data, so you
can actually use it — the signed/unsigned split mirrors real distribution
(publisher tools are signed; personal tools you made or were handed are not).

## Building a bundle from source

The committed `<slug>/<slug>.vessel` files are ready to open. To rebuild one from
its source folder, use the SDK CLI from a clone of the repo (until it's published
to npm — then it's just `vessel build`):

```bash
npm run build -w @vessel/sdk                       # -> sdk/dist/cli.mjs (once)
node sdk/dist/cli.mjs build examples/budget        # -> examples/budget/budget.vessel
node sdk/dist/cli.mjs dev   examples/budget         # or run it locally with host parity
```

The two signed tools are built with `--sign` against an **example** publisher key
(`.keys/example.pub` is the shareable public key; the secret key is not committed —
it is a throwaway example identity, not a real publisher key):

```bash
node sdk/dist/cli.mjs build examples/invoice --sign examples/.keys/example.key
```

> Authoring your own? See the `vessel-author` skill / `docs/sdk.md`. The golden
> rules: `async def` routes only, parameterized SQL, one self-contained
> `ui/index.html`, and style with `--vessel-*` tokens (don't hardcode colors).
