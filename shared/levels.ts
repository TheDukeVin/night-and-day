// The Starter pack: 20 levels increasing in difficulty.
// Every level's `solution` is checked by `npm run verify-levels`.

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
    name: 'Two at a Time',
    concept: 'Skip counting by 2',
    intro: 'This generator makes TWO crystals with every press. How many presses will you need?',
    initial: { red: { day: 5, night: 3 } },
    generators: [gen('n1', 'night', [['red', 2]])],
    solution: { n1: 1 },
  },
  {
    index: 4,
    name: 'Meet in the Middle',
    concept: 'Both sides can grow',
    intro: 'Both sides have a generator now. Where will day and night meet?',
    initial: { red: { day: 0, night: 3 } },
    generators: [gen('d1', 'day', [['red', 2]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 2, n1: 1 },
  },
  {
    index: 5,
    name: 'Catching Up',
    concept: 'Growing at different speeds',
    initial: { red: { day: 5, night: 1 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 2 },
  },
  {
    index: 6,
    name: 'Threes and Twos',
    concept: 'Groups of 3 and 2',
    initial: { red: { day: 3, night: 0 } },
    generators: [gen('d1', 'day', [['red', 3]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 1, n1: 3 },
  },
  {
    index: 7,
    name: 'Fours and Threes',
    concept: 'Groups of 4 and 3',
    initial: { red: { day: 1, night: 0 } },
    generators: [gen('d1', 'day', [['red', 4]]), gen('n1', 'night', [['red', 3]])],
    solution: { d1: 2, n1: 3 },
  },
  {
    index: 8,
    name: 'True Blue',
    concept: 'A new color',
    intro: 'A new color appears! Blue crystals balance just like red ones — each color counts on its own.',
    initial: { blue: { day: 2, night: 0 } },
    generators: [gen('n1', 'night', [['blue', 1]])],
    solution: { n1: 2 },
  },
  {
    index: 9,
    name: 'Two Colors, Two Jobs',
    concept: 'Balancing colors separately',
    initial: { red: { day: 1, night: 2 }, blue: { day: 1, night: 3 } },
    generators: [gen('d1', 'day', [['red', 1]]), gen('d2', 'day', [['blue', 1]])],
    solution: { d1: 1, d2: 2 },
  },
  {
    index: 10,
    name: 'Crossed Colors',
    concept: 'Helping the other side',
    intro: 'Day makes blue and night makes red — each side fills the gap the other side needs.',
    initial: { red: { day: 3, night: 0 }, blue: { day: 0, night: 4 } },
    generators: [gen('d1', 'day', [['blue', 1]]), gen('n1', 'night', [['red', 1]])],
    solution: { d1: 4, n1: 3 },
  },
  {
    index: 11,
    name: 'Odd One Out',
    concept: 'Two colors, two gaps',
    initial: { red: { day: 4, night: 0 }, blue: { day: 2, night: 3 } },
    generators: [gen('d1', 'day', [['blue', 1]]), gen('n1', 'night', [['red', 2]])],
    solution: { d1: 1, n1: 2 },
  },
  {
    index: 12,
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

  // --- Combined generators: one press changes two colors ---
  {
    index: 13,
    name: 'Two for One',
    concept: 'One press changes two colors',
    intro: 'Careful — this day generator makes a red AND a blue crystal at the same time!',
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
    index: 14,
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
    index: 15,
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
    index: 16,
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

  // --- Three colors: simple Diophantine systems ---
  {
    index: 17,
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
    index: 18,
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
    index: 19,
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
    index: 20,
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
