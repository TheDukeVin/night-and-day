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
