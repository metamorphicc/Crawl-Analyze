import { it, expect } from 'vitest';
import { isolatedEnvironment } from './environment.js';
import { fixtureReport } from '../fixtures/report.js';
import { key } from '../fixtures/analytics.js';
import { outcomesTick } from '../../apps/worker/src/outcomes.js';
import type { OutcomeObservation } from '@crawlspider/contracts';
it('collects immutable forward baselines/horizons, survives restart and censors missing historical windows', async () => {
  const e = await isolatedEnvironment();
  let price = '10',
    reads = 0;
  const read = async (): Promise<OutcomeObservation> => {
    reads++;
    return {
      observedAt: new Date().toISOString(),
      pool: key(2),
      priceUsd: price,
      liquidityUsd: '1000',
      supply: '1000',
      slot: '445186127',
      source: 'synthetic-outcome',
      freshnessUpperSeconds: 60,
      reasons: [],
    };
  };
  try {
    const admitted = await e.scans.admit(key(1), 'deep', 'test-outcome'),
      lease = (await e.scans.claim(admitted.job.id))!,
      r = fixtureReport(lease.id, 'deep', key(1), new Date().toISOString());
    await e.scans.finish(lease, r);
    await outcomesTick(e.config, e.storage, read);
    await outcomesTick(e.config, e.storage, read);
    expect(reads).toBe(1);
    expect((await e.storage.pool.query('SELECT count(*) FROM token_outcomes')).rows[0].count).toBe(
      '3',
    );
    // Advance the synthetic clock by changing its saved baseline/due time, not production time.
    await e.storage.pool.query(
      "UPDATE outcome_baselines SET observation=jsonb_set(observation,'{observedAt}',$2::jsonb) WHERE report_id=$1",
      [r.id, JSON.stringify(new Date(Date.now() - 3601000).toISOString())],
    );
    await e.storage.pool.query('UPDATE token_outcomes SET due_at=now() WHERE horizon_seconds=3600');
    price = '4';
    await outcomesTick(e.config, e.storage, read);
    await outcomesTick(e.config, e.storage, read);
    expect(reads).toBe(2);
    const saved = (
      await e.storage.pool.query('SELECT result FROM token_outcomes WHERE horizon_seconds=3600')
    ).rows[0].result;
    expect(saved.labels.marketDrawdown, JSON.stringify(saved)).toBe(true);
    expect(saved.labels.confirmedMaliciousAction).toBeNull();
    const old = await e.scans.admit(key(3), 'deep', 'old-outcome'),
      oldLease = (await e.scans.claim(old.job.id))!;
    await e.scans.finish(
      oldLease,
      fixtureReport(oldLease.id, 'deep', key(3), '2020-01-01T00:00:00.000Z'),
    );
    await outcomesTick(e.config, e.storage, read);
    expect(reads).toBe(2);
    expect(
      (
        await e.storage.pool.query(
          'SELECT observation FROM outcome_baselines WHERE report_id=(SELECT report_id FROM scan_jobs WHERE id=$1)',
          [oldLease.id],
        )
      ).rows[0].observation.reasons,
    ).toContain('BASELINE_WINDOW_MISSED');
  } finally {
    await e.close();
  }
});
