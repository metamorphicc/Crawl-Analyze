import { describe, it, expect } from 'vitest';
import { readMarketChart, discoverChartPool } from './chart.js';
import { getAddressDecoder } from '@solana/kit';
const mint = getAddressDecoder().decode(new Uint8Array(32).fill(1)),
  pool = getAddressDecoder().decode(new Uint8Array(32).fill(2));
const body = (address = mint, rows: unknown[] = [[1712534400, 1, 2, 0.5, 1.5, 12]]) =>
  JSON.stringify({
    data: { attributes: { ohlcv_list: rows } },
    meta: { base: { address }, quote: { address: pool } },
  });
describe('bounded independent chart enrichment', () => {
  it('discovers a display pool on any venue without accepting unrelated token pairs', async () => {
    const data = (token: string, address: string = pool) => ({
      attributes: { address },
      relationships: {
        base_token: { data: { id: `solana_${token}` } },
        quote_token: { data: { id: `solana_${pool}` } },
      },
    });
    const result = await discoverChartPool(
      mint,
      AbortSignal.timeout(2000),
      async (url, options) => {
        expect(String(url)).toBe(
          `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools`,
        );
        expect(options?.redirect).toBe('error');
        return new Response(JSON.stringify({ data: [data(pool), data(mint, 'bad'), data(mint)] }));
      },
    );
    expect(result).toBe(pool);
    expect(
      await discoverChartPool(
        mint,
        AbortSignal.timeout(2000),
        async () => new Response(JSON.stringify({ data: [data(pool)] })),
      ),
    ).toBeNull();
  });
  it('uses only the fixed provider with explicit mint selection and preserves decimals', async () => {
    const response = body().replace('1.5', '1.500000000000000000000001');
    const chart = await readMarketChart(
      mint,
      pool,
      AbortSignal.timeout(2000),
      async (url, options) => {
        const u = new URL(String(url));
        expect(u.hostname).toBe('api.geckoterminal.com');
        expect(u.searchParams.get('token')).toBe(mint);
        expect(u.searchParams.get('include_empty_intervals')).toBe('false');
        expect(options?.redirect).toBe('error');
        return new Response(response);
      },
    );
    expect(chart.candles[0]!.close).toBe('1.500000000000000000000001');
  });
  it('rejects unrelated tokens, duplicate timestamps, malformed candles and oversized bodies', async () => {
    await expect(
      readMarketChart(mint, pool, AbortSignal.timeout(2000), async () => new Response(body(pool))),
    ).rejects.toThrow();
    for (const rows of [
      [
        [1712534400, 1, 2, 0.5, 1.5, 12],
        [1712534400, 1, 2, 0.5, 1.5, 12],
      ],
      [[1712534400, 1, 2, 3, 1.5, 12]],
      [[1712534400, -1, 2, 0.5, 1.5, 12]],
    ])
      await expect(
        readMarketChart(
          mint,
          pool,
          AbortSignal.timeout(2000),
          async () => new Response(body(mint, rows)),
        ),
      ).rejects.toThrow();
    await expect(
      readMarketChart(
        mint,
        pool,
        AbortSignal.timeout(2000),
        async () => new Response(' '.repeat(1024 * 1024 + 1)),
      ),
    ).rejects.toMatchObject({ code: 'CHART_RESPONSE_TOO_LARGE' });
  });
  it('does not invent candles on an empty history and propagates cancellation', async () => {
    const chart = await readMarketChart(
      mint,
      pool,
      AbortSignal.timeout(2000),
      async () => new Response(body(mint, [])),
    );
    expect(chart.status).toBe('unavailable');
    expect(chart.candles).toEqual([]);
    await expect(
      readMarketChart(mint, pool, AbortSignal.abort(), async () => new Response(body())),
    ).rejects.toThrow();
  });
  it('cancels a stalled streaming body and rejects float underflow', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{'));
      },
    });
    await expect(
      readMarketChart(mint, pool, AbortSignal.timeout(30), async () => new Response(stream)),
    ).rejects.toThrow();
    await expect(
      readMarketChart(
        mint,
        pool,
        AbortSignal.timeout(2000),
        async () =>
          new Response(
            body(mint, [[1712534400, '1e-999', 2, 0, 1, 1]]).replace('"1e-999"', '1e-999'),
          ),
      ),
    ).rejects.toThrow();
  });
});
