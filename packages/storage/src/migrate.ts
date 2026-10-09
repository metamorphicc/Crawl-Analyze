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
      await client.query('INSERT INTO schema_migrations(version) VALUES (1)');
    }
    const current = await client.query('SELECT max(version) AS version FROM schema_migrations');
    const version = current.rows[0]?.version;
    if (!Number.isInteger(version) || version > SCHEMA_VERSION)
      throw new Error('Unsupported database schema version');
    for (let next = version + 1; next <= SCHEMA_VERSION; next++) {
      const name =
        next === 2
          ? '002_scans.sql'
          : next === 3
            ? '003_positions.sql'
            : next === 4
              ? '004_telegram.sql'
              : '';
      if (!name) throw new Error('Missing migration');
      await client.query(
        await readFile(fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)), 'utf8'),
      );
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [next]);
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
