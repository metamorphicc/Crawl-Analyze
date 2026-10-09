import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Config } from '@crawlspider/config';
import { ScanStore, type Storage, type Lease, type Lane } from '@crawlspider/storage';
import { PublicError, type AnalysisReport } from '@crawlspider/contracts';
import { runScan, type Progress } from './pipeline.js';
export type Pipeline = (
  lease: Lease,
  signal: AbortSignal,
  progress: Progress,
) => Promise<AnalysisReport>;
export async function executeLease(
  store: ScanStore,
  lease: Lease,
  pipeline: Pipeline,
  shutdown?: AbortSignal,
) {
  const abort = new AbortController(),
    remaining = Math.max(1, Date.parse(lease.deadline) - Date.now());
  const workSignal = AbortSignal.any([
    abort.signal,
    AbortSignal.timeout(Math.max(1, remaining - 1000)),
    ...(shutdown ? [shutdown] : []),
  ]);
  let checking = false;
  const heartbeat = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (!(await store.heartbeat(lease))) abort.abort();
    } catch {
      abort.abort();
    } finally {
      checking = false;
    }
  }, 3000);
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  try {
    const report = await Promise.race([
      pipeline(lease, workSignal, async (phase, preview) => {
        if (!(await store.checkpoint(lease, phase, preview))) {
          abort.abort();
          throw new PublicError('LEASE_LOST', 'Scan lease expired', 409);
        }
      }),
      new Promise<never>((_, reject) => {
        watchdog = setTimeout(() => {
          abort.abort();
          reject(new PublicError('DEADLINE_EXCEEDED', 'Scan deadline reached', 408));
        }, remaining);
      }),
      new Promise<never>((_, reject) => {
        stop = () => reject(new PublicError('WORKER_SHUTDOWN', 'Worker stopped', 503));
        shutdown?.addEventListener('abort', stop, { once: true });
        if (shutdown?.aborted) stop();
      }),
    ]);
    await store.finish(lease, report);
  } catch (error) {
    const code =
      error instanceof PublicError
        ? error.code
        : workSignal.aborted
          ? 'DEADLINE_EXCEEDED'
          : 'SCAN_FAILED';
    const retryable = error instanceof Error && 'retryable' in error && error.retryable === true;
    await store.fail(
      lease,
      code,
      retryable || code === 'SCAN_FAILED' || code === 'WORKER_SHUTDOWN',
    );
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (stop) shutdown?.removeEventListener('abort', stop);
    clearInterval(heartbeat);
    abort.abort();
  }
}
export function startRunner(
  config: Config,
  storage: Storage,
  options: { prefix?: string; pipeline?: Pipeline } = {},
) {
  const store = new ScanStore(storage.pool, config),
    prefix = options.prefix || 'crawlspider-v1';
  const connections: Redis[] = [],
    workers: Worker[] = [],
    queues = new Map<Lane, Queue>();
  const shutdown = new AbortController();
  const active = new Set<Promise<unknown>>();
  for (const lane of ['preview', 'deep', 'monitor'] as const) {
    const writer = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: 3000,
    });
    writer.on('error', () => {});
    connections.push(writer);
    const reader = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
    reader.on('error', () => {});
    connections.push(reader);
    const queue = new Queue(`scan-${lane}`, { connection: writer, prefix });
    queue.on('error', () => {});
    queues.set(lane, queue);
    const worker = new Worker(
      `scan-${lane}`,
      async (task) => {
        const lease = await store.claim(task.data.id);
        if (lease) {
          const run = executeLease(
            store,
            lease,
            options.pipeline || ((l, s, p) => runScan(config, storage, l, s, p)),
            shutdown.signal,
          );
          active.add(run);
          try {
            await run;
          } finally {
            active.delete(run);
          }
        }
      },
      {
        connection: reader,
        prefix,
        concurrency: lane === 'deep' ? Math.max(1, config.SCAN_CONCURRENCY - 2) : 1,
      },
    );
    worker.on('error', () => {});
    workers.push(worker);
  }
  let syncing = false;
  const reconcile = async () => {
    if (syncing || shutdown.signal.aborted) return;
    syncing = true;
    try {
      await store.recover();
      for (const lane of ['preview', 'deep', 'monitor'] as const)
        for (const row of await store.pending(lane))
          await queues
            .get(lane)!
            .add(
              'scan',
              { id: row.id },
              { jobId: `${row.id}-${row.attempt}`, removeOnComplete: true, removeOnFail: true },
            );
    } catch {
      /* database is authoritative; retry after transient Redis/DB failure */
    } finally {
      syncing = false;
    }
  };
  const timer = setInterval(() => void reconcile(), 1000);
  void reconcile();
  return {
    store,
    reconcile,
    async close() {
      clearInterval(timer);
      shutdown.abort();
      await Promise.allSettled(active);
      await Promise.all(workers.map((w) => w.close(true)));
      await Promise.all(Array.from(queues.values(), (q) => q.close()));
      for (const c of connections) c.disconnect();
    },
  };
}
