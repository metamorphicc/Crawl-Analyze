import { z } from 'zod';
import { marketChartSchema, type MarketChart } from '@crawlspider/contracts';
import { validAddress } from './input.js';
import { parseProviderJson, ProviderError } from './rpc.js';
const row = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string()]);
const payloadSchema = z.object({
  data: z.object({ attributes: z.object({ ohlcv_list: z.array(row).max(100) }) }),
  meta: z.object({
    base: z.object({ address: z.string() }),
    quote: z.object({ address: z.string() }),
  }),
});
// Only chart enrichment: prices never enter report scores or reserve arithmetic.
export async function readMarketChart(
  mint: string,
  pool: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<MarketChart> {
  validAddress(mint);
  validAddress(pool);
  signal.throwIfAborted();
  const url = new URL(
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/ohlcv/minute`,
  );
  url.search = new URLSearchParams({
    aggregate: '5',
    limit: '100',
    currency: 'usd',
    token: mint,
    include_empty_intervals: 'false',
  }).toString();
  const response = await request(url, {
    signal,
    redirect: 'error',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError('CHART_PROVIDER_UNAVAILABLE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('CHART_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const stop = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new ProviderError('CHART_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', stop);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const payload = payloadSchema.parse(parseProviderJson(Buffer.concat(chunks).toString('utf8')));
  if (![payload.meta.base.address, payload.meta.quote.address].includes(mint))
    throw new ProviderError('CHART_TOKEN_MISMATCH');
  const candles = payload.data.attributes.ohlcv_list
    .map(([time, open, high, low, close, volume]) => ({
      time: Number(time),
      open,
      high,
      low,
      close,
      volume,
    }))
    .sort((a, b) => a.time - b.time);
  const parsed = marketChartSchema.parse({
    status: candles.length ? 'available' : 'unavailable',
    mint,
    pool,
    provider: 'geckoterminal',
    observedAt: new Date().toISOString(),
    currency: 'USD',
    intervalSeconds: 300,
    reasons: candles.length ? [] : ['CHART_NO_TRADES'],
    candles,
  });
  if (
    parsed.candles.some(
      (c, i) =>
        c.time > Date.now() / 1000 + 300 ||
        (i > 0 && c.time <= parsed.candles[i - 1]!.time) ||
        Number(c.low) > Math.min(Number(c.open), Number(c.close)) ||
        Number(c.high) < Math.max(Number(c.open), Number(c.close)),
    )
  )
    throw new ProviderError('CHART_INVALID_CANDLES');
  return parsed;
}
