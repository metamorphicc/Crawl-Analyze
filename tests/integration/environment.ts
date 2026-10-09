import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '@crawlspider/config';
import { createStorage, ScanStore } from '@crawlspider/storage';
import { migrate } from '../../packages/storage/src/migrate.js';
export async function isolatedEnvironment() {
  const config = {
      ...loadConfig(),
      NODE_ENV: 'test' as const,
      HELIUS_API_KEY: 'synthetic-test-key',
      SCAN_IP_MINUTE_LIMIT: 50,
      SCAN_IP_DAILY_LIMIT: 1000,
      PUBLIC_WEB_URL: 'https://crawlspider.example',
    },
    admin = new pg.Pool({ connectionString: config.DATABASE_URL }),
    schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const storage = createStorage(
    config,
    new pg.Pool({ connectionString: config.DATABASE_URL, options: `-c search_path=${schema}` }),
  );
  try {
    await migrate(storage.pool);
  } catch (e) {
    await storage.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw e;
  }
  return {
    config,
    storage,
    scans: new ScanStore(storage.pool, config),
    async close() {
      await storage.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
