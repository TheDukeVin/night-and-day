// The Skyway pack: the same balance math as the Starter pack, but the
// generators are no longer all within walking distance. Three new ideas:
//
//   1. Stone platforms you JUMP onto (Space). A generator can sit on top of one.
//   2. Pushable crates. Walk into a crate and it slides — it never turns — so
//      you can park it beside a platform that is too tall to jump and use it as
//      a step.
//   3. Extending platforms: white slabs that grow a bridge (or a pillar) while
//      one crystal count is exactly right, and pull it back in the moment it
//      isn't. The mini crystals on top say which count — so for the first time
//      the ARITHMETIC changes the shape of the level.
//
// Everything else is unchanged: same sunset/day/night atmosphere, same
// generators, same "make day and night match" goal. Only *reaching* a generator
// is new, so the arithmetic stays gentle while the puzzle gets a second layer.
//
// Geometry lives in `terrain` (platforms, crates, extending platforms) and each
// generator carries an explicit `at` position. `npm run verify-levels` checks the
// math AND that every generator actually rests on a surface.
//
// These levels come from the level editor (`/editor`), which is why they are
// plain data with editor-shaped ids.

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
    name: 'Level 1',
    concept: 'Jumping and pushing',
    initial: { red: { day: 0, night: 2 } },
    generators: [gen('d1', 'day', [['red', 1]], { x: -10, y: 0, z: 15 })],
    solution: { d1: 2 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [],
      boxes: [],
    },
  },
  {
    index: 2,
    name: 'Level 2',
    concept: 'Jumping and pushing',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('d1', 'night', [['red', 1]], { x: 10, y: 2, z: 15 })],
    solution: { d1: 4 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [{ id: 'p1', x: 10, z: 15, w: 5, d: 5, y: 2 }],
      boxes: [],
    },
  },
  {
    index: 3,
    name: 'Level 3',
    concept: 'Jumping and pushing',
    initial: { red: { day: 0, night: 6 } },
    generators: [gen('d1', 'day', [['red', 2]], { x: -10, y: 4, z: 15 })],
    solution: { d1: 3 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [{ id: 'p1', x: -10, z: 15, w: 10, d: 10, y: 4 }],
      boxes: [{ id: 'b1', x: 9, z: 14, y: 0 }],
    },
  },
  {
    index: 4,
    name: 'Level 4',
    concept: 'Jumping and pushing',
    initial: { red: { day: 1, night: 4 } },
    generators: [
      gen('d1', 'day', [['red', 2]], { x: -10, y: 4, z: 18 }),
      gen('d2', 'night', [['red', 1]], { x: 10, y: 4, z: 15 }),
    ],
    solution: { d1: 2, d2: 1 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [
        { id: 'p1', x: -10, z: 15, w: 10, d: 10, y: 4 },
        { id: 'p2', x: 10, z: 15, w: 10, d: 10, y: 4 },
        { id: 'p3', x: -10, z: 21, w: 10, d: 2, y: 2 },
      ],
      boxes: [{ id: 'b2', x: -7, z: 14, y: 4 }],
    },
  },
  {
    index: 5,
    name: 'Level 5',
    concept: 'Jumping and pushing',
    initial: { red: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 1]], { x: -10, y: 0, z: 15 }),
      gen('d2', 'night', [['red', 1]], { x: 0, y: 4, z: 12 }),
    ],
    solution: { d1: 0, d2: 1 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [{ id: 'p1', x: 0, z: 12.5, w: 10, d: 5, y: 4 }],
      boxes: [],
      extenders: [
        {
          id: 'e1',
          x: 0,
          z: 16.5,
          w: 4,
          d: 3,
          y: 0,
          dir: '+y',
          length: 2,
          when: { color: 'red', side: 'day', count: 3 },
        },
      ],
    },
  },
  {
    index: 6,
    name: 'Level 6',
    concept: 'Jumping and pushing',
    initial: { red: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [['red', 2]], { x: 10, y: 4, z: 12 }),
      gen('d2', 'night', [['red', 3]], { x: 5, y: 0, z: 20 }),
    ],
    solution: { d1: 2, d2: 1 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [{ id: 'p1', x: 8.5, z: 12.5, w: 13, d: 5, y: 4 }],
      boxes: [],
      extenders: [
        {
          id: 'e1',
          x: -7,
          z: 12.5,
          w: 6,
          d: 5,
          y: 2,
          dir: '+x',
          length: 6,
          when: { color: 'red', side: 'night', count: 7 },
        },
      ],
    },
  },
  {
    index: 7,
    name: 'Level 7',
    concept: 'Jumping and pushing',
    initial: { red: { day: 2, night: 1 } },
    generators: [
      gen('d2', 'day', [['red', 2]], { x: -3.5, y: 6, z: 15.5 }),
      gen('d3', 'night', [['red', 2]], { x: -3, y: 6, z: -12 }),
      gen('d1', 'night', [['red', 4]], { x: -21, y: 0, z: -11 }),
      gen('d4', 'day', [['red', 1]], { x: 7, y: 8, z: 14 }),
    ],
    // Day is even until d4 is pressed and night is always odd, so d4 has to be
    // reached — which is what makes the two towers depend on each other.
    solution: { d1: 1, d2: 2, d3: 1, d4: 1 },
    terrain: {
      spawn: { x: 0, z: 28 },
      platforms: [
        { id: 'p1', x: -16.5, z: 12.5, w: 3, d: 5, y: 2 },
        { id: 'p2', x: 6.5, z: 12.5, w: 3, d: 5, y: 8 },
        { id: 'p3', x: -16.5, z: -12.5, w: 3, d: 5, y: 2 },
        { id: 'p4', x: -2.5, z: -12.5, w: 5, d: 5, y: 6 },
      ],
      boxes: [],
      extenders: [
        {
          id: 'e1',
          x: -13.5,
          z: 12.5,
          w: 3,
          d: 5,
          y: 4,
          dir: '+x',
          length: 6,
          when: { color: 'red', side: 'night', count: 5 },
        },
        // d2 stands on this slab: the arm reaches out, the slab never moves.
        {
          id: 'e2',
          x: -3.5,
          z: 13.5,
          w: 3,
          d: 7,
          y: 6,
          dir: '+x',
          length: 6,
          when: { color: 'red', side: 'night', count: 7 },
        },
        {
          id: 'e3',
          x: -13.5,
          z: -12.5,
          w: 3,
          d: 5,
          y: 4,
          dir: '+x',
          length: 6,
          when: { color: 'red', side: 'day', count: 4 },
        },
      ],
    },
  },
];
