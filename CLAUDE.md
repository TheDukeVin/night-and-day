# Night and Day — project guide

Browser-based 3D math puzzle game: three.js + TypeScript + Vite client, Node + `ws`
WebSocket server for two-player rooms, and a `shared/` package holding all game
logic and level data. See README.md for the gameplay overview.

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

Dev flow: open http://localhost:5173. In dev, Vite proxies `/ws` to :8787; in
production the WebSocket is same-origin on :8787. Stop stray servers with
`lsof -ti:5173,8787 -sTCP:LISTEN | xargs kill` (npm doesn't forward SIGTERM).

## Architecture rules

- **`shared/` is the single source of truth for game rules.** The pure reducer
  (`shared/logic.ts`) and the authoritative `GameSession` (`shared/session.ts`)
  are used by BOTH the server (2-player) and the client's `LoopbackChannel`
  (single-player). Never fork game logic into client- or server-only code.
- **Game state is minimal by design**: level index + per-generator press counts.
  Crystal counts are always *derived* via `currentCounts()`. Keep it that way —
  it's what makes networking, hints, and reset trivial.
- **The server is authoritative** in 2-player mode: clients send intents
  (`press`/`balance`/`reset`/…), the server replies with state. The client never
  mutates game state directly; it renders whatever `state` messages arrive.
- **Levels are data** in `shared/levels.ts`, each with a stored `solution`
  (press counts per generator). Every generator must appear in `solution` (use 0
  for decoys). Levels should generally have generators on both day and night
  sides so 2-player mode requires collaboration (a few early tutorial levels are
  deliberately one-sided; `verify-levels` warns on these). `npm run
  verify-levels` enforces solution correctness — it must pass before a level
  change is done.
- Client screens are plain DOM overlays (`client/src/screens/`, styled by
  `client/src/style.css`); the 3D scene lives in `client/src/game/`. UI text
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
  - **Visual cues** (`client/src/game/guides.ts`, ids `guide-move|look|press|
    balance`, styled `.guide-*` in `style.css`): nearly wordless, animated coach
    marks shown **one at a time** in order `move → look → press → balance`, each
    waiting until the player actually performs the action (tracked via
    `Player.usedKeys`/`turned` and the controller's press/balance counters)
    before advancing; `move`/`look` also expire after 30s so later cues still
    surface. Form: white so they read against the 3D scene — WASD/Space
    **keycaps** centered toward the left and a **mouse glyph** (drag button
    blinking) centered right, echoing where each control sits; a pulsing **ring +
    pointing hand** anchored over the nearest pressable generator (projected each
    frame via `pressAnchor()`); a bouncing **arrow** over the glowing Balance
    button.
  - **Text tips** (`client/src/game/tutorial.ts`, ids `role-day|role-night|goal|
    multi-output|balance`): short toasts for what a picture can't convey — role
    (day/night), the balance goal, multi-output. The `move`/`generator` tips were
    intentionally removed; the visual cues teach those.
  Both pause/resume with the intro cutscene and respect `settings.showTutorials`
  and `prefers-reduced-motion`.

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
