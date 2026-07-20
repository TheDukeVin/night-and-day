// Minimal .env loader — no dependency, just KEY=VALUE lines. Existing
// process.env values always win, so real deployment env vars aren't shadowed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ENV_PATH = join(fileURLToPath(new URL('.', import.meta.url)), '../.env');

try {
  const contents = readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // No .env file — fine, e.g. production deployments set real env vars.
}
