import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { config } from 'dotenv';

config({ quiet: true });
let failures = 0;
function report(ok, label) {
  console.log(`${ok ? 'OK' : 'FAIL'} ${label}`);
  if (!ok) failures++;
}
report(Number(process.versions.node.split('.')[0]) === 24, `Node ${process.versions.node}`);
report(existsSync('package-lock.json'), 'Dependency lockfile');
report(existsSync('node_modules/typescript'), 'TypeScript installed');
report(existsSync('node_modules/@playwright/test'), 'Playwright installed');
report(existsSync('.env'), 'Local environment file');
for (const name of ['HELIUS_API_KEY', 'SOLANA_RPC_URL', 'TELEGRAM_BOT_TOKEN']) {
  console.log(`${process.env[name] ? 'CONFIGURED' : 'PENDING'} ${name} (value hidden)`);
}
if (process.argv.includes('--services')) {
  let available = false;
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
      stdio: 'pipe',
      timeout: 5000,
    });
    available = true;
  } catch {
    // No stderr: connection strings and platform-specific details are unnecessary here.
  }
  report(available, 'Docker engine');
  if (available) {
    try {
      const rows = JSON.parse(
        `[${execFileSync('docker', ['compose', 'ps', '--format', 'json'], {
          encoding: 'utf8',
          timeout: 10000,
        })
          .trim()
          .split('\n')
          .filter(Boolean)
          .join(',')}]`,
      );
      for (const service of ['postgres', 'redis']) {
        report(
          rows.some((row) => row.Service === service && row.Health === 'healthy'),
          `${service} container healthy`,
        );
      }
    } catch {
      report(false, 'Infrastructure health inspection');
    }
  }
  const { default: pg } = await import('pg');
  const { default: Redis } = await import('ioredis');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const result = await client.query('select 1 as ready');
    report(result.rows[0]?.ready === 1, 'PostgreSQL query');
  } catch {
    report(false, 'PostgreSQL connection (details hidden)');
  } finally {
    await client.end();
  }
  const redis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
    report((await redis.ping()) === 'PONG', 'Redis ping');
  } catch {
    report(false, 'Redis connection (details hidden)');
  } finally {
    redis.disconnect();
  }
}
process.exitCode = failures ? 1 : 0;
