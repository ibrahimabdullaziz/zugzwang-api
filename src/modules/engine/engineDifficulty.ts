type EngineLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface EngineDifficulty {
  level: EngineLevel;
  skillLevel: number;
  targetElo: number;
  moveTime: number;
  useEloLimit: boolean;
  description: string;
}

export const ENGINE_DIFFICULTIES: Record<EngineLevel, EngineDifficulty> = {
  1: {
    level: 1,
    skillLevel: 0,
    targetElo: 800,
    moveTime: 100,
    useEloLimit: true,
    description: 'Beginner',
  },
  2: {
    level: 2,
    skillLevel: 3,
    targetElo: 1100,
    moveTime: 150,
    useEloLimit: false,
    description: 'Casual player',
  },
  3: {
    level: 3,
    skillLevel: 6,
    targetElo: 1400,
    moveTime: 250,
    useEloLimit: true,
    description: 'Intermediate club player',
  },
  4: {
    level: 4,
    skillLevel: 9,
    targetElo: 1700,
    moveTime: 400,
    useEloLimit: true,
    description: 'Strong club player',
  },
  5: {
    level: 5,
    skillLevel: 12,
    targetElo: 2000,
    moveTime: 600,
    useEloLimit: true,
    description: 'Expert',
  },
  6: {
    level: 6,
    skillLevel: 15,
    targetElo: 2300,
    moveTime: 800,
    useEloLimit: true,
    description: 'Master',
  },
  7: {
    level: 7,
    skillLevel: 18,
    targetElo: 2600,
    moveTime: 1000,
    useEloLimit: true,
    description: 'Grandmaster',
  },
  8: {
    level: 8,
    skillLevel: 20,
    targetElo: 3000,
    moveTime: 1500,
    useEloLimit: true,
    description: 'Maximum strength',
  },
};

export function getEngineDifficulty(level: number): EngineDifficulty {
  if (!Number.isInteger(level) || level < 1 || level > 8) {
    throw new Error('Engine level must be between 1 and 8');
  }

  return ENGINE_DIFFICULTIES[level as EngineLevel];
}
