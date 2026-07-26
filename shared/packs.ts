// The pack registry. A pack is just a named, ordered list of levels; every
// lookup in the game goes through `getLevel(packId, index)` so nothing is tied
// to one particular pack any more.
//
// Packs are looked up by id (`GameState.packId`), which is also the key that
// unlock progress is stored under — see `client/src/progress.ts`.

import type { LevelDef } from './types.ts';
import { STARTER_LEVELS } from './levels.ts';
import { SKYWAY_LEVELS } from './skyway.ts';

export interface PackDef {
  id: string;
  /** Display name, also shown by the pack intro cutscene. */
  name: string;
  /** One-line blurb for the pack-select card. */
  description: string;
  /** Card icon (emoji). */
  icon: string;
  levels: LevelDef[];
}

const PACK_LIST: PackDef[] = [
  {
    id: 'starter',
    name: 'Starter Pack',
    icon: '⭐',
    description: '40 levels — counting, adding, groups, and taking turns',
    levels: STARTER_LEVELS,
  },
  {
    id: 'skyway',
    name: 'Skyway Pack',
    icon: '🧗',
    description: 'Jump up stone platforms and push crates to reach the generators',
    levels: SKYWAY_LEVELS,
  },
];

const packs = new Map<string, PackDef>(PACK_LIST.map((p) => [p.id, p]));

/**
 * Add or replace a pack at runtime. The level editor uses this to make the
 * level you are building playable ("Play test") without a rebuild.
 */
export function registerPack(pack: PackDef): void {
  packs.set(pack.id, pack);
}

/** Every pack in menu order. Runtime-registered packs are appended. */
export function allPacks(): PackDef[] {
  return [...PACK_LIST, ...[...packs.values()].filter((p) => !PACK_LIST.includes(p))];
}

export function hasPack(packId: string): boolean {
  return packs.has(packId);
}

export function getPack(packId: string): PackDef {
  const pack = packs.get(packId);
  if (!pack) throw new Error(`No pack "${packId}"`);
  return pack;
}

export function getLevel(packId: string, index: number): LevelDef {
  const level = getPack(packId).levels[index - 1];
  if (!level) throw new Error(`No level ${index} in pack "${packId}"`);
  return level;
}

export function levelCount(packId: string): number {
  return getPack(packId).levels.length;
}

/** The pack a fresh session starts in. */
export const DEFAULT_PACK_ID = 'starter';
