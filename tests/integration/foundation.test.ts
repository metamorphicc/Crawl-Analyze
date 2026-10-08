import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { loadConfig } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import { migrate } from '../../packages/storage/src/migrate.js';
import { createApp } from '../../apps/api/src/app.js';
describe('real infrastructure', () => {
  it('applies migrations twice to an empty isolated schema and enforces job deduplication', async () => {
    const config = loadConfig();
    const admin = new pg.Pool({ connectionString: config.DATABASE_URL });
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      options: `-c search_path=${schema}`,
    });
    try {
      await migrate(pool);
      await migrate(pool);
      const id = randomUUID();
      await pool.query(
        "INSERT INTO scan_jobs(id,mint,mode,state,dedupe_key) VALUES($1,'mint','preview','queued','same')",
        [id],
      );
      await expect(
        pool.query(
          "INSERT INTO scan_jobs(id,mint,mode,state,dedupe_key) VALUES($1,'mint','preview','queued','same')",
          [randomUUID()],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await pool.query("UPDATE scan_jobs SET state='complete' WHERE id=$1", [id]);
      await pool.query(
        "INSERT INTO scan_jobs(id,mint,mode,state,dedupe_key) VALUES($1,'mint','preview','queued','same')",
        [randomUUID()],
      );
      expect((await pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count).toBe('1');
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
  it('checks real PostgreSQL and Redis through the API', async () => {
    const config = loadConfig();
    const storage = createStorage(config);
    await migrate(storage.pool);
    const app = createApp(config, storage);
    try {
      expect((await app.inject('/health/ready')).statusCode).toBe(200);
    } finally {
      await app.close();
      await storage.close();
    }
  });
});
