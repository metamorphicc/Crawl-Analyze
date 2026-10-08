import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'lossless-json';
import { z } from 'zod';
import type { Config } from '@crawlspider/config';
import { PublicError } from '@crawlspider/contracts';
import { validAddress } from './input.js';
import { LocalBudget, type ProviderBudget } from './budget.js';
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
  return parse(text, undefined, (value) => value);
}
export const integerString = z
  .string()
  .max(20)
  .regex(/^(0|[1-9]\d*)$/)
  .refine((v) => BigInt(v) <= 18446744073709551615n);
const accountSchema = z.object({
  owner: z.string(),
  executable: z.boolean(),
  data: z.tuple([z.string(), z.literal('base64')]),
});
export type RpcAccount = { owner: string; executable: boolean; data: Uint8Array; slot: string };
export type RpcParams = unknown[] | Record<string, unknown>;
export type RpcTransport = {
  call(method: string, params: RpcParams, signal: AbortSignal): Promise<unknown>;
};
async function boundedBody(response: Response, signal: AbortSignal) {
  if (!response.body) throw new ProviderError('PROVIDER_EMPTY_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}
type Circuit = { failures: number; until: number };
export class RpcClient implements RpcTransport {
  private readonly urls: string[];
  private readonly circuits = new Map<string, Circuit>();
  private readonly budget: ProviderBudget;
  private readonly provider: string;
  constructor(
    private readonly config: Config,
    private readonly request: typeof fetch = fetch,
    options: { budget?: ProviderBudget; provider?: 'rpc' | 'helius' } = {},
  ) {
    const helius = config.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(config.HELIUS_API_KEY)}`
      : undefined;
    this.provider = options.provider || 'rpc';
    this.urls = (
      this.provider === 'helius'
        ? [helius]
        : [config.SOLANA_RPC_URL || helius, config.SOLANA_FALLBACK_RPC_URL]
    ).filter((v): v is string => Boolean(v));
    this.budget =
      options.budget ||
      new LocalBudget(config.PROVIDER_MAX_RPS, config.PROVIDER_DAILY_REQUEST_LIMIT);
  }
  async call(method: string, params: RpcParams, signal: AbortSignal): Promise<unknown> {
    if (!this.urls.length)
      throw new PublicError(
        this.provider === 'helius' ? 'INDEX_NOT_CONFIGURED' : 'RPC_NOT_CONFIGURED',
        'Configure the required Solana provider in the local environment',
        503,
      );
    let lastError: ProviderError = new ProviderError('PROVIDER_CIRCUIT_OPEN', true);
    for (const url of this.urls) {
      if ((this.circuits.get(url)?.until || 0) > Date.now()) continue;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) throw new ProviderError('DEADLINE_EXCEEDED');
        try {
          const host = new URL(url).hostname;
          await this.budget.reserve(
            host === 'mainnet.helius-rpc.com' || host.endsWith('.helius-rpc.com')
              ? 'helius'
              : 'rpc',
            signal,
          );
          const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(this.config.PROVIDER_REQUEST_TIMEOUT_MS),
          ]);
          const response = await this.request(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 'crawlspider', method, params }),
            signal: requestSignal,
            redirect: 'error',
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new ProviderError(
              response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR',
              response.status === 429 || response.status >= 500,
            );
          }
          let json;
          try {
            json = z
              .object({
                jsonrpc: z.literal('2.0'),
                id: z.literal('crawlspider'),
                result: z.unknown().optional(),
                error: z.object({ code: z.string(), message: z.string() }).optional(),
              })
              .parse(parseProviderJson(await boundedBody(response, requestSignal)));
          } catch (e) {
            if (e instanceof ProviderError) throw e;
            if (requestSignal.aborted) throw new ProviderError('PROVIDER_TIMEOUT', true);
            throw new ProviderError('PROVIDER_INVALID_RESPONSE');
          }
          if (json.error)
            throw new ProviderError(
              'PROVIDER_RPC_ERROR',
              ['-32029', '-32005', '-32000'].includes(json.error.code),
            );
          if (!('result' in json)) throw new ProviderError('PROVIDER_INVALID_RESPONSE');
          this.circuits.set(url, { failures: 0, until: 0 });
          return json.result;
        } catch (e) {
          if (signal.aborted) throw new ProviderError('DEADLINE_EXCEEDED');
          if (e instanceof PublicError && !(e instanceof ProviderError)) throw e;
          lastError =
            e instanceof ProviderError ? e : new ProviderError('PROVIDER_CONNECTION_ERROR', true);
          if (!lastError.retryable) throw lastError;
          const circuit = this.circuits.get(url) || { failures: 0, until: 0 };
          circuit.failures++;
          if (circuit.failures >= 3) circuit.until = Date.now() + 15000;
          this.circuits.set(url, circuit);
          if (this.urls.length > 1 || attempt === 1) break;
          await delay(150, undefined, { signal }).catch(() => {
            throw new ProviderError('DEADLINE_EXCEEDED');
          });
        }
      }
    }
    throw lastError;
  }
}
export function decodeRpcAccount(value: unknown, slot: string): RpcAccount | null {
  if (value === null) return null;
  const result = accountSchema.parse(value);
  const text = result.data[0];
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text) ||
    text.length > 1048576
  )
    throw new ProviderError('INVALID_ACCOUNT_DATA');
  return {
    owner: validAddress(result.owner),
    executable: result.executable,
    data: Buffer.from(text, 'base64'),
    slot,
  };
}
export async function getAccount(
  rpc: RpcTransport,
  key: string,
  signal: AbortSignal,
): Promise<RpcAccount | null> {
  validAddress(key);
  const response = z
    .object({ context: z.object({ slot: integerString }), value: z.unknown() })
    .parse(
      await rpc.call(
        'getAccountInfo',
        [key, { encoding: 'base64', commitment: 'confirmed' }],
        signal,
      ),
    );
  return decodeRpcAccount(response.value, response.context.slot);
}
export async function getAccounts(rpc: RpcTransport, keys: string[], signal: AbortSignal) {
  if (keys.length > 100) throw new Error('RPC account batch is limited to 100');
  keys.forEach(validAddress);
  const response = z
    .object({ context: z.object({ slot: integerString }), value: z.array(z.unknown()) })
    .parse(
      await rpc.call(
        'getMultipleAccounts',
        [keys, { encoding: 'base64', commitment: 'confirmed' }],
        signal,
      ),
    );
  if (response.value.length !== keys.length) throw new ProviderError('PROVIDER_INVALID_RESPONSE');
  return response.value.map((v) => decodeRpcAccount(v, response.context.slot));
}
