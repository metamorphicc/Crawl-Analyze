import { describe, expect, it } from 'vitest';
import { address, getAddressDecoder } from '@solana/kit';
import type { MintIdentity } from '@crawlspider/contracts';
import { aggregateOwners, enumerateHolders, type IndexedTokenAccount } from './holders.js';
import { ProviderError, type RpcTransport } from './rpc.js';
import { TOKEN_PROGRAM } from './input.js';
const key = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const mint = key(99);
const identity = (supply: string): MintIdentity => ({
  mint,
  program: TOKEN_PROGRAM,
  decimals: 6,
  supply,
  mintAuthority: null,
  freezeAuthority: null,
  token2022Extensions: [],
  provenance: {
    provider: 'fixture',
    slot: '100',
    observedAt: new Date().toISOString(),
    commitment: 'confirmed',
    parserVersion: '1',
  },
});
const row = (n: number, owner = n, amount = '1'): IndexedTokenAccount => ({
  address: key(n),
  owner: key(owner),
  mint,
  amount,
  delegated_amount: '0',
  frozen: false,
});
const rpc: RpcTransport = {
  async call() {
    return '105';
  },
};
const run = (responses: unknown[], supply: string, options = { maxPages: 10, pageSize: 10 }) => {
  let i = 0;
  return enumerateHolders(
    identity(supply),
    {
      async call() {
        const result = responses[i++];
        if (result instanceof Error) throw result;
        return result;
      },
    },
    rpc,
    AbortSignal.timeout(2000),
    options,
  );
};
const page = (rows: IndexedTokenAccount[], slot = '100', cursor?: string) => ({
  token_accounts: rows,
  last_indexed_slot: slot,
  total: String(rows.length),
  ...(cursor ? { cursor } : {}),
});
describe('complete holder enumeration', () => {
  it('enumerates more than 20 owners despite per-page totals and consolidates accounts', async () => {
    const result = await run(
      [
        page(Array.from({ length: 10 }, (_, i) => row(i + 1))),
        page(Array.from({ length: 10 }, (_, i) => row(i + 11))),
        page([row(21), row(22), row(23, 22, '9007199254740993')]),
      ],
      '9007199254741015',
    );
    expect(result.accountCount).toBe(23);
    expect(result.ownerCount).toBe(22);
    expect(result.enumerationComplete).toBe(true);
    expect(result.holders[0]?.amount).toBe('9007199254740994');
    expect(result.quality.status).toBe('complete');
    expect(result.quality.atomic).toBe(false);
  });
  it('returns a partial snapshot when a later page fails', async () => {
    const result = await run(
      [page([row(1), row(2)]), new ProviderError('PROVIDER_RATE_LIMIT')],
      '3',
      { maxPages: 5, pageSize: 2 },
    );
    expect(result.accountCount).toBe(2);
    expect(result.quality.reasons).toContain('PROVIDER_RATE_LIMIT');
    expect(result.quality.supplyReconciled).toBe(false);
  });
  it('detects cursor loops without double counting', async () => {
    const result = await run([page([row(1)], '100', 'x'), page([row(2)], '100', 'x')], '3', {
      maxPages: 5,
      pageSize: 1,
    });
    expect(result.quality.reasons).toContain('CURSOR_LOOP');
    expect(result.accountCount).toBe(2);
  });
  it('does not count duplicated pages or inconsistent balances as an exact count', async () => {
    const result = await run([page([row(1)]), page([row(1)])], '1', { maxPages: 5, pageSize: 1 });
    expect(result.quality.reasons).toContain('REPEATED_PAGE');
    expect(result.enumerationComplete).toBe(false);
  });
  it.each(['-1', '18446744073709551616', '1e12'])('rejects corrupt amounts %s', async (amount) => {
    const result = await run([page([row(1, 1, amount)])], '1');
    expect(result.quality.status).toBe('partial');
    expect(result.quality.reasons).toContain('INDEX_PAGE_INVALID');
  });
  it('qualifies slot drift, index lag and supply mismatch', async () => {
    const result = await run([page([row(1)], '1'), page([row(2)], '500'), page([], '500')], '9', {
      maxPages: 5,
      pageSize: 1,
    });
    expect(result.quality.reasons).toEqual(
      expect.arrayContaining(['SUPPLY_NOT_RECONCILED', 'INDEX_SLOT_SPREAD', 'RPC_BEHIND_INDEX']),
    );
  });
  it('excludes only individually verified accounts rather than their entire owner', () => {
    const a = row(1, 10, '5'),
      b = row(2, 10, '7');
    const holders = aggregateOwners([a, b], new Set([a.address]));
    expect(holders[0]?.amount).toBe('12');
    expect(holders[0]?.excludedAmount).toBe('5');
    expect(address(holders[0]!.owner)).toBe(key(10));
  });
});
