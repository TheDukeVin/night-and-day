// /mechanics* route handlers: per-account record of which first-time guidance
// cues a user has already encountered. Guests never hit these routes — the
// client keeps their seen-set in memory for the session only.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getSessionUser, readJsonBody, respondJson } from './auth.ts';
import { getSeenMechanics, markMechanicSeen } from './db.ts';

interface MarkSeenBody {
  mechanic?: unknown;
}

export function handleGetMechanics(req: IncomingMessage, res: ServerResponse): void {
  const user = getSessionUser(req);
  if (!user) return respondJson(res, 401, { error: 'Not signed in.' });
  respondJson(res, 200, { seen: getSeenMechanics(user.id) });
}

export async function handleMarkMechanicSeen(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = getSessionUser(req);
  if (!user) return respondJson(res, 401, { error: 'Not signed in.' });

  const body = await readJsonBody<MarkSeenBody>(req);
  if (typeof body.mechanic !== 'string' || body.mechanic.length === 0 || body.mechanic.length > 64) {
    return respondJson(res, 400, { error: 'Invalid mechanic payload.' });
  }

  markMechanicSeen(user.id, body.mechanic);
  respondJson(res, 200, {});
}
