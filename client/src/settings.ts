// Persistent settings (localStorage).

export interface Settings {
  mouseSensitivity: number; // 0.3 .. 2
  quality: 'low' | 'high';
  showTutorials: boolean;
  cameraMode: 'drag' | 'pointerlock'; // right-click-drag vs. cursor-lock mouse look
  resolutionScale: number; // 0.5 .. 1 — multiplies the render pixel ratio (lower = cooler GPU)
  fpsCap: number; // frames/sec ceiling; 0 = unlimited
}

const KEY = 'night-and-day-settings';

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (!cached) {
    const defaults: Settings = {
      mouseSensitivity: 1,
      quality: 'high',
      showTutorials: true,
      cameraMode: 'drag',
      resolutionScale: 1,
      fpsCap: 60,
    };
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

/**
 * The device pixel ratio to hand `renderer.setPixelRatio`. High quality renders
 * up to 2× (capped so Retina displays don't quadruple the fragment load); low
 * quality pins to 1×. `resolutionScale` then dials that down further — the
 * single biggest lever for a cooler-running GPU.
 */
export function pixelRatioFor(s: Settings): number {
  const base = s.quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1;
  return base * s.resolutionScale;
}
