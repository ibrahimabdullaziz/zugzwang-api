import { Role } from '@prisma/client';
import type { Server } from 'socket.io';

export type ackResponse = { ok: true; data?: unknown } | { ok: false; error: string };

interface ClientToServerEvents {
  'game:join': (data: { gameId: string }, ack: (res: ackResponse) => void) => void;
  'game:move': (data: { gameId: string; uci: string }, ack: (res: ackResponse) => void) => void;
  'game:resign': (data: { gameId: string }, ack: (res: ackResponse) => void) => void;
  'game:draw:offer': (data: { gameId: string }, ack: (res: ackResponse) => void) => void;
  'game:draw:accept': (data: { gameId: string }, ack: (res: ackResponse) => void) => void;
  'game:draw:decline': (data: { gameId: string }, ack: (res: ackResponse) => void) => void;
}

interface ServerToClientEvents {
  'game:state': (state: unknown) => void;
  'game:move': (moveData: { ply: number; san: string; uci: string; fen: string }) => void;
  'game:over': (gameData: { result: string; reason: string }) => void;
  'game:opponent:disconnected': (data: { graceSeconds: number }) => void;
  'game:opponent:reconnected': () => void;
  'game:draw:offered': () => void;
  'game:draw:declined': () => void;
  'game:error': (error: { code: string; message: string }) => void;
}

interface InterServerEvents {
  [key: string]: never;
}

interface SocketData {
  user: {
    id: string;
    role: Role;
  };
}

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
