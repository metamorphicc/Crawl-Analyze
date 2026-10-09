// Test-only, isolated PostgreSQL/Redis worker. Never imported by application entrypoints.
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { Queue } from 'bullmq';
import { loadConfig, installShutdown } from '@crawlspider/config';
import { createStorage, WatchStore, TelegramStore } from '@crawlspider/storage';
import { PublicError, reportSchema } from '@crawlspider/contracts';
import { migrate } from '../../packages/storage/src/migrate.js';
import { startRunner } from '../../apps/worker/src/runner.js';
import { createApp } from '../../apps/api/src/app.js';
import { fixtureReport } from '../fixtures/report.js';
import { key } from '../fixtures/analytics.js';
import { TOKEN_PROGRAM, PUMP_AMM_PROGRAM } from '@crawlspider/providers';
const config = {
  ...loadConfig(),
  NODE_ENV: 'test' as const,
  WEB_ORIGIN: 'http://127.0.0.1:5198',
  HELIUS_API_KEY: 'synthetic-browser-only',
  TELEGRAM_BOT_USERNAME: 'crawlspider_test',
  TELEGRAM_BOT_TOKEN: 'synthetic-browser-only',
  SOLANA_RPC_URL: 'http://127.0.0.1:3098/__test__/rpc',
  SOLANA_FALLBACK_RPC_URL: undefined,
  SCAN_IP_MINUTE_LIMIT: 100,
  SCAN_IP_DAILY_LIMIT: 1000,
  SCAN_PREVIEW_DEADLINE_MS: 20000,
  SCAN_DEEP_DEADLINE_MS: 30000,
};
const schema = `browser_${randomUUID().replaceAll('-', '')}`,
  prefix = `browser-${randomUUID()}`,
  admin = new pg.Pool({ connectionString: config.DATABASE_URL });
await admin.query(`CREATE SCHEMA ${schema}`);
const storage = createStorage(
  config,
  new pg.Pool({ connectionString: config.DATABASE_URL, options: `-c search_path=${schema}` }),
);
await migrate(storage.pool);
const runner = startRunner(config, storage, {
  prefix,
  pipeline: async (lease, signal, progress) => {
    await progress('mint');
    await delay(500, undefined, { signal });
    if (lease.mint === key(2))
      throw new PublicError('SYNTHETIC_PROVIDER_FAILURE', 'Test-only failure', 503);
    const r = fixtureReport(lease.id, lease.mode, lease.mint, new Date().toISOString());
    const first = r.snapshot.holders[0]!,
      second = r.snapshot.holders[1]!;
    r.snapshot.holders.push(
      ...Array.from({ length: 10 }, (_, i) => ({
        ...first,
        owner: key(i + 80),
        accounts: [key(i + 100)],
        amount: '0',
      })),
    );
    r.graph.edges.push({
      id: 'synthetic-transfer',
      kind: 'transfer',
      from: first.owner,
      to: second.owner,
      strength: 'onchain-interaction',
      signature: '1'.repeat(88),
      amount: '1',
      explanation: 'SYNTHETIC_TEST_FIXTURE: observed transfer, identity unproven',
      provenance: { ...r.identity.provenance, provider: 'synthetic-browser' },
      signatures: ['1'.repeat(88)],
      transactionLinks: [`https://solscan.io/tx/${'1'.repeat(88)}`],
      ruleVersion: 'relationships-1',
      confidence: 'high',
      assetMint: r.identity.mint,
      supportsControlHypothesis: false,
      serviceExcluded: false,
      relatedEvidenceIds: [],
    });
    r.earlyBuyers = {
      status: 'partial',
      launch: null,
      observedAt: r.observedAt,
      reasons: ['SYNTHETIC_WINDOW_ONLY'],
      coverage: null,
      buyers: [
        {
          owner: first.owner,
          signature: '1'.repeat(88),
          slot: '445186127',
          instruction: '0',
          transactionOrder: null,
          amount: '1',
          currentBalance: first.amount,
          early: null,
          entryClaim: 'earliest-observed-slot-candidate',
        },
      ],
    };
    r.changes = {
      previousReportId: null,
      currentReportId: r.id,
      comparable: false,
      reasons: ['NO_PREVIOUS_REPORT'],
      positions: [],
      movements: [],
    };
    const preview = structuredClone(r);
    preview.id = randomUUID();
    preview.mode = 'preview';
    preview.snapshot.quality.status = 'partial';
    preview.snapshot.quality.reasons = ['SYNTHETIC_PREVIEW'];
    await progress('preview', reportSchema.parse(preview));
    await delay(lease.mint === key(3) ? 7000 : 1500, undefined, { signal });
    if (lease.mint === key(4)) {
      r.snapshot.quality.status = 'partial';
      r.snapshot.enumerationComplete = false;
      r.risk.eligible = false;
      r.risk.riskScore = null;
      r.risk.classification = 'insufficient-data';
      r.risk.eligibilityReasons = ['SYNTHETIC_PARTIAL_INDEX'];
      r.snapshot.quality.reasons = ['SYNTHETIC_PARTIAL_INDEX'];
    }
    if (lease.mint === key(5)) r.observedAt = '2020-01-01T00:00:00.000Z';
    await progress('analysis');
    return reportSchema.parse(r);
  },
});
const app = createApp(config, storage);
app.post('/__test__/approve-link', async (request) => {
  const { id } = request.body as { id: string };
  const store = new WatchStore(storage.pool, config);
  await new TelegramStore(storage.pool, config).recoverIdentity(7007, 7007);
  await store.requestLink(id, 7007);
  await store.approveLink(id, 7007);
  return { ok: true };
});
app.post<{ Body: { id: number; method: string; params: unknown[] } }>(
  '/__test__/rpc',
  async (req) => {
    if (req.body.method !== 'getAccountInfo')
      return {
        jsonrpc: '2.0',
        id: req.body.id,
        error: { code: -32601, message: 'Synthetic method unavailable' },
      };
    const address = req.body.params[0],
      bytes = Buffer.alloc(address === key(6) ? 211 : 82);
    if (address === key(6)) {
      bytes.set([241, 154, 109, 4, 17, 177, 109, 188]);
      bytes.set(new Uint8Array(32).fill(1), 43);
    } else {
      bytes.writeBigUInt64LE(1000n, 36);
      bytes[44] = 6;
      bytes[45] = 1;
    }
    return {
      jsonrpc: '2.0',
      id: req.body.id,
      result: {
        context: { slot: 445186127 },
        value:
          address === key(1) || address === key(6)
            ? {
                owner: address === key(6) ? PUMP_AMM_PROGRAM : TOKEN_PROGRAM,
                executable: false,
                data: [bytes.toString('base64'), 'base64'],
              }
            : null,
      },
    };
  },
);
let cleaning: Promise<void> | undefined;
const clean = () =>
  (cleaning ??= (async () => {
    await runner.close();
    for (const lane of ['preview', 'deep', 'monitor']) {
      const q = new Queue(`scan-${lane}`, { connection: { url: config.REDIS_URL }, prefix });
      await q.obliterate({ force: true });
      await q.close();
    }
    await storage.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  })());
app.post('/__test__/cleanup', async () => {
  await clean();
  setTimeout(() => {
    void app.close().then(() => process.exit(0));
  }, 100);
  return { ok: true };
});
await app.listen({ host: '127.0.0.1', port: 3098 });
installShutdown(async () => {
  await app.close();
  await clean();
});
