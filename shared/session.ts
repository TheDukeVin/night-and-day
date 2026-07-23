// Authoritative game-session logic, shared by the WebSocket server (2-player)
// and the client-side loopback channel (single-player). Processes client
// messages and returns the server messages to deliver.

import { getLevel, LEVEL_COUNT } from './levels.ts';
import {
  activeSide,
  applyPass,
  applyPress,
  applyReset,
  applyUndo,
  canPass,
  canPress,
  initialGameState,
  isBalanced,
  pickHint,
  undoIndexFor,
} from './logic.ts';
import type { ClientMsg, GameState, PlayerRole, ServerMsg } from './types.ts';

export class GameSession {
  state: GameState = initialGameState(1);

  /** Restart the session at the given level (clamped to the pack). */
  startLevel(index: number): void {
    const clamped = Math.min(Math.max(1, Math.floor(index)), LEVEL_COUNT);
    this.state = initialGameState(clamped);
  }

  /** Handle a message from `role`; returns messages for everyone in the room. */
  handle(role: PlayerRole, msg: ClientMsg): ServerMsg[] {
    const level = getLevel(this.state.levelIndex);
    switch (msg.t) {
      case 'press': {
        if (this.state.solved) return [];
        if (!canPress(level, role, msg.gen, this.state)) {
          return [{ t: 'error', message: 'That generator belongs to the other player!' }];
        }
        this.state = applyPress(this.state, msg.gen);
        return [{ t: 'state', state: this.state }];
      }
      case 'pass': {
        if (this.state.solved) return [];
        if (!canPass(level, this.state)) return [];
        // Only the currently-active side may hand off (Dusk owns both sides).
        if (role !== 'dusk' && role !== activeSide(level, this.state)) {
          return [{ t: 'error', message: 'It is the other side’s turn!' }];
        }
        this.state = applyPass(this.state);
        return [{ t: 'state', state: this.state }];
      }
      case 'balance': {
        if (this.state.solved) return [];
        // On cycle levels, Balance is only valid at the final phase; earlier
        // phases show "Pass" instead, so guard against a stray early balance.
        if (canPass(level, this.state)) return [];
        const win = isBalanced(level, this.state.presses);
        if (win) this.state = { ...this.state, solved: true };
        return [{ t: 'balance-result', win, state: this.state }];
      }
      case 'undo': {
        if (this.state.solved) return [];
        // Undoes this player's own most recent press; the other side's presses
        // are a separate stack and are left untouched. On cycle levels this is
        // limited to the active side's current-phase presses.
        const index = undoIndexFor(level, role, this.state.history, this.state);
        if (index < 0) return [];
        this.state = applyUndo(this.state, index);
        return [{ t: 'state', state: this.state }];
      }
      case 'reset': {
        if (this.state.solved) return [];
        this.state = applyReset(this.state);
        const out: ServerMsg[] = [{ t: 'state', state: this.state }];
        // After a hint was taken and 5 further resets, offer the full answer.
        if (this.state.hintTaken && this.state.resets >= 5) out.push({ t: 'offer-answer' });
        return out;
      }
      case 'hint': {
        this.state = { ...this.state, hintTaken: true, resets: 0 };
        const hint = pickHint(level, this.state.presses);
        return [{ t: 'state', state: this.state }, { t: 'hint', ...hint }];
      }
      case 'answer': {
        return [{ t: 'answer', solution: level.solution }];
      }
      case 'next': {
        if (!this.state.solved) return [];
        const nextIndex = Math.min(this.state.levelIndex + 1, LEVEL_COUNT);
        this.state = initialGameState(nextIndex);
        return [{ t: 'state', state: this.state }];
      }
      default:
        return [];
    }
  }
}
