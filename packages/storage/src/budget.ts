import { setTimeout as delay } from 'node:timers/promises';
import { PublicError } from '@crawlspider/contracts';
import type { Storage } from './index.js';
const rateLua = `
local t=redis.call('TIME');local now=t[1]*1000+math.floor(t[2]/1000)
local next=tonumber(redis.call('GET',KEYS[1]) or '0')
if next>now then return next-now end
redis.call('SET',KEYS[1],now+tonumber(ARGV[1]),'PX',60000)
return 0`;
export function sharedProviderBudget(storage: Storage, rps: number, dailyLimit: number) {
  return {
    async reserve(provider: string, signal: AbortSignal) {
      if (!/^[a-z-]+$/.test(provider)) throw new Error('Invalid provider budget key');
      await storage.ensureRedis();
      while (true) {
        signal.throwIfAborted();
        const wait = Number(
          await storage.redis.eval(
            rateLua,
            1,
            `crawlspider:provider:rate:${provider}`,
            Math.ceil(1000 / rps),
          ),
        );
        if (!Number.isFinite(wait) || wait < 0 || wait > 60000)
          throw new PublicError('BUDGET_UNAVAILABLE', 'Provider budget is unavailable', 503);
        if (!wait) break;
        await delay(wait, undefined, { signal });
      }
      signal.throwIfAborted();
      const result = await storage.pool.query(
        `INSERT INTO provider_usage(provider,day,requests)
      VALUES($1,(now() AT TIME ZONE 'UTC')::date,1) ON CONFLICT(provider,day) DO UPDATE
      SET requests=provider_usage.requests+1 WHERE provider_usage.requests<$2 RETURNING requests`,
        [provider, dailyLimit],
      );
      if (!result.rowCount)
        throw new PublicError(
          'PROVIDER_DAILY_BUDGET_EXHAUSTED',
          'Configured daily provider request budget reached',
          503,
        );
    },
  };
}
