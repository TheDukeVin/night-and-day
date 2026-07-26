// The rules a level has to satisfy, in one place so `npm run verify-levels`
// and the in-browser level editor never disagree about what "valid" means.

import { currentCounts, isBalanced } from './logic.ts';
import { BOX_SIZE } from './skyway.ts';
import type { LevelDef, PlatformDef } from './types.ts';

export interface LevelReport {
  /** Must be empty for the level to ship. */
  errors: string[];
  /** Worth a second look, but not fatal. */
  warnings: string[];
}

/** How far a hand-placed y may sit from a real surface before we complain. */
const SURFACE_EPS = 0.01;

/** The platforms whose footprint covers (x, z). */
export function platformsUnder(level: LevelDef, x: number, z: number): PlatformDef[] {
  return (level.terrain?.platforms ?? []).filter(
    (p) => Math.abs(x - p.x) <= p.w / 2 + 1e-6 && Math.abs(z - p.z) <= p.d / 2 + 1e-6
  );
}

/**
 * The surface something dropped at (x, z) would come to rest on: the highest
 * platform or crate top covering that spot, or the ground (0). This is what the
 * editor uses to place a crate or generator on whatever is beneath the cursor.
 */
export function surfaceUnder(level: LevelDef, x: number, z: number, ignoreId?: string): number {
  let best = 0;
  for (const p of platformsUnder(level, x, z)) {
    if (p.id !== ignoreId && p.y > best) best = p.y;
  }
  for (const b of level.terrain?.boxes ?? []) {
    if (b.id === ignoreId) continue;
    if (Math.abs(x - b.x) > BOX_SIZE / 2 + 1e-6 || Math.abs(z - b.z) > BOX_SIZE / 2 + 1e-6) continue;
    if (b.y + BOX_SIZE > best) best = b.y + BOX_SIZE;
  }
  return best;
}

/** Is `y` the ground, or the top of a platform / crate at this spot? */
function restsOnSurface(level: LevelDef, x: number, y: number, z: number, ignoreId?: string): boolean {
  if (Math.abs(y) < SURFACE_EPS) return true; // the terrain itself
  if (platformsUnder(level, x, z).some((p) => p.id !== ignoreId && Math.abs(p.y - y) < SURFACE_EPS)) return true;
  return (level.terrain?.boxes ?? []).some(
    (b) =>
      b.id !== ignoreId &&
      Math.abs(x - b.x) <= BOX_SIZE / 2 + 1e-6 &&
      Math.abs(z - b.z) <= BOX_SIZE / 2 + 1e-6 &&
      Math.abs(b.y + BOX_SIZE - y) < SURFACE_EPS
  );
}

function checkTerrain(level: LevelDef, errors: string[]): void {
  const terrain = level.terrain;

  for (const g of level.generators) {
    if (terrain && !g.at) errors.push(`generator ${g.id} needs an \`at\` position on a platformer level`);
    if (!terrain && g.at) errors.push(`generator ${g.id} has an \`at\` position but the level has no terrain`);
    if (g.at && !restsOnSurface(level, g.at.x, g.at.y, g.at.z)) {
      errors.push(`generator ${g.id} floats at y=${g.at.y} — no ground, platform or crate top there`);
    }
  }
  if (!terrain) return;

  const ids = new Set<string>();
  for (const p of terrain.platforms) {
    if (ids.has(p.id)) errors.push(`duplicate terrain id ${p.id}`);
    ids.add(p.id);
    if (p.w <= 0 || p.d <= 0) errors.push(`platform ${p.id} has a non-positive size`);
    if (p.y <= 0) errors.push(`platform ${p.id} must stand above the ground (y > 0)`);
  }
  for (const b of terrain.boxes) {
    if (ids.has(b.id)) errors.push(`duplicate terrain id ${b.id}`);
    ids.add(b.id);
    if (!restsOnSurface(level, b.x, b.y, b.z, b.id)) {
      errors.push(`crate ${b.id} floats at y=${b.y} — it must start on the ground or on a platform`);
    }
    // A crate whose footprint is inside a platform's would be stuck forever.
    for (const p of platformsUnder(level, b.x, b.z)) {
      if (p.y > b.y + 1e-6) errors.push(`crate ${b.id} is buried inside platform ${p.id}`);
    }
  }

  for (const p of platformsUnder(level, terrain.spawn?.x ?? 0, terrain.spawn?.z ?? 22)) {
    errors.push(`spawn point is inside platform ${p.id}`);
  }
}

export function validateLevel(level: LevelDef): LevelReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!level.name.trim()) errors.push('level needs a name');
  if (isBalanced(level, {})) errors.push('level is already balanced with zero presses');
  if (level.generators.length === 0) errors.push('level has no generators');
  if (!isBalanced(level, level.solution)) {
    errors.push(`stored solution does not balance: ${JSON.stringify(currentCounts(level, level.solution))}`);
  }
  for (const id of Object.keys(level.solution)) {
    if (!level.generators.some((g) => g.id === id)) errors.push(`solution references unknown generator ${id}`);
  }
  const seen = new Set<string>();
  for (const g of level.generators) {
    if (seen.has(g.id)) errors.push(`duplicate generator id ${g.id}`);
    seen.add(g.id);
    if (!(g.id in level.solution)) errors.push(`generator ${g.id} missing from solution (use 0 if unused)`);
    if (g.outputs.length === 0) errors.push(`generator ${g.id} produces nothing`);
    for (const out of g.outputs) {
      if (out.count <= 0) errors.push(`generator ${g.id} has a non-positive ${out.color} output`);
    }
  }

  // Cycle levels: the turn order must be valid and cover both sides.
  if (level.cycle !== undefined) {
    if (level.cycle.length === 0) errors.push('cycle is empty (omit `cycle` for a Sunset level)');
    for (const s of level.cycle) {
      if (s !== 'day' && s !== 'night') errors.push(`cycle has invalid side ${JSON.stringify(s)}`);
    }
    const cycleSides = new Set(level.cycle);
    for (const g of level.generators) {
      if (!cycleSides.has(g.side)) {
        errors.push(`generator ${g.id} is on ${g.side}, which never becomes active in the cycle`);
      }
    }
    if (new Set(level.generators.map((g) => g.side)).size < 2) {
      errors.push('cycle level must have generators on both sides');
    }
  }

  checkTerrain(level, errors);

  // In a 2-player game both players ideally participate. A few early tutorial
  // levels are deliberately one-sided, so this is a warning, not a failure.
  if (level.index > 1 && new Set(level.generators.map((g) => g.side)).size < 2) {
    warnings.push('has generators on only one side, so 2-player mode needs just one of them');
  }

  return { errors, warnings };
}
