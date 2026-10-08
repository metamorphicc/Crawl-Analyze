import { parse } from 'lossless-json';
import { z } from 'zod';
import type { Config } from '@crawlspider/config';
import { PublicError } from '@crawlspider/contracts';
import { validAddress } from './input.js';

export class ProviderError extends PublicError {
  constructor(
    code: string,
    public readonly retryable = false,
  ) {
    super(code, 'Provider data is unavailable or invalid', 503);
    this.name = 'ProviderError';
  }
}
export function parseProviderJson(text: string): unknown {
  // Every numeric JSON literal stays textual until a field-specific precision check.
  return parse(text, undefined, (value) => value);
}
export const integerString = z.string().regex(/^(0|[1-9]\d*)$/);
const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  data: z.tuple([z.string(), z.literal('base64')]),
});
export type RpcAccount = { owner: string; executable: boolean; data: Uint8Array; slot: string };
export type RpcTransport = {
  call(method: string, params: unknown[], signal: AbortSignal): Promise<unknown>;
};
export class RpcClient implements RpcTransport {
  private readonly urls: string[];
  constructor(
    private readonly config: Config,
    private readonly request: typeof fetch = fetch,
  ) {
    const primary =
      config.SOLANA_RPC_URL ||
      (config.HELIUS_API_KEY
        ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(config.HELIUS_API_KEY)}`
        : undefined);
    this.urls = [primary, config.SOLANA_FALLBACK_RPC_URL].filter((v): v is string => Boolean(v));
  }
  async call(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    if (!this.urls.length)
      throw new PublicError(
        'RPC_NOT_CONFIGURED',
        'Configure Solana RPC in the local environment',
        503,
      );
    for (const [index, url] of this.urls.entries()) {
      signal.throwIfAborted();
      try {
        const response = await this.request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 'crawlspider', method, params }),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.config.PROVIDER_REQUEST_TIMEOUT_MS),
          ]),
          redirect: 'error',
        });
        if (!response.ok)
          throw new ProviderError(
            response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR',
            response.status === 429 || response.status >= 500,
          );
        const json = z
          .object({
            jsonrpc: z.literal('2.0'),
            id: z.literal('crawlspider'),
            result: z.unknown().optional(),
            error: z.object({ code: z.string(), message: z.string() }).optional(),
          })
          .parse(parseProviderJson(await response.text()));
        if (json.error) throw new ProviderError('PROVIDER_RPC_ERROR', false);
        if (!('result' in json)) throw new ProviderError('PROVIDER_INVALID_RESPONSE');
        return json.result;
      } catch (error) {
        if (signal.aborted) throw new ProviderError('DEADLINE_EXCEEDED');
        if (index === this.urls.length - 1 || (error instanceof ProviderError && !error.retryable))
          throw error instanceof ProviderError
            ? error
            : new ProviderError('PROVIDER_CONNECTION_ERROR', true);
      }
    }
    throw new ProviderError('PROVIDER_UNAVAILABLE');
  }
}
export async function getAccount(
  rpc: RpcTransport,
  key: string,
  signal: AbortSignal,
): Promise<RpcAccount | null> {
  validAddress(key);
  const response = z
    .object({ context: z.object({ slot: integerString }), value: accountSchema.nullable() })
    .parse(
      await rpc.call(
        'getAccountInfo',
        [key, { encoding: 'base64', commitment: 'confirmed' }],
        signal,
      ),
    );
  if (!response.value) return null;
  const text = response.value.data[0];
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) ||
    text.length > 1048576
  )
    throw new ProviderError('INVALID_ACCOUNT_DATA');
  return {
    owner: response.value.owner,
    executable: response.value.executable,
    data: Buffer.from(text, 'base64'),
    slot: response.context.slot,
  };
}
