import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutosave } from "../src/autosave";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createAutosave", () => {
  it("coalesces a burst of mutations into a single debounced save", async () => {
    let saves = 0;
    const a = createAutosave({ delayMs: 800, save: async () => void saves++ });

    a.markDirty();
    a.markDirty();
    a.markDirty();
    expect(saves).toBe(0); // nothing yet — still within the quiet period
    expect(a.state).toBe("dirty");

    await vi.advanceTimersByTimeAsync(800);
    expect(saves).toBe(1); // one write for the whole burst
    expect(a.state).toBe("saved");
  });

  it("does not fire until the quiet period elapses, resetting on each change", async () => {
    let saves = 0;
    const a = createAutosave({ delayMs: 800, save: async () => void saves++ });

    a.markDirty();
    await vi.advanceTimersByTimeAsync(500);
    a.markDirty(); // resets the timer
    await vi.advanceTimersByTimeAsync(500);
    expect(saves).toBe(0); // 1000ms total, but never 800ms quiet
    await vi.advanceTimersByTimeAsync(300);
    expect(saves).toBe(1);
  });

  it("flush() saves immediately and cancels the pending timer", async () => {
    let saves = 0;
    const a = createAutosave({ delayMs: 800, save: async () => void saves++ });

    a.markDirty();
    await a.flush();
    expect(saves).toBe(1);
    expect(a.state).toBe("saved");

    await vi.advanceTimersByTimeAsync(800);
    expect(saves).toBe(1); // the canceled timer did not fire a second save
  });

  it("does not lose a change made while a save is in flight", async () => {
    let saves = 0;
    let release!: () => void;
    const a = createAutosave({
      delayMs: 800,
      save: () =>
        new Promise<void>((r) => {
          saves++;
          release = r;
        }),
    });

    a.markDirty();
    await vi.advanceTimersByTimeAsync(800); // first save starts and blocks
    expect(saves).toBe(1);
    expect(a.state).toBe("saving");

    a.markDirty(); // change arrives mid-save
    release(); // finish the first save
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(800); // follow-up save fires
    expect(saves).toBe(2);
  });

  it("reports error state when the save throws", async () => {
    const a = createAutosave({ delayMs: 800, save: async () => { throw new Error("disk full"); } });
    a.markDirty();
    await vi.advanceTimersByTimeAsync(800);
    expect(a.state).toBe("error");
  });

  it("manual mode never auto-saves; only flush() saves (download-to-save)", async () => {
    let saves = 0;
    const a = createAutosave({ manual: true, delayMs: 800, save: async () => void saves++ });

    a.markDirty();
    expect(a.state).toBe("dirty");
    await vi.advanceTimersByTimeAsync(5000); // no debounce in manual mode
    expect(saves).toBe(0); // nothing downloaded automatically

    await a.flush();
    expect(saves).toBe(1); // only the explicit save produced a download
    expect(a.state).toBe("saved");
  });
});
