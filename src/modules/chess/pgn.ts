import { ResultReason } from '@prisma/client';
import type { PgnParams } from './types.js';

export function buildPgn(params: PgnParams): string {
  const white = params.white || 'Anonymous';
  const black = params.black || 'Anonymous';

  const date = params.date;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}.${month}.${day}`;

  let gameResult = '*';
  if (params.result === 'WHITE_WIN') gameResult = '1-0';
  else if (params.result === 'BLACK_WIN') gameResult = '0-1';
  else if (params.result === 'DRAW') gameResult = '1/2-1/2';

  const timeControlStr = `${params.timeControl.baseSeconds}+${params.timeControl.incrementSecs}`;

  let terminationStr = 'Normal';
  if (!params.reason) terminationStr = 'Unterminated';
  else if (params.reason === ResultReason.TIMEOUT) terminationStr = 'Time forfeit';
  else if (params.reason === ResultReason.ABANDONED) terminationStr = 'Abandoned';

  const movePairs: string[] = [];
  for (let i = 0; i < params.moves.length; i += 2) {
    const whiteMove = `${Math.floor(i / 2) + 1}. ${params.moves[i]}`;
    const blackMove = params.moves[i + 1];
    movePairs.push(blackMove ? `${whiteMove} ${blackMove}` : whiteMove);
  }

  const escapeTagValue = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const headers = [
    `[White "${escapeTagValue(white)}"]`,
    `[Black "${escapeTagValue(black)}"]`,
    `[Date "${dateStr}"]`,
    `[Result "${gameResult}"]`,
    `[TimeControl "${timeControlStr}"]`,
    `[Termination "${terminationStr}"]`,
  ];
  const movetext = [...movePairs, gameResult].join(' ');

  return `${headers.join('\n')}\n\n${movetext}`;
}
