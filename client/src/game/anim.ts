// Minimal tween system for crystal/generator animations.

export interface Tween {
  duration: number;
  elapsed: number;
  delay: number;
  onUpdate: (t: number) => void; // t: 0..1 eased
  onDone?: () => void;
}

const active: Tween[] = [];

export function tween(opts: {
  duration: number;
  delay?: number;
  onUpdate: (t: number) => void;
  onDone?: () => void;
}): Tween {
  const tw: Tween = { elapsed: 0, delay: opts.delay ?? 0, duration: opts.duration, onUpdate: opts.onUpdate, onDone: opts.onDone };
  active.push(tw);
  return tw;
}

export function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}

export function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + u * u * ((c + 1) * u + c);
}

export function updateTweens(dt: number): void {
  for (let i = active.length - 1; i >= 0; i--) {
    const tw = active[i];
    if (tw.delay > 0) {
      tw.delay -= dt;
      continue;
    }
    tw.elapsed += dt;
    const t = Math.min(1, tw.elapsed / tw.duration);
    tw.onUpdate(t);
    if (t >= 1) {
      active.splice(i, 1);
      tw.onDone?.();
    }
  }
}

export function clearTweens(): void {
  active.length = 0;
}
