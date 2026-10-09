import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { collectWalletHistories, readWalletHistory, transactionReader } from './history.js';
import { WRAPPED_SOL } from './input.js';
import { tx } from '../../../tests/fixtures/intelligence.js';
import { key } from '../../../tests/fixtures/analytics.js';
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

describe('concurrent history collection', () => {
  it('publishes a fast wallet without waiting for a slow one, preserves candidate order and shares receipt reads', async () => {
    const owners = [key(1), key(2)];
    const releases = new Map<string, () => void>();
    let started!: () => void, updated!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const firstUpdate = new Promise<void>((resolve) => {
      updated = resolve;
    });
    let receipts = 0;
    const rpc = {
      async call(method: string, params: unknown[] | Record<string, unknown>) {
        if (method === 'getTransaction') {
          receipts++;
          return null;
        }
        await new Promise<void>((resolve) => {
          releases.set((params as string[])[0]!, resolve);
          if (releases.size === 2) started();
        });
        return [{ signature: signature(1), slot: '10', err: null }];
      },
    };
    const signal = AbortSignal.timeout(5000);
    const updates: string[][] = [];
    const result = collectWalletHistories(
      owners.map((owner) => ({ owner, accounts: [] })),
      rpc,
      signal,
      options,
      transactionReader(rpc, signal),
      {
        concurrency: 2,
        async onUpdate(histories) {
          updates.push(histories.map((h) => h.owner));
          updated();
        },
      },
    );
    await bothStarted;
    releases.get(owners[1]!)!();
    await firstUpdate;
    expect(updates[0]).toEqual([owners[1]]);
    releases.get(owners[0]!)!();
    const collected = await result;
    expect(collected.histories.map((h) => h.owner)).toEqual(owners);
    expect(collected.complete).toBe(true);
    expect(receipts).toBe(1);
    expect(collected.histories.every((h) => h.coverage.missing === 1)).toBe(true);
  });
  it('does not start another wallet after cancellation and keeps incomplete coverage explicit', async () => {
    const abort = new AbortController();
    let calls = 0;
    const result = await collectWalletHistories(
      [key(1), key(2)].map((owner) => ({ owner, accounts: [] })),
      {
        async call() {
          calls++;
          return [];
        },
      },
      abort.signal,
      options,
      undefined,
      {
        concurrency: 1,
        async onUpdate() {
          abort.abort();
        },
      },
    );
    expect(calls).toBe(1);
    expect(result.histories).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain('OWNER_HISTORY_DEADLINE');
  });
  it('propagates checkpoint failures instead of publishing a successful collection', async () => {
    await expect(
      collectWalletHistories(
        [{ owner: key(1), accounts: [] }],
        {
          async call() {
            return [];
          },
        },
        AbortSignal.timeout(1000),
        options,
        undefined,
        {
          async onUpdate() {
            throw new Error('LEASE_LOST');
          },
        },
      ),
    ).rejects.toThrow('LEASE_LOST');
  });
});
