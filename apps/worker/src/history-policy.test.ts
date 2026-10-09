import { describe, expect, it } from 'vitest';
import { parseConfig } from '@crawlspider/config';
import { selectHistoryCandidates } from '@crawlspider/analysis';
import { historyPolicy } from './history-policy.js';
import { holder } from '../../../tests/fixtures/intelligence.js';
import { key } from '../../../tests/fixtures/analytics.js';

const config = parseConfig({
  DATABASE_URL: 'postgres://test:test@localhost/test',
  REDIS_URL: 'redis://localhost',
});
describe('targeted history investigation', () => {
  it('stops after covering large balances instead of crawling all small holders', () => {
    const holders = [
      holder(key(1), '9700'),
      ...Array.from({ length: 100 }, (_, i) => holder(key(i + 2), '3')),
    ];
    const selected = selectHistoryCandidates(holders, historyPolicy('preview', config));
    expect(selected.candidates).toHaveLength(2);
    expect(selected.selectedSupplyBps).toBe(9703);
    expect(selected.candidates[0]?.owner).toBe(key(1));
  });
  it('caps dispersed ownership honestly and respects a lower operator limit', () => {
    const holders = Array.from({ length: 100 }, (_, i) => holder(key(i + 1), '10'));
    const quick = selectHistoryCandidates(holders, historyPolicy('preview', config));
    expect(quick.candidates).toHaveLength(6);
    expect(quick.targetReached).toBe(false);
    expect(quick.reasons).toContain('HISTORY_OWNER_CAP_BELOW_SUPPLY_TARGET');
    expect(selectHistoryCandidates(holders, historyPolicy('deep', config)).candidates).toHaveLength(
      12,
    );
    expect(historyPolicy('deep', { ...config, MAX_HISTORY_OWNERS: 2 }).maxOwners).toBe(2);
  });
});
