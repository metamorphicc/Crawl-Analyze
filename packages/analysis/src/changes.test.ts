import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { positionComparisonSchema, type ChainTransaction } from '@crawlspider/contracts';
import { comparePositions } from './changes.js';
import { fixtureReport } from '../../../tests/fixtures/report.js';
import { key, NOW } from '../../../tests/fixtures/analytics.js';
import { tx, transfer } from '../../../tests/fixtures/intelligence.js';
const pair = () => {
  const a = fixtureReport(randomUUID()),
    b = fixtureReport(randomUUID(), 'deep', key(1), '2026-10-09T00:00:30.000Z');
  b.snapshot.quality.minSlot = b.snapshot.quality.maxSlot = '445186200';
  return { a, b };
};
const movement = (kind: 'transfer' | 'burn' | 'mint' = 'transfer'): ChainTransaction => {
  const t = transfer(key(10), key(11), key(1), 'synthetic-flow');
  t.slot = '445186150';
  t.flows[0]!.sourceAccount = key(40);
  t.flows[0]!.destinationAccount = key(41);
  t.flows[0]!.amount = '30';
  t.flows[0]!.kind = kind;
  if (kind === 'burn') {
    t.flows[0]!.to = null;
    t.flows[0]!.destinationAccount = null;
  }
  if (kind === 'mint') {
    t.flows[0]!.from = null;
    t.flows[0]!.sourceAccount = null;
  }
  return t;
};
describe('position changes require token movements, not rank', () => {
  it('does not invent a sale when ranks or selected groups change', () => {
    const { a, b } = pair();
    b.snapshot.holders.reverse();
    b.graph.controlHypotheses = [];
    const result = comparePositions(a, b);
    expect(result.comparable).toBe(true);
    expect(result.positions).toHaveLength(0);
    expect(result.movements).toHaveLength(0);
  });
  it('attributes transfer deltas and keeps common control an unproven hypothesis', () => {
    const { a, b } = pair();
    b.snapshot.holders[0]!.amount = '20';
    b.snapshot.holders[1]!.amount = '80';
    b.transactions = [movement()];
    b.graph.controlHypotheses = [
      {
        id: 'group',
        owners: [key(10), key(11)],
        amount: '100',
        evidenceIds: ['transfer'],
        confidence: 'medium',
        identityProven: false,
      },
    ];
    const result = comparePositions(a, b);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({
      kind: 'transfer',
      controlHypothesis: 'group',
      identityProven: false,
    });
    expect(result.positions.map((p) => p.unexplainedDelta)).toEqual(['0', '0']);
    expect(positionComparisonSchema.safeParse(result).success).toBe(true);
  });
  it('retains an unexplained decrease rather than substituting a sell', () => {
    const { a, b } = pair();
    b.snapshot.holders[0]!.amount = '20';
    b.snapshot.holders[1]!.amount = '80';
    const result = comparePositions(a, b);
    expect(result.positions[0]).toMatchObject({ delta: '-30', unexplainedDelta: '-30' });
    expect(result.movements).toHaveLength(0);
  });
  it('proves an exact Pump sell without counting its vault receipt again as a distribution', () => {
    const { a, b } = pair(),
      t = movement();
    b.snapshot.holders[0]!.amount = '20';
    b.snapshot.holders[1]!.amount = '80';
    t.calls = [
      {
        program: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
        instruction: 'sell',
        accounts: {
          base_mint: key(1),
          user: key(10),
          user_base_token_account: key(40),
          pool_base_token_account: key(41),
        },
        args: {},
        missingFields: [],
        index: '0',
      },
    ];
    t.ownerDeltas = [{ owner: key(10), mint: key(1), delta: '-30' }];
    b.transactions = [t, t];
    const result = comparePositions(a, b);
    expect(result.movements).toHaveLength(1);
    expect(result.movements[0]).toMatchObject({ kind: 'sell', amount: '30' });
  });
  it('separates ambiguous swap legs from actual quantified sells', () => {
    const { a, b } = pair(),
      t = movement();
    t.calls = [
      {
        program: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
        instruction: 'sell',
        accounts: {
          base_mint: key(1),
          user: key(10),
          user_base_token_account: key(40),
          pool_base_token_account: key(41),
        },
        args: {},
        missingFields: [],
        index: '0',
      },
    ];
    t.ownerDeltas = [{ owner: key(10), mint: key(1), delta: '-35' }];
    b.transactions = [t];
    const result = comparePositions(a, b);
    expect(result.movements.some((m) => m.kind === 'sell')).toBe(false);
    expect(result.movements[0]).toMatchObject({ kind: 'trade-observed', amount: null });
  });
  it.each(['burn', 'mint'] as const)(
    'preserves factual %s evidence while a changed supply disables balance comparison',
    (kind) => {
      const { a, b } = pair(),
        t = movement(kind);
      b.identity.supply = kind === 'burn' ? '970' : '1030';
      b.snapshot.holders[kind === 'burn' ? 0 : 1]!.amount = kind === 'burn' ? '20' : '80';
      b.transactions = [t];
      const result = comparePositions(a, b);
      expect(result.comparable).toBe(false);
      expect(result.reasons).toContain('MINT_SUPPLY_CHANGED');
      expect(result.movements[0]!.kind).toBe(kind);
      expect(result.positions).toHaveLength(0);
    },
  );
  it('distinguishes self transfers and frozen flags from sales or proven time locks', () => {
    const { a, b } = pair(),
      t = movement();
    t.flows[0]!.to = key(10);
    b.transactions = [t];
    b.snapshot.holders[0]!.frozenAmount = '50';
    const result = comparePositions(a, b);
    expect(result.movements.map((m) => m.kind)).toEqual(['self-transfer', 'freeze-change']);
    expect(result.positions).toHaveLength(0);
  });
  it('does not compare partial/stale snapshots as complete owner balances', () => {
    for (const mode of ['partial', 'stale', 'targeted-mismatch']) {
      const { a, b } = pair();
      if (mode === 'partial') {
        b.snapshot.quality.status = 'partial';
        b.snapshot.holders = [];
      }
      if (mode === 'stale') b.snapshot.quality.observedAt = '2026-10-08T23:00:00.000Z';
      if (mode === 'targeted-mismatch')
        b.targetedBalances = [
          {
            owner: key(10),
            amount: '0',
            slot: '445186200',
            status: 'complete',
            observedAt: NOW,
            reasons: [],
          },
        ];
      expect(comparePositions(a, b).comparable).toBe(false);
      expect(comparePositions(a, b).positions).toHaveLength(0);
    }
  });
  it('does not re-report transactions outside the open snapshot interval or failed executions', () => {
    const { a, b } = pair(),
      t = movement();
    t.slot = a.snapshot.quality.maxSlot!;
    b.transactions = [t];
    expect(comparePositions(a, b).movements).toHaveLength(0);
    t.slot = '445186150';
    t.failed = true;
    expect(comparePositions(a, b).movements).toHaveLength(0);
  });
  it('does not miss an old owner because it no longer appears near the top', () => {
    const { a, b } = pair();
    b.snapshot.holders[0]!.amount = '0';
    b.snapshot.holders[19]!.amount = '100';
    b.snapshot.holders.reverse();
    expect(comparePositions(a, b).positions.find((p) => p.owner === key(10))).toMatchObject({
      before: '50',
      after: '0',
      delta: '-50',
      unexplainedDelta: '-50',
    });
  });
});
