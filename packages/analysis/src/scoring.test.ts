import { describe, it, expect } from 'vitest';
import { riskAssessmentSchema } from '@crawlspider/contracts';
import { assessRisk, type RiskInput } from './scoring.js';
import { identity, NOW, key, emptyGraph } from '../../../tests/fixtures/analytics.js';
import { holder, signal } from '../../../tests/fixtures/intelligence.js';
const input = (): RiskInput => {
  const mint = identity();
  mint.supply = '1000';
  const holders = Array.from({ length: 20 }, (_, i) => holder(key(i + 10), '50'));
  return {
    identity: mint,
    holders,
    quality: {
      status: 'complete',
      reasons: [],
      observedAt: NOW,
      minSlot: '445186127',
      maxSlot: '445186127',
      indexedSlot: '445186127',
      supplyReconciled: true,
      atomic: false,
    },
    enumerationComplete: true,
    signals: holders.map((h) => ({ ...signal(h.owner), earlyObservedEntry: false })),
    graph: emptyGraph(),
    observedAt: NOW,
    supportedMarket: true,
  };
};
describe('versioned distribution scoring and separate completeness', () => {
  it('uses a validated shared contract and clearly labels an eligible heuristic', () => {
    const result = assessRisk(input());
    expect(riskAssessmentSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      ruleVersion: 'heuristic-1',
      heuristic: true,
      calibrated: false,
      eligible: true,
      riskScore: 0,
      classification: 'low',
    });
    expect(result.confidence).toMatchObject({
      dataCompleteness: 95,
      meaning: 'coverage-not-predictive-accuracy',
    });
    expect(result.metrics).toMatchObject({
      eligibleBalance: '1000',
      top1Bps: 500,
      top10Bps: 5000,
      flaggedBalance: '0',
    });
    expect(riskAssessmentSchema.safeParse({ ...result, eligible: false }).success).toBe(false);
    expect(
      riskAssessmentSchema.safeParse({
        ...result,
        metrics: { ...result.metrics, flaggedBalance: 'invalid' },
      }).success,
    ).toBe(false);
  });
  it('unions overlapping hypotheses, early buyers and concentrated owners without trusting group totals', () => {
    const data = input();
    data.holders[0]!.amount = '250';
    data.holders[1]!.amount = '150';
    data.identity.supply = '1300';
    data.signals[0]!.earlyObservedEntry = true;
    const owners = data.holders.map((h) => h.owner);
    data.graph.controlHypotheses = [
      {
        id: 'a',
        owners: [owners[0]!, owners[1]!, owners[0]!],
        amount: '999999999999',
        evidenceIds: ['tx-a'],
        confidence: 'medium',
        identityProven: false,
      },
      {
        id: 'b',
        owners: [owners[1]!, owners[2]!],
        amount: '999999999999',
        evidenceIds: ['tx-b'],
        confidence: 'medium',
        identityProven: false,
      },
    ];
    const result = assessRisk(data);
    expect(result.metrics.flaggedBalance).toBe('450');
    expect(result.metrics.flaggedOwners).toHaveLength(3);
    expect(result.metrics.largestHypothesisBps).toBe(3076);
    expect(result.rules.find((r) => r.id === 'CORROBORATED_CONTROL_GROUP')).toMatchObject({
      status: 'triggered',
      points: 25,
    });
  });
  it('never treats common funders or similar timing alone as common-control concentration', () => {
    const data = input();
    data.graph.suspiciousOwners = data.holders.map((h) => h.owner);
    // The graph may mark behavioral candidates; scoring only unions corroborated control hypotheses.
    expect(assessRisk(data).metrics.flaggedBalance).toBe('0');
  });
  it('excludes verified infrastructure, consolidates owners and rejects duplicate source balances', () => {
    const data = input(),
      pool = holder(key(99), '1000');
    pool.excludedAmount = '1000';
    data.holders.push(pool);
    data.identity.supply = '2000';
    const result = assessRisk(data);
    expect(result.metrics).toMatchObject({
      eligibleBalance: '1000',
      excludedBalance: '1000',
      ownerCount: 20,
      top1Bps: 500,
    });
    data.holders.push(data.holders[0]!);
    expect(() => assessRisk(data)).toThrow('Duplicate owner');
  });
  it('triggers present authorities while unknown balance flags keep the verdict insufficient', () => {
    const data = input();
    data.identity.mintAuthority = key(50);
    data.identity.freezeAuthority = key(51);
    data.holders[0]!.frozenAmount = null;
    const result = assessRisk(data);
    expect(result.observedRiskPoints).toBe(30);
    expect(result.riskScore).toBeNull();
    expect(result.classification).toBe('insufficient-data');
    expect(result.rules.find((r) => r.id === 'FROZEN_BALANCE')!.status).toBe('unknown');
  });
  it.each([
    'holder-page',
    'history',
    'entry',
    'early-entry',
    'market',
    'metadata',
    'stale',
  ] as const)('losing %s data cannot improve confidence or produce a clean score', (loss) => {
    const data = input(),
      full = assessRisk(data);
    if (loss === 'holder-page') {
      data.quality.status = 'partial';
      data.enumerationComplete = false;
      data.quality.supplyReconciled = false;
    }
    if (loss === 'history')
      for (const s of data.signals) {
        s.coverage = { ...s.coverage, exhausted: false, reasons: ['HISTORY_TRANSACTION_LIMIT'] };
      }
    if (loss === 'entry') for (const s of data.signals) s.entry = null;
    if (loss === 'early-entry') for (const s of data.signals) s.earlyObservedEntry = null;
    if (loss === 'market') data.supportedMarket = false;
    if (loss === 'metadata') data.identity.token2022Extensions = [14];
    if (loss === 'stale') data.quality.observedAt = '2026-10-08T00:00:00.000Z';
    const partial = assessRisk(data);
    expect(partial.confidence.dataCompleteness).toBeLessThanOrEqual(
      full.confidence.dataCompleteness,
    );
    expect(partial).toMatchObject({
      eligible: false,
      riskScore: null,
      classification: 'insufficient-data',
    });
  });
  it('requires at least five circulating owners and distinguishes empty balances', () => {
    const data = input();
    data.holders = data.holders.slice(0, 4);
    data.identity.supply = '200';
    expect(assessRisk(data).eligibilityReasons).toContain('TOO_FEW_ELIGIBLE_OWNERS');
    data.holders = [];
    data.identity.supply = '0';
    const zero = assessRisk(data);
    expect(zero.metrics.eligibleBalance).toBe('0');
    expect(zero.riskScore).toBeNull();
  });
  it('keeps the denominator qualified when a missing holder page artificially increases concentration', () => {
    const data = input();
    data.holders = data.holders.slice(0, 5);
    data.quality.status = 'partial';
    data.enumerationComplete = false;
    data.quality.supplyReconciled = false;
    const result = assessRisk(data);
    expect(result.metrics.top1Bps).toBe(2000);
    expect(result.observedRiskPoints).toBeGreaterThan(0);
    expect(result.riskScore).toBeNull();
    expect(result.classification).toBe('insufficient-data');
  });
  it('preserves a supply mismatch above the mint instead of abandoning the partial report', () => {
    const data = input();
    data.quality.status = 'partial';
    data.quality.supplyReconciled = false;
    data.holders[0]!.amount = '1000';
    const result = assessRisk(data);
    expect(result.metrics.eligibleBalance).toBe('1950');
    expect(result.eligible).toBe(false);
    expect(result.riskScore).toBeNull();
  });
  it('keeps risk between zero and 100 when independently flagged rules overlap', () => {
    const data = input();
    data.holders[0]!.amount = '800';
    data.identity.supply = '1750';
    data.holders[0]!.frozenAmount = '800';
    data.holders[0]!.delegatedAmount = '800';
    data.identity.mintAuthority = key(70);
    data.identity.freezeAuthority = key(71);
    data.signals[0]!.earlyObservedEntry = true;
    data.graph.controlHypotheses = [
      {
        id: 'large',
        owners: [data.holders[0]!.owner, data.holders[1]!.owner],
        amount: '850',
        evidenceIds: ['e'],
        confidence: 'medium',
        identityProven: false,
      },
    ];
    const result = assessRisk(data);
    expect(result.riskScore).toBe(100);
    expect(result.classification).toBe('high');
  });
});
