import { RatingCategory } from '@prisma/client';
import { cacheRedis } from '../../config/redis.js';
import type { MatchMaker, Pair, QueueEntry } from './matchmaker.js';

const QUEUE_KEY = (category: RatingCategory) => `zz:v1:matchmaking:queue:${category}`;

const ENTRY_KEY = (userId: string) => `zz:v1:matchmaking:entry:${userId}`;

const ENTRY_TTL_SECONDS = 120;

const MATCH_SCRIPT = `
local queueKey = KEYS[1]
local prefix = ARGV[1]
local now = tonumber(ARGV[2])

local players = redis.call('ZRANGE', queueKey, 0, -1, 'WITHSCORES')

for i = 1, #players - 2, 2 do
  local user1 = players[i]
  local rating1 = tonumber(players[i + 1])
  local raw1 = redis.call('GET', prefix .. user1)

  if not raw1 then
    redis.call('ZREM', queueKey, user1)
  else
    local p1 = cjson.decode(raw1)

    for j = i + 2, #players, 2 do
      local user2 = players[j]
      local rating2 = tonumber(players[j + 1])
      local raw2 = redis.call('GET', prefix .. user2)

      if not raw2 then
        redis.call('ZREM', queueKey, user2)
      else
        local p2 = cjson.decode(raw2)

        local sameTimeControl =
          p1.timeControl.baseSeconds == p2.timeControl.baseSeconds and
          p1.timeControl.incrementSecs == p2.timeControl.incrementSecs

        if user1 ~= user2 and sameTimeControl then
          local wait1 = math.max(0, now - tonumber(p1.joinedAt))
          local wait2 = math.max(0, now - tonumber(p2.joinedAt))

          local allowed1 = 100 + math.floor(wait1 / 5000) * 50
          local allowed2 = 100 + math.floor(wait2 / 5000) * 50
          local maxAllowed = math.min(allowed1, allowed2)

          if math.abs(rating1 - rating2) <= maxAllowed then
            redis.call('ZREM', queueKey, user1, user2)
            redis.call('DEL', prefix .. user1, prefix .. user2)

            return { raw1, raw2 }
          end
        end
      end
    end
  end
end

return {}
`;

export class RedisMatchmaker implements MatchMaker {
  async enqueue(entry: QueueEntry): Promise<void> {
    const queueKey = QUEUE_KEY(entry.category);
    const entryKey = ENTRY_KEY(entry.userId);

    await cacheRedis
      .multi()
      .set(entryKey, JSON.stringify(entry), 'EX', ENTRY_TTL_SECONDS)
      .zadd(queueKey, entry.rating, entry.userId)
      .exec();
  }

  async dequeue(userId: string): Promise<boolean> {
    const entryKey = ENTRY_KEY(userId);
    const metadata = await cacheRedis.get(entryKey);

    if (!metadata) {
      return false;
    }

    const entry = JSON.parse(metadata) as QueueEntry;

    const results = await cacheRedis
      .multi()
      .zrem(QUEUE_KEY(entry.category), userId)
      .del(entryKey)
      .exec();

    return Number(results?.[0]?.[1] ?? 0) > 0;
  }

  async tick(): Promise<Pair[]> {
    const categories: RatingCategory[] = ['BULLET', 'BLITZ', 'RAPID'];
    const pairs: Pair[] = [];

    for (const category of categories) {
      const result = await cacheRedis.eval(
        MATCH_SCRIPT,
        1,
        QUEUE_KEY(category),
        'zz:v1:matchmaking:entry:',
        String(Date.now()),
      );

      if (!Array.isArray(result) || result.length !== 2) {
        continue;
      }

      const player1 = JSON.parse(String(result[0])) as QueueEntry;
      const player2 = JSON.parse(String(result[1])) as QueueEntry;

      pairs.push({ player1, player2 });
    }

    return pairs;
  }

  async isQueued(userId: string): Promise<boolean> {
    return (await cacheRedis.exists(ENTRY_KEY(userId))) === 1;
  }

  async size(category?: RatingCategory): Promise<number> {
    if (category) {
      return cacheRedis.zcard(QUEUE_KEY(category));
    }

    const categories: RatingCategory[] = ['BULLET', 'BLITZ', 'RAPID'];
    const sizes = await Promise.all(categories.map((item) => cacheRedis.zcard(QUEUE_KEY(item))));

    return sizes.reduce((total, size) => total + size, 0);
  }
}
