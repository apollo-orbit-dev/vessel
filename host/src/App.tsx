import { useCallback, useEffect, useRef, useState } from "react";
import {
  readBundle,
  rebuildBundle,
  allowedOrigins,
  verifyBundle,
  type BundleParts,
  type VesselRuntime,
  type VerifyResult,
} from "@vessel/core";
import { mountBundleUi } from "./iframe";
import { writeToHandle } from "./save";
import { downloadBundle } from "./download";
import { detectCapabilities, isFullExperience } from "./capabilities";
import { createAutosave, type Autosave, type AutosaveState } from "./autosave";
import { createWorkerRuntime, type WorkerRuntime } from "./runtime-client";
import { addRecent, loadRecents, toEntry, type StoredRecent } from "./recents";
import { useAppearance, useTheme, UIFONT } from "./theme";
import { MenuBar } from "./ui/MenuBar";
import { LauncherBody } from "./ui/Launcher";
import { BootBody } from "./ui/Boot";
import { Sandbox } from "./ui/Sandbox";
import { Settings, type Prefs } from "./ui/Settings";
import { Toast } from "./ui/Toast";
import { PermissionModal, type PermissionChoice } from "./ui/PermissionModal";
import { Button, Dot, type Trust } from "./ui/primitives";
import { decisionKey, getDecision, setDecision } from "./permission";
import type { RecentEntry } from "./ui/MenuBar";

type Screen = "launcher" | "boot" | "tool";

interface Session {
  bundle: BundleParts;
  runtime: VesselRuntime;
  html: string;
  name: string;
  handle: FileSystemFileHandle | null;
  /** Post-consent effective egress allowlist for this run. */
  allowedOrigins: string[];
  trust: Trust;
  publisher?: string;
}

interface PermissionReq {
  name: string;
  origins: string[];
  trust: Trust;
  publisher?: string;
  resolve: (choice: PermissionChoice) => void;
}

function trustOf(v: VerifyResult): Trust {
  return !v.signed ? "unsigned" : v.valid ? "signed" : "invalid";
}

const SAVED_LABEL: Record<AutosaveState, string> = {
  idle: "Saved",
  dirty: "Edited",
  saving: "Saving…",
  saved: "Saved",
  error: "Save failed",
};

// Host capabilities are fixed for the session. Without the File System Access /
// File Handling APIs (Firefox/Safari) the host runs degraded: file-input open +
// explicit download-to-save (see capabilities.ts, download.ts).
const CAPS = detectCapabilities();
const DEGRADED = !isFullExperience(CAPS);

// Fallback open for browsers with no showOpenFilePicker: a transient file input.
function pickFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".vessel,application/zip";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click(); // not added to the DOM; nothing to clean up if cancelled
  });
}

const PREFS_KEY = "vessel.prefs";
const DEFAULT_PREFS: Prefs = { cache: true, warnNet: true, multiWin: true };

function shortError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Save status for a handle-less (download-to-save) session. Unlike promptless
// autosave, the user must click to produce the download, so dirty state offers
// an explicit action rather than reporting a save that already happened.
function DownloadSaveSlot({ state, onSave }: { state: AutosaveState; onSave: () => void }) {
  const t = useTheme();
  if (state === "dirty" || state === "error") {
    return (
      <Button
        kind="primary"
        onClick={onSave}
        style={{ height: 24, padding: "0 11px", borderRadius: 6, font: `500 12px ${UIFONT}` }}
      >
        Download to save
      </Button>
    );
  }
  const label = state === "saving" ? "Preparing…" : state === "saved" ? "Downloaded" : "Saves by download";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `12px ${UIFONT}`, color: t.textMid }}>
      {state === "saved" && <Dot color={t.ok} size={6} />}
      {label}
    </span>
  );
}

function ToolView({ session, onMutation }: { session: Session; onMutation: () => void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const teardown = mountBundleUi(stageRef.current!, session.html, session.runtime, {
      allowedOrigins: session.allowedOrigins,
      afterDispatch: (req, res) => {
        if (req.method !== "GET" && res.status < 400) onMutation();
      },
    });
    return () => teardown();
  }, [session, onMutation]);
  return <Sandbox stageRef={stageRef} />;
}

export function App() {
  const t = useTheme();
  const { appearance, setAppearance } = useAppearance();

  const [screen, setScreen] = useState<Screen>("launcher");
  const [session, setSession] = useState<Session | null>(null);
  const [savedState, setSavedState] = useState<AutosaveState>("idle");
  const [bootNote, setBootNote] = useState<string | undefined>(undefined);
  const [recents, setRecents] = useState<StoredRecent[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
    } catch {
      return DEFAULT_PREFS;
    }
  });
  const [toast, setToast] = useState<string | null>(null);
  const [permissionReq, setPermissionReq] = useState<PermissionReq | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  const autosave = useRef<Autosave | null>(null);
  const worker = useRef<WorkerRuntime | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }, []);

  const onMutation = useCallback(() => autosave.current?.markDirty(), []);

  const requestPermission = useCallback(
    (name: string, origins: string[], trust: Trust, publisher?: string) =>
      new Promise<PermissionChoice>((resolve) => {
        setPermissionReq({
          name,
          origins,
          trust,
          publisher,
          resolve: (choice) => {
            setPermissionReq(null);
            resolve(choice);
          },
        });
      }),
    [],
  );

  // Resolve the effective egress allowlist for a bundle: default-deny, plus the
  // declared origins if the user consents (prompted unless remembered / pref off).
  const resolveEgress = useCallback(
    async (bundle: BundleParts, name: string, verify: VerifyResult): Promise<string[]> => {
      const declared = allowedOrigins(bundle.manifest);
      if (declared.length === 0) return [];
      if (!prefs.warnNet) return declared; // "ask before network" off -> auto-allow declared

      const key = decisionKey(bundle.manifest.name, declared);
      const remembered = await getDecision(key);
      if (remembered === "allow") return declared;
      if (remembered === "deny") return [];

      const choice = await requestPermission(name, declared, trustOf(verify), verify.publisher);
      if (choice === "always") {
        await setDecision(key, "allow");
        return declared;
      }
      return choice === "once" ? declared : [];
    },
    [prefs.warnNet, requestPermission],
  );

  useEffect(() => {
    void loadRecents().then(setRecents);
  }, []);

  const openBytes = useCallback(
    async (bytes: Uint8Array, handle: FileSystemFileHandle | null, name: string) => {
      worker.current?.terminate();
      worker.current = null;

      let bundle: BundleParts;
      try {
        bundle = readBundle(bytes);
      } catch (e) {
        showToast(`Couldn't open: ${shortError(e)}`);
        return;
      }

      const verify = await verifyBundle(bundle.files, bundle.manifest);

      // Consent BEFORE boot — the permission modal renders over the current
      // screen, and the boot screen has no overlays.
      const effectiveOrigins = await resolveEgress(bundle, name, verify);

      setScreen("boot");
      setBootNote("loading runtime (first run downloads ~10 MB)…");
      try {
        const wr = createWorkerRuntime();
        worker.current = wr;
        await wr.init(bundle, effectiveOrigins); // Pyodide + bundle boot in the worker
        const runtime = wr.runtime;

        autosave.current?.dispose();
        autosave.current = handle
          ? createAutosave({
              // Writable handle (Chromium launch/picker): promptless debounced save.
              save: async () => writeToHandle(handle, await rebuildBundle(bundle, runtime)),
              onState: setSavedState,
            })
          : createAutosave({
              // No handle (degraded browser, or a drag-dropped file): persist by
              // downloading a fresh .vessel — manual, only on explicit save.
              manual: true,
              save: async () => downloadBundle(name, await rebuildBundle(bundle, runtime)),
              onState: setSavedState,
            });
        setSavedState("idle");

        const html = new TextDecoder().decode(bundle.files[bundle.manifest.ui]);
        setSession({
          bundle,
          runtime,
          html,
          name,
          handle,
          allowedOrigins: effectiveOrigins,
          trust: trustOf(verify),
          publisher: verify.publisher,
        });
        setScreen("tool");

        if (handle) void addRecent(name, handle).then(setRecents);
      } catch (e) {
        worker.current?.terminate();
        worker.current = null;
        showToast(`Couldn't open: ${shortError(e)}`);
        setScreen(session ? "tool" : "launcher");
      }
    },
    [session, showToast, resolveEgress],
  );

  const openHandle = useCallback(
    async (handle: FileSystemFileHandle) => {
      const q = await (handle as any).queryPermission?.({ mode: "read" });
      if (q && q !== "granted") {
        const r = await (handle as any).requestPermission?.({ mode: "read" });
        if (r !== "granted") {
          showToast("Permission denied for that file");
          return;
        }
      }
      const file = await handle.getFile();
      await openBytes(new Uint8Array(await file.arrayBuffer()), handle, file.name);
    },
    [openBytes, showToast],
  );

  const openFilePicker = useCallback(async () => {
    const picker = (globalThis as any).showOpenFilePicker as
      | ((opts?: unknown) => Promise<FileSystemFileHandle[]>)
      | undefined;
    if (!picker) {
      // Degraded: no handle-returning picker — read the file into memory and
      // open it without a handle (save happens via download-to-save).
      const file = await pickFileFallback();
      if (file) await openBytes(new Uint8Array(await file.arrayBuffer()), null, file.name);
      return;
    }
    try {
      const [handle] = await picker({
        types: [{ description: "Vessel bundle", accept: { "application/zip": [".vessel"] } }],
      });
      if (handle) await openHandle(handle);
    } catch {
      /* user cancelled */
    }
  }, [openHandle, openBytes]);

  const onOpenRecent = useCallback(
    (entry: RecentEntry) => {
      const stored = recents.find((r) => r.name === entry.id);
      if (stored) void openHandle(stored.handle);
    },
    [recents, openHandle],
  );

  const closeTool = useCallback(() => {
    autosave.current?.dispose();
    autosave.current = null;
    worker.current?.terminate();
    worker.current = null;
    setSession(null);
    setSavedState("idle");
    setScreen("launcher");
  }, []);

  const togglePref = useCallback((key: keyof Prefs) => {
    setPrefs((p) => {
      const next = { ...p, [key]: !p[key] };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const onAction = useCallback(
    (id: string, payload?: unknown) => {
      switch (id) {
        case "open":
          void openFilePicker();
          break;
        case "open-recent":
          onOpenRecent(payload as RecentEntry);
          break;
        case "save":
          void autosave.current?.flush();
          break;
        case "close":
          closeTool();
          break;
        case "settings":
          setSettingsOpen(true);
          break;
        case "set-light":
          setAppearance("light");
          break;
        case "set-dark":
          setAppearance("dark");
          break;
        case "set-system":
          setAppearance("system");
          break;
        case "about":
          showToast("Vessel 0.1.0 — opens self-contained .vessel tool bundles");
          break;
        case "docs":
          showToast("Documentation lives in the project repo (docs/)");
          break;
      }
    },
    [openFilePicker, onOpenRecent, closeTool, setAppearance, showToast],
  );

  // Global shortcuts + launch handlers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "s" && session) {
        e.preventDefault();
        void autosave.current?.flush();
      } else if (k === "o") {
        e.preventDefault();
        void openFilePicker();
      } else if (k === "w" && session) {
        e.preventDefault();
        closeTool();
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session, openFilePicker, closeTool]);

  useEffect(() => {
    const launchQueue = (globalThis as any).launchQueue;
    launchQueue?.setConsumer?.(async (params: { files?: FileSystemFileHandle[] }) => {
      const handle = params.files?.[0];
      if (handle) await openHandle(handle);
    });
  }, [openHandle]);

  // Service worker (offline runtime cache), gated on the "keep cached" pref.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const sw = navigator.serviceWorker;

    // Re-fetch the app shell so it's in the cache (the first load happened
    // before the SW took control, so those responses weren't cached).
    const warmShell = () => {
      const urls = new Set<string>(["/"]);
      document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[href]").forEach((el) => {
        const u = (el as HTMLScriptElement).src || (el as HTMLLinkElement).href;
        if (u && u.startsWith(location.origin)) urls.add(u);
      });
      urls.forEach((u) => void fetch(u).catch(() => {}));
      setOfflineReady(sw.controller != null);
    };

    const onCtrl = () => warmShell();
    sw.addEventListener("controllerchange", onCtrl);

    // Only cache in production builds — on the dev server a caching SW would
    // serve stale vite modules. In dev (or when the pref is off) ensure no SW.
    if (prefs.cache && import.meta.env.PROD) {
      sw.register("/sw.js").then(() => {
        if (sw.controller) warmShell();
      }).catch(() => {});
    } else {
      sw.controller?.postMessage("vessel:clear-cache");
      sw.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      setOfflineReady(false);
    }
    return () => sw.removeEventListener("controllerchange", onCtrl);
  }, [prefs.cache]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) void file.arrayBuffer().then((b) => openBytes(new Uint8Array(b), null, file.name));
  }

  if (screen === "boot") return <BootBody note={bootNote} />;

  // Recents persist a reopenable file handle; degraded browsers have none, so
  // there is nothing to reopen — don't show a Recent list that can't populate.
  const recentEntries = DEGRADED ? [] : recents.map(toEntry);
  const savedSlot =
    session?.handle != null ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: `12px ${UIFONT}`, color: t.textMid }}>
        <Dot color={savedState === "error" ? t.closeHover : t.ok} size={6} />
        {SAVED_LABEL[savedState]}
      </span>
    ) : (
      <DownloadSaveSlot state={savedState} onSave={() => void autosave.current?.flush()} />
    );

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", background: t.appBg, position: "relative" }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <MenuBar
        hasTool={screen === "tool"}
        appearance={appearance}
        recents={recentEntries}
        onAction={onAction}
        toolName={screen === "tool" ? session?.name : undefined}
        trust={screen === "tool" ? session?.trust : undefined}
        publisher={screen === "tool" ? session?.publisher : undefined}
        right={screen === "tool" ? savedSlot : undefined}
      />

      {DEGRADED && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: "0 0 auto",
            padding: "6px 14px",
            background: t.chip,
            borderBottom: `1px solid ${t.hair}`,
            font: `12px ${UIFONT}`,
            color: t.textMid,
          }}
        >
          <Dot color={t.textMuted} size={6} />
          <span>
            This browser can’t auto-save to files. Tools run normally — use{" "}
            <strong style={{ fontWeight: 600, color: t.text }}>Download to save</strong> to keep your changes.
          </span>
        </div>
      )}

      {screen === "launcher" ? (
        <LauncherBody
          recents={recentEntries}
          onOpen={openFilePicker}
          onOpenRecent={onOpenRecent}
          offlineReady={offlineReady}
        />
      ) : (
        session && <ToolView session={session} onMutation={onMutation} />
      )}

      {settingsOpen && <Settings prefs={prefs} onToggle={togglePref} onClose={() => setSettingsOpen(false)} />}
      {permissionReq && (
        <PermissionModal
          name={permissionReq.name}
          origins={permissionReq.origins}
          trust={permissionReq.trust}
          publisher={permissionReq.publisher}
          onChoice={permissionReq.resolve}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}
