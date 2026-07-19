// Pure game logic shared by client (single-player) and server (two-player).

import type { CrystalCounts, GameState, LevelDef, PlayerRole } from './types.ts';

export function initialGameState(levelIndex: number): GameState {
  return { levelIndex, presses: {}, resets: 0, hintTaken: false, solved: false };
}

/** Crystal counts implied by the level's initial layout plus all generator presses. */
export function currentCounts(level: LevelDef, presses: Record<string, number>): CrystalCounts {
  const counts: CrystalCounts = {};
  for (const [color, c] of Object.entries(level.initial)) {
    counts[color] = { day: c.day, night: c.night };
  }
  for (const gen of level.generators) {
    const n = presses[gen.id] ?? 0;
    if (n === 0) continue;
    for (const out of gen.outputs) {
      if (!counts[out.color]) counts[out.color] = { day: 0, night: 0 };
      counts[out.color][gen.side] += out.count * n;
    }
  }
  return counts;
}

/** May this role press this generator? Dusk (single-player) may press both sides. */
export function canPress(level: LevelDef, role: PlayerRole, genId: string): boolean {
  const gen = level.generators.find((g) => g.id === genId);
  if (!gen) return false;
  return role === 'dusk' || role === gen.side;
}

export function applyPress(state: GameState, genId: string): GameState {
  return {
    ...state,
    presses: { ...state.presses, [genId]: (state.presses[genId] ?? 0) + 1 },
  };
}

export function isBalanced(level: LevelDef, presses: Record<string, number>): boolean {
  const counts = currentCounts(level, presses);
  return Object.values(counts).every((c) => c.day === c.night);
}

export function applyReset(state: GameState): GameState {
  return { ...state, presses: {}, resets: state.resets + 1 };
}

/**
 * Hint: pick the generator whose press count is farthest from the stored
 * solution and reveal its target press count.
 */
export function pickHint(
  level: LevelDef,
  presses: Record<string, number>
): { gen: string; presses: number } {
  let best: { gen: string; presses: number; gap: number } | null = null;
  for (const gen of level.generators) {
    const target = level.solution[gen.id] ?? 0;
    const gap = Math.abs(target - (presses[gen.id] ?? 0));
    if (best === null || gap > best.gap) best = { gen: gen.id, presses: target, gap };
  }
  return { gen: best!.gen, presses: best!.presses };
}

/** Human-readable label for a generator, used in hint/answer dialogs and HUD. */
export function generatorLabel(level: LevelDef, genId: string): string {
  const gen = level.generators.find((g) => g.id === genId);
  if (!gen) return genId;
  const parts = gen.outputs.map((o) => `+${o.count} ${o.color}`);
  return `${gen.side} generator (${parts.join(', ')})`;
}
