import { GameResult } from '@prisma/client';
import { ChessGame } from '../modules/chess/chessGame.js';
import { OutCome } from '../modules/chess/types.js';

function playRandomGame(): OutCome | null {
  const game = new ChessGame();

  while (!game.isGameOver) {
    const moves = game.getLegalMoves();
    if (moves.length === 0) break;
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    if (!randomMove) break;
    game.applyMove(randomMove);
  }

  return game.getOutcome();
}

function runSimulation() {
  const results = { WHITE_WIN: 0, BLACK_WIN: 0, DRAW: 0 };
  const N = 100;

  console.log(`Starting simulation of ${N} random games...`);

  for (let i = 0; i < N; i++) {
    const outcome = playRandomGame();
    if (outcome) {
      if (outcome.result === GameResult.WHITE_WIN) results.WHITE_WIN++;
      else if (outcome.result === GameResult.BLACK_WIN) results.BLACK_WIN++;
      else if (outcome.result === GameResult.DRAW) results.DRAW++;
      console.log(outcome);
    }
  }

  console.log(`Results after ${N} games:`, results);
}

runSimulation();
