// First-time guidance memory: which mechanic cues a player has already met.
// Tied to the account (server-backed) for signed-in players so the cues follow
// the user across browsers and never re-show; guests keep an in-memory set for
// the session only (no localStorage — a different user on the same browser must
// get their own first-time cues). See guides.ts / tutorial.ts for the ids.

import type { AuthUser } from '../../shared/authTypes.ts';

let signedIn = false;
let seen = new Set<string>();

/** Call whenever the signed-in user changes (boot, login, register, logout, guest). */
export async function configureMechanics(user: AuthUser | null): Promise<void> {
  signedIn = user !== null;
  seen = new Set();
  if (!signedIn) return;
  try {
    const res = await fetch('/mechanics', { credentials: 'include' });
    if (!res.ok) return;
    const json = (await res.json()) as { seen?: string[] };
    for (const id of json.seen ?? []) seen.add(id);
  } catch {
    // Offline or server error — treat as nothing seen; cues just show again.
  }
}

/** Has this player already encountered the guidance for `id`? */
export function hasSeenMechanic(id: string): boolean {
  return seen.has(id);
}

/** Record a first encounter. Persists to the account when signed in; guests keep
 *  it only for this page load. */
export function markMechanicSeen(id: string): void {
  if (seen.has(id)) return;
  seen.add(id);
  if (!signedIn) return;
  fetch('/mechanics/seen', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mechanic: id }),
  }).catch(() => {});
}
