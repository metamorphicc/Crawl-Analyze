import { describe, expect, it } from 'vitest';
import { address, getAddressEncoder, getProgramDerivedAddress, none } from '@solana/kit';
import { getTokenEncoder } from '@solana-program/token';
import { PUMP_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL } from './input.js';
import { verifyInfrastructure } from './infrastructure.js';
import { aggregateOwners } from './holders.js';
describe('infrastructure verification', () => {
  it('requires a derived program account and matching vault authority, mint and balance', async () => {
    const [curve] = await getProgramDerivedAddress({
      programAddress: address(PUMP_PROGRAM),
      seeds: [
        new TextEncoder().encode('bonding-curve'),
        getAddressEncoder().encode(address(WRAPPED_SOL)),
      ],
    });
    const tokenKey = '11111111111111111111111111111111';
    const rows = [{ address: tokenKey, owner: curve, mint: WRAPPED_SOL, amount: '100' }];
    const snapshot = { accounts: rows, holders: aggregateOwners(rows) };
    const curveBytes = new Uint8Array(81);
    curveBytes.set([23, 183, 248, 55, 96, 216, 172, 96]);
    const bytes = getTokenEncoder().encode({
      mint: address(WRAPPED_SOL),
      owner: curve,
      amount: 100n,
      delegate: none(),
      state: 1,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
    });
    let validProgram = true;
    const rpc = {
      async call() {
        const data = validProgram
          ? {
              owner: PUMP_PROGRAM,
              executable: false,
              data: [Buffer.from(curveBytes).toString('base64'), 'base64'],
            }
          : {
              owner: TOKEN_PROGRAM,
              executable: false,
              data: [Buffer.from(bytes).toString('base64'), 'base64'],
            };
        validProgram = false;
        return { context: { slot: '100' }, value: [data] };
      },
    };
    const result = await verifyInfrastructure(
      WRAPPED_SOL,
      snapshot,
      rpc,
      AbortSignal.timeout(1000),
    );
    expect(result.excluded.has(tokenKey)).toBe(true);
    expect(result.evidence[0]?.verifiedBy).toContain('derived-pda');
    const fakeRpc = {
      async call() {
        return {
          context: { slot: '100' },
          value: [
            {
              owner: TOKEN_PROGRAM,
              executable: false,
              data: [
                Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]).toString('base64'),
                'base64',
              ],
            },
          ],
        };
      },
    };
    expect(
      (await verifyInfrastructure(WRAPPED_SOL, snapshot, fakeRpc, AbortSignal.timeout(1000)))
        .excluded.size,
    ).toBe(0);
  });
});
