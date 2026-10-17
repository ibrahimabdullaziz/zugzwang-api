import { io as clientIo, Socket } from 'socket.io-client';
import { config } from '../config/env.js';

const SERVER_URL = `http://localhost:${config.server.port}`;

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Starting Socket Play Test...');

  const uniqueId = Date.now();
  const apiUrl = `${SERVER_URL}`;

  const whiteRes = await fetch(`${apiUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `white_${uniqueId}@test.com`,
      username: `white_${uniqueId}`,
      password: 'password123',
    }),
  });
  const whiteResponse = (await whiteRes.json()) as {
    success?: boolean;
    data?: { accessToken?: string; user?: { id?: string } };
    error?: { message?: string };
  };
  if (!whiteRes.ok || !whiteResponse.data?.accessToken || !whiteResponse.data.user?.id) {
    throw new Error(whiteResponse.error?.message ?? 'White user registration failed');
  }
  const whiteToken = whiteResponse.data.accessToken;

  const blackRes = await fetch(`${apiUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `black_${uniqueId}@test.com`,
      username: `black_${uniqueId}`,
      password: 'password123',
    }),
  });
  const blackResponse = (await blackRes.json()) as {
    success?: boolean;
    data?: { accessToken?: string; user?: { id?: string } };
    error?: { message?: string };
  };
  if (!blackRes.ok || !blackResponse.data?.accessToken || !blackResponse.data.user?.id) {
    throw new Error(blackResponse.error?.message ?? 'Black user registration failed');
  }
  const blackToken = blackResponse.data.accessToken;

  console.log('White & Black users registered successfully.');

  const gameRes = await fetch(`${apiUrl}/games`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${whiteToken}`,
    },
    body: JSON.stringify({
      color: 'white',
      rated: false,
      timeControl: { baseSeconds: 300, incrementSecs: 0 },
    }),
  });
  const gameResponse = (await gameRes.json()) as {
    success?: boolean;
    data?: { id?: string; inviteCode?: string };
    error?: { message?: string };
  };
  if (!gameRes.ok || !gameResponse.data?.id || !gameResponse.data.inviteCode) {
    throw new Error(gameResponse.error?.message ?? 'Game creation failed');
  }
  const gameId = gameResponse.data.id;

  const joinRes = await fetch(`${apiUrl}/games/join/${gameResponse.data.inviteCode}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${blackToken}` },
  });
  const joinResponse = (await joinRes.json()) as {
    success?: boolean;
    error?: { message?: string };
  };
  if (!joinRes.ok || !joinResponse.success) {
    throw new Error(joinResponse.error?.message ?? 'Black player could not join the game');
  }

  console.log(`Game created with ID: ${gameId}`);

  const socketWhite: Socket = clientIo(SERVER_URL, {
    auth: { token: whiteToken },
  });

  const socketBlack: Socket = clientIo(SERVER_URL, {
    auth: { token: blackToken },
  });

  await new Promise<void>((resolve) => {
    let connectedCount = 0;
    const check = () => {
      connectedCount++;
      if (connectedCount === 2) resolve();
    };
    socketWhite.on('connect', check);
    socketBlack.on('connect', check);
  });

  console.log('Both sockets connected.');

  socketWhite.emit('game:join', { gameId });
  socketBlack.emit('game:join', { gameId });

  await Promise.all([
    new Promise((r) => socketWhite.once('game:state', r)),
    new Promise((r) => socketBlack.once('game:state', r)),
  ]);

  console.log('Both players joined the room and received game:state.');

  console.log('Running Negative Test 1 (Illegal Move)...');
  const illegalRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socketWhite.emit(
      'game:move',
      { gameId, uci: 'e2e5' },
      (response: { ok: boolean; error?: string }) => resolve(response),
    );
  });
  if (!illegalRes.ok) {
    console.log('Negative Test 1 Passed: Illegal move rejected.', illegalRes.error);
  } else {
    console.error('Negative Test 1 Failed: Illegal move was allowed!');
  }

  console.log('Running Negative Test 2 (Out of Turn)...');
  const outOfTurnRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    socketBlack.emit(
      'game:move',
      { gameId, uci: 'e7e5' },
      (response: { ok: boolean; error?: string }) => resolve(response),
    );
  });
  if (!outOfTurnRes.ok) {
    console.log('Negative Test 2 Passed: Out of turn move rejected.', outOfTurnRes.error);
  } else {
    console.error('Negative Test 2 Failed: Out of turn move was allowed!');
  }

  console.log("Playing Fool's Mate sequence...");

  const playMove = (socket: Socket, uci: string) => {
    return new Promise((resolve) => {
      socket.emit('game:move', { gameId, uci }, resolve);
    });
  };

  await playMove(socketWhite, 'f2f3');
  console.log('White played: f2f3');
  await delay(200);

  await playMove(socketBlack, 'e7e5');
  console.log('Black played: e7e5');
  await delay(200);

  await playMove(socketWhite, 'g2g4');
  console.log('White played: g2g4');
  await delay(200);

  console.log('Black playing d8h4 for Checkmate...');
  const gameOverPromise = new Promise<{ result?: string; reason?: string }>((resolve) => {
    socketWhite.on('game:over', resolve);
    socketBlack.on('game:over', resolve);
  });

  await playMove(socketBlack, 'd8h4');

  const outcome = await gameOverPromise;
  console.log('Game Over received!', outcome);

  if (outcome.result === 'BLACK_WIN' && outcome.reason === 'CHECKMATE') {
    console.log("SUCCESS: Fool's Mate test passed successfully! Black wins by Checkmate.");
  } else {
    console.error('FAILED: Unexpected game over result:', outcome);
  }

  socketWhite.disconnect();
  socketBlack.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Script crashed with error:', err);
  process.exit(1);
});
