import { describe, expect, it } from 'vitest';
import { holder, history, tx, transfer } from '../../../tests/fixtures/intelligence.js';
import { selectHistoryCandidates, counterpartyCandidates, summarizeWallet } from './history.js';
describe('coverage and observed history signals', () => {
  it('selects beyond the top 20 and reports an unmet supply target under a cap', () => {
    const holders = Array.from({ length: 60 }, (_, i) =>
      holder(`owner-${String(i).padStart(2, '0')}`),
    );
    const selection = selectHistoryCandidates(holders, {
      maxOwners: 40,
      minOwners: 25,
      targetSupplyBps: 9500,
    });
    expect(selection.candidates.length).toBe(40);
    expect(selection.selectedSupplyBps).toBe(6666);
    expect(selection.targetReached).toBe(false);
  });
  it('targets small counterparties outside the initial ranking', () => {
    const holders = Array.from({ length: 60 }, (_, i) => holder(`owner-${i}`));
    const extra = counterpartyCandidates(
      holders,
      [history('owner-0', [transfer('owner-0', 'owner-55', 'mint', 'sig')])],
      new Set(['owner-0']),
    );
    expect(extra.map((h) => h.owner)).toEqual(['owner-55']);
  });
  it('does not classify missing entry/history as fresh or clean', () => {
    const result = summarizeWallet(history('a'), 'mint');
    expect(result.entry).toBeNull();
    expect(result.priorTrading).toBe('unknown');
    expect(result.freshWallet).toBeNull();
  });
  it('reports scoped prior activity and acquisition evidence, never personal identity', () => {
    const older = tx('old', '90');
    older.calls = [
      {
        program: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
        instruction: 'buy',
        accounts: { user: 'a', mint: 'old-mint' },
        args: { amount: '10' },
        missingFields: [],
        index: '0',
      },
    ];
    const entry = transfer('distributor', 'a', 'mint', 'new');
    const result = summarizeWallet(history('a', [entry, older]), 'mint', {
      slot: '98',
      signature: 'launch',
    });
    expect(result.priorTrading).toBe('observed');
    expect(result.priorTradeCount).toBe(1);
    expect(result.earlyObservedEntry).toBe(true);
    expect(result.freshWallet).toBeNull();
  });
});
