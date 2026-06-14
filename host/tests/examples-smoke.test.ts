import { describe, it, expect } from "vitest";
import { loadPyodide } from "pyodide";
import { readBundle, createRuntime, rebuildBundle, type PyodideLike } from "@vessel/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Functional smoke for the fifteen example bundles (ten Phase-12 + five
// Phase-17 developer tools). Boots each built examples/<slug>/<slug>.vessel
// through the real fetch->ASGI->SQLite bridge, exercises its primary read + the
// full create/edit/delete lifecycle, and proves the save->reopen persistence
// trip for a representative tool.
//
// GATED: createRuntime micropip-installs FastAPI (+ cryptography/pyyaml/tomli-w
// for some Phase-17 tools) per boot (network) and this boots Pyodide ~16x, so it
// is heavy. SKIPPED by default; run on demand:
//   SMOKE_EXAMPLES=1 npx vitest run examples-smoke   (from host/)
// The api-workbench case exercises only its local CRUD (collections/requests/
// history), never a live outbound request — egress isn't installed in this
// Node harness, and the network path was verified live during authoring.
const RUN = !!process.env.SMOKE_EXAMPLES;
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const boot = async (): Promise<PyodideLike> => (await loadPyodide()) as unknown as PyodideLike;
const vesselBytes = (slug: string) =>
  new Uint8Array(readFileSync(join(repoRoot, "examples", slug, `${slug}.vessel`)));

const J = { "content-type": "application/json" };
const req = (rt: any, method: string, path: string, body?: unknown) =>
  rt.dispatch({ method, path, headers: body !== undefined ? J : {}, body: body !== undefined ? JSON.stringify(body) : null });
const get = (rt: any, path: string) => req(rt, "GET", path);
const ok = (r: any, where: string) => {
  if (r.status < 200 || r.status >= 300) throw new Error(`${where}: status ${r.status} body=${String(r.body).slice(0, 200)}`);
  return r.body ? JSON.parse(r.body) : null;
};

// Each tool: primary read + its showcase gesture + a full create/verify/delete
// pass over its new CRUD. Returns a one-line summary for the test log.
const TOOLS: Record<string, (rt: any) => Promise<string>> = {
  budget: async (rt) => {
    const s = ok(await get(rt, "/api/state"), "state");
    expect(s.transactions.length).toBeGreaterThan(0);
    expect(s.categories.length).toBeGreaterThan(0);
    const before = s.transactions.length;
    ok(await req(rt, "POST", "/api/transactions", { tx_date: "2026-06-13", merchant: "Smoke", category_id: s.categories[0].id, amount: 10 }), "POST tx");
    const s2 = ok(await get(rt, "/api/state"), "state2");
    expect(s2.transactions.length).toBe(before + 1);
    const hue = (s2.allowed_hues && s2.allowed_hues[0]) ?? 230;
    ok(await req(rt, "POST", "/api/categories", { name: "SmokeCat", hue }), "POST cat");
    const s3 = ok(await get(rt, "/api/state"), "state3");
    const cat = s3.categories.find((c: any) => c.name === "SmokeCat");
    expect(cat, "new category present").toBeTruthy();
    ok(await req(rt, "DELETE", `/api/categories/${cat.id}`), "DELETE cat");
    const s4 = ok(await get(rt, "/api/state"), "state4");
    expect(s4.categories.find((c: any) => c.name === "SmokeCat")).toBeFalsy();
    return `tx ${before}->${s2.transactions.length}; category add+delete ok`;
  },
  flashcards: async (rt) => {
    const s = ok(await get(rt, "/api/state"), "state");
    if (s.card) ok(await req(rt, "POST", "/api/rate", { card_id: s.card.id, rating: "good" }), "rate");
    const c0 = ok(await get(rt, "/api/cards"), "cards");
    const before = c0.cards.length;
    ok(await req(rt, "POST", "/api/cards", { front: "smoke-front", back: "smoke-back", note: "" }), "add card");
    const c1 = ok(await get(rt, "/api/cards"), "cards2");
    expect(c1.cards.length).toBe(before + 1);
    const added = c1.cards.find((c: any) => c.front === "smoke-front");
    expect(added).toBeTruthy();
    ok(await req(rt, "POST", "/api/cards/delete", { card_id: added.id }), "del card");
    const c2 = ok(await get(rt, "/api/cards"), "cards3");
    expect(c2.cards.length).toBe(before);
    return `cards ${before}->${c1.cards.length}->${c2.cards.length}; rate ok`;
  },
  "csv-explorer": async (rt) => {
    const m = ok(await get(rt, "/api/meta"), "meta");
    expect(m.total).toBeGreaterThan(0);
    const q = ok(await req(rt, "POST", "/api/query", { filter: "", sort: "station", dir: "asc", limit: 10 }), "query");
    expect(q.rows.length).toBeGreaterThan(0);
    ok(await req(rt, "POST", "/api/import", { text: "alpha,beta\n1,x\n2,y\n3,z", mode: "replace" }), "import");
    const m2 = ok(await get(rt, "/api/meta"), "meta2");
    expect(m2.total).toBe(3);
    const q2 = ok(await req(rt, "POST", "/api/query", { filter: "", sort: "alpha", dir: "asc", limit: 10 }), "query2");
    expect(q2.rows.length).toBe(3);
    return `seed ${m.total} rows; import->${m2.total} rows over new columns`;
  },
  invoice: async (rt) => {
    const inv = ok(await get(rt, "/api/invoice"), "inv");
    const id = inv.items[0].id;
    ok(await req(rt, "PUT", `/api/items/${id}/qty`, { qty: 7 }), "put qty");
    const inv2 = ok(await get(rt, "/api/invoice"), "inv2");
    expect(inv2.items[0].qty).toBe(7);
    const n0 = inv2.items.length;
    ok(await req(rt, "POST", "/api/items", { descr: "Smoke line", detail: "", qty: 2, rate: 5 }), "add item");
    const inv3 = ok(await get(rt, "/api/invoice"), "inv3");
    expect(inv3.items.length).toBe(n0 + 1);
    const newId = inv3.items[inv3.items.length - 1].id;
    ok(await req(rt, "PATCH", "/api/invoice", { number: "SMOKE-1" }), "patch header");
    ok(await req(rt, "DELETE", `/api/items/${newId}`), "del item");
    const inv5 = ok(await get(rt, "/api/invoice"), "inv5");
    expect(inv5.items.length).toBe(n0);
    return `qty edit; items ${n0}->${inv3.items.length}->${inv5.items.length}; header patch ok`;
  },
  "recipe-planner": async (rt) => {
    const s = ok(await get(rt, "/api/state"), "state");
    expect(s.recipes.length).toBeGreaterThan(0);
    ok(await req(rt, "POST", "/api/plan", { day_index: 0, recipe_id: s.recipes[0].id }), "plan");
    const planned0 = ok(await get(rt, "/api/state"), "state-plan").plan.find((d: any) => d.day_index === 0);
    expect(planned0.meals.length).toBeGreaterThan(0);
    const aisle = (s.aisles && s.aisles[0]) || "Produce";
    const before = s.recipes.length;
    ok(await req(rt, "POST", "/api/recipes", { name: "Smoke Stew", time: 20, serves: 2, tags: ["test"], ingredients: [{ item: "Smoke onion", aisle }] }), "add recipe");
    const s2 = ok(await get(rt, "/api/state"), "state2");
    expect(s2.recipes.length).toBe(before + 1);
    const r = s2.recipes.find((x: any) => x.name === "Smoke Stew");
    ok(await req(rt, "DELETE", `/api/recipes/${r.id}`), "del recipe");
    const s3 = ok(await get(rt, "/api/state"), "state3");
    expect(s3.recipes.length).toBe(before);
    return `recipes ${before}->${s2.recipes.length}->${s3.recipes.length}; plan ok`;
  },
  habits: async (rt) => {
    const s = ok(await get(rt, "/api/habits"), "habits");
    expect(s.habits.length).toBeGreaterThan(0);
    const before = s.habits.length;
    ok(await req(rt, "POST", "/api/toggle", { habit_id: s.habits[0].id, day: 5 }), "toggle");
    ok(await req(rt, "POST", "/api/habits", { name: "Smoke habit", hue: 200 }), "add habit");
    const s2 = ok(await get(rt, "/api/habits"), "habits2");
    expect(s2.habits.length).toBe(before + 1);
    const added = s2.habits.find((x: any) => x.name === "Smoke habit");
    ok(await req(rt, "DELETE", `/api/habits/${added.id}`), "del habit");
    const s3 = ok(await get(rt, "/api/habits"), "habits3");
    expect(s3.habits.length).toBe(before);
    return `habits ${before}->${s2.habits.length}->${s3.habits.length}; toggle ok`;
  },
  crm: async (rt) => {
    const s = ok(await get(rt, "/api/people"), "people");
    expect(s.people.length).toBeGreaterThan(0);
    const p = s.people[0];
    ok(await req(rt, "POST", `/api/people/${p.id}/log`, {}), "log");
    const d = ok(await get(rt, `/api/people/${p.id}`), "person");
    expect(d.days).toBe(0);
    const before = s.people.length;
    ok(await req(rt, "POST", "/api/people", { name: "Smoke Person", relationship: "test", tags: "a,b", note: "hi" }), "add person");
    const s2 = ok(await get(rt, "/api/people"), "people2");
    expect(s2.people.length).toBe(before + 1);
    const np = s2.people.find((x: any) => x.name === "Smoke Person");
    ok(await req(rt, "DELETE", `/api/people/${np.id}`), "del person");
    const s3 = ok(await get(rt, "/api/people"), "people3");
    expect(s3.people.length).toBe(before);
    return `people ${before}->${s2.people.length}->${s3.people.length}; log days=${d.days}`;
  },
  "job-tracker": async (rt) => {
    const flat = (bd: any) => bd.columns.flatMap((c: any) => c.jobs.map((j: any) => ({ id: j.id, stage: c.index })));
    const b = ok(await get(rt, "/api/board"), "board");
    const job = flat(b).find((j: any) => j.stage === 0);
    expect(job, "an Applied-stage job to advance").toBeTruthy();
    ok(await req(rt, "POST", "/api/advance", { id: job.id }), "advance");
    const before = flat(b).length;
    const created = ok(await req(rt, "POST", "/api/jobs", { company: "SmokeCo", role: "QA", stage: 0, follow: "" }), "add job");
    const jid = created.job?.id;
    expect(jid, "created job id").toBeTruthy();
    const b2 = ok(await get(rt, "/api/board"), "board2");
    expect(flat(b2).length).toBe(before + 1);
    ok(await req(rt, "POST", "/api/move", { id: jid, stage: 3 }), "move");
    const b3 = ok(await get(rt, "/api/board"), "board3");
    expect(flat(b3).find((j: any) => j.id === jid).stage).toBe(3);
    ok(await req(rt, "DELETE", `/api/jobs/${jid}`), "del job");
    const b4 = ok(await get(rt, "/api/board"), "board4");
    expect(flat(b4).length).toBe(before);
    return `jobs ${before}->${flat(b2).length}->${flat(b4).length}; move->stage3 ok`;
  },
  workout: async (rt) => {
    const s = ok(await get(rt, "/api/session"), "session");
    expect(s.exercises.length).toBeGreaterThan(0);
    const ex = s.exercises[0];
    const beforeSets = ex.sets.length;
    ok(await req(rt, "POST", `/api/exercises/${ex.id}/sets`, {}), "add set");
    const s2 = ok(await get(rt, "/api/session"), "session2");
    expect(s2.exercises[0].sets.length).toBe(beforeSets + 1);
    const beforeEx = s.exercises.length;
    ok(await req(rt, "POST", "/api/exercises", { name: "Smoke press", target: "3x5" }), "add ex");
    const s3 = ok(await get(rt, "/api/session"), "session3");
    expect(s3.exercises.length).toBe(beforeEx + 1);
    const nx = s3.exercises.find((x: any) => x.name === "Smoke press");
    ok(await req(rt, "DELETE", `/api/exercises/${nx.id}`), "del ex");
    const s4 = ok(await get(rt, "/api/session"), "session4");
    expect(s4.exercises.length).toBe(beforeEx);
    return `sets ${beforeSets}->${s2.exercises[0].sets.length}; exercises ${beforeEx}->${s3.exercises.length}->${s4.exercises.length}`;
  },
  journal: async (rt) => {
    const s = ok(await get(rt, "/api/entries"), "entries");
    expect(s.entries.length).toBeGreaterThan(0);
    const word = String(s.entries[0].title || s.entries[0].body || "the").split(/\s+/)[0];
    const r = ok(await get(rt, `/api/entries?q=${encodeURIComponent(word)}`), "search");
    const mood = s.entries[0].mood;
    const before = s.total;
    const created = ok(await req(rt, "POST", "/api/entries", { title: "Smoke entry", body: "smoke body unique-token-zzz", mood, date: "Jun 13", time: "09:00" }), "add entry");
    const eid = created.entry?.id;
    expect(eid, "created entry id").toBeTruthy();
    const s2 = ok(await get(rt, "/api/entries"), "entries2");
    expect(s2.total).toBe(before + 1);
    const r2 = ok(await get(rt, `/api/entries?q=unique-token-zzz`), "search2");
    expect(r2.entries.length).toBe(1);
    ok(await req(rt, "DELETE", `/api/entries/${eid}`), "del entry");
    const s3 = ok(await get(rt, "/api/entries"), "entries3");
    expect(s3.total).toBe(before);
    return `entries ${before}->${s2.total}->${s3.total}; search mode=${r.search_mode}; new entry searchable`;
  },
  "sqlite-playground": async (rt) => {
    // No DB imported yet: status reflects it and the run guard refuses.
    const st = ok(await get(rt, "/api/status"), "status");
    expect(st.imported).toBe(false);
    const guard = ok(await req(rt, "POST", "/api/run", { sql: "SELECT 1" }), "run-noimport");
    expect(guard.ok).toBe(false); // "No database imported."
    // The bundle's OWN store (saved queries) is the CRUD that travels in the file.
    const s0 = ok(await get(rt, "/api/saved"), "saved0");
    const before = s0.saved.length;
    const saved = ok(await req(rt, "POST", "/api/saved", { name: "Smoke", sql: "SELECT 1" }), "save");
    expect(saved.ok).toBe(true);
    const s1 = ok(await get(rt, "/api/saved"), "saved1");
    expect(s1.saved.length).toBe(before + 1);
    ok(await req(rt, "POST", "/api/saved/delete", { id: saved.id }), "del-saved");
    const s2 = ok(await get(rt, "/api/saved"), "saved2");
    expect(s2.saved.length).toBe(before);
    return `imported=${st.imported}; run guarded; saved ${before}->${s1.saved.length}->${s2.saved.length}`;
  },
  "regex-tester": async (rt) => {
    const t = ok(await req(rt, "POST", "/api/test", { pattern: "(?P<y>\\d{4})-(\\d{2})", flags: "", text: "2026-06 and 1999-12" }), "test");
    expect(t.ok).toBe(true);
    expect(t.match_count).toBe(2);
    expect(t.group_count).toBe(2);
    const bad = ok(await req(rt, "POST", "/api/test", { pattern: "(", flags: "", text: "x" }), "bad");
    expect(bad.ok).toBe(false); // compile error returned, not a 500
    const p0 = ok(await get(rt, "/api/patterns"), "patterns");
    const before = p0.patterns.length;
    const created = ok(await req(rt, "POST", "/api/patterns", { name: "Smoke pat", pattern: "\\d+", flags: "i", note: "" }), "add");
    const pid = created.pattern.id;
    const p1 = ok(await get(rt, "/api/patterns"), "patterns2");
    expect(p1.patterns.length).toBe(before + 1);
    ok(await req(rt, "PUT", `/api/patterns/${pid}`, { name: "Smoke pat 2", pattern: "\\w+", flags: "", note: "edited" }), "edit");
    ok(await req(rt, "DELETE", `/api/patterns/${pid}`), "del");
    const p2 = ok(await get(rt, "/api/patterns"), "patterns3");
    expect(p2.patterns.length).toBe(before);
    return `matches=${t.match_count} groups=${t.group_count}; bad-pattern handled; patterns ${before}->${p1.patterns.length}->${p2.patterns.length}`;
  },
  "jwt-inspector": async (rt) => {
    const cap = ok(await get(rt, "/api/capabilities"), "caps");
    expect(cap.hmac).toBe(true);
    // The canonical jwt.io HS256 sample (secret: "your-256-bit-secret").
    const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const dec = ok(await req(rt, "POST", "/api/inspect", { token: TOKEN }), "decode");
    expect(dec.ok).toBe(true);
    expect(dec.alg).toBe("HS256");
    expect(dec.payload.sub).toBe("1234567890");
    expect(dec.verification.status).toBe("not_checked"); // no secret supplied
    const good = ok(await req(rt, "POST", "/api/inspect", { token: TOKEN, secret: "your-256-bit-secret" }), "verify-good");
    expect(good.verification.status).toBe("valid");
    const wrong = ok(await req(rt, "POST", "/api/inspect", { token: TOKEN, secret: "nope" }), "verify-bad");
    expect(wrong.verification.status).toBe("invalid");
    const h0 = ok(await get(rt, "/api/history"), "hist0");
    const before = h0.length;
    const sv = ok(await req(rt, "POST", "/api/history", { label: "smoke", token: TOKEN, store_token: false }), "save");
    expect(sv.ok).toBe(true);
    const h1 = ok(await get(rt, "/api/history"), "hist1");
    expect(h1.length).toBe(before + 1);
    expect(h1[0].has_token).toBe(false); // metadata-only by default
    ok(await req(rt, "DELETE", `/api/history/${sv.id}`), "del");
    const h2 = ok(await get(rt, "/api/history"), "hist2");
    expect(h2.length).toBe(before);
    return `decode alg=${dec.alg}; HS256 valid/invalid ok; asymmetric=${cap.asymmetric}; history metadata-only`;
  },
  "data-converter": async (rt) => {
    const conv = ok(await req(rt, "POST", "/api/convert", { text: '{"a": 1, "b": [2, 3]}', in_format: "json" }), "convert");
    expect(conv.ok).toBe(true);
    expect(conv.outputs.yaml.ok).toBe(true);
    expect(conv.outputs.toml.ok).toBe(true);
    // round-trip: parse the emitted YAML back
    const back = ok(await req(rt, "POST", "/api/convert", { text: conv.outputs.yaml.text, in_format: "yaml" }), "convert-back");
    expect(back.ok).toBe(true);
    const q = ok(await req(rt, "POST", "/api/query", { text: '{"users": [{"name": "ann"}]}', in_format: "json", path: "users[0].name" }), "query");
    expect(q.ok).toBe(true);
    expect(JSON.parse(q.result_json)).toBe("ann");
    const bad = ok(await req(rt, "POST", "/api/convert", { text: "{bad", in_format: "json" }), "bad");
    expect(bad.ok).toBe(false); // parse error returned, not a 500
    const h0 = ok(await get(rt, "/api/history"), "hist0");
    const before = h0.length;
    const sv = ok(await req(rt, "POST", "/api/history", { label: "smoke", in_format: "json", body: "{}" }), "save");
    expect(sv.ok).toBe(true);
    const h1 = ok(await get(rt, "/api/history"), "hist1");
    expect(h1.length).toBe(before + 1);
    ok(await req(rt, "DELETE", `/api/history/${sv.id}`), "del");
    const h2 = ok(await get(rt, "/api/history"), "hist2");
    expect(h2.length).toBe(before);
    return `json->yaml/toml ok; yaml round-trip; path=ann; bad-json handled; history ${before}->${h1.length}->${h2.length}`;
  },
  "api-workbench": async (rt) => {
    // Local CRUD only — no live outbound request in this harness.
    const c0 = ok(await get(rt, "/api/collections"), "collections");
    expect(c0.collections.length).toBeGreaterThan(0);
    expect(c0.allowed_origins.length).toBeGreaterThan(0);
    const beforeCols = c0.collections.length;
    const created = ok(await req(rt, "POST", "/api/collections", { name: "Smoke Coll" }), "add-coll");
    const cid = created.id;
    const c1 = ok(await get(rt, "/api/collections"), "collections2");
    expect(c1.collections.length).toBe(beforeCols + 1);
    const r = ok(await req(rt, "POST", "/api/requests", { collection_id: cid, name: "Smoke Req", method: "GET", url: "https://httpbin.org/get", query_params: [], headers: [], body_mode: "none", body: "" }), "add-req");
    const rid = r.id;
    const c2 = ok(await get(rt, "/api/collections"), "collections3");
    const coll = c2.collections.find((x: any) => x.id === cid);
    expect(coll.requests.length).toBe(1);
    ok(await req(rt, "DELETE", `/api/requests/${rid}`), "del-req");
    ok(await req(rt, "DELETE", `/api/collections/${cid}`), "del-coll");
    const c3 = ok(await get(rt, "/api/collections"), "collections4");
    expect(c3.collections.length).toBe(beforeCols);
    return `collections ${beforeCols}->${c1.collections.length}->${c3.collections.length}; request add/delete ok; ${c0.allowed_origins.length} curated origins`;
  },
};

const d = RUN ? describe : describe.skip;
d("example bundles: boot + primary read + full CRUD", () => {
  it.each(Object.keys(TOOLS))(
    "%s runs end to end",
    async (slug) => {
      const rt = await createRuntime(await boot(), readBundle(vesselBytes(slug)));
      const summary = await TOOLS[slug](rt);
      console.log(`  ${slug}: ${summary}`);
      expect(summary).toBeTruthy();
    },
    180_000,
  );

  it(
    "crm persists a logged contact across save -> reopen",
    async () => {
      const bundle = readBundle(vesselBytes("crm"));
      const rt = await createRuntime(await boot(), bundle);
      const p = ok(await get(rt, "/api/people"), "people").people[0];
      ok(await req(rt, "POST", `/api/people/${p.id}/log`, {}), "log");
      const reopened = readBundle(await rebuildBundle(bundle, rt));
      const rt2 = await createRuntime(await boot(), reopened);
      const after = ok(await get(rt2, `/api/people/${p.id}`), "person after reopen");
      expect(after.days).toBe(0);
    },
    240_000,
  );
});
