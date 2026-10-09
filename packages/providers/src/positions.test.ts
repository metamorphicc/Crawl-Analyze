import { describe, it, expect } from 'vitest';
import { address, none } from '@solana/kit';
import { getTokenEncoder } from '@solana-program/token';
import { readOwnerPositions, readBlockOrders } from './positions.js';
import { aggregateOwners } from './holders.js';
import { key } from '../../../tests/fixtures/analytics.js';
const account = (n: number, amount: bigint, owner = key(10)) => ({
  pubkey: key(n),
  account: {
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    data: [
      Buffer.from(
        getTokenEncoder().encode({
          mint: address(key(1)),
          owner: address(owner),
          amount,
          delegate: none(),
          state: 1,
          isNative: none(),
          delegatedAmount: 0n,
          closeAuthority: none(),
        }),
      ).toString('base64'),
      'base64',
    ],
  },
});
describe('targeted positions and block-order adapters', () => {
  it('reads all accounts of an old owner without converting balances to number', async () => {
    const rpc = {
      async call(method: string, params: unknown) {
        expect(method).toBe('getTokenAccountsByOwner');
        expect(params).toMatchObject([key(10), { mint: key(1) }, { encoding: 'base64' }]);
        return {
          context: { slot: '100' },
          value: [account(40, 9007199254740993n), account(41, 10n)],
        };
      },
    };
    const result = await readOwnerPositions(
      [key(10), key(10)],
      key(1),
      rpc,
      AbortSignal.timeout(1000),
    );
    expect(result).toHaveLength(1);
    expect(
      aggregateOwners([
        {
          address: key(40),
          owner: key(10),
          mint: key(1),
          amount: '10',
          frozen: false,
          delegated_amount: '50',
        },
      ])[0]!.delegatedAmount,
    ).toBe('10');
    expect(result[0]).toMatchObject({
      status: 'complete',
      amount: '9007199254741003',
      slot: '100',
    });
  });
  it('distinguishes complete empty positions from unavailable/incorrect-owner accounts', async () => {
    const empty = {
      async call() {
        return { context: { slot: '100' }, value: [] };
      },
    };
    expect(
      (await readOwnerPositions([key(10)], key(1), empty, AbortSignal.timeout(1000)))[0],
    ).toMatchObject({ status: 'complete', amount: '0' });
    const wrong = {
      async call() {
        return { context: { slot: '100' }, value: [account(40, 10n, key(11))] };
      },
    };
    expect(
      (await readOwnerPositions([key(10)], key(1), wrong, AbortSignal.timeout(1000)))[0],
    ).toMatchObject({ status: 'unavailable', amount: null });
    const down = {
      async call() {
        throw new Error('private provider URL');
      },
    };
    expect(
      (await readOwnerPositions([key(10)], key(1), down, AbortSignal.timeout(1000)))[0]!.reasons,
    ).toEqual(['OWNER_POSITION_UNVERIFIED']);
  });
  it('preserves RPC block signature order and bounds unique block reads', async () => {
    let calls = 0;
    const rpc = {
      async call() {
        calls++;
        return { signatures: ['third-lexically', 'first-lexically'] };
      },
    };
    const result = await readBlockOrders(
      ['100', '100', '101', '102', '103', '104'],
      rpc,
      AbortSignal.timeout(1000),
    );
    expect(calls).toBe(4);
    expect(result.get('100')).toEqual(['third-lexically', 'first-lexically']);
  });
});
