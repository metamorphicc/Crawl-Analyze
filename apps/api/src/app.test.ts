import { describe, expect, it } from 'vitest';
import { parseConfig } from '@crawlspider/config';
import { serviceStatusSchema } from '@crawlspider/contracts';
import type { Storage } from '@crawlspider/storage';
import { createApp } from './app.js';
const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
});
describe('service health', () => {
  it('stays alive but is not ready when the database is unavailable', async () => {
    const db = {
      readiness: async () => ({ postgres: false, redis: true, schema: false }),
    } as Storage;
    const app = createApp(config, db);
    try {
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      const ready = await app.inject('/health/ready');
      expect(ready.statusCode).toBe(503);
      expect(serviceStatusSchema.parse(ready.json()).status).toBe('degraded');
      const text = (await app.inject('/v1/status')).body;
      expect(text).not.toContain('DATABASE_URL');
    } finally {
      await app.close();
    }
  });
});
