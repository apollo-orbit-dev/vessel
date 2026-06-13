import { describe, it, expect } from "vitest";
import { loadPyodide } from "pyodide";
import { buildBundle } from "../scripts/build-bundle.mjs";
import { readBundle, createRuntime, rebuildBundle, type PyodideLike } from "@vessel/core";

// Exercises the bridge end to end in Node against the real FastAPI example
// bundle: UI request -> ASGI -> SQLite -> response, plus the save/reopen
// round-trip at the data layer.
//
// NOTE: createRuntime micropip-installs FastAPI (+ closure) from PyPI/Pyodide,
// so this needs network on first run. Offline wheel-vendoring is Phase 3.

async function boot(): Promise<PyodideLike> {
  return (await loadPyodide()) as unknown as PyodideLike;
}

describe("fetch->ASGI bridge (FastAPI bundle)", () => {
  it("reads, writes, and round-trips a note through SQLite", async () => {
    const bundle = readBundle(buildBundle());
    expect(bundle.manifest.name).toBe("Notes");

    const runtime = await createRuntime(await boot(), bundle);

    const initial = await runtime.dispatch({ method: "GET", path: "/api/note", headers: {}, body: null });
    expect(initial.status).toBe(200);
    expect(JSON.parse(initial.body)).toEqual({ body: "" });

    const wrote = await runtime.dispatch({
      method: "POST",
      path: "/api/note",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "hello vessel" }),
    });
    expect(wrote.status).toBe(200);
    expect(JSON.parse(wrote.body)).toMatchObject({ ok: true, body: "hello vessel" });

    const readBack = await runtime.dispatch({ method: "GET", path: "/api/note", headers: {}, body: null });
    expect(JSON.parse(readBack.body)).toEqual({ body: "hello vessel" });

    // Save -> reopen in a fresh runtime -> data persisted.
    const saved = await rebuildBundle(bundle, runtime);
    expect(saved.length).toBeGreaterThan(0);
    const reopened = readBundle(saved);
    const runtime2 = await createRuntime(await boot(), reopened);
    const afterReopen = await runtime2.dispatch({ method: "GET", path: "/api/note", headers: {}, body: null });
    expect(JSON.parse(afterReopen.body)).toEqual({ body: "hello vessel" });
  });

  it("rejects an invalid note body via FastAPI/Pydantic validation", async () => {
    const bundle = readBundle(buildBundle());
    const runtime = await createRuntime(await boot(), bundle);
    const res = await runtime.dispatch({
      method: "POST",
      path: "/api/note",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: 123 }),
    });
    // FastAPI returns 422 Unprocessable Entity for request-model validation errors.
    expect(res.status).toBe(422);
  });
});
