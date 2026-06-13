// Debounced autosave: coalesce a burst of mutations into a single write after a
// quiet period, expose dirty/saving/saved state, and allow an explicit flush
// (Save now). Changes made while a save is in flight are never lost — they
// reschedule a follow-up save.

export type AutosaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveOptions {
  /** Performs the actual write. May throw (-> "error" state). */
  save: () => Promise<void>;
  /** Quiet period before a debounced save fires (ms). */
  delayMs?: number;
  /** Notified on every state transition (drive the UI from this). */
  onState?: (state: AutosaveState) => void;
  /**
   * Manual mode (degraded download-to-save): markDirty() only flags the
   * document dirty — it never schedules a save. Saving happens only on an
   * explicit flush(), so we never auto-trigger a file download on each edit.
   */
  manual?: boolean;
}

export interface Autosave {
  readonly state: AutosaveState;
  /** Mark the document changed; schedules a debounced save. */
  markDirty(): void;
  /** Save immediately (e.g. explicit Save / before close). */
  flush(): Promise<void>;
  /** Cancel any pending timer. */
  dispose(): void;
}

export function createAutosave(opts: AutosaveOptions): Autosave {
  const delay = opts.delayMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: Promise<void> | null = null;
  let pendingDirty = false;
  let state: AutosaveState = "idle";

  function setState(s: AutosaveState): void {
    state = s;
    opts.onState?.(s);
  }

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function schedule(): void {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  }

  function run(): Promise<void> {
    clearTimer();
    if (inflight) {
      // A save is already running; remember to save again after it finishes.
      pendingDirty = true;
      return inflight;
    }
    pendingDirty = false;
    setState("saving");
    inflight = (async () => {
      try {
        await opts.save();
        setState(pendingDirty ? "dirty" : "saved");
      } catch {
        setState("error");
      } finally {
        inflight = null;
        // In manual mode, leave the change pending+dirty for the next explicit
        // flush rather than auto-scheduling a download.
        if (pendingDirty && !opts.manual) {
          pendingDirty = false;
          schedule();
        }
      }
    })();
    return inflight;
  }

  return {
    get state() {
      return state;
    },
    markDirty() {
      if (inflight) {
        pendingDirty = true;
        return;
      }
      setState("dirty");
      if (!opts.manual) schedule();
    },
    async flush() {
      clearTimer();
      await run();
    },
    dispose() {
      clearTimer();
    },
  };
}
