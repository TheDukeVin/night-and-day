// Authoritative game-session logic, shared by the WebSocket server (2-player)
// and the client-side loopback channel (single-player). Processes client
// messages and returns the server messages to deliver.
//
// The session owns the *whole* level: the press counts AND the terrain — where
// every crate has ended up and how far each extending arm has grown. That is not
// bookkeeping for its own sake: on a platformer level, which side of a gap a
// crate is on decides whether a generator can be reached, so a crate is as much
// game state as a press count is. `tick` advances it; clients predict it and
// correct to the snapshots that come back.

import { groundHeight } from './ground.ts';
import { DEFAULT_PACK_ID, getLevel, hasPack, levelCount } from './packs.ts';
import {
  activeSide,
  applyPass,
  applyPress,
  applyReset,
  applyUndo,
  canPass,
  canPress,
  currentCounts,
  initialGameState,
  isBalanced,
  pickHint,
  undoIndexFor,
} from './logic.ts';
import { ACTOR_HEIGHT, PLAYER_RADIUS, TerrainSim } from './terrain.ts';
import type { ClientMsg, GameState, LevelDef, PlayerRole, PlayerPose, ServerMsg } from './types.ts';

/** Nothing has moved for this long? Send the terrain anyway, so drift can't last. */
const HEARTBEAT = 1;

export class GameSession {
  state: GameState = initialGameState(DEFAULT_PACK_ID, 1);
  /** The live terrain for the current level. */
  private sim: TerrainSim;
  /** Seconds since the last terrain message went out. */
  private sinceSent = 0;
  /** Whether the terrain has news worth sending. */
  private dirty = false;

  constructor() {
    this.sim = this.buildSim();
  }

  /**
   * Restart the session at the given pack + level. Both come from a client, so
   * both are sanitised here: an unknown pack falls back to the default one, and
   * the level is clamped to that pack's length.
   */
  startLevel(packId: string, index: number): void {
    const pack = hasPack(packId) ? packId : DEFAULT_PACK_ID;
    const clamped = Math.min(Math.max(1, Math.floor(index)), levelCount(pack));
    this.state = initialGameState(pack, clamped);
    this.sim = this.buildSim();
  }

  /**
   * Where a player is standing, from their last pose. Bodies are *reported*, not
   * simulated here — each client owns its own character — but the session still
   * needs them: a growing arm must not pass through someone, and it holds still
   * when it would crush them. Because both bodies are registered here, that
   * decision is finally the same one for both players.
   */
  setPose(role: PlayerRole, pose: PlayerPose): void {
    const feetY = pose.y ?? pose.jump;
    this.sim.setBody(role, {
      pushBox: () => ({ x: pose.x, z: pose.z, feetY, half: PLAYER_RADIUS, height: ACTOR_HEIGHT }),
    });
  }

  /** Forget a player who has left, so their ghost can't block a platform. */
  clearPose(role: PlayerRole): void {
    this.sim.setBody(role, null);
  }

  /**
   * Advance the terrain by `dt` and hand back what the room should hear. Called
   * on a fixed interval by the server and from the render loop by the loopback
   * channel, so single- and two-player run the identical simulation.
   */
  tick(dt: number): ServerMsg[] {
    if (!this.sim.isLive) return [];
    if (this.sim.step(dt)) this.dirty = true;
    this.sinceSent += dt;
    // Stream while anything is moving; otherwise a slow heartbeat, so a client
    // that somehow drifted is put right within a second no matter what.
    if (!this.dirty && this.sinceSent < HEARTBEAT) return [];
    this.dirty = false;
    this.sinceSent = 0;
    this.state = { ...this.state, terrain: this.sim.snapshot() };
    return [{ t: 'terrain', terrain: this.state.terrain! }];
  }

  /** Handle a message from `role`; returns messages for everyone in the room. */
  handle(role: PlayerRole, msg: ClientMsg): ServerMsg[] {
    const level = getLevel(this.state.packId, this.state.levelIndex);
    switch (msg.t) {
      case 'press': {
        if (this.state.solved) return [];
        if (!canPress(level, role, msg.gen, this.state)) {
          return [{ t: 'error', message: 'That generator belongs to the other player!' }];
        }
        this.state = applyPress(this.state, msg.gen);
        this.aimExtenders(level);
        return [this.stateMsg()];
      }
      case 'pass': {
        if (this.state.solved) return [];
        if (!canPass(level, this.state)) return [];
        // Only the currently-active side may hand off (Dusk owns both sides).
        if (role !== 'dusk' && role !== activeSide(level, this.state)) {
          return [{ t: 'error', message: 'It is the other side’s turn!' }];
        }
        this.state = applyPass(this.state);
        return [this.stateMsg()];
      }
      case 'balance': {
        if (this.state.solved) return [];
        // On cycle levels, Balance is only valid at the final phase; earlier
        // phases show "Pass" instead, so guard against a stray early balance.
        if (canPass(level, this.state)) return [];
        const win = isBalanced(level, this.state.presses);
        if (win) this.state = { ...this.state, solved: true };
        return [{ t: 'balance-result', win, state: this.snapshotState() }];
      }
      case 'undo': {
        if (this.state.solved) return [];
        // Undoes this player's own most recent press; the other side's presses
        // are a separate stack and are left untouched. On cycle levels this is
        // limited to the active side's current-phase presses.
        const index = undoIndexFor(level, role, this.state.history, this.state);
        if (index < 0) return [];
        this.state = applyUndo(this.state, index);
        this.aimExtenders(level);
        return [this.stateMsg()];
      }
      case 'pose': {
        // Single player reaches the session this way; in a room the server has
        // already recorded the pose (it relays it to the peer as well).
        this.setPose(role, msg.pose);
        return [];
      }
      case 'push': {
        // A crate a player walked into. Re-run the collision test here, from the
        // session's own crate positions, so a push only lands if it really fits.
        if (this.state.solved) return [];
        this.sim.applyPushes(msg.pushes);
        this.dirty = true;
        return [];
      }
      case 'reset': {
        if (this.state.solved) return [];
        this.state = applyReset(this.state);
        // Starting over puts the crates back on their marks too — otherwise the
        // climbing route would still be solved.
        this.sim.restore();
        this.aimExtenders(level, false);
        this.dirty = true;
        const out: ServerMsg[] = [this.stateMsg()];
        // After a hint was taken and 5 further resets, offer the full answer.
        if (this.state.hintTaken && this.state.resets >= 5) out.push({ t: 'offer-answer' });
        return out;
      }
      case 'hint': {
        this.state = { ...this.state, hintTaken: true, resets: 0 };
        const hint = pickHint(level, this.state.presses);
        return [this.stateMsg(), { t: 'hint', ...hint }];
      }
      case 'answer': {
        return [{ t: 'answer', solution: level.solution }];
      }
      case 'next': {
        if (!this.state.solved) return [];
        const nextIndex = Math.min(this.state.levelIndex + 1, levelCount(this.state.packId));
        const packId = this.state.packId;
        this.state = initialGameState(packId, nextIndex);
        this.sim = this.buildSim();
        return [this.stateMsg()];
      }
      default:
        return [];
    }
  }

  // ---------- Terrain plumbing ----------

  /** A fresh sim for the current level, with its arms already in position. */
  private buildSim(): TerrainSim {
    const level = getLevel(this.state.packId, this.state.levelIndex);
    const sim = new TerrainSim(level.terrain, groundHeight());
    sim.setCounts(currentCounts(level, this.state.presses), false);
    this.state = { ...this.state, terrain: sim.isPlatformer ? sim.snapshot() : null };
    this.dirty = false;
    this.sinceSent = 0;
    return sim;
  }

  /** Point the extending platforms at the counts the presses now imply. */
  private aimExtenders(level: LevelDef, animate = true): void {
    this.sim.setCounts(currentCounts(level, this.state.presses), animate);
    this.dirty = true;
  }

  private stateMsg(): ServerMsg {
    return { t: 'state', state: this.snapshotState() };
  }

  /** The state with the terrain of this instant folded into it. */
  private snapshotState(): GameState {
    this.state = { ...this.state, terrain: this.sim.isPlatformer ? this.sim.snapshot() : null };
    return this.state;
  }
}
