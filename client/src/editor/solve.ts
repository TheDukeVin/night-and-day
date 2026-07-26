// Finds the fewest presses that balance a level, so the editor can fill in the
// `solution` field for you (and tell you when a level you drew is impossible).
//
// The search runs over the day-minus-night DIFFERENCE per color, not over press
// counts: pressing a generator adds a fixed vector to that difference, and the
// level is solved when every component reaches zero. That collapses the whole
// press-order space into a small graph, so a breadth-first walk finds the
// minimum-press answer directly.

import { currentCounts } from '../../../shared/logic.ts';
import type { LevelDef } from '../../../shared/types.ts';

/** Give up past this many distinct difference states (keeps the UI responsive). */
const MAX_VISITED = 400_000;

/** Difference components beyond this are runaway branches, not solutions. */
const MAX_DIFF = 120;

export type SolveResult =
  | { ok: true; solution: Record<string, number>; presses: number }
  | { ok: false; reason: string };

export function solveLevel(level: LevelDef): SolveResult {
  if (level.generators.length === 0) return { ok: false, reason: 'The level has no generators.' };

  // Colors in play, and the starting day−night gap for each.
  const counts = currentCounts(level, {});
  const colors = Object.keys(counts);
  const start = colors.map((c) => counts[c].day - counts[c].night);
  if (start.every((d) => d === 0)) {
    return { ok: false, reason: 'This level is already balanced before any press — add a starting gap.' };
  }

  // What one press of each generator does to the gap.
  const steps = level.generators.map((g) => {
    const delta = colors.map(() => 0);
    for (const out of g.outputs) {
      const i = colors.indexOf(out.color);
      if (i >= 0) delta[i] += g.side === 'day' ? out.count : -out.count;
    }
    return { id: g.id, delta };
  });

  const key = (v: number[]) => v.join(',');
  // Each visited state remembers the generator pressed to reach it and where it
  // came from, so the winning path can be walked back at the end.
  const cameFrom = new Map<string, { prev: string; gen: number } | null>();
  cameFrom.set(key(start), null);
  let frontier = [start];

  while (frontier.length > 0 && cameFrom.size < MAX_VISITED) {
    const next: number[][] = [];
    for (const state of frontier) {
      const from = key(state);
      for (let i = 0; i < steps.length; i++) {
        const candidate = state.map((v, j) => v + steps[i].delta[j]);
        if (candidate.some((v) => Math.abs(v) > MAX_DIFF)) continue;
        const k = key(candidate);
        if (cameFrom.has(k)) continue;
        cameFrom.set(k, { prev: from, gen: i });
        if (candidate.every((v) => v === 0)) return { ok: true, ...walkBack(k, cameFrom, steps, level) };
        next.push(candidate);
      }
    }
    frontier = next;
  }

  return {
    ok: false,
    reason:
      cameFrom.size >= MAX_VISITED
        ? 'Searched a long way without finding a solution — try smaller numbers.'
        : 'No combination of presses can balance this level.',
  };
}

function walkBack(
  goal: string,
  cameFrom: Map<string, { prev: string; gen: number } | null>,
  steps: { id: string }[],
  level: LevelDef
): { solution: Record<string, number>; presses: number } {
  // Every generator appears in the solution — zero for the decoys — because
  // that is what `validateLevel` requires.
  const solution: Record<string, number> = {};
  for (const g of level.generators) solution[g.id] = 0;
  let presses = 0;
  let at: string | undefined = goal;
  while (at) {
    const step = cameFrom.get(at);
    if (!step) break;
    solution[steps[step.gen].id]++;
    presses++;
    at = step.prev;
  }
  return { solution, presses };
}
