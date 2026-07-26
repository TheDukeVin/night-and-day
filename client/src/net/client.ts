// Game channel abstraction: the game code talks to one interface whether it's
// a single-player loopback or a real WebSocket to the room server.

import { GameSession } from '../../../shared/session.ts';
import type { ClientMsg, PlayerRole, ServerMsg } from '../../../shared/types.ts';

export interface GameChannel {
  role: PlayerRole;
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  close(): void;
  /**
   * Advance the authoritative simulation by `dt`, for a channel that hosts the
   * session in this tab. The networked channel leaves it out: there the server
   * runs the clock, and its updates arrive as messages like any other.
   */
  tick?(dt: number): void;
  /**
   * Hot seat only: hand the keyboard to the other player and return the role
   * that now holds it. Present on a channel where one person plays both sides
   * (the editor's two-player play test) and absent everywhere else, which is how
   * the game code knows whether swapping is offered at all.
   */
  swap?(): PlayerRole;
}

/** Single-player: run the authoritative session in-memory as Dusk. */
export class LoopbackChannel implements GameChannel {
  role: PlayerRole = 'dusk';
  onMessage: (msg: ServerMsg) => void = () => {};
  protected session = new GameSession();

  constructor(packId: string, startLevel = 1) {
    this.session.startLevel(packId, startLevel);
  }

  send(msg: ClientMsg): void {
    const replies = this.session.handle(this.role, msg);
    // Deliver async so the game code sees the same timing as a network channel.
    queueMicrotask(() => {
      for (const reply of replies) this.onMessage(reply);
    });
  }

  /**
   * Single player still runs the real session — crates and arms included — so
   * the render loop drives its clock here exactly as the server does for a room.
   */
  tick(dt: number): void {
    for (const reply of this.session.tick(dt)) this.onMessage(reply);
  }

  close(): void {}
}

/**
 * Two players, one keyboard. The authoritative session runs in-memory exactly as
 * it does for single player, but this client is Day or Night rather than Dusk —
 * so every side rule the networked game enforces (whose generator, whose turn,
 * whose undo) is enforced here too. Used by the editor's two-player play test to
 * check that a level really does need both sides.
 */
export class HotSeatChannel extends LoopbackChannel {
  role: PlayerRole = 'day';

  swap(): PlayerRole {
    this.role = this.role === 'day' ? 'night' : 'day';
    return this.role;
  }
}

/** Two-player: WebSocket to the room server. */
export class SocketChannel implements GameChannel {
  role: PlayerRole = 'day';
  onMessage: (msg: ServerMsg) => void = () => {};
  private ws: WebSocket;
  private queue: ClientMsg[] = [];
  private open = false;

  constructor(onError: (message: string) => void) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // In dev, Vite proxies /ws to the game server; in production the server
    // itself serves the client so same-origin works directly.
    this.ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws.onopen = () => {
      this.open = true;
      for (const msg of this.queue) this.ws.send(JSON.stringify(msg));
      this.queue = [];
    };
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMsg;
      if (msg.t === 'created' || msg.t === 'joined') this.role = msg.role;
      this.onMessage(msg);
    };
    this.ws.onerror = () => onError('Could not reach the game server.');
    this.ws.onclose = () => {
      if (this.open) this.onMessage({ t: 'peer-left' });
    };
  }

  send(msg: ClientMsg): void {
    if (this.open) this.ws.send(JSON.stringify(msg));
    else this.queue.push(msg);
  }

  close(): void {
    this.open = false;
    this.ws.close();
  }
}
