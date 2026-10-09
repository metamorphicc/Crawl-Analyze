import { it, expect } from 'vitest';
import { getMintEncoder } from '@solana-program/token';
import { none, getAddressDecoder } from '@solana/kit';
import { readOutcomeObservation } from './outcomes.js';
import { TOKEN_PROGRAM } from './input.js';
const key = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const rpc = {
  call: async () => ({
    context: { slot: '9007199254740993' },
    value: {
      owner: TOKEN_PROGRAM,
      executable: false,
      data: [
        Buffer.from(
          getMintEncoder().encode({
            mintAuthority: none(),
            freezeAuthority: none(),
            isInitialized: true,
            decimals: 9,
            supply: 18446744073709551615n,
          }),
        ).toString('base64'),
        'base64',
      ],
    },
  }),
};
const payload = (mint = key(1)) => ({
  data: {
    attributes: {
      address: key(2),
      base_token_price_usd: '0.12345678901234567890123456789',
      quote_token_price_usd: '150',
      reserve_in_usd: '10000',
    },
    relationships: {
      base_token: { data: { id: `solana_${mint}` } },
      quote_token: { data: { id: `solana_${key(3)}` } },
    },
  },
});
it('preserves exact forward price/supply and verifies fixed endpoint pool/token identity', async () => {
  const observation = await readOutcomeObservation(
    key(1),
    key(2),
    rpc,
    AbortSignal.timeout(2000),
    async (url, options) => {
      expect(String(url)).toBe(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${key(2)}`,
      );
      expect(options?.redirect).toBe('error');
      return Response.json(payload());
    },
  );
  expect(observation.supply).toBe('18446744073709551615');
  expect(observation.priceUsd).toBe('0.12345678901234567890123456789');
  expect(observation.freshnessUpperSeconds).toBeNull();
  const wrong = await readOutcomeObservation(
    key(1),
    key(2),
    rpc,
    AbortSignal.timeout(2000),
    async () => Response.json(payload(key(4))),
  );
  expect(wrong.priceUsd).toBeNull();
  expect(wrong.supply).toBe(observation.supply);
});
it('censors failed/oversized market reads without turning unavailable data into zero', async () => {
  const result = await readOutcomeObservation(
    key(1),
    key(2),
    {
      call: async () => {
        throw new Error('synthetic');
      },
    },
    AbortSignal.timeout(2000),
    async () => new Response('x'.repeat(1024 * 1024 + 1)),
  );
  expect(result.priceUsd).toBeNull();
  expect(result.liquidityUsd).toBeNull();
  expect(result.supply).toBeNull();
});
