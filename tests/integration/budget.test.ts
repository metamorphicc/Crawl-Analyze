import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { loadConfig } from '@crawlspider/config';
import { createStorage, sharedProviderBudget } from '@crawlspider/storage';
it('shares a durable daily budget across two independent gate instances', async () => {
  const storage = createStorage(loadConfig());
  const key = `test-${randomUUID().replaceAll(/[0-9-]/g, '')}`;
  try {
    await storage.readiness();
    const a = sharedProviderBudget(storage, 1000, 2),
      b = sharedProviderBudget(storage, 1000, 2);
    await a.reserve(key, AbortSignal.timeout(2000));
    await b.reserve(key, AbortSignal.timeout(2000));
    await expect(a.reserve(key, AbortSignal.timeout(2000))).rejects.toMatchObject({
      code: 'PROVIDER_DAILY_BUDGET_EXHAUSTED',
    });
    expect(
      (await storage.pool.query('SELECT requests FROM provider_usage WHERE provider=$1', [key]))
        .rows[0].requests,
    ).toBe('2');
  } finally {
    await storage.pool.query('DELETE FROM provider_usage WHERE provider=$1', [key]);
    await storage.redis.del(`crawlspider:provider:rate:${key}`);
    await storage.close();
  }
});
