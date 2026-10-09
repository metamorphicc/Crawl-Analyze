import { describe, it, expect } from 'vitest';
import { earlyBuyersSchema } from '@crawlspider/contracts';
import { analyzeEarlyBuyers } from './early.js';
import { key, NOW } from '../../../tests/fixtures/analytics.js';
import { tx, holder, history } from '../../../tests/fixtures/intelligence.js';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const creation = () => {
  const t = tx('create', '100');
  t.calls = [
    {
      program: PUMP,
      instruction: 'create_v2',
      accounts: { mint: key(1) },
      args: {},
      missingFields: [],
      index: '0',
    },
  ];
  return t;
};
const buy = (signature: string, owner: string, slot = '100') => {
  const t = tx(signature, slot);
  t.calls = [
    {
      program: PUMP,
      instruction: 'buy',
      accounts: { mint: key(1), user: owner },
      args: {},
      missingFields: [],
      index: '1',
    },
  ];
  t.ownerDeltas = [{ owner, mint: key(1), delta: '10' }];
  return t;
};
const input = () => ({
  mint: key(1),
  transactions: [creation(), buy('z-first', key(10)), buy('a-second', key(11))],
  coverage: { ...history(key(1)).coverage, signatures: 3, decoded: 3 },
  holders: [holder(key(10), '25')],
  holdersComplete: true,
  observedAt: NOW,
  blockOrders: new Map([['100', ['create', 'z-first', 'a-second']]]),
});
describe('verified launch and bounded first observations', () => {
  it('uses block transaction order, never lexical signature order', () => {
    const result = analyzeEarlyBuyers(input());
    expect(result.status).toBe('complete');
    expect(result.buyers.map((b) => b.signature)).toEqual(['z-first', 'a-second']);
    expect(result.buyers.map((b) => b.transactionOrder)).toEqual([1, 2]);
    expect(result.buyers.map((b) => b.currentBalance)).toEqual(['25', '0']);
    expect(earlyBuyersSchema.safeParse(result).success).toBe(true);
  });
  it('keeps launch proximity unknown when the creation or slot order is missing', () => {
    const data = input();
    data.blockOrders.clear();
    let result = analyzeEarlyBuyers(data);
    expect(result.buyers.every((b) => b.early === null)).toBe(true);
    expect(result.status).toBe('partial');
    data.transactions.shift();
    result = analyzeEarlyBuyers(data);
    expect(result.launch).toBeNull();
    expect(result.reasons).toContain('VERIFIED_LAUNCH_NOT_IN_WINDOW');
  });
  it('deduplicates buyers but labels tied-slot candidates and incomplete current balances', () => {
    const data = input();
    data.transactions.push(buy('again', key(10), '101'));
    data.holdersComplete = false;
    data.blockOrders.clear();
    const result = analyzeEarlyBuyers(data);
    expect(result.buyers).toHaveLength(2);
    expect(result.buyers.find((b) => b.owner === key(11))!.currentBalance).toBeNull();
    expect(result.buyers[0]!.entryClaim).toBe('earliest-observed-slot-candidate');
  });
  it('does not call a routed funding transfer or failed/receiptless instruction an early buyer', () => {
    const data = input();
    data.transactions[1]!.failed = true;
    data.transactions[2]!.ownerDeltas = [];
    expect(analyzeEarlyBuyers(data).buyers).toHaveLength(0);
  });
  it('marks archive truncation and display caps instead of claiming a complete first-buyer list', () => {
    const data = input();
    data.coverage.exhausted = false;
    const result = analyzeEarlyBuyers({ ...data, limit: 1 });
    expect(result.status).toBe('partial');
    expect(result.reasons).toContain('EARLY_BUYER_WINDOW_INCOMPLETE');
    expect(result.reasons).toContain('EARLY_BUYER_DISPLAY_CAP');
  });
});
