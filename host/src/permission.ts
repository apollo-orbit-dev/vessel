import { get, set } from "idb-keyval";

// Per-bundle network decisions, remembered in IndexedDB. Keyed by bundle name +
// the exact set of declared origins, so a bundle that changes which domains it
// requests is re-prompted rather than silently inheriting an old "allow".

export type Decision = "allow" | "deny";

const KEY = "vessel.permissions";

export function decisionKey(name: string, origins: string[]): string {
  return `${name}::${[...origins].sort().join(",")}`;
}

export async function getDecision(key: string): Promise<Decision | undefined> {
  const all = (await get<Record<string, Decision>>(KEY)) ?? {};
  return all[key];
}

export async function setDecision(key: string, decision: Decision): Promise<void> {
  const all = (await get<Record<string, Decision>>(KEY)) ?? {};
  all[key] = decision;
  await set(KEY, all);
}
