import { z } from 'zod';
import { outcomeObservationSchema, type OutcomeObservation } from '@crawlspider/contracts';
import { validAddress } from './input.js';
import { parseProviderJson, ProviderError, type RpcTransport } from './rpc.js';
import { resolveInput } from './mint.js';
const numberString = z
  .string()
  .max(100)
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .nullable();
const poolSchema = z.object({
  data: z.object({
    attributes: z.object({
      address: z.string(),
      base_token_price_usd: numberString,
      quote_token_price_usd: numberString,
      reserve_in_usd: numberString,
    }),
    relationships: z.object({
      base_token: z.object({ data: z.object({ id: z.string() }) }),
      quote_token: z.object({ data: z.object({ id: z.string() }) }),
    }),
  }),
});
export async function readOutcomeObservation(
  mint: string,
  pool: string | null,
  rpc: RpcTransport,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  marketPermit?: () => Promise<void>,
): Promise<OutcomeObservation> {
  validAddress(mint);
  if (pool) validAddress(pool);
  let supply: string | null = null,
    slot: string | null = null,
    priceUsd: string | null = null,
    liquidityUsd: string | null = null;
  const reasons: string[] = [];
  try {
    const resolved = await resolveInput(mint, rpc, signal);
    supply = resolved.identity.supply;
    slot = resolved.identity.provenance.slot;
  } catch {
    reasons.push('OUTCOME_SUPPLY_UNAVAILABLE');
  }
  if (pool)
    try {
      await marketPermit?.();
      signal.throwIfAborted();
      const response = await request(
        `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`,
        { signal, redirect: 'error', headers: { accept: 'application/json;version=20230203' } },
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError('OUTCOME_MARKET_UNAVAILABLE');
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty');
      let size = 0;
      const chunks: Uint8Array[] = [];
      const abort = () => {
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', abort, { once: true });
      let raw: string;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new Error('size');
          chunks.push(value);
        }
        signal.throwIfAborted();
        raw = Buffer.concat(chunks).toString('utf8');
      } finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      const data = poolSchema.parse(parseProviderJson(raw)).data;
      if (data.attributes.address !== pool) throw new Error('pool identity');
      const base = data.relationships.base_token.data.id === `solana_${mint}`,
        quote = data.relationships.quote_token.data.id === `solana_${mint}`;
      if (base === quote) throw new Error('mint identity');
      priceUsd = base
        ? data.attributes.base_token_price_usd
        : data.attributes.quote_token_price_usd;
      liquidityUsd = data.attributes.reserve_in_usd;
      if (priceUsd === null) reasons.push('OUTCOME_PRICE_UNAVAILABLE');
      if (liquidityUsd === null) reasons.push('OUTCOME_LIQUIDITY_UNAVAILABLE');
    } catch {
      reasons.push('OUTCOME_MARKET_UNAVAILABLE');
    }
  else reasons.push('VERIFIED_POOL_UNAVAILABLE');
  return outcomeObservationSchema.parse({
    observedAt: new Date().toISOString(),
    pool,
    priceUsd,
    liquidityUsd,
    supply,
    slot,
    source: 'geckoterminal+solana-rpc',
    freshnessUpperSeconds: null,
    reasons: [...reasons, 'MARKET_EVENT_TIME_UNAVAILABLE'],
  });
}
