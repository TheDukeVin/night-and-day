// Level-unlock progress: per-pack list of completed level indices, backed by
// the account server for signed-in players and localStorage for guests.

import type { AuthUser } from '../../shared/authTypes.ts';

const LOCAL_KEY_PREFIX = 'night-and-day-progress-';

let signedIn = false;
let cache: Record<string, number[]> = {};

/** Call whenever the signed-in user changes (boot, login, register, logout, guest). */
export async function configureProgress(user: AuthUser | null): Promise<void> {
  signedIn = user !== null;
  cache = {};
  if (!signedIn) return;
  try {
    const res = await fetch('/progress', { credentials: 'include' });
    if (!res.ok) return;
    const json = (await res.json()) as { completed?: Record<string, number[]> };
    cache = json.completed ?? {};
  } catch {
    cache = {};
  }
}

function localKey(packId: string): string {
  return `${LOCAL_KEY_PREFIX}${packId}`;
}

function completedFor(packId: string): number[] {
  if (signedIn) return cache[packId] ?? [];
  try {
    return JSON.parse(localStorage.getItem(localKey(packId)) ?? '[]') as number[];
  } catch {
    return [];
  }
}

export function getUnlockedLevels(packId: string, levelCount: number): Set<number> {
  const unlocked = new Set<number>([1]);
  for (const level of completedFor(packId)) {
    unlocked.add(level);
    if (level + 1 <= levelCount) unlocked.add(level + 1);
  }
  return unlocked;
}

export function markLevelComplete(packId: string, level: number): void {
  const completed = new Set(completedFor(packId));
  if (completed.has(level)) return;
  completed.add(level);
  const list = [...completed];

  if (signedIn) {
    cache[packId] = list;
    fetch('/progress/complete', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packId, level }),
    }).catch(() => {});
  } else {
    try {
      localStorage.setItem(localKey(packId), JSON.stringify(list));
    } catch {
      // Storage unavailable (e.g. private browsing) — progress just won't persist.
    }
  }
}

export function unionUnlocked(mine: Iterable<number>, theirs: Iterable<number>): number[] {
  return [...new Set([...mine, ...theirs])];
}
