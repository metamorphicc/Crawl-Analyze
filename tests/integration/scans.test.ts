import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { Queue } from 'bullmq';
import { loadConfig } from '@crawlspider/config';
import { createStorage, ScanStore } from '@crawlspider/storage';
import { migrate } from '../../packages/storage/src/migrate.js';
import { startRunner, executeLease } from '../../apps/worker/src/runner.js';
import { createApp } from '../../apps/api/src/app.js';
import { fixtureReport } from '../fixtures/report.js';
import { key } from '../fixtures/analytics.js';
async function environment() {
  const config = {
    ...loadConfig(),
    NODE_ENV: 'test' as const,
    HELIUS_API_KEY: 'synthetic-test-key',
    SCAN_QUEUE_LIMIT: 5,
    SCAN_IP_MINUTE_LIMIT: 2,
    SCAN_IP_DAILY_LIMIT: 10,
  };
  const admin = new pg.Pool({ connectionString: config.DATABASE_URL }),
    schema = `test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const storage = createStorage(
    config,
    new pg.Pool({ connectionString: config.DATABASE_URL, options: `-c search_path=${schema}` }),
  );
  try {
    await migrate(storage.pool);
  } catch (error) {
    await storage.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    throw error;
  }
  const store = new ScanStore(storage.pool, config);
  return {
    config,
    storage,
    store,
    async close() {
      await storage.close();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
async function waitUntil(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for fixture worker');
}
describe('durable scans on real PostgreSQL/Redis', () => {
  it('reserves capacity for interactive and monitor lanes across concurrent claims', async () => {
    const e = await environment();
    try {
      const jobs = [];
      for (let i = 0; i < 3; i++) jobs.push(await e.store.admit(key(i + 1), 'deep', String(i)));
      const claims = await Promise.all(jobs.map((j) => e.store.claim(j.job.id)));
      expect(claims.filter(Boolean).length).toBeLessThanOrEqual(2);
      const preview = await e.store.admit(key(6), 'preview', 'preview'),
        monitor = await e.store.admit(key(7), 'deep', 'monitor', 'monitor');
      expect(await e.store.claim(preview.job.id)).not.toBeNull();
      expect(await e.store.claim(monitor.job.id)).not.toBeNull();
      const active = (
        await e.storage.pool.query(
          "SELECT count(*)::integer AS n FROM scan_jobs WHERE state='running'",
        )
      ).rows[0].n;
      expect(active).toBeLessThanOrEqual(e.config.SCAN_CONCURRENCY);
      const lease = claims.find(Boolean)!;
      const creator = jobs.find((j) => j.job.id === lease.id)!;
      await e.store.cancel(creator.job.id, creator.cancelToken!);
      expect(await e.store.finish(lease, fixtureReport(lease.id))).toBe(false);
    } finally {
      await e.close();
    }
  });
  it('deduplicates concurrent acceptance, bounds admission and protects cancellation', async () => {
    const e = await environment();
    try {
      const accepted = await Promise.all(
        Array.from({ length: 8 }, () => e.store.admit(key(1), 'deep', 'same')),
      );
      expect(new Set(accepted.map((a) => a.job.id)).size).toBe(1);
      expect(accepted.filter((a) => a.cancelToken)).toHaveLength(1);
      await e.store.admit(key(2), 'deep', 'same');
      await expect(e.store.admit(key(3), 'deep', 'same')).rejects.toMatchObject({
        code: 'SCAN_QUOTA',
      });
      await expect(e.store.cancel(accepted[0]!.job.id, 'invalid')).rejects.toMatchObject({
        code: 'CANCEL_REJECTED',
      });
      const creator = accepted.find((a) => a.cancelToken)!;
      await e.store.cancel(creator.job.id, creator.cancelToken!);
      expect((await e.store.details(creator.job.id)).state).toBe('cancelled');
      for (let i = 4; i < 8; i++) await e.store.admit(key(i), 'deep', String(i));
      await expect(e.store.admit(key(8), 'deep', '8')).rejects.toMatchObject({
        code: 'QUEUE_FULL',
      });
    } finally {
      await e.close();
    }
  });
  it('fences a recovered worker, keeps reports immutable and does not cache stale data', async () => {
    const e = await environment();
    try {
      const a = await e.store.admit(key(1), 'deep', 'a'),
        old = await e.store.claim(a.job.id);
      expect(old).not.toBeNull();
      await e.storage.pool.query(
        "UPDATE scan_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
        [a.job.id],
      );
      await e.store.recover();
      const current = await e.store.claim(a.job.id);
      expect(current!.token).not.toBe(old!.token);
      expect(await e.store.finish(old!, fixtureReport(a.job.id))).toBe(false);
      const report = fixtureReport(a.job.id, 'deep', key(1), new Date().toISOString());
      expect(await e.store.finish(current!, report)).toBe(true);
      expect(await e.store.finish(current!, report)).toBe(false);
      expect((await e.store.report(report.id)).id).toBe(report.id);
      expect((await e.store.admit(key(1), 'deep', 'b')).report!.id).toBe(report.id);
      await e.storage.pool.query(
        "UPDATE reports SET observed_at=now()-interval '10 minutes' WHERE id=$1",
        [report.id],
      );
      expect((await e.store.admit(key(1), 'deep', 'c')).reused).toBe(false);
    } finally {
      await e.close();
    }
  });
  it('aborts the absolute deadline and rejects a library result arriving afterward', async () => {
    const e = await environment();
    try {
      const a = await e.store.admit(key(1), 'deep', 'a');
      await e.storage.pool.query(
        "UPDATE scan_jobs SET deadline_at=now()+interval '150 milliseconds' WHERE id=$1",
        [a.job.id],
      );
      const lease = (await e.store.claim(a.job.id))!;
      let aborted = false;
      await executeLease(e.store, lease, async (_l, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        await delay(300);
        return fixtureReport(lease.id);
      });
      await delay(350);
      expect(aborted).toBe(true);
      expect((await e.store.details(lease.id)).errorCode).toBe('DEADLINE_EXCEEDED');
      expect((await e.storage.pool.query('SELECT count(*) FROM reports')).rows[0].count).toBe('0');
    } finally {
      await e.close();
    }
  });
  it('rebuilds transport after queue loss and completes accepted jobs through a restarted runner', async () => {
    const e = await environment(),
      prefix = `test-${randomUUID()}`;
    let runner: ReturnType<typeof startRunner> | undefined;
    const cleanup = new Queue('scan-deep', {
      connection: { host: '127.0.0.1', port: Number(new URL(e.config.REDIS_URL).port) },
      prefix,
    });
    try {
      const accepted = await e.store.admit(key(1), 'deep', 'a');
      await cleanup.add('scan', { id: accepted.job.id }, { jobId: accepted.job.id });
      await cleanup.obliterate({ force: true });
      runner = startRunner(e.config, e.storage, {
        prefix,
        pipeline: async (lease) =>
          fixtureReport(lease.id, 'deep', lease.mint, new Date().toISOString()),
      });
      await waitUntil(async () =>
        ['complete', 'partial'].includes((await e.store.details(accepted.job.id)).state),
      );
      expect((await e.store.details(accepted.job.id)).reportId).not.toBeNull();
      await runner.close();
      runner = undefined;
      const b = await e.store.admit(key(2), 'deep', 'b');
      runner = startRunner(e.config, e.storage, {
        prefix,
        pipeline: async (lease) =>
          fixtureReport(lease.id, 'deep', lease.mint, new Date().toISOString()),
      });
      await waitUntil(async () => !!(await e.store.details(b.job.id)).reportId);
    } finally {
      await runner?.close();
      for (const lane of ['preview', 'deep', 'monitor']) {
        const q = new Queue(`scan-${lane}`, {
          connection: { host: '127.0.0.1', port: Number(new URL(e.config.REDIS_URL).port) },
          prefix,
        });
        await q.obliterate({ force: true });
        await q.close();
      }
      await cleanup.close();
      await e.close();
    }
  });
  it('serves immutable reports and replays only events after an SSE cursor', async () => {
    const e = await environment(),
      app = createApp(e.config, e.storage);
    try {
      const accepted = (
        await app.inject({
          method: 'POST',
          url: '/v1/scans',
          payload: { input: key(1), mode: 'deep' },
        })
      ).json();
      expect(accepted.job.state).toBe('queued');
      const lease = (await e.store.claim(accepted.job.id))!;
      await e.store.checkpoint(lease, 'fixture');
      const report = fixtureReport(lease.id);
      await e.store.finish(lease, report);
      expect((await app.inject(`/v1/reports/${report.id}`)).json().id).toBe(report.id);
      const events = await e.store.events(lease.id, '0');
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new Error('No TCP port');
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/scans/${lease.id}/events`, {
        headers: { 'last-event-id': events[1]!.id },
        signal: AbortSignal.timeout(3000),
      });
      const text = await response.text();
      expect(text).not.toContain(`id: ${events[0]!.id}\n`);
      expect(text).not.toContain(`id: ${events[1]!.id}\n`);
      expect(text).toContain('"reportId"');
    } finally {
      await app.close();
      await e.close();
    }
  });
});
