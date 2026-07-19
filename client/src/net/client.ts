// Game channel abstraction: the game code talks to one interface whether it's
// a single-player loopback or a real WebSocket to the room server.

import { GameSession } from '../../../shared/session.ts';
import type { ClientMsg, PlayerRole, ServerMsg } from '../../../shared/types.ts';

export interface GameChannel {
  role: PlayerRole;
  send(msg: ClientMsg): void;
  onMessage: (msg: ServerMsg) => void;
  close(): void;
}

/** Single-player: run the authoritative session in-memory as Dusk. */
export class LoopbackChannel implements GameChannel {
  role: PlayerRole = 'dusk';
  onMessage: (msg: ServerMsg) => void = () => {};
  private session = new GameSession();

  constructor(startLevel = 1) {
    this.session.startLevel(startLevel);
  }

  send(msg: ClientMsg): void {
    const replies = this.session.handle(this.role, msg);
    // Deliver async so the game code sees the same timing as a network channel.
    queueMicrotask(() => {
      for (const reply of replies) this.onMessage(reply);
    });
  }

  close(): void {}
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
