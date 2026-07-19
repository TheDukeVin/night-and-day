// Verifies every starter level: the stored solution must balance the level,
// the zero-press state must NOT already be balanced, and solution keys must
// reference real generators. Run with `npm run verify-levels`.

import { STARTER_LEVELS } from './levels.ts';
import { currentCounts, isBalanced } from './logic.ts';

let failures = 0;

for (const level of STARTER_LEVELS) {
  const problems: string[] = [];

  if (isBalanced(level, {})) problems.push('level is already balanced with zero presses');
  if (!isBalanced(level, level.solution)) {
    const counts = currentCounts(level, level.solution);
    problems.push(`stored solution does not balance: ${JSON.stringify(counts)}`);
  }
  for (const id of Object.keys(level.solution)) {
    if (!level.generators.some((g) => g.id === id)) problems.push(`solution references unknown generator ${id}`);
  }
  for (const g of level.generators) {
    if (!(g.id in level.solution)) problems.push(`generator ${g.id} missing from solution (use 0 if unused)`);
  }
  // In a 2-player game both players ideally participate. A few early tutorial
  // levels are deliberately one-sided, so this is a warning, not a failure.
  if (level.index > 1) {
    const sides = new Set(level.generators.map((g) => g.side));
    if (sides.size < 2) console.warn(`  (note) Level ${level.index} has generators on only one side`);
  }

  if (problems.length > 0) {
    failures++;
    console.error(`✗ Level ${level.index} (${level.name}):`);
    for (const p of problems) console.error(`    ${p}`);
  } else {
    console.log(`✓ Level ${level.index} (${level.name})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} level(s) failed verification`);
  process.exit(1);
}
console.log(`\nAll ${STARTER_LEVELS.length} levels verified.`);
