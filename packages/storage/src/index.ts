import pg from 'pg';
import { Redis } from 'ioredis';
import type { Config } from '@crawlspider/config';

export const SCHEMA_VERSION = 2;
export function createStorage(
  config: Pick<Config, 'DATABASE_URL' | 'REDIS_URL'>,
  database?: pg.Pool,
) {
  const pool =
    database ??
    new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: 12,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 30000,
      statement_timeout: 5000,
    });
  // A disconnected readiness check must finish, not enqueue indefinitely.
  const redis = new Redis(config.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 3000,
    commandTimeout: 3000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  pool.on('error', () => {});
  redis.on('error', () => {});
  let connecting: Promise<unknown> | undefined;
  const connectRedis = async () => {
    if (redis.status === 'wait')
      connecting ??= redis.connect().finally(() => {
        connecting = undefined;
      });
    if (connecting) await connecting;
  };
  return {
    pool,
    redis,
    ensureRedis: connectRedis,
    async readiness() {
      const checks = await Promise.allSettled([
        pool.query('SELECT 1'),
        connectRedis().then(() => redis.ping()),
        pool.query('SELECT version FROM schema_migrations WHERE version = $1', [SCHEMA_VERSION]),
      ]);
      return {
        postgres: checks[0]?.status === 'fulfilled',
        redis: checks[1]?.status === 'fulfilled',
        schema: checks[2]?.status === 'fulfilled' && checks[2].value.rowCount === 1,
      };
    },
    async close() {
      redis.disconnect();
      await pool.end();
    },
  };
}
export type Storage = ReturnType<typeof createStorage>;
export * from './budget.js';
export * from './scans.js';
