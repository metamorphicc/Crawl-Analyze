import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { getAddressDecoder } from '@solana/kit';
import { normalizeTransaction, executedTrades } from './transactions.js';
import { protocolIdl } from './idl.js';
import { PUMP_PROGRAM, TOKEN_PROGRAM, WRAPPED_SOL } from './input.js';
const key = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const sig = bs58.encode(new Uint8Array(64).fill(1));
const ix = (tag: number, amount: bigint, accounts: number[]) => {
  const b = Buffer.alloc(9);
  b[0] = tag;
  b.writeBigUInt64LE(amount, 1);
  return { programIdIndex: '0', accounts: accounts.map(String), data: bs58.encode(b) };
};
const balance = (index: number, owner: string, amount: string) => ({
  accountIndex: String(index),
  mint: WRAPPED_SOL,
  owner,
  uiTokenAmount: { amount, decimals: '9' },
});
const fixture = () => ({
  slot: '9007199254740993',
  blockTime: '100',
  transaction: {
    signatures: [sig],
    message: {
      accountKeys: [TOKEN_PROGRAM, key(1), key(2), key(3)],
      instructions: [ix(3, 9007199254740993n, [1, 2, 3])],
    },
  },
  meta: {
    err: null as unknown,
    preTokenBalances: [balance(1, key(10), '9007199254740993'), balance(2, key(11), '0')],
    postTokenBalances: [balance(1, key(10), '0'), balance(2, key(11), '9007199254740993')],
    innerInstructions: [] as { index: string; instructions: ReturnType<typeof ix>[] }[],
    loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
    logMessages: [] as string[],
  },
});
describe('transaction normalization', () => {
  it('normalizes exact token flows and owner deltas', () => {
    const result = normalizeTransaction(fixture());
    expect(result.flows[0]?.amount).toBe('9007199254740993');
    expect(result.flows[0]?.from).toBe(key(10));
    expect(result.ownerDeltas.find((d) => d.owner === key(11))?.delta).toBe('9007199254740993');
  });
  it('loads ALT addresses in writable then readonly order and handles CPI', () => {
    const f = fixture();
    f.transaction.message.instructions = [];
    f.transaction.message.accountKeys = [TOKEN_PROGRAM, key(1)];
    f.meta.loadedAddresses = { writable: [key(2)], readonly: [key(3)] };
    f.meta.innerInstructions = [{ index: '0', instructions: [ix(3, 7n, [1, 2, 3])] }];
    expect(normalizeTransaction(f).flows[0]?.destinationAccount).toBe(key(2));
    expect(normalizeTransaction(f).flows[0]?.instruction).toBe('0.0');
  });
  it('failed transactions produce no successful flows or deltas', () => {
    const f = fixture();
    f.meta.err = { InstructionError: ['0', 'Custom'] };
    const result = normalizeTransaction(f);
    expect(result.failed).toBe(true);
    expect(result.flows).toEqual([]);
    expect(result.ownerDeltas).toEqual([]);
  });
  it('missing owner stays unknown and is not interpreted as distribution', () => {
    const f = fixture();
    const raw = JSON.parse(JSON.stringify(f));
    delete raw.meta.preTokenBalances[0].owner;
    delete raw.meta.postTokenBalances[0].owner;
    const result = normalizeTransaction(raw);
    expect(result.flows[0]?.from).toBeNull();
    expect(result.limitations).toContain('TOKEN_FLOW_OWNER_UNAVAILABLE');
  });
  it('authority changes make transfer owner attribution unknown', () => {
    const f = fixture();
    f.meta.postTokenBalances[0]!.owner = key(12);
    const result = normalizeTransaction(f);
    expect(result.flows[0]?.from).toBeNull();
    expect(result.limitations).toContain('ACCOUNT_OWNER_CHANGED');
  });
  it.each([
    [7, 'mint'],
    [8, 'burn'],
  ])('distinguishes token tag %s as %s', (tag, kind) => {
    const f = fixture();
    f.transaction.message.instructions = [ix(Number(tag), 7n, [1, 2, 3])];
    expect(normalizeTransaction(f).flows[0]?.kind).toBe(kind);
  });
  it('does not infer a trade amount from a net balance change without a matching venue receipt', () => {
    const f = fixture();
    const ixDefinition = protocolIdl(PUMP_PROGRAM)!.instructions.find((i) => i.name === 'buy')!;
    const raw = JSON.parse(JSON.stringify(f));
    raw.transaction.message.accountKeys.push(PUMP_PROGRAM);
    const data = Buffer.alloc(26);
    data.set(ixDefinition.discriminator);
    data.writeBigUInt64LE(7n, 8);
    data.writeBigUInt64LE(100n, 16);
    raw.transaction.message.instructions.push({
      programIdIndex: '4',
      accounts: ixDefinition.accounts!.map((a, i) =>
        a.name === 'mint' ? '2' : a.name === 'user' ? '3' : String(i % 4),
      ),
      data: bs58.encode(data),
    });
    expect(executedTrades(normalizeTransaction(raw))[0]?.amount).toBeNull();
  });
  it('does not attribute an event emitted by a router to Pump', () => {
    const f = fixture();
    f.meta.logMessages = [
      `Program ${key(20)} invoke [1]`,
      'Program data: AAAAAAAAAAA=',
      `Program ${key(20)} success`,
    ];
    expect(normalizeTransaction(f).events).toEqual([]);
  });
});
