// The ground the whole game stands on.
//
// This lives in `shared/` because the height field is not just scenery: the
// authoritative terrain simulation (`shared/terrain.ts`) asks it what is under a
// crate, so the server and both clients have to agree on it *exactly*. Deriving
// the visible ground and the physics ground from this one seeded function is
// what makes that true by construction.

/** The seed every play session uses, so every player sees the same hills. */
export const WORLD_SEED = 20260719;

/** Small seeded RNG (mulberry32) so terrain is procedural but repeatable. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * How many random numbers the height field draws from its stream. The world
 * renderer seeds its decorations from the same stream, so it skips this many to
 * land where it always has (see `World`).
 */
export const GROUND_NOISE_DRAWS = 16 * 16;

/** Cheap value noise for gentle terrain undulation. */
function makeNoise(rand: () => number): (x: number, z: number) => number {
  const grid = 16;
  const values: number[] = [];
  for (let i = 0; i < grid * grid; i++) values.push(rand());
  const at = (ix: number, iz: number) =>
    values[((iz % grid) + grid) % grid * grid + (((ix % grid) + grid) % grid)];
  return (x, z) => {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = at(ix, iz);
    const b = at(ix + 1, iz);
    const c = at(ix, iz + 1);
    const d = at(ix + 1, iz + 1);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
}

/** Smoothstep between two edges (three.js has one; the server has no three.js). */
function smoothstep(x: number, min: number, max: number): number {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

export type HeightField = (x: number, z: number) => number;

const CACHE = new Map<number, HeightField>();

/**
 * The ground height field for a seed: flat near the play area, gentle rolls
 * further out. Cached per seed, so the server and the renderer can both ask for
 * it freely and always get the identical (and identically-cheap) function.
 */
export function groundHeight(seed: number = WORLD_SEED): HeightField {
  const cached = CACHE.get(seed);
  if (cached) return cached;
  const noise = makeNoise(seededRandom(seed));
  const field: HeightField = (x, z) => {
    const d = Math.sqrt(x * x + z * z);
    const flatten = smoothstep(d, 18, 60); // 0 near center -> 1 far
    return noise(x * 0.04 + 3, z * 0.04 + 7) * 3.2 * flatten;
  };
  CACHE.set(seed, field);
  return field;
}
