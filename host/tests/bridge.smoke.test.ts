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
  it("lists notebooks, updates a note, and round-trips through SQLite", async () => {
    const bundle = readBundle(buildBundle());
    expect(bundle.manifest.name).toBe("Notes");

    const runtime = await createRuntime(await boot(), bundle);

    // Seeded notebooks + notes come back grouped for the sidebar.
    const list = await runtime.dispatch({ method: "GET", path: "/api/notebooks", headers: {}, body: null });
    expect(list.status).toBe(200);
    const notebooks = JSON.parse(list.body);
    expect(notebooks.length).toBeGreaterThanOrEqual(2);
    const noteId = notebooks[0].notes[0].id;

    const wrote = await runtime.dispatch({
      method: "PUT",
      path: `/api/notes/${noteId}`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Edited", body: "hello vessel" }),
    });
    expect(wrote.status).toBe(200);

    const readBack = await runtime.dispatch({ method: "GET", path: `/api/notes/${noteId}`, headers: {}, body: null });
    expect(JSON.parse(readBack.body)).toMatchObject({ title: "Edited", body: "hello vessel" });

    // Save -> reopen in a fresh runtime -> data persisted.
    const saved = await rebuildBundle(bundle, runtime);
    expect(saved.length).toBeGreaterThan(0);
    const reopened = readBundle(saved);
    const runtime2 = await createRuntime(await boot(), reopened);
    const afterReopen = await runtime2.dispatch({ method: "GET", path: `/api/notes/${noteId}`, headers: {}, body: null });
    expect(JSON.parse(afterReopen.body)).toMatchObject({ title: "Edited", body: "hello vessel" });
  });

  it("rejects an invalid note update via FastAPI/Pydantic validation", async () => {
    const bundle = readBundle(buildBundle());
    const runtime = await createRuntime(await boot(), bundle);
    const res = await runtime.dispatch({
      method: "PUT",
      path: "/api/notes/1",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: 123, body: 456 }), // not strings
    });
    // FastAPI returns 422 Unprocessable Entity for request-model validation errors.
    expect(res.status).toBe(422);
  });
});
