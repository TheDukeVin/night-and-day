// Persistent settings + tutorial-seen flags (localStorage).

export interface Settings {
  mouseSensitivity: number; // 0.3 .. 2
  quality: 'low' | 'high';
  showTutorials: boolean;
}

const KEY = 'night-and-day-settings';
const TUTORIAL_KEY = 'night-and-day-tutorials-seen';

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (!cached) {
    const defaults: Settings = { mouseSensitivity: 1, quality: 'high', showTutorials: true };
    try {
      cached = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
    } catch {
      cached = defaults;
    }
  }
  return cached;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  cached = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(cached));
  return cached;
}

export function tutorialSeen(id: string): boolean {
  try {
    const seen = JSON.parse(localStorage.getItem(TUTORIAL_KEY) ?? '[]') as string[];
    return seen.includes(id);
  } catch {
    return false;
  }
}

export function markTutorialSeen(id: string): void {
  try {
    const seen = JSON.parse(localStorage.getItem(TUTORIAL_KEY) ?? '[]') as string[];
    if (!seen.includes(id)) {
      seen.push(id);
      localStorage.setItem(TUTORIAL_KEY, JSON.stringify(seen));
    }
  } catch {
    localStorage.setItem(TUTORIAL_KEY, JSON.stringify([id]));
  }
}
