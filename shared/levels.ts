// The Starter pack: 40 levels that increase in difficulty gently, so
// elementary-school students always have a small next step. New concepts are
// introduced one at a time, each followed by extra practice before the next
// idea arrives: counting up -> skip counting -> both sides -> a second color ->
// combined generators -> the CYCLE mechanic (sides take turns; one passes to
// the other before Balance). Every level's `solution` is checked by
// `npm run verify-levels`.
//
// Two atmospheres:
//   - "Sunset" levels (no `cycle`): both sides act freely, Balance any time.
//   - "Cycle" levels (`cycle: [...]`): only the active side may press; the
//     active player passes to hand off, and the last side presses Balance.
//     Cycle Night starts at night -> day; Cycle Day starts at day -> night.

import type { GeneratorDef, LevelDef } from './types.ts';

function gen(id: string, side: 'day' | 'night', outputs: [string, number][]): GeneratorDef {
  return {
    id,
    side,
    outputs: outputs.map(([color, count]) => ({ color: color as GeneratorDef['outputs'][0]['color'], count })),
  };
}

export const STARTER_LEVELS: LevelDef[] = [
  // --- Counting up: close the gap one crystal at a time ---
  {
    index: 1,
    name: 'First Light',
    concept: 'Counting up',
    intro:
      'Each color needs the same number of day and night crystals. Walk to the glowing day generator and click it to add day crystals until the sides match, then press Balance!',
    initial: { red: { day: 0, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]])],
    solution: { d1: 1 },
    tutorial: true,
  },
  {
    index: 2,
    name: "Night's Turn",
    concept: 'Counting up',
    intro:
      'This time the night side needs help. Night generators sparkle with stars — click one to add night crystals until the sides match.',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('n1', 'night', [['red', 1]])],
    solution: { n1: 4 },
    tutorial: true,
  },
  {
    index: 3,
    name: 'A Small Gap',
    concept: 'Counting up',
    initial: { red: { day: 2, night: 4 } },
    generators: [gen('d1', 'day', [['red', 1]])],
    solution: { d1: 2 },
  },
  {
    index: 4,
    name: 'Two at a Time',
    concept: 'Skip counting by 2',
    intro: 'This generator makes TWO crystals with every press. How many presses will you need?',
    initial: { red: { day: 4, night: 0 } },
    generators: [gen('n1', 'night', [['red', 2]])],
    solution: { n1: 2 },
  },

  // --- Both sides can grow ---
  {
    index: 5,
    name: 'Both Awake',
    concept: 'Both sides can grow',
    intro: 'Both sides have a generator now. Grow them until day and night meet in the middle.',
    initial: { red: { day: 1, night: 4 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 2, n1: 1 },
  },
  {
    index: 6,
    name: 'Racing Along',
    concept: 'Growing at different speeds',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 2 },
  },
  {
    index: 7,
    name: 'Groups Meet',
    concept: 'Growing at different speeds',
    initial: { red: { day: 3, night: 0 } },
    generators: [gen('d1', 'day', [['red', 3]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 1, n1: 3 },
  },
  {
    index: 8,
    name: 'Fours and Threes',
    concept: 'Growing at different speeds',
    initial: { red: { day: 1, night: 0 } },
    generators: [gen('d1', 'day', [['red', 4]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 3 },
  },

  // --- A second color: blue ---
  {
    index: 9,
    name: 'True Blue',
    concept: 'A new color',
    intro: 'Meet blue crystals! Blue works just like red — make the blue sides match too.',
    initial: { blue: { day: 2, night: 0 } },
    generators: [gen('n1', 'night', [['blue', 1]])],
    solution: { n1: 2 },
  },
  {
    index: 10,
    name: 'Two Colors',
    concept: 'One color at a time',
    intro: 'Two colors to balance. Each generator handles just one color — take them one at a time.',
    initial: { red: { day: 1, night: 2 }, blue: { day: 1, night: 3 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('d2', 'day', [['blue', 1]])],
    solution: { d1: 1, d2: 2 },
  },
  {
    index: 11,
    name: 'Trading Sides',
    concept: 'Colors on different sides',
    initial: { red: { day: 3, night: 0 }, blue: { day: 0, night: 4 } },
    generators: [gen('d1', 'day', [['blue', 1]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 4, n1: 3 },
  },
  {
    index: 12,
    name: 'Two Helpers',
    concept: 'Two generators, one side',
    intro: 'The night side has two generators. Mix their presses to reach the goal.',
    initial: { red: { day: 6, night: 1 }, blue: { day: 1, night: 7 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('n1', 'night', [['red', 2]]),
      gen('n2', 'night', [['red', 3]]),
    ],
    solution: { d1: 3, n1: 1, n2: 1 },
  },
  {
    index: 13,
    name: 'Two in One',
    concept: 'One press, two colors',
    intro: 'This generator makes a red AND a blue crystal every press. One button, two colors!',
    initial: { red: { day: 3, night: 1 }, blue: { day: 1, night: 4 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['red', 1]]),
    ],
    solution: { d1: 3, n1: 5 },
  },

  // --- The CYCLE mechanic: take turns, then pass ---
  {
    index: 14,
    name: 'Night First',
    concept: 'Taking turns',
    intro:
      'Something new! Only the ACTIVE side can play. Night goes first — press the night generator, then press "Pass to Day". Then Day finishes and presses Balance.',
    initial: { red: { day: 0, night: 3 }, blue: { day: 2, night: 0 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['blue', 1]])],
    solution: { n1: 2, d1: 3 },
    cycle: ['night', 'day'],
    tutorial: true,
  },
  {
    index: 15,
    name: 'Day First',
    concept: 'Taking turns',
    intro: 'Now Day goes first. Make your changes, press "Pass to Night", and let Night finish up.',
    initial: { red: { day: 1, night: 0 }, blue: { day: 0, night: 4 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['red', 1]]),
    ],
    solution: { d1: 4, n1: 5 },
    cycle: ['day', 'night'],
    tutorial: true,
  },
  {
    index: 16,
    name: 'Night Sets Up',
    concept: 'Taking turns',
    initial: { red: { day: 0, night: 2 }, blue: { day: 0, night: 0 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['blue', 1]]),
    ],
    solution: { n1: 2, d1: 2 },
    cycle: ['night', 'day'],
  },
  {
    index: 17,
    name: 'Day Sets Up',
    concept: 'Taking turns',
    initial: { red: { day: 2, night: 0 }, blue: { day: 1, night: 2 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 2 },
    cycle: ['day', 'night'],
  },
  {
    index: 18,
    name: 'Catch Up After Dark',
    concept: 'Taking turns',
    initial: { red: { day: 0, night: 4 } },
    generators: [gen('d1', 'day', [['red', 3]]), gen('n1', 'night', [['red', 1]])],
    solution: { n1: 2, d1: 2 },
    cycle: ['night', 'day'],
  },
  {
    index: 19,
    name: 'Sunrise Plan',
    concept: 'Taking turns',
    initial: { blue: { day: 4, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 1]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 2],
      ]),
    ],
    solution: { d1: 2, n1: 2 },
    cycle: ['day', 'night'],
  },
  {
    index: 20,
    name: 'Starlight Start',
    concept: 'Taking turns',
    initial: { red: { day: 0, night: 3 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [['blue', 1]]),
    ],
    solution: { n1: 6, d1: 3 },
    cycle: ['night', 'day'],
  },
  {
    index: 21,
    name: 'Morning Balance',
    concept: 'Taking turns',
    initial: { red: { day: 4, night: 1 }, blue: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 1, n1: 3 },
    cycle: ['day', 'night'],
  },

  // --- Back to Sunset: bigger two-color puzzles, both sides free ---
  {
    index: 22,
    name: 'Dusk Duet',
    concept: 'Combined generators',
    intro: 'Back to free play — both sides at once. These generators each make two colors.',
    initial: { red: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [
        ['red', 2],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 1, n1: 1 },
  },
  {
    index: 23,
    name: 'Evening Mix',
    concept: 'Combined generators',
    initial: { red: { day: 5, night: 0 }, blue: { day: 0, night: 2 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [
        ['red', 2],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 4 },
  },
  {
    index: 24,
    name: 'Big Groups',
    concept: 'Skip counting practice',
    initial: { red: { day: 1, night: 0 } },
    generators: [gen('d1', 'day', [['red', 4]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 3 },
  },
  {
    index: 25,
    name: 'Nine and Threes',
    concept: 'Combined generators',
    initial: { red: { day: 9, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [
        ['red', 3],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 3 },
  },
  {
    index: 26,
    name: 'Three Generators',
    concept: 'Planning presses',
    initial: { red: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 2]]),
      gen('d2', 'day', [['blue', 3]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 1, d2: 1, n1: 3 },
  },
  {
    index: 27,
    name: 'Two Night Helpers',
    concept: 'Planning presses',
    initial: { red: { day: 6, night: 0 }, blue: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [['blue', 3]]),
      gen('n1', 'night', [['red', 2]]),
      gen('n2', 'night', [
        ['red', 2],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 1, n1: 1, n2: 2 },
  },
  {
    index: 28,
    name: 'Six All Round',
    concept: 'Combined generators',
    initial: { red: { day: 3, night: 0 }, blue: { day: 0, night: 4 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [
        ['red', 3],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 2 },
  },
  {
    index: 29,
    name: 'Four Generators',
    concept: 'Planning presses',
    initial: { red: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 3]]),
      gen('d2', 'day', [
        ['red', 2],
        ['blue', 1],
      ]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n2', 'night', [['red', 4]]),
    ],
    solution: { d1: 1, d2: 2, n1: 5, n2: 0 },
  },
  {
    index: 30,
    name: 'Sunset Finale',
    concept: 'Everything together',
    initial: { red: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('d2', 'day', [
        ['red', 3],
        ['blue', 1],
      ]),
      gen('n1', 'night', [
        ['red', 2],
        ['blue', 2],
      ]),
    ],
    solution: { d1: 3, d2: 2, n1: 4 },
  },

  // --- Cycle levels return, now with two colors and combined generators ---
  {
    index: 31,
    name: 'Night Builds First',
    concept: 'Taking turns',
    initial: { red: { day: 5, night: 0 }, blue: { day: 0, night: 3 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['red', 1]]),
    ],
    solution: { n1: 8, d1: 3 },
    cycle: ['night', 'day'],
  },
  {
    index: 32,
    name: 'Day Builds First',
    concept: 'Taking turns',
    initial: { blue: { day: 4, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 1]]),
      gen('n1', 'night', [
        ['blue', 1],
        ['red', 2],
      ]),
    ],
    solution: { d1: 8, n1: 4 },
    cycle: ['day', 'night'],
  },
  {
    index: 33,
    name: 'Even the Reds',
    concept: 'Taking turns',
    initial: { red: { day: 5, night: 8 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['blue', 1]]),
    ],
    solution: { n1: 3, d1: 3 },
    cycle: ['night', 'day'],
  },
  {
    index: 34,
    name: 'Nine in the Morning',
    concept: 'Taking turns',
    initial: { red: { day: 9, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [
        ['red', 3],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 3 },
    cycle: ['day', 'night'],
  },
  {
    index: 35,
    name: 'Fives and Threes',
    concept: 'Taking turns',
    initial: { red: { day: 1, night: 7 } },
    generators: [gen('d1', 'day', [['red', 5]]), gen('n1', 'night', [['red', 3]])],
    solution: { n1: 3, d1: 3 },
    cycle: ['night', 'day'],
  },
  {
    index: 36,
    name: 'Sunrise Colors',
    concept: 'Taking turns',
    initial: { blue: { day: 0, night: 2 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [
        ['red', 2],
        ['blue', 3],
      ]),
    ],
    solution: { d1: 4, n1: 2 },
    cycle: ['day', 'night'],
  },
  {
    index: 37,
    name: 'Two Day Helpers',
    concept: 'Taking turns',
    initial: { red: { day: 1, night: 0 }, blue: { day: 0, night: 2 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('d2', 'day', [
        ['red', 2],
        ['blue', 1],
      ]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { n1: 3, d1: 2, d2: 1 },
    cycle: ['night', 'day'],
  },
  {
    index: 38,
    name: 'Two Night Helpers Again',
    concept: 'Taking turns',
    initial: { red: { day: 7, night: 0 }, blue: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 3]]),
      gen('n1', 'night', [['red', 2]]),
      gen('n2', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 2, n1: 0, n2: 7 },
    cycle: ['day', 'night'],
  },
  {
    index: 39,
    name: 'Four Helpers at Night',
    concept: 'Everything together',
    initial: { blue: { day: 5, night: 0 } },
    generators: [
      gen('d1', 'day', [['red', 2]]),
      gen('d2', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n2', 'night', [['blue', 3]]),
    ],
    solution: { d1: 1, d2: 3, n1: 5, n2: 2 },
    cycle: ['night', 'day'],
  },
  {
    index: 40,
    name: 'Grand Balance',
    concept: 'Everything together',
    intro: 'The final level! Day plans first, then passes to Night to bring the whole sky into balance.',
    initial: { red: { day: 2, night: 0 }, blue: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('d2', 'day', [
        ['red', 2],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['red', 3]]),
      gen('n2', 'night', [
        ['red', 1],
        ['blue', 3],
      ]),
    ],
    solution: { d1: 2, d2: 4, n1: 3, n2: 3 },
    cycle: ['day', 'night'],
  },
];

export function getLevel(index: number): LevelDef {
  const level = STARTER_LEVELS[index - 1];
  if (!level) throw new Error(`No level ${index}`);
  return level;
}

export const LEVEL_COUNT = STARTER_LEVELS.length;

/** Pack id used to key unlock progress; free-form for future packs. */
export const STARTER_PACK_ID = 'starter';

/** Display name, shown under the title in the pack intro cutscene. */
export const STARTER_PACK_NAME = 'Starter Pack';
