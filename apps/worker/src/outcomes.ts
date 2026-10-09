import type { Config } from '@crawlspider/config';
import { capabilities } from '@crawlspider/config';
import { ScanStore, sharedProviderBudget, type Storage } from '@crawlspider/storage';
import {
  OUTCOME_POLICY_VERSION,
  outcomeObservationSchema,
  type OutcomeObservation,
  type AnalysisReport,
} from '@crawlspider/contracts';
import { RpcClient, readOutcomeObservation } from '@crawlspider/providers';
import { classifyOutcome } from '@crawlspider/analysis';
const empty = (report: AnalysisReport, reason: string): OutcomeObservation => ({
  observedAt: report.observedAt,
  pool: null,
  priceUsd: null,
  liquidityUsd: null,
  supply: report.identity.supply,
  slot: report.identity.provenance.slot,
  source: 'report-only',
  freshnessUpperSeconds: null,
  reasons: [reason],
});
export async function outcomesTick(
  config: Config,
  storage: Storage,
  read?: (report: AnalysisReport, signal: AbortSignal) => Promise<OutcomeObservation>,
  stop?: AbortSignal,
) {
  const c = await storage.pool.connect(),
    scans = new ScanStore(storage.pool, config),
    budget = sharedProviderBudget(
      storage,
      config.PROVIDER_MAX_RPS,
      config.PROVIDER_DAILY_REQUEST_LIMIT,
    ),
    rpc = new RpcClient(config, fetch, { budget });
  const observe =
    read ??
    (async (report: AnalysisReport, signal: AbortSignal) => {
      const pool =
        report.scenarios.scenarios.flatMap((s) => s.quotes).find((q) => q.venue === 'pump-swap')
          ?.market || null;
      return readOutcomeObservation(report.identity.mint, pool, rpc, signal, fetch, async () => {
        await storage.ensureRedis();
        if (!(await storage.redis.set('crawlspider:gecko:gate', '1', 'PX', 6000, 'NX')))
          throw new Error('market busy');
        await budget.reserve('geckoterminal', signal);
      });
    });
  const signal = () =>
    AbortSignal.any([
      AbortSignal.timeout(config.PROVIDER_REQUEST_TIMEOUT_MS),
      ...(stop ? [stop] : []),
    ]);
  try {
    if (!(await c.query('SELECT pg_try_advisory_lock(733931) AS ok')).rows[0].ok) return;
    const bases = (
      await c.query(
        "SELECT r.id FROM reports r LEFT JOIN outcome_baselines b ON b.report_id=r.id WHERE b.report_id IS NULL AND r.mode='deep' ORDER BY r.observed_at DESC LIMIT 5",
      )
    ).rows;
    for (const row of bases) {
      if (stop?.aborted) break;
      const report = await scans.report(row.id);
      const late =
        Date.now() - Date.parse(report.observedAt) > 120000 ||
        Date.now() < Date.parse(report.observedAt);
      let observation = empty(
        report,
        late ? 'BASELINE_WINDOW_MISSED' : 'OUTCOME_PROVIDER_UNAVAILABLE',
      );
      if (!late && (read || capabilities(config).rpc))
        try {
          observation = outcomeObservationSchema.parse(await observe(report, signal()));
        } catch {}
      // A delayed response must not replace a missing historical baseline with future data.
      if (
        Date.parse(observation.observedAt) - Date.parse(report.observedAt) > 120000 ||
        Date.parse(observation.observedAt) < Date.parse(report.observedAt)
      )
        observation = empty(report, 'BASELINE_WINDOW_MISSED');
      await c.query('BEGIN');
      try {
        await c.query(
          'INSERT INTO outcome_baselines(report_id,policy_version,observation) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
          [report.id, OUTCOME_POLICY_VERSION, JSON.stringify(observation)],
        );
        for (const horizon of [3600, 21600, 86400])
          await c.query(
            'INSERT INTO token_outcomes(report_id,horizon_seconds,due_at,policy_version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [
              report.id,
              horizon,
              new Date(Date.parse(observation.observedAt) + horizon * 1000),
              OUTCOME_POLICY_VERSION,
            ],
          );
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    const due = (
      await c.query(
        'SELECT o.report_id,o.horizon_seconds,o.due_at,b.observation FROM token_outcomes o JOIN outcome_baselines b ON b.report_id=o.report_id WHERE o.observed_at IS NULL AND o.due_at<=now() ORDER BY o.due_at LIMIT 5',
      )
    ).rows;
    for (const row of due) {
      if (stop?.aborted) break;
      if (Date.now() < row.due_at.getTime()) continue;
      const report = await scans.report(row.report_id),
        baseline = outcomeObservationSchema.parse(row.observation);
      let current: OutcomeObservation = {
        ...empty(report, 'OUTCOME_WINDOW_MISSED'),
        supply: null,
        slot: null,
        observedAt: new Date().toISOString(),
      };
      if (Date.now() - row.due_at.getTime() <= 300000 && (read || capabilities(config).rpc))
        try {
          current = await observe(report, signal());
        } catch {
          current.reasons = ['OUTCOME_PROVIDER_UNAVAILABLE'];
        }
      const result = classifyOutcome(baseline, current, row.horizon_seconds);
      await c.query(
        'UPDATE token_outcomes SET observed_at=$3,result=$4 WHERE report_id=$1 AND horizon_seconds=$2 AND observed_at IS NULL',
        [row.report_id, row.horizon_seconds, current.observedAt, JSON.stringify(result)],
      );
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(733931)').catch(() => {});
    c.release();
  }
}
export function startOutcomes(config: Config, storage: Storage) {
  const stop = new AbortController();
  let active: Promise<void> | undefined;
  const run = () => {
    if (!active && !stop.signal.aborted)
      active = outcomesTick(config, storage, undefined, stop.signal)
        .catch(() => {})
        .finally(() => {
          active = undefined;
        });
  };
  const timer = setInterval(run, 30000);
  run();
  return {
    async close() {
      clearInterval(timer);
      stop.abort();
      await active;
    },
  };
}
