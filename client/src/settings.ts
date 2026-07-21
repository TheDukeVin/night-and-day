// Persistent settings (localStorage).

export interface Settings {
  mouseSensitivity: number; // 0.3 .. 2
  quality: 'low' | 'high';
  showTutorials: boolean;
  cameraMode: 'drag' | 'pointerlock'; // right-click-drag vs. cursor-lock mouse look
}

const KEY = 'night-and-day-settings';

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (!cached) {
    const defaults: Settings = { mouseSensitivity: 1, quality: 'high', showTutorials: true, cameraMode: 'drag' };
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
