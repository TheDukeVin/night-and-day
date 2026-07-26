# Night and Day — project guide

Browser-based 3D math puzzle game: three.js + TypeScript + Vite client, Node + `ws`
WebSocket server for two-player rooms, and a `shared/` package holding all game
logic and level data. See README.md for the gameplay overview.

**Target audience: elementary-school students.** Everything — puzzle math, UI
text, onboarding, and difficulty pacing — must stay approachable for young
children. Keep numbers small, introduce one new idea at a time, and always leave
a gentle next step.

## Commands

```bash
npm run dev            # client (Vite, :5173) + game server (tsx watch, :8787) together
npm run dev:client     # client only
npm run dev:server     # server only
npm run build          # build client into client/dist
npm start              # production: server on :8787 serves client/dist + ws rooms
npm run typecheck      # tsc --noEmit over shared/, server/, client/src
npm run verify-levels  # asserts every level's stored solution balances (run after ANY level edit)
```

Puzzle design helper (2-color balance): `tools/puzzle_explorer.py` BFS-plots the
minimum presses to reach each `(r, b)` crystal-diff state for a generator set.
Pass generators as `dr,db` deltas — use the `--gen=...` form so negatives aren't
read as flags:

```bash
python tools/puzzle_explorer.py                                  # built-in day/night set
python tools/puzzle_explorer.py -g 1,2 -g 2,2 --gen=-3,0 --gen=-2,-1
python tools/puzzle_explorer.py -g 1,2 --gen=-3,0 --bound 20 --save grid.png
```

Dev flow: open http://localhost:5173. In dev, Vite proxies `/ws` to :8787; in
production the WebSocket is same-origin on :8787. Stop stray servers with
`lsof -ti:5173,8787 -sTCP:LISTEN | xargs kill` (npm doesn't forward SIGTERM).

## Architecture rules

- **`shared/` is the single source of truth for game rules.** The pure reducer
  (`shared/logic.ts`), the platformer physics (`shared/terrain.ts`), the ground
  height field (`shared/ground.ts`) and the authoritative `GameSession`
  (`shared/session.ts`) are used by BOTH the server (2-player) and the client's
  `LoopbackChannel` (single-player). Never fork game logic into client- or
  server-only code. `client/src/game/platforms.ts` and `world.ts` are *views* over
  the shared model — a crate must land where it is drawn, so neither keeps its own
  copy of the physics or of the terrain height.
- **Packs go through the registry in `shared/packs.ts`** — never import a level
  array directly. `getLevel(packId, index)` / `levelCount(packId)` are the only
  lookups; `GameState.packId` and the `begin` message carry the pack, and the
  server sanitises an unknown id back to `DEFAULT_PACK_ID`. Two packs ship today:
  **Starter** (`shared/levels.ts`, 40 levels) and **Skyway** (`shared/skyway.ts`,
  the platformer). `registerPack` adds one at runtime — that is how the editor's
  play test works.
- **Level rules live in `shared/validate.ts`** (`validateLevel` → errors +
  warnings). `npm run verify-levels` and the in-browser editor both call it, so
  there is exactly one definition of a valid level.
- **Game state is minimal by design**: level index + per-generator press counts,
  plus (platformer levels only) the terrain — where the crates are and how far
  each arm has grown. Crystal counts are always *derived* via `currentCounts()`.
  Keep it that way — it's what makes networking, hints, and reset trivial.
- **The server is authoritative** in 2-player mode: clients send intents
  (`press`/`balance`/`reset`/`push`/…), the server replies with state. The client
  never decides game state; it predicts the continuous parts and corrects to
  whatever arrives.
- **Levels are data** in `shared/levels.ts`, each with a stored `solution`
  (press counts per generator). Every generator must appear in `solution` (use 0
  for decoys). Levels should generally have generators on both day and night
  sides so 2-player mode requires collaboration (a few early tutorial levels are
  deliberately one-sided; `verify-levels` warns on these). `npm run
  verify-levels` enforces solution correctness — it must pass before a level
  change is done. The pack is **40 levels** (two colors, red + blue) with a
  deliberately gentle difficulty ramp for elementary-school players: introduce
  concepts one at a time (counting → skip-counting → both sides → groups →
  second color → combined generators → the Cycle mechanic) and add extra
  practice levels between each new idea rather than jumping in difficulty. The
  first and last levels set the low/high bounds — new levels should slot
  *between* them, never exceed the finale. Level layout mirrors
  `~/Downloads/Levels - Sheet1.csv`.
- **Two puzzle styles, chosen per level by the optional `cycle` field on
  `LevelDef`:**
  - **Sunset** (no `cycle`): both sides act freely at once; either player may
    press **Balance** whenever the sides match. The original behavior.
  - **Cycle** (`cycle: Side[]`, e.g. `['night','day']` = Cycle Night,
    `['day','night']` = Cycle Day): only the *active* side may press; its
    generators light up while the resting side's are dimmed and unclickable. The
    active player presses **"Pass to <side>"** (which replaces Balance) to hand
    off; the final phase shows Balance. The active side is *derived* from an
    authoritative `phase` counter on `GameState` (advanced by the new `pass`
    intent, reset by `reset`), so both networked clients — and the atmosphere —
    stay in sync. Shared helpers: `isCycle`, `activeSide`, `canPass`, `applyPass`
    (`shared/logic.ts`); `canPress`/`undoIndexFor` now take `state` and gate on
    the active side. `verify-levels` checks cycle turn order covers both sides.
  The **world atmosphere** tracks the active side (`client/src/game/world.ts`,
  `World.setAtmosphere`/`update`): **night** = dark sky with stars + fireflies
  drifting near the player; **day** = bright sky with a sun that arcs so shadows
  sweep across the ground; **sunset** = the original dusk look for Sunset levels.
  It cross-fades on each pass. `GeneratorStand.setActive` dims/undims a pedestal.
- **Platformer levels (the Skyway pack)** add an optional `terrain` field to
  `LevelDef` (stone `platforms`, pushable `boxes`, a `spawn`) and an `at` position
  on each `GeneratorDef`. The balance *rules* are untouched, so a platformer
  level is verified by exactly the same checks as any other — but the **puzzle**
  is no longer a plain linear Diophantine equation. Press counts that balance on
  paper are only a solution if the player can actually reach those generators,
  and reach them **in an order that works**: extending platforms grow and retract
  as the counts change, so a bridge you need may exist only in the middle of a
  press sequence, and a press that balances a color can strand you. Treat a
  stored `solution` as the arithmetic half of the answer — accessibility and
  press order are the other half, and only playing the level checks them.
  `client/src/game/platforms.ts` owns both the meshes and the collision model
  together, because they must agree exactly:
  - Platforms are axis-aligned blocks, solid from the top face down (you go
    around or jump on top, never underneath). Crates are `BOX_SIZE` cubes that
    slide along ONE world axis and **never rotate** — pushing changes position
    only. Anything within `STEP_UP` of your feet is stepped onto for free.
  - `Player` does real vertical physics (`feetY`/`vy`/`grounded`); its jump apex
    (`JUMP_SPEED²/2·GRAVITY` ≈ 2.4) is what the pack's heights are built around —
    a 2-unit step is always reachable, 4 needs a crate. Generator colliders carry
    a `y` so a stand on a platform doesn't wall off the ground below it.
  - **Generators on these levels are step pads, not click targets.** Any level
    that authored a `terrain` block at all is a platformer level
    (`Terrain.isPlatformer` — true even when the geometry is empty, so a pack
    never switches control schemes between its own levels) and sets
    `GameController.stepPads`: clicking generators is disabled
    entirely and `updateStepPads()` fires one press when the player walks into
    the glow ring at a stand's base (`RING_RADIUS` + the player's radius, with a
    slightly wider release radius so hugging the edge doesn't stutter). The pad
    is the ring **on the ground**, so entry needs the player's *feet* at the
    stand's base — `Player.feetHeight` within `STEP_PAD_BAND` (0.4, released at
    0.7). That both keeps a stand up on a platform from firing from the ground
    below and makes **jumping count as leaving**: the apex (~2.4) is far outside
    the band, so hopping in place and landing back in the ring is a fresh entry
    and presses the generator again.
    Press and denial handling is shared with clicking via `attemptPress`. The
    `step-pad` text tip introduces the mechanic.
  - **These levels balance themselves, and have no Undo.** `GameController.autoBalance`
    (also `Terrain.isPlatformer`) sends the `balance` intent the moment
    `applyState` sees every color matched — there is no ⚖ Balance button, and no
    ↶ Undo either, because with crates pushed and platforms grown "take back the
    last press" no longer describes a state you can return to. `Hud.setAutoBalance`
    hides both; a **Pass** button still appears if such a level is ever a Cycle
    level. Nothing changed server-side — the same `balance` message, guarded by
    `solved`, so in 2-player both clients firing it is harmless. The balance
    coach mark and its "press ⚖ Balance" text tip are suppressed here.
  - **Crates and arms are game state, and the session owns them.** Which side of
    a gap a crate ended up on decides whether a generator can be reached at all,
    so they belong in `GameState.terrain` next to the press counts, not in a
    peer-to-peer relay. `GameSession` holds a `TerrainSim` and `tick(dt)`s it —
    the server on a 33 ms interval per started room, single player from the render
    loop via `GameChannel.tick` on `LoopbackChannel`, so both modes run the one
    simulation. It streams `{ t: 'terrain' }` while anything moves and on a 1 s
    heartbeat when nothing does, so no disagreement can outlive a second, and
    every `state` message carries a snapshot too (level load, reset, a peer
    joining mid-level). Two inputs flow the other way, both on a 50 ms timer
    (`REPORT_MS`): `pose` — which is also how the session knows where a body is
    standing — and `push`, "I walked into this crate and it moved this far",
    re-tested against the session's own crate positions before it lands.
    Clients **predict**: `client/src/game/platforms.ts` steps a `TerrainSim` of
    its own every frame (local player + the peer's last pose as bodies), so a push
    moves the crate under your hands with no round trip, and `applySnapshot` turns
    any disagreement into a visual offset that decays over ~0.1 s (snapping past
    1.5 units) instead of a pop. `PlayerPose` carries `y` so a peer up on a
    platform is drawn — and simulated — at the right height.
  - **Extending platforms** (`terrain.extenders`) are the one place the math
    changes the *shape* of a level: a white slab that grows an arm `length` units
    along one of six `dir`s while `when` (color + side + count) matches EXACTLY,
    and retracts the moment it doesn't. Unlike stone they are thin slabs you can
    walk under, and horizontal arms are bridges while `+y`/`-y` grow pillars.
    The *target* is derived from the counts (`setCounts`), and the `reach` that
    eases toward it is authoritative session state like a crate is; the growth
    rate is well under `STEP_UP` per frame, so a rising pillar carries whoever
    stands on it. A **growing** arm also *shoves* whatever is in its way — a
    player (`Player` implements `TerrainBody`) and crates — along the growth axis
    (`inTheWay`/`clearanceOf`). Retracting never shoves. If a shove would drive
    someone into something that isn't moving — ground, wall, crate, another slab —
    `shovesFor` returns null and the platform **holds still**
    (`ExtenderState.stuck`, throbbing) until they walk clear, rather than
    squeezing them through it. Horizontal shoves keep the `STEP_UP` slack (being
    swept onto a low ledge is just walking); a downward shove gets none, because
    being pressed onto a floor *is* the squeeze. Bodies are *reported*, never
    simulated by the session (each client owns its own character and applies its
    own shove), but **both** are registered there from their poses — so a platform
    pausing for a wedged body is one decision both players see, not a local guess.
    `validateLevel` rejects a condition the level can never
    reach (counts only grow from `initial`), and `surfaceUnder` deliberately
    excludes them so nothing is ever authored resting on one. They may sit at
    `y: 0`, **flush with the floor** (stone may not) — a flush slab's mesh is
    nudged up by `FLUSH_LIFT` so it doesn't z-fight the terrain. Visually: white,
    with one mini crystal per crystal the condition wants **set into the top
    face** and **laid out in rows of five** — the same five-across layout the
    crystal stacks use (`COLS_PER_ROW`/`ROWS_PER_LAYER`, 5×2 per layer). A `+y`
    platform grows a pillar out of that face, so its marks ride the top of the
    pillar (`markTopY`) instead of being swallowed. The `extend` text tip
    introduces the mechanic.
- Client screens are plain DOM overlays (`client/src/screens/`, styled by
  `client/src/style.css`); the 3D scene lives in `client/src/game/`. Two extra
  pages hang off a path check in `main.ts` (no separate HTML entry — Vite and the
  server's SPA fallback both serve `index.html`): `/cutscene` and `/editor`. UI text
  targets elementary-school players: hints nudge, they don't explain solutions.
- **First-time onboarding shows each cue only on a player's FIRST encounter with
  that mechanic**, tied to the account — not the browser. The seen-set lives in
  `client/src/mechanics.ts`: server-backed for signed-in players (`/mechanics`
  GET + `/mechanics/seen` POST → `seen_mechanics` table, keyed by user id) so a
  cue never re-shows on any browser once met, and **in-memory per session for
  guests** (never localStorage — a different user on the same browser gets their
  own first-time cues). `configureMechanics(user)` is called wherever
  `configureProgress` is (boot/login/register/logout/guest). Each guidance item
  checks `hasSeenMechanic(id)` before showing and calls `markMechanicSeen(id)`
  when shown. Two layers, distinct id namespaces so they never share a flag:
  - **Visual cues** (`client/src/game/guides.ts`, ids `guide-move|look|balance`,
    styled `.guide-*` in `style.css`): nearly wordless, animated coach
    marks shown **one at a time** in order `move → look → balance`, each
    waiting until the player actually performs the action (tracked via
    `Player.usedKeys`/`turned` and the controller's balance counter)
    before advancing; `move`/`look` also expire after 30s so later cues still
    surface. Form: white so they read against the 3D scene — WASD/Space
    **keycaps** centered toward the left and a **mouse glyph** (drag button
    blinking) centered right, echoing where each control sits; a bouncing
    **arrow** over the glowing Balance button. There is **no `press` cue** —
    the ring-and-hand mark over the nearest generator was removed (for now); the
    scripted walkthrough still uses those same `.guide-press` visuals.
  - **Text tips** (`client/src/game/tutorial.ts`, ids `role-day|role-night|goal|
    multi-output|balance|jump|push|step-pad`): short toasts for what a picture
    can't convey — role (day/night), the balance goal, multi-output, and the
    three Skyway mechanics. The `move`/`generator` tips were intentionally
    removed; the visual cues teach those.
  Both pause/resume with the intro cutscene and respect `settings.showTutorials`
  and `prefers-reduced-motion`. The Skyway mechanics add three text tips
  (`jump`, `push`, `step-pad`), fired from `buildLevel` when a level first has
  platforms, crates, or terrain at all.
- **Tutorial levels** (`tutorial: true` on `LevelDef` — sheet levels 1, 2, 14,
  15) run a *scripted* solution walkthrough (`client/src/game/walkthrough.ts`),
  separate from the once-per-account coach marks: it reads the level's stored
  `solution` + `cycle` order and points at each generator to press (with a "N×"
  count badge), then "Pass to …", then "Balance". Unlike the guides it is **not**
  seen-set-gated — it **replays every visit** (still respecting
  `settings.showTutorials`). Generic press/balance coach marks are suppressed on
  these levels so cues don't double up.

## Conventions

- ESM throughout; **relative imports include the `.ts` extension** (works via
  `allowImportingTsExtensions` + Vite on the client and `tsx` on the server).
- One root `tsconfig.json` covers everything; strict mode; no build step for the
  server (`tsx` runs TypeScript directly).
- No test framework — verification is `verify-levels`, `typecheck`, and driving
  the real app (below). Textures/sprites are generated in code (canvas), no
  binary assets.
- Animations go through the tiny tween helper in `client/src/game/anim.ts`, not
  ad-hoc rAF loops.

## The level editor (`/editor`)

`client/src/editor/` — a top-down plan view (+x right, +z **down** the screen, so
the bottom of the map is where players spawn) for building platformer levels:
draw platforms and extending platforms, drop crates, place generators, edit the
level's math, then
**Play test** (registers a `draft` pack and boots the real `GameController`),
**Two-player test**, **Check** (runs `validateLevel`), or **Download** the level or
pack as JSON in the exact `LevelDef` shape `shared/skyway.ts` holds. Work autosaves
to localStorage.

The **two-player test** is a hot seat: `HotSeatChannel` (`client/src/net/client.ts`)
is the loopback session played as **Day or Night** rather than Dusk, so every side
rule the networked game enforces applies. It is the only channel with the optional
`GameChannel.swap()`, which is how `GameController` knows to bind **P** — pressing
it takes over the other character where it stands (`swapPlayers()`: re-skin both
bodies, exchange positions, re-badge the HUD, re-arm step pads so taking over never
fires a free press). No second renderer, no server, no room.

Two invariants worth keeping:
- Every mutation runs `resettle()`, which drops each crate and generator onto the
  surface beneath it. A floating generator is a level the verifier rejects, so the
  editor simply never lets that state exist. Extending platforms are exempt in
  both directions: they float where you put them, and nothing settles onto one.
- The extender tool draws like the platform tool (drag a rectangle); its arm is
  drawn dashed in the plan view — where the platform *will* be, not where it is.
- `solve.ts` searches the **day−night difference** space, not press counts: one
  press is a fixed vector on that difference, so a BFS finds the minimum-press
  solution directly.

## Driving the app headlessly (verification)

Playwright with the cached headless shell works, but WebGL needs SwiftShader:

```js
chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'],
})
```

- `GameController` exposes itself as `window.__nd` — use it to read player and
  generator positions, project them through `__nd.camera` to click coordinates,
  and inspect `__nd.lastPresses` for sync checks.
- Click the pedestal (generator root + ~1.4y), not the floating crown — the
  crown bobs and clicks miss it.
- Headless FPS is low, so WASD walking is slow: hold keys ~400 ms per step and
  poll positions rather than assuming real-time speeds.
- Two-player tests: two browser contexts, create/join a random room name, host
  clicks "Begin!". Assert cross-client: denial toast for wrong-side presses,
  identical press counts, win dialog on both.
