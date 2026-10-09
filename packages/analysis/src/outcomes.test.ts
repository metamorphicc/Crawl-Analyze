import { it, expect } from 'vitest';
import { classifyOutcome, evaluateRules, type EvaluationSample } from './outcomes.js';
import type { OutcomeObservation } from '@crawlspider/contracts';
const base: OutcomeObservation = {
  observedAt: '2026-01-01T00:00:00.000Z',
  pool: 'verified',
  priceUsd: '10',
  liquidityUsd: '1000',
  supply: '18446744073709551000',
  slot: '1',
  source: 'synthetic',
  freshnessUpperSeconds: 60,
  reasons: [],
};
it('separates price drawdown, USD depth and unknown malicious/withdrawal labels using exact amounts', () => {
  const value = classifyOutcome(
    base,
    {
      ...base,
      observedAt: '2026-01-01T01:00:00.000Z',
      priceUsd: '4',
      liquidityUsd: '800',
      supply: '18446744073709551003',
    },
    3600,
  );
  expect(value.priceReturnBps).toBe('-6000');
  expect(value.supplyDelta).toBe('3');
  expect(value.labels).toEqual({
    marketDrawdown: true,
    liquidityDepthDecline: false,
    liquidityWithdrawal: null,
    confirmedMaliciousAction: null,
  });
  expect(
    classifyOutcome(
      base,
      { ...base, observedAt: '2026-01-01T01:00:00.000Z', priceUsd: '5.000001' },
      3600,
    ).labels.marketDrawdown,
  ).toBe(false);
  expect(
    classifyOutcome(base, { ...base, observedAt: '2026-01-01T02:00:00.000Z', priceUsd: '0' }, 3600)
      .status,
  ).toBe('censored');
  expect(
    classifyOutcome(
      { ...base, priceUsd: null },
      { ...base, observedAt: '2026-01-01T01:00:00.000Z' },
      3600,
    ).labels.marketDrawdown,
  ).toBeNull();
});
it('reproducibly holds out chronological tokens, embargoes immature labels and rejects future leakage', () => {
  const samples: EvaluationSample[] = Array.from({ length: 500 }, (_, i) => ({
    reportId: `report-${i}`,
    mint: `synthetic-token-${i}`,
    observedAt: new Date(Date.UTC(2026, 0, 1) + i * 7200000).toISOString(),
    labelObservedAt: new Date(Date.UTC(2026, 0, 1) + i * 7200000 + 3600000).toISOString(),
    ruleVersion: 'heuristic-1',
    policyVersion: 'forward-1',
    horizonSeconds: 3600,
    score: i % 2 ? 70 : 30,
    label: !!(i % 2),
  }));
  const result = evaluateRules(samples, 'heuristic-1');
  expect(result.status).toBe('sufficient-for-descriptive-evaluation');
  expect(result.confusion).toEqual({ tp: 50, tn: 50, fp: 0, fn: 0 });
  expect(evaluateRules([...samples].reverse(), 'heuristic-1')).toEqual(result);
  expect(evaluateRules(samples.slice(0, 10), 'heuristic-1').confusion).toBeNull();
  expect(() =>
    evaluateRules([{ ...samples[0]!, labelObservedAt: samples[0]!.observedAt }], 'heuristic-1'),
  ).toThrow();
  const immature = { ...samples[399]!, labelObservedAt: samples[450]!.observedAt };
  const values = [...samples.slice(0, 399), immature, ...samples.slice(400)];
  expect(evaluateRules(values, 'heuristic-1').training).toBe(399);
  expect(evaluateRules([...samples, ...samples.slice(0, 100)], 'heuristic-1').total).toBe(500);
});
