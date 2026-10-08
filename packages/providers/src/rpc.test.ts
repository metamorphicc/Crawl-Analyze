import { describe, expect, it } from 'vitest';
import { parseConfig } from '@crawlspider/config';
import { parseProviderJson, RpcClient } from './rpc.js';
const config = parseConfig({
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
  SOLANA_RPC_URL: 'https://rpc.test',
  SOLANA_FALLBACK_RPC_URL: 'https://backup.test',
});
describe('RPC boundary', () => {
  it('preserves unsafe JSON integers before they enter JavaScript number', () => {
    expect(parseProviderJson('{"amount":18446744073709551615,"slot":9007199254740993}')).toEqual({
      amount: '18446744073709551615',
      slot: '9007199254740993',
    });
  });
  it('fails over on rate limits and never includes endpoint credentials in errors', async () => {
    let count = 0;
    const request = (async () =>
      ++count === 1
        ? new Response('', { status: 429 })
        : new Response('{"jsonrpc":"2.0","id":"crawlspider","result":42}')) as typeof fetch;
    expect(
      await new RpcClient(config, request).call('getSlot', [], AbortSignal.timeout(1000)),
    ).toBe('42');
    expect(count).toBe(2);
  });
  it('aborts before any IO if the scan is already cancelled', async () => {
    let count = 0;
    const request = (async () => {
      count++;
      return new Response();
    }) as typeof fetch;
    await expect(
      new RpcClient(config, request).call('getSlot', [], AbortSignal.abort()),
    ).rejects.toThrow();
    expect(count).toBe(0);
  });
});
