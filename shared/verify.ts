// Verifies every level of every pack against the shared rules in
// `shared/validate.ts` — the same rules the in-browser level editor checks
// against. Run with `npm run verify-levels`.

import { allPacks } from './packs.ts';
import { validateLevel } from './validate.ts';

let failures = 0;
let checked = 0;

for (const pack of allPacks()) {
  console.log(`\n── ${pack.name} (${pack.id}) ──`);
  for (const level of pack.levels) {
    checked++;
    const { errors, warnings } = validateLevel(level);
    for (const w of warnings) console.warn(`  (note) Level ${level.index} ${w}`);
    if (errors.length > 0) {
      failures++;
      console.error(`✗ Level ${level.index} (${level.name}):`);
      for (const e of errors) console.error(`    ${e}`);
    } else {
      console.log(`✓ Level ${level.index} (${level.name})`);
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} level(s) failed verification`);
  process.exit(1);
}
console.log(`\nAll ${checked} levels verified.`);
