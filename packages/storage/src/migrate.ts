import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@crawlspider/config';
import { createStorage, SCHEMA_VERSION } from './index.js';

export async function migrate(database: ReturnType<typeof createStorage>['pool']) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(733901)');
    const exists = await client.query("SELECT to_regclass('schema_migrations') AS present");
    if (!exists.rows[0]?.present) {
      // Compiled entry remains inside this package, one directory below migrations.
      const sql = await readFile(
        fileURLToPath(new URL('../migrations/001_foundation.sql', import.meta.url)),
        'utf8',
      );
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [SCHEMA_VERSION]);
    } else {
      const current = await client.query('SELECT max(version) AS version FROM schema_migrations');
      if (current.rows[0]?.version !== SCHEMA_VERSION)
        throw new Error('Unsupported database schema version');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const db = createStorage(loadConfig());
  try {
    await migrate(db.pool);
    console.log(`Database schema ${SCHEMA_VERSION} ready`);
  } catch {
    console.error('Database migration failed; check local configuration and database availability');
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
