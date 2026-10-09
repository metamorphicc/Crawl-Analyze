import { describe, expect, it } from 'vitest';
import { address, getAddressDecoder, getAddressEncoder, none } from '@solana/kit';
import { getTokenEncoder, getMintEncoder } from '@solana-program/token';
import { loadPumpPool, pda } from './markets.js';
import { PUMP_AMM_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL } from './input.js';
const key = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const encoder = getAddressEncoder();
describe('PumpSwap market verification', () => {
  it('rereads pool and both vaults at one context and retains negative virtual quote', async () => {
    const mint = key(5),
      creator = key(6),
      baseVault = key(7),
      quoteVault = key(8);
    const pool = await pda(PUMP_AMM_PROGRAM, [
      new TextEncoder().encode('pool'),
      new Uint8Array(2),
      new Uint8Array(encoder.encode(creator)),
      new Uint8Array(encoder.encode(mint)),
      new Uint8Array(encoder.encode(address(WRAPPED_SOL))),
    ]);
    const data = Buffer.alloc(287);
    data.set([241, 154, 109, 4, 17, 177, 109, 188]);
    for (const [offset, value] of [
      [11, creator],
      [43, mint],
      [75, WRAPPED_SOL],
      [139, baseVault],
      [171, quoteVault],
    ] as const)
      data.set(encoder.encode(address(value)), offset);
    data.writeBigInt64LE(-20n, 245);
    data.fill(255, 253, 261);
    const toAccount = (owner: string, bytes: Uint8Array) => ({
      owner,
      executable: false,
      data: [Buffer.from(bytes).toString('base64'), 'base64'],
    });
    let vaultState = 1;
    const token = (mint: string, amount: bigint) =>
      new Uint8Array(
        getTokenEncoder().encode({
          mint: address(mint),
          owner: pool,
          amount,
          delegate: none(),
          state: vaultState,
          isNative: none(),
          delegatedAmount: 0n,
          closeAuthority: none(),
        }),
      );
    const quoteMint = new Uint8Array(
      getMintEncoder().encode({
        mintAuthority: none(),
        supply: 0n,
        decimals: 9,
        isInitialized: true,
        freezeAuthority: none(),
      }),
    );
    const rpc = {
      async call(method: string) {
        return method === 'getAccountInfo'
          ? { context: { slot: '10' }, value: toAccount(PUMP_AMM_PROGRAM, data) }
          : {
              context: { slot: '20' },
              value: [
                toAccount(PUMP_AMM_PROGRAM, data),
                toAccount(TOKEN_PROGRAM, token(mint, 1000n)),
                toAccount(TOKEN_PROGRAM, token(WRAPPED_SOL, 100n)),
                null,
                null,
                toAccount(TOKEN_PROGRAM, quoteMint),
              ],
            };
      },
    };
    const market = await loadPumpPool(pool, mint, rpc, AbortSignal.timeout(1000));
    expect(market?.virtualQuoteReserve).toBe('-20');
    expect(market?.quoteVaultBalance).toBe('100');
    expect(market?.baseReserve).toBe('1000');
    expect(market?.slot).toBe('20');
    vaultState = 2;
    expect((await loadPumpPool(pool, mint, rpc, AbortSignal.timeout(1000)))?.limitations).toContain(
      'POOL_VAULT_FROZEN',
    );
    vaultState = 0;
    expect(await loadPumpPool(pool, mint, rpc, AbortSignal.timeout(1000))).toBeNull();
    vaultState = 1;
    data.set(encoder.encode(key(22)), 43);
    expect(await loadPumpPool(pool, mint, rpc, AbortSignal.timeout(1000))).toBeNull();
  });
});
