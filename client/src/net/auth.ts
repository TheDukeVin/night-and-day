// Thin fetch wrappers for the /auth/* HTTP API. Google sign-in isn't a fetch
// call — it's a real navigation to /auth/google/start (see main.ts).

import type { AuthErrorResponse, AuthUser, MeResponse } from '../../../shared/authTypes.ts';

async function postJson(path: string, body: unknown): Promise<{ user?: AuthUser; error?: string }> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { user?: AuthUser } & Partial<AuthErrorResponse>;
  if (!res.ok) return { error: json.error ?? 'Something went wrong — please try again.' };
  return { user: json.user };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const res = await fetch('/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as MeResponse;
    return json.user;
  } catch {
    return null;
  }
}

export function register(username: string, password: string): Promise<{ user?: AuthUser; error?: string }> {
  return postJson('/auth/register', { username, password });
}

export function login(username: string, password: string): Promise<{ user?: AuthUser; error?: string }> {
  return postJson('/auth/login', { username, password });
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}
