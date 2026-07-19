// Night and Day game server: serves the built client (production) and hosts
// two-player rooms over WebSocket. The server is authoritative: all game
// actions run through the shared GameSession reducer.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { GameSession } from '../shared/session.ts';
import type { ClientMsg, PlayerRole, ServerMsg } from '../shared/types.ts';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = join(fileURLToPath(new URL('.', import.meta.url)), '../client/dist');

interface Room {
  name: string;
  session: GameSession;
  players: Map<WebSocket, PlayerRole>;
  started: boolean;
}

const rooms = new Map<string, Room>();

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const httpServer = createServer(async (req, res) => {
  try {
    const url = (req.url ?? '/').split('?')[0];
    const safePath = normalize(url).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(DIST, safePath === '/' ? 'index.html' : safePath);
    try {
      const s = await stat(filePath);
      if (s.isDirectory()) filePath = join(filePath, 'index.html');
    } catch {
      filePath = join(DIST, 'index.html'); // SPA fallback
    }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found — run `npm run build` first for production serving.');
  }
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMsg, except?: WebSocket): void {
  for (const ws of room.players.keys()) {
    if (ws !== except) send(ws, msg);
  }
}

wss.on('connection', (ws) => {
  let room: Room | null = null;
  let role: PlayerRole = 'day';

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (msg.t) {
      case 'create': {
        const name = msg.room.trim().toLowerCase();
        if (!name) return send(ws, { t: 'error', message: 'Room name cannot be empty.' });
        if (rooms.has(name)) return send(ws, { t: 'error', message: 'That room name is taken — pick another.' });
        room = { name, session: new GameSession(), players: new Map([[ws, 'day']]), started: false };
        role = 'day';
        rooms.set(name, room);
        send(ws, { t: 'created', room: name, role });
        break;
      }
      case 'join': {
        const name = msg.room.trim().toLowerCase();
        const target = rooms.get(name);
        if (!target) return send(ws, { t: 'error', message: 'No room with that name was found.' });
        if (target.players.size >= 2) return send(ws, { t: 'error', message: 'That room is already full.' });
        room = target;
        role = 'night';
        room.players.set(ws, role);
        send(ws, { t: 'joined', room: name, role });
        broadcast(room, { t: 'peer-joined' }, ws);
        send(ws, { t: 'peer-joined' }); // joiner also learns the host is present
        break;
      }
      case 'begin': {
        if (!room || room.players.size < 2 || role !== 'day') return;
        room.session.startLevel(msg.level);
        room.started = true;
        broadcast(room, { t: 'begin', level: room.session.state.levelIndex });
        broadcast(room, { t: 'state', state: room.session.state });
        break;
      }
      case 'pose': {
        if (room) broadcast(room, { t: 'pose', pose: msg.pose }, ws);
        break;
      }
      default: {
        if (!room || !room.started) return;
        const replies = room.session.handle(role, msg);
        for (const reply of replies) {
          // Errors go only to the offender; everything else is shared state.
          if (reply.t === 'error') send(ws, reply);
          else broadcast(room, reply);
        }
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.players.delete(ws);
    broadcast(room, { t: 'peer-left' });
    if (room.players.size === 0) rooms.delete(room.name);
    room = null;
  });
});

httpServer.listen(PORT, () => {
  console.log(`Night and Day server listening on http://localhost:${PORT} (ws path /ws)`);
});
