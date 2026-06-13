import { get, set } from "idb-keyval";
import type { RecentEntry } from "./ui/MenuBar";

// Recents persist the FileSystemFileHandle (via IndexedDB) so a recent reopens
// on click. Deduped by file name; capped. Recents don't carry the verification
// result, so they list as unsigned regardless of the bundle's signature.

const KEY = "vessel.recents";
const MAX = 8;

export interface StoredRecent {
  name: string;
  ts: number;
  handle: FileSystemFileHandle;
}

export async function loadRecents(): Promise<StoredRecent[]> {
  return (await get<StoredRecent[]>(KEY)) ?? [];
}

export async function addRecent(name: string, handle: FileSystemFileHandle): Promise<StoredRecent[]> {
  const list = await loadRecents();
  const next = [{ name, ts: Date.now(), handle }, ...list.filter((r) => r.name !== name)].slice(0, MAX);
  await set(KEY, next);
  return next;
}

/** Map a stored recent to the display entry used by the UI. */
export function toEntry(r: StoredRecent): RecentEntry {
  return { id: r.name, name: r.name, signed: false, time: relativeTime(r.ts) };
}

function relativeTime(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 2) return "yesterday";
  return `${Math.round(d)}d ago`;
}
