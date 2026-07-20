// /auth/* route handlers: username+password accounts, Google OAuth, and
// cookie-based sessions. Persistence lives in db.ts; this file owns hashing,
// cookies, validation, and the Google authorization-code exchange.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthUser, LoginBody, RegisterBody } from '../shared/authTypes.ts';
import {
  createLocalUser,
  createSession,
  deleteSession,
  findByUsername,
  findOrCreateGoogleUser,
  getUserBySessionToken,
  type UserRow,
} from './db.ts';

const SESSION_COOKIE = 'nd_session';
const OAUTH_STATE_COOKIE = 'nd_oauth_state';
const SCRYPT_KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const CLIENT_ORIGIN = process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5173';

// ---------- helpers ----------

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function respondJson(res: ServerResponse, status: number, body: unknown, cookies: string[] = []): void {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Usernames are 3–20 letters, numbers, or underscores.';
  }
  return null;
}

function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 6) {
    return 'Passwords need at least 6 characters.';
  }
  return null;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    username: row.username ?? row.google_email ?? 'Player',
    provider: row.google_id ? 'google' : 'local',
  };
}

function getSessionUser(req: IncomingMessage): UserRow | undefined {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return undefined;
  return getUserBySessionToken(token);
}

function startSessionCookie(userId: number): string {
  const token = randomBytes(32).toString('hex');
  createSession(userId, token);
  return serializeCookie(SESSION_COOKIE, token, 60 * 60 * 24 * 30);
}

// ---------- handlers ----------

export async function handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<RegisterBody>(req);
  const usernameError = validateUsername(body.username);
  if (usernameError) return respondJson(res, 400, { error: usernameError });
  const passwordError = validatePassword(body.password);
  if (passwordError) return respondJson(res, 400, { error: passwordError });

  if (findByUsername(body.username)) {
    return respondJson(res, 409, { error: 'That username is taken — pick another.' });
  }

  const user = createLocalUser(body.username, hashPassword(body.password));
  const cookie = startSessionCookie(user.id);
  respondJson(res, 200, { user: toAuthUser(user) }, [cookie]);
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody<LoginBody>(req);
  const user = typeof body.username === 'string' ? findByUsername(body.username) : undefined;
  if (!user || !user.password_hash || typeof body.password !== 'string' || !verifyPassword(body.password, user.password_hash)) {
    return respondJson(res, 401, { error: 'Incorrect username or password.' });
  }
  const cookie = startSessionCookie(user.id);
  respondJson(res, 200, { user: toAuthUser(user) }, [cookie]);
}

export function handleLogout(req: IncomingMessage, res: ServerResponse): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) deleteSession(token);
  respondJson(res, 200, {}, [serializeCookie(SESSION_COOKIE, '', 0)]);
}

export function handleMe(req: IncomingMessage, res: ServerResponse): void {
  const user = getSessionUser(req);
  respondJson(res, 200, { user: user ? toAuthUser(user) : null });
}

export function handleGoogleStart(req: IncomingMessage, res: ServerResponse): void {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return respondJson(res, 503, { error: 'Google sign-in is not configured on this server yet.' });
  }
  const state = randomBytes(16).toString('hex');
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', 'openid email profile');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('access_type', 'online');
  authorizeUrl.searchParams.set('prompt', 'select_account');

  res.setHeader('Set-Cookie', serializeCookie(OAUTH_STATE_COOKIE, state, 300));
  res.writeHead(302, { Location: authorizeUrl.toString() });
  res.end();
}

export async function handleGoogleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', 'http://localhost');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = parseCookies(req.headers.cookie)[OAUTH_STATE_COOKIE];
  const clearStateCookie = serializeCookie(OAUTH_STATE_COOKIE, '', 0);

  if (!code || !state || state !== expectedState) {
    return respondJson(res, 400, { error: 'Google sign-in failed — please try again.' }, [clearStateCookie]);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return respondJson(res, 503, { error: 'Google sign-in is not configured on this server yet.' }, [clearStateCookie]);
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) throw new Error('token exchange failed');
    const tokenJson = (await tokenRes.json()) as { access_token: string };

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!userInfoRes.ok) throw new Error('userinfo failed');
    const profile = (await userInfoRes.json()) as { sub: string; email: string };

    const user = findOrCreateGoogleUser(profile.sub, profile.email);
    const sessionCookie = startSessionCookie(user.id);
    res.setHeader('Set-Cookie', [clearStateCookie, sessionCookie]);
    res.writeHead(302, { Location: `${CLIENT_ORIGIN}/` });
    res.end();
  } catch {
    respondJson(res, 502, { error: 'Could not reach Google — please try again.' }, [clearStateCookie]);
  }
}
