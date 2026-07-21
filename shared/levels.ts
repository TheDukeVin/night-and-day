// The Starter pack: 50 levels that increase in difficulty gently, so
// elementary-school players always have a small next step. New concepts are
// introduced one at a time, each followed by extra practice before the next
// idea arrives. Every level's `solution` is checked by `npm run verify-levels`.

import type { GeneratorDef, LevelDef } from './types.ts';

function gen(id: string, side: 'day' | 'night', outputs: [string, number][]): GeneratorDef {
  return {
    id,
    side,
    outputs: outputs.map(([color, count]) => ({ color: color as GeneratorDef['outputs'][0]['color'], count })),
  };
}

export const STARTER_LEVELS: LevelDef[] = [
  // --- Addition: count the gap, one crystal at a time ---
  {
    index: 1,
    name: 'First Light',
    concept: 'Counting up',
    intro:
      'Each color needs the same number of day and night crystals. Walk to the glowing day generator and click it to add day crystals until the sides match, then press Balance!',
    initial: { red: { day: 2, night: 4 } },
    generators: [gen('d1', 'day', [['red', 1]])],
    solution: { d1: 2 },
  },
  {
    index: 2,
    name: "Night's Turn",
    concept: 'Counting up',
    intro:
      'This time the night side needs help. Night generators sparkle with stars — click one to add night crystals.',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('n1', 'night', [['red', 1]])],
    solution: { n1: 4 },
  },
  {
    index: 3,
    name: 'A Wider Gap',
    concept: 'Counting up',
    initial: { red: { day: 1, night: 8 } },
    generators: [gen('d1', 'day', [['red', 1]])],
    solution: { d1: 7 },
  },
  {
    index: 4,
    name: 'Starlit Climb',
    concept: 'Counting up',
    initial: { red: { day: 9, night: 3 } },
    generators: [gen('n1', 'night', [['red', 1]])],
    solution: { n1: 6 },
  },

  // --- Skip counting: one press makes a whole group ---
  {
    index: 5,
    name: 'Two at a Time',
    concept: 'Skip counting by 2',
    intro: 'This generator makes TWO crystals with every press. How many presses will you need?',
    initial: { red: { day: 5, night: 3 } },
    generators: [gen('n1', 'night', [['red', 2]])],
    solution: { n1: 1 },
  },
  {
    index: 6,
    name: 'Three at a Time',
    concept: 'Skip counting by 3',
    intro: 'Now every press makes THREE crystals. Count by threes to close the gap.',
    initial: { red: { day: 2, night: 11 } },
    generators: [gen('d1', 'day', [['red', 3]])],
    solution: { d1: 3 },
  },
  {
    index: 7,
    name: 'Five at a Time',
    concept: 'Skip counting by 5',
    initial: { red: { day: 10, night: 0 } },
    generators: [gen('n1', 'night', [['red', 5]])],
    solution: { n1: 2 },
  },

  // --- Both sides can grow ---
  {
    index: 8,
    name: 'Both Awake',
    concept: 'Both sides can grow',
    intro: 'Both sides have a generator now. Grow them until day and night meet.',
    initial: { red: { day: 2, night: 4 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 3, n1: 1 },
  },
  {
    index: 9,
    name: 'Meet in the Middle',
    concept: 'Both sides can grow',
    initial: { red: { day: 0, night: 3 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 2, n1: 1 },
  },
  {
    index: 10,
    name: 'Racing Along',
    concept: 'Growing at different speeds',
    intro: 'One side grows faster than the other. Watch both speeds to make them meet.',
    initial: { red: { day: 3, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 2, n1: 2 },
  },
  {
    index: 11,
    name: 'Catching Up',
    concept: 'Growing at different speeds',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 2 },
  },
  {
    index: 12,
    name: 'A Steady Chase',
    concept: 'Growing at different speeds',
    initial: { red: { day: 4, night: 3 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 4, n1: 3 },
  },

  // --- Groups of different sizes ---
  {
    index: 13,
    name: 'Threes and Twos',
    concept: 'Groups of 3 and 2',
    initial: { red: { day: 3, night: 0 } },
    generators: [gen('d1', 'day', [['red', 3]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 1, n1: 3 },
  },
  {
    index: 14,
    name: 'Twos and Fives',
    concept: 'Groups of 2 and 5',
    initial: { red: { day: 11, night: 3 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['red', 5]])],
    solution: { d1: 1, n1: 2 },
  },
  {
    index: 15,
    name: 'Fours and Threes',
    concept: 'Groups of 4 and 3',
    initial: { red: { day: 1, night: 0 } },
    generators: [gen('d1', 'day', [['red', 4]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 3 },
  },
  {
    index: 16,
    name: 'Fives and Threes',
    concept: 'Groups of 5 and 3',
    initial: { red: { day: 1, night: 8 } },
    generators: [gen('d1', 'day', [['red', 5]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 1 },
  },

  // --- A second color: each color counts on its own ---
  {
    index: 17,
    name: 'True Blue',
    concept: 'A new color',
    intro: 'A new color appears! Blue crystals balance just like red ones — each color counts on its own.',
    initial: { blue: { day: 2, night: 0 } },
    generators: [gen('n1', 'night', [['blue', 1]])],
    solution: { n1: 2 },
  },
  {
    index: 18,
    name: 'Blue on Both Sides',
    concept: 'One color, both sides',
    initial: { blue: { day: 1, night: 4 } },
    generators: [gen('d1', 'day', [['blue', 2]]), gen('n1', 'night', [['blue', 1]])],
    solution: { d1: 2, n1: 1 },
  },
  {
    index: 19,
    name: 'Two Colors, Two Jobs',
    concept: 'Balancing colors separately',
    intro: 'Two colors at once! Balance each one on its own — red does not care about blue.',
    initial: { red: { day: 1, night: 2 }, blue: { day: 1, night: 3 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('d2', 'day', [['blue', 1]])],
    solution: { d1: 1, d2: 2 },
  },
  {
    index: 20,
    name: 'Two Colors, Two Sides',
    concept: 'Two colors, two gaps',
    initial: { red: { day: 2, night: 5 }, blue: { day: 4, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['blue', 1]])],
    solution: { d1: 3, n1: 3 },
  },
  {
    index: 21,
    name: 'Crossed Colors',
    concept: 'Helping the other side',
    intro: 'Day makes blue and night makes red — each side fills the gap the other side needs.',
    initial: { red: { day: 3, night: 0 }, blue: { day: 0, night: 4 } },
    generators: [gen('d1', 'day', [['blue', 1]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 4, n1: 3 },
  },
  {
    index: 22,
    name: 'Trading Colors',
    concept: 'Helping the other side',
    initial: { red: { day: 6, night: 0 }, blue: { day: 0, night: 8 } },
    generators: [gen('d1', 'day', [['blue', 2]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 4, n1: 3 },
  },
  {
    index: 23,
    name: 'Odd One Out',
    concept: 'Two colors, two gaps',
    initial: { red: { day: 4, night: 0 }, blue: { day: 2, night: 3 } },
    generators: [gen('d1', 'day', [['blue', 1]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 1, n1: 2 },
  },
  {
    index: 24,
    name: 'Different Groups',
    concept: 'Two colors, different groups',
    initial: { red: { day: 1, night: 7 }, blue: { day: 5, night: 1 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['blue', 2]])],
    solution: { d1: 3, n1: 2 },
  },
  {
    index: 25,
    name: 'Pick Your Helper',
    concept: 'Adding groups to make 5',
    intro: 'Night has two red generators — maybe you need both of them!',
    initial: { red: { day: 6, night: 1 }, blue: { day: 1, night: 7 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('n1', 'night', [['red', 2]]),
      gen('n2', 'night', [['red', 3]]),
    ],
    solution: { d1: 3, n1: 1, n2: 1 },
  },
  {
    index: 26,
    name: 'Two Helpers',
    concept: 'Adding groups together',
    initial: { red: { day: 5, night: 1 }, blue: { day: 0, night: 8 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('d2', 'day', [['blue', 3]]),
      gen('n1', 'night', [['red', 1]]),
    ],
    solution: { d1: 1, d2: 2, n1: 4 },
  },

  // --- Combined generators: one press changes two colors ---
  {
    index: 27,
    name: 'Two in One',
    concept: 'One press, two colors',
    intro: 'This generator makes a red AND a blue crystal every press. One button, two colors!',
    initial: { red: { day: 0, night: 4 }, blue: { day: 0, night: 4 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 4 },
  },
  {
    index: 28,
    name: 'Two for One',
    concept: 'One press changes two colors',
    intro: 'Careful — the day generator makes two colors, but night only fixes one of them!',
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
  {
    index: 29,
    name: 'Double Duty',
    concept: 'One press, two colors',
    initial: { red: { day: 0, night: 4 }, blue: { day: 2, night: 5 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [['blue', 1]]),
    ],
    solution: { d1: 4, n1: 1 },
  },
  {
    index: 30,
    name: 'Tangled Pair',
    concept: 'Untangling two colors',
    initial: { blue: { day: 4, night: 0 }, red: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [['red', 1]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 5, n1: 4 },
  },
  {
    index: 31,
    name: 'Woven Threads',
    concept: 'Untangling groups',
    initial: { red: { day: 4, night: 0 }, blue: { day: 0, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 2],
      ]),
    ],
    solution: { d1: 4, n1: 4 },
  },
  {
    index: 32,
    name: 'Double Blues',
    concept: 'One color decides the other',
    initial: { red: { day: 3, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 2],
      ]),
    ],
    solution: { d1: 6, n1: 3 },
  },
  {
    index: 33,
    name: 'The Extra Helper',
    concept: 'Not every helper is needed',
    intro: 'Two red helpers, but you might only need one. Which one makes the gap exactly?',
    initial: { red: { day: 6, night: 0 }, blue: { day: 0, night: 2 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [['red', 2]]),
      gen('n2', 'night', [['red', 3]]),
    ],
    solution: { d1: 2, n1: 0, n2: 2 },
  },
  {
    index: 34,
    name: 'Fair Trade',
    concept: 'Working out the order',
    initial: { red: { day: 4, night: 1 }, blue: { day: 1, night: 0 } },
    generators: [
      gen('d1', 'day', [['blue', 2]]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 1, n1: 3 },
  },
  {
    index: 35,
    name: 'Careful Order',
    concept: 'Working out the order',
    initial: { red: { day: 2, night: 1 }, blue: { day: 1, night: 5 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('n1', 'night', [['red', 1]]),
    ],
    solution: { d1: 2, n1: 3 },
  },
  {
    index: 36,
    name: 'Two Tangles',
    concept: 'Two tangled pairs',
    initial: { red: { day: 0, night: 2 }, blue: { day: 1, night: 3 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('n1', 'night', [
        ['red', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, n1: 1 },
  },

  // --- Three colors: simple systems ---
  {
    index: 37,
    name: 'Three Threads',
    concept: 'Three colors to juggle',
    intro: 'Green joins the party! Keep an eye on all three colors at once.',
    initial: { red: { day: 3, night: 0 }, green: { day: 1, night: 0 }, blue: { day: 0, night: 2 } },
    generators: [
      gen('d1', 'day', [['blue', 1]]),
      gen('n1', 'night', [['red', 1]]),
      gen('n2', 'night', [['green', 1]]),
    ],
    solution: { d1: 2, n1: 3, n2: 1 },
  },
  {
    index: 38,
    name: 'Green Grows',
    concept: 'Three colors, one each',
    initial: {
      red: { day: 4, night: 2 },
      green: { day: 1, night: 3 },
      blue: { day: 3, night: 1 },
    },
    generators: [
      gen('d1', 'day', [['green', 1]]),
      gen('n1', 'night', [['red', 1]]),
      gen('n2', 'night', [['blue', 1]]),
    ],
    solution: { d1: 2, n1: 2, n2: 2 },
  },
  {
    index: 39,
    name: 'Three in Balance',
    concept: 'Three colors, bigger groups',
    initial: {
      red: { day: 5, night: 1 },
      green: { day: 0, night: 4 },
      blue: { day: 2, night: 6 },
    },
    generators: [
      gen('d1', 'day', [['green', 2]]),
      gen('d2', 'day', [['blue', 2]]),
      gen('n1', 'night', [['red', 2]]),
    ],
    solution: { d1: 2, d2: 2, n1: 2 },
  },
  {
    index: 40,
    name: 'Trading Places',
    concept: 'Three colors, tangled together',
    initial: { blue: { day: 2, night: 0 }, red: { day: 0, night: 1 }, green: { day: 0, night: 3 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['green', 1],
      ]),
      gen('n1', 'night', [['red', 1]]),
      gen('n2', 'night', [['blue', 1]]),
    ],
    solution: { d1: 3, n1: 2, n2: 2 },
  },
  {
    index: 41,
    name: 'A Shared Helper',
    concept: 'Three colors with a combined generator',
    initial: {
      red: { day: 0, night: 5 },
      green: { day: 0, night: 2 },
      blue: { day: 4, night: 0 },
    },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['green', 1],
      ]),
      gen('d2', 'day', [['red', 1]]),
      gen('n1', 'night', [['blue', 1]]),
    ],
    solution: { d1: 2, d2: 3, n1: 4 },
  },
  {
    index: 42,
    name: 'Three Threads Twist',
    concept: 'Three colors together',
    initial: {
      red: { day: 6, night: 0 },
      green: { day: 0, night: 3 },
      blue: { day: 1, night: 5 },
    },
    generators: [
      gen('d1', 'day', [['green', 1]]),
      gen('d2', 'day', [['blue', 2]]),
      gen('n1', 'night', [['red', 2]]),
    ],
    solution: { d1: 3, d2: 2, n1: 3 },
  },
  {
    index: 43,
    name: 'The Long Way Round',
    concept: 'Big moves, careful counting',
    initial: { red: { day: 5, night: 0 }, blue: { day: 0, night: 2 }, green: { day: 0, night: 1 } },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 2],
      ]),
      gen('d2', 'day', [['green', 1]]),
      gen('n1', 'night', [
        ['red', 2],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, d2: 1, n1: 4 },
  },
  {
    index: 44,
    name: 'A Busy Sky',
    concept: 'Three colors and a combined generator',
    initial: {
      red: { day: 0, night: 4 },
      blue: { day: 0, night: 6 },
      green: { day: 2, night: 0 },
    },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('d2', 'day', [['blue', 1]]),
      gen('n1', 'night', [['green', 1]]),
    ],
    solution: { d1: 4, d2: 2, n1: 2 },
  },
  {
    index: 45,
    name: 'Four Corners',
    concept: 'Four generators, pick wisely',
    intro: 'Four generators now — but one of them you will not need at all.',
    initial: {
      red: { day: 1, night: 5 },
      green: { day: 4, night: 0 },
      blue: { day: 0, night: 3 },
    },
    generators: [
      gen('d1', 'day', [['red', 2]]),
      gen('d2', 'day', [['blue', 1]]),
      gen('n1', 'night', [['green', 1]]),
      gen('n2', 'night', [['red', 1]]),
    ],
    solution: { d1: 2, d2: 3, n1: 4, n2: 0 },
  },
  {
    index: 46,
    name: 'Tangled Sky',
    concept: 'Three colors, one combined pair',
    initial: {
      red: { day: 0, night: 3 },
      green: { day: 5, night: 2 },
      blue: { day: 0, night: 1 },
    },
    generators: [
      gen('d1', 'day', [['red', 1]]),
      gen('d2', 'day', [['blue', 2]]),
      gen('n1', 'night', [
        ['green', 1],
        ['blue', 1],
      ]),
    ],
    solution: { d1: 3, d2: 2, n1: 3 },
  },
  {
    index: 47,
    name: 'Balancing Act',
    concept: 'Keeping every color in balance',
    initial: {
      red: { day: 3, night: 0 },
      green: { day: 0, night: 4 },
      blue: { day: 2, night: 8 },
    },
    generators: [
      gen('n1', 'night', [['red', 1]]),
      gen('d1', 'day', [['green', 2]]),
      gen('d2', 'day', [['blue', 3]]),
      gen('n2', 'night', [['green', 2]]),
    ],
    solution: { n1: 3, d1: 2, d2: 2, n2: 0 },
  },
  {
    index: 48,
    name: 'The Clever Sky',
    concept: 'A combined helper for two colors',
    initial: {
      red: { day: 0, night: 4 },
      green: { day: 0, night: 6 },
      blue: { day: 5, night: 1 },
    },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['green', 1],
      ]),
      gen('d2', 'day', [['green', 1]]),
      gen('n1', 'night', [['blue', 2]]),
    ],
    solution: { d1: 4, d2: 2, n1: 2 },
  },
  {
    index: 49,
    name: 'One Last Practice',
    concept: 'Everything you have learned',
    initial: {
      red: { day: 0, night: 3 },
      green: { day: 4, night: 0 },
      blue: { day: 1, night: 2 },
    },
    generators: [
      gen('d1', 'day', [
        ['red', 1],
        ['blue', 1],
      ]),
      gen('d2', 'day', [['green', 2]]),
      gen('n1', 'night', [['blue', 2]]),
      gen('n2', 'night', [['green', 1]]),
    ],
    solution: { d1: 3, d2: 0, n1: 1, n2: 4 },
  },
  {
    index: 50,
    name: 'Grand Balance',
    concept: 'Everything together',
    intro: 'The final level! Three colors, four generators — bring the whole sky into balance.',
    initial: { red: { day: 1, night: 0 }, green: { day: 1, night: 3 } },
    generators: [
      gen('d1', 'day', [
        ['green', 2],
        ['blue', 1],
      ]),
      gen('d2', 'day', [['red', 1]]),
      gen('n1', 'night', [['blue', 2]]),
      gen('n2', 'night', [
        ['green', 1],
        ['red', 1],
      ]),
    ],
    solution: { d1: 2, d2: 1, n1: 1, n2: 2 },
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
