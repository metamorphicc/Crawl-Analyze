import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { readWalletHistory } from './history.js';
import { WRAPPED_SOL } from './input.js';
import { tx } from '../../../tests/fixtures/intelligence.js';
const signature = (n: number) => bs58.encode(new Uint8Array(64).fill(n));
const options = { maxPages: 2, pageSize: 2, maxTransactions: 2, maxAccounts: 0 };
describe('bounded wallet history reader', () => {
  it('reports unavailable receipts and retained-history uncertainty', async () => {
    const sig = signature(1);
    const result = await readWalletHistory(
      WRAPPED_SOL,
      [],
      {
        async call() {
          return [{ signature: sig, slot: '10', err: null }];
        },
      },
      AbortSignal.timeout(1000),
      options,
      async () => null,
    );
    expect(result.coverage.missing).toBe(1);
    expect(result.coverage.reasons).toContain('TRANSACTION_UNAVAILABLE');
    expect(result.coverage.status).toBe('partial');
  });
  it('catches repeated pages without unbounded IO', async () => {
    let calls = 0;
    const rpc = {
      async call() {
        calls++;
        return [
          { signature: signature(1), slot: '10', err: null },
          { signature: signature(2), slot: '9', err: null },
        ];
      },
    };
    const result = await readWalletHistory(
      WRAPPED_SOL,
      [],
      rpc,
      AbortSignal.timeout(1000),
      options,
      async (signature) => tx(signature),
    );
    expect(calls).toBe(2);
    expect(result.coverage.reasons).toContain('HISTORY_CURSOR_LOOP');
    expect(result.transactions.length).toBe(2);
  });
  it('enforces the transaction budget and does not interpret a limited window as a fresh wallet', async () => {
    const result = await readWalletHistory(
      WRAPPED_SOL,
      [],
      {
        async call() {
          return [
            { signature: signature(1), slot: '10', err: null },
            { signature: signature(2), slot: '9', err: null },
          ];
        },
      },
      AbortSignal.timeout(1000),
      { ...options, maxPages: 1, maxTransactions: 1 },
      async (signature) => tx(signature),
    );
    expect(result.transactions.length).toBe(1);
    expect(result.coverage.reasons).toContain('HISTORY_TRANSACTION_LIMIT');
    expect(result.coverage.exhausted).toBe(false);
  });
});
