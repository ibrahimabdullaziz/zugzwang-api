import type { Server } from 'socket.io';
import type { Logger } from 'pino';
import type { GameSession } from './GameSession.js';
import type { EnginePool } from '../modules/engine/EnginePool.js';

const scheduledEngineGames = new Set<string>();

function getSkillLevelForLevel(level: number): number {
  return Math.max(0, Math.min(20, level));
}

function getMoveTimeForLevel(level: number): number {
  return 500 + level * 100;
}

export async function scheduleEngineMove(
  session: GameSession,
  io: Server,
  enginePool: EnginePool,
  logger: Logger,
): Promise<void> {
  try {
    const delayTime = Math.random() * 500 + 500;
    await new Promise((resolve) => setTimeout(resolve, delayTime));

    const game = session.game;

    if (game.status !== 'ACTIVE' || game.mode !== 'VS_ENGINE') {
      return;
    }

    const level = game.engineLevel;

    if (level === null) {
      throw new Error('Engine level is missing');
    }

    const evaluation = await enginePool.evaluate(session.gameInstance.fen, {
      moveTime: getMoveTimeForLevel(level),
      skillLevel: getSkillLevelForLevel(level),
    });

    if (session.game.status !== 'ACTIVE') return;

    const move = await session.handleMove('ENGINE', evaluation.bestMoveUci);

    io.to(`game:${session.gameId}`).emit('game:move', {
      ply: move.ply,
      san: move.san,
      uci: move.uci,
      fen: move.fen,
      clocks: move.clocks,
    });
  } catch (error) {
    logger.error({ err: error, gameId: session.gameId }, 'Failed to execute engine move');
  }
}

export function triggerEngineMove(
  session: GameSession,
  io: Server,
  enginePool: EnginePool,
  logger: Logger,
) {
  const gameId = session.gameId;

  if (scheduledEngineGames.has(gameId)) return;

  scheduledEngineGames.add(gameId);

  scheduleEngineMove(session, io, enginePool, logger).finally(() =>
    scheduledEngineGames.delete(gameId),
  );
}
