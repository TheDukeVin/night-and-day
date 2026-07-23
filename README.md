# Night and Day

A 3D math-education puzzle game played in the browser. Balance day ☀ and night 🌙
crystals by pressing crystal generators — each level is secretly a tiny system of
linear Diophantine equations, dressed up as a sunset stroll.

- **Single player**: play as **Dusk**, who can use every generator.
- **Two players**: one player is **Day** (golden generators only), the other is
  **Night** (starry generators only) — you must collaborate to balance the level.
- **Starter pack**: 40 levels ramping gently from simple counting through
  multiplication, differences, and remainder puzzles to two-color systems.
- **Two puzzle styles**: **Sunset** levels let both sides act freely and press
  Balance any time. **Cycle** levels take turns — only the active side may act,
  then presses **"Pass to Day/Night"** to hand off before the last side balances.
  The world shifts with the turn: a starry night with fireflies, or a bright day
  with a sun that arcs so shadows sweep across the ground.
- Stuck? **Reset** offers a hint (how many times to press one generator); after a
  hint plus 5 more resets the game offers the full answer.

## Running

```bash
npm install
npm run dev        # dev: client on http://localhost:5173, game server on :8787
```

Open http://localhost:5173. For two-player, open it in two windows: one creates a
room by name, the other joins it.

```bash
npm run build      # build the client into client/dist
npm start          # production: serves the built client + rooms on :8787
```

## Other scripts

```bash
npm run verify-levels   # asserts every level's stored solution actually balances
npm run typecheck       # tsc over client, server and shared code
```

## Layout

- `shared/` — types, pure game logic, the 40 starter levels (+ verifier), and the
  authoritative `GameSession` used by both the server and single-player loopback.
- `server/` — Node HTTP + WebSocket server: serves the built client and hosts
  two-player rooms (server-authoritative, role-checked).
- `client/` — Vite + TypeScript + three.js game: procedural sunset world, WASD
  third-person movement, clickable generators, balance/annihilation animation,
  DOM menu screens and HUD.
