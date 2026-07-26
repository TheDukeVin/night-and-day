// The Skyway pack: the same balance math as the Starter pack, but the
// generators are no longer all within walking distance. Two new ideas, added
// one at a time:
//
//   1. Stone platforms you JUMP onto (Space). A generator can sit on top of one.
//   2. Pushable crates. Walk into a crate and it slides — it never turns — so
//      you can park it beside a platform that is too tall to jump and use it as
//      a step.
//
// Everything else is unchanged: same sunset/day/night atmosphere, same
// generators, same "make day and night match" goal. Only *reaching* a generator
// is new, so the arithmetic stays gentle while the puzzle gets a second layer.
//
// Geometry lives in `terrain` (platforms + crates) and each generator carries an
// explicit `at` position. `npm run verify-levels` checks the math AND that every
// generator actually rests on a surface.

import type { GeneratorDef, LevelDef } from './types.ts';

/** Edge length of a pushable crate. Also its step-up height. */
export const BOX_SIZE = 2;

function gen(
  id: string,
  side: 'day' | 'night',
  outputs: [string, number][],
  at: { x: number; y: number; z: number }
): GeneratorDef {
  return {
    id,
    side,
    outputs: outputs.map(([color, count]) => ({ color: color as GeneratorDef['outputs'][0]['color'], count })),
    at,
  };
}

export const SKYWAY_LEVELS: LevelDef[] = [
  {
    index: 1,
    name: 'Up We Go',
    concept: 'Jumping to a generator',
    intro:
      'Some generators live up on stone platforms now. Press SPACE to jump — hop up to the day generator and get the sides matching!',
    initial: { red: { day: 1, night: 4 } },
    generators: [
      gen('d1', 'day', [['red', 2]], { x: -8, y: 2, z: 18 }),
      gen('n1', 'night', [['red', 1]], { x: 9, y: 0, z: 20 }),
    ],
    solution: { d1: 2, n1: 1 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [{ id: 'p1', x: -8, z: 18, w: 9, d: 9, y: 2 }],
      boxes: [],
    },
  },
  {
    index: 2,
    name: 'Give It a Boost',
    concept: 'Pushing a crate to climb',
    intro:
      'That night platform is too tall to jump! Walk into the stone crate to push it — park it against the platform and use it as a step.',
    initial: { red: { day: 6, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 2]], { x: -9, y: 0, z: 20 }),
      gen('n1', 'night', [['red', 4]], { x: 9, y: 4, z: 18 }),
    ],
    solution: { d1: 1, n1: 2 },
    terrain: {
      spawn: { x: 0, z: 30 },
      platforms: [{ id: 'p1', x: 9, z: 18, w: 9, d: 9, y: 4 }],
      boxes: [{ id: 'b1', x: 9, z: 26, y: 0 }],
    },
  },
  {
    index: 3,
    name: 'Stepping Stones',
    concept: 'Climbing on both sides, in turn',
    intro:
      'Two colors and two heights. Night goes first — climb up, make your presses, then pass to Day.',
    initial: { red: { day: 1, night: 0 }, blue: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [['red', 2]], { x: -6, y: 0, z: 26 }),
      gen('d2', 'day', [['blue', 1]], { x: -12, y: 2, z: 20 }),
      gen('n1', 'night', [['red', 3]], { x: 12, y: 4, z: 18 }),
      gen('n2', 'night', [['blue', 1]], { x: 6, y: 0, z: 26 }),
    ],
    solution: { d1: 1, d2: 2, n1: 1, n2: 1 },
    cycle: ['night', 'day'],
    terrain: {
      spawn: { x: 0, z: 32 },
      platforms: [
        { id: 'p1', x: -12, z: 20, w: 8, d: 8, y: 2 },
        { id: 'p2', x: 12, z: 18, w: 8, d: 8, y: 4 },
      ],
      boxes: [{ id: 'b1', x: 12, z: 27, y: 0 }],
    },
  },
];
