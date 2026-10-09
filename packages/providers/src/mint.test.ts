import { describe, expect, it } from 'vitest';
import { getMintEncoder } from '@solana-program/token';
import { address, none, getAddressEncoder } from '@solana/kit';
import { decodeMintIdentity, resolveInput } from './mint.js';
import { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, WRAPPED_SOL } from './input.js';
const mintBytes = () =>
  new Uint8Array(
    getMintEncoder().encode({
      mintAuthority: none(),
      supply: 18446744073709551615n,
      decimals: 9,
      isInitialized: true,
      freezeAuthority: none(),
    }),
  );
const account = () => ({
  owner: TOKEN_PROGRAM,
  executable: false,
  data: mintBytes(),
  slot: '9007199254740993',
});
describe('on-chain mint verification', () => {
  it('validates metadata-only extensions without confusing them with token restrictions', () => {
    const data = new Uint8Array(166 + 4 + 64 + 4 + 80);
    data.set(mintBytes());
    data[165] = 1;
    data[166] = 18;
    data[168] = 64;
    const at = 234;
    data[at] = 19;
    data[at + 2] = 80;
    data.set(getAddressEncoder().encode(address(WRAPPED_SOL)), at + 4 + 32);
    const result = decodeMintIdentity(WRAPPED_SOL, {
      ...account(),
      owner: TOKEN_2022_PROGRAM,
      data,
    });
    expect(result.token2022Extensions).toEqual([18, 19]);
    data[at + 4 + 32] = 255;
    expect(() =>
      decodeMintIdentity(WRAPPED_SOL, { ...account(), owner: TOKEN_2022_PROGRAM, data }),
    ).toThrow();
    data[168] = 63;
    expect(() =>
      decodeMintIdentity(WRAPPED_SOL, { ...account(), owner: TOKEN_2022_PROGRAM, data }),
    ).toThrow();
  });
  it('decodes exact supply, slot and revoked authorities', () => {
    const result = decodeMintIdentity(WRAPPED_SOL, account());
    expect(result.supply).toBe('18446744073709551615');
    expect(result.mintAuthority).toBeNull();
    expect(result.provenance.slot).toBe('9007199254740993');
  });
  it('rejects wallets, executable programs and token accounts', () => {
    expect(() =>
      decodeMintIdentity(WRAPPED_SOL, { ...account(), owner: '11111111111111111111111111111111' }),
    ).toThrow();
    expect(() => decodeMintIdentity(WRAPPED_SOL, { ...account(), executable: true })).toThrow();
    expect(() =>
      decodeMintIdentity(WRAPPED_SOL, { ...account(), data: new Uint8Array(165) }),
    ).toThrow();
  });
  it('exposes Token-2022 extensions and rejects malformed TLV', () => {
    const data = new Uint8Array(174);
    data.set(mintBytes());
    data[165] = 1;
    data[166] = 99;
    data[168] = 4;
    const result = decodeMintIdentity(WRAPPED_SOL, {
      ...account(),
      owner: TOKEN_2022_PROGRAM,
      data,
    });
    expect(result.token2022Extensions).toEqual([99]);
    data[168] = 5;
    expect(() =>
      decodeMintIdentity(WRAPPED_SOL, { ...account(), owner: TOKEN_2022_PROGRAM, data }),
    ).toThrow();
  });
  it('never fetches a supplied terminal URL', async () => {
    const calls: unknown[][] = [];
    const rpc = {
      async call(method: string, params: unknown[]) {
        calls.push([method, ...params]);
        return {
          context: { slot: '1' },
          value: {
            owner: TOKEN_PROGRAM,
            executable: false,
            data: [Buffer.from(mintBytes()).toString('base64'), 'base64'],
          },
        };
      },
    };
    const result = await resolveInput(
      `https://gmgn.ai/sol/token/${WRAPPED_SOL}`,
      rpc,
      AbortSignal.timeout(1000),
    );
    expect(result.identity.mint).toBe(WRAPPED_SOL);
    expect(calls[0]?.[1]).toBe(WRAPPED_SOL);
    expect(address(result.identity.mint)).toBe(WRAPPED_SOL);
  });
});
