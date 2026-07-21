// SQLite-backed account storage. Single source of truth for users/sessions;
// server/auth.ts owns hashing and cookies, this file only owns persistence.

import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const DATA_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'data');
mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, 'night-and-day.sqlite3'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    google_id TEXT UNIQUE,
    google_email TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    user_id INTEGER NOT NULL REFERENCES users(id),
    pack_id TEXT NOT NULL,
    level_index INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, pack_id, level_index)
  );
  CREATE TABLE IF NOT EXISTS seen_mechanics (
    user_id INTEGER NOT NULL REFERENCES users(id),
    mechanic TEXT NOT NULL,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mechanic)
  );
`);

export interface UserRow {
  id: number;
  username: string | null;
  password_hash: string | null;
  google_id: string | null;
  google_email: string | null;
  created_at: string;
}

export function findByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim().toLowerCase()) as
    | UserRow
    | undefined;
}

export function createLocalUser(username: string, passwordHash: string): UserRow {
  const info = db
    .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username.trim().toLowerCase(), passwordHash, new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
}

export function findOrCreateGoogleUser(googleId: string, email: string): UserRow {
  const existing = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId) as UserRow | undefined;
  if (existing) return existing;
  const info = db
    .prepare('INSERT INTO users (google_id, google_email, created_at) VALUES (?, ?, ?)')
    .run(googleId, email, new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow;
}

export function createSession(userId: number, token: string): void {
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    new Date().toISOString()
  );
}

export function getUserBySessionToken(token: string): UserRow | undefined {
  return db
    .prepare(
      `SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?`
    )
    .get(token) as UserRow | undefined;
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getCompletedLevels(userId: number): Record<string, number[]> {
  const rows = db
    .prepare('SELECT pack_id, level_index FROM progress WHERE user_id = ?')
    .all(userId) as { pack_id: string; level_index: number }[];
  const out: Record<string, number[]> = {};
  for (const row of rows) {
    (out[row.pack_id] ??= []).push(row.level_index);
  }
  return out;
}

export function markLevelComplete(userId: number, packId: string, levelIndex: number): void {
  db.prepare(
    'INSERT OR IGNORE INTO progress (user_id, pack_id, level_index, completed_at) VALUES (?, ?, ?, ?)'
  ).run(userId, packId, levelIndex, new Date().toISOString());
}

/** Mechanic-guidance ids this user has already encountered (see client guides.ts
 *  / tutorial.ts). Used to show each first-time cue only on its first encounter. */
export function getSeenMechanics(userId: number): string[] {
  const rows = db
    .prepare('SELECT mechanic FROM seen_mechanics WHERE user_id = ?')
    .all(userId) as { mechanic: string }[];
  return rows.map((r) => r.mechanic);
}

export function markMechanicSeen(userId: number, mechanic: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO seen_mechanics (user_id, mechanic, seen_at) VALUES (?, ?, ?)'
  ).run(userId, mechanic, new Date().toISOString());
}
