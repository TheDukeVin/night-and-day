// /progress* route handlers: per-account level-unlock progress. Guests never
// hit these routes — the client falls back to localStorage for them.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSessionUser, readJsonBody, respondJson } from './auth.ts';
import { getCompletedLevels, markLevelComplete } from './db.ts';

interface CompleteLevelBody {
  packId?: unknown;
  level?: unknown;
}

export function handleGetProgress(req: IncomingMessage, res: ServerResponse): void {
  const user = getSessionUser(req);
  if (!user) return respondJson(res, 401, { error: 'Not signed in.' });
  respondJson(res, 200, { completed: getCompletedLevels(user.id) });
}

export async function handleCompleteLevel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = getSessionUser(req);
  if (!user) return respondJson(res, 401, { error: 'Not signed in.' });

  const body = await readJsonBody<CompleteLevelBody>(req);
  if (typeof body.packId !== 'string' || typeof body.level !== 'number') {
    return respondJson(res, 400, { error: 'Invalid progress payload.' });
  }

  markLevelComplete(user.id, body.packId, body.level);
  respondJson(res, 200, {});
}
