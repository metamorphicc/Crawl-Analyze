import { getTokenDecoder } from '@solana-program/token';
import { addressSchema, rawAmountSchema, type targetedBalanceSchema } from '@crawlspider/contracts';
import { z } from 'zod';
import { PUMP_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, validAddress } from './input.js';
import { pda } from './markets.js';
import { getAddressEncoder, address } from '@solana/kit';
import { integerString, type RpcTransport } from './rpc.js';
import { readWalletHistory, transactionReader } from './history.js';
export async function readLaunchWindow(
  mint: string,
  rpc: RpcTransport,
  signal: AbortSignal,
  read = transactionReader(rpc, signal),
  options = { maxPages: 2, pageSize: 50, maxTransactions: 100, maxAccounts: 0 },
) {
  const curve = await pda(PUMP_PROGRAM, [
    new TextEncoder().encode('bonding-curve'),
    new Uint8Array(getAddressEncoder().encode(address(mint))),
  ]);
  return readWalletHistory(curve, [], rpc, signal, options, read);
}
export async function readBlockOrders(slots: string[], rpc: RpcTransport, signal: AbortSignal) {
  const orders = new Map<string, string[]>();
  for (const slot of [...new Set(slots)].slice(0, 4)) {
    try {
      const n = BigInt(slot);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      const value = await rpc.call(
        'getBlock',
        [
          Number(n),
          {
            commitment: 'confirmed',
            transactionDetails: 'signatures',
            rewards: false,
            maxSupportedTransactionVersion: 0,
          },
        ],
        signal,
      );
      const data = z.object({ signatures: z.array(z.string()).max(10000) }).parse(value);
      orders.set(slot, data.signatures);
    } catch {
      /* pruned/partial block order stays unknown */
    }
  }
  return orders;
}
export async function readOwnerPositions(
  owners: string[],
  mint: string,
  rpc: RpcTransport,
  signal: AbortSignal,
) {
  const result: z.infer<typeof targetedBalanceSchema>[] = [];
  const schema = z.object({
    context: z.object({ slot: integerString }),
    value: z
      .array(
        z.object({
          pubkey: addressSchema,
          account: z.object({
            owner: addressSchema,
            data: z.tuple([z.string(), z.literal('base64')]),
          }),
        }),
      )
      .max(1000),
  });
  for (const owner of [...new Set(owners)].slice(0, 100)) {
    const observedAt = new Date().toISOString();
    try {
      signal.throwIfAborted();
      validAddress(owner);
      validAddress(mint);
      const data = schema.parse(
        await rpc.call(
          'getTokenAccountsByOwner',
          [owner, { mint }, { encoding: 'base64', commitment: 'confirmed' }],
          signal,
        ),
      );
      let amount = 0n;
      const accounts = new Set<string>();
      for (const row of data.value) {
        if (accounts.has(row.pubkey)) throw new Error('Duplicate account');
        accounts.add(row.pubkey);
        if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(row.account.owner))
          throw new Error('Unsupported token program');
        const bytes = Buffer.from(row.account.data[0], 'base64'),
          decoded = getTokenDecoder().decode(bytes.subarray(0, 165));
        if (
          decoded.mint !== mint ||
          decoded.owner !== owner ||
          decoded.state === 0 ||
          bytes.length > 165
        )
          throw new Error('Owner account semantics not verified');
        amount += decoded.amount;
      }
      rawAmountSchema.parse(amount.toString());
      result.push({
        owner,
        amount: amount.toString(),
        slot: data.context.slot,
        observedAt,
        status: 'complete',
        reasons: [],
      });
    } catch {
      result.push({
        owner,
        amount: null,
        slot: null,
        observedAt,
        status: 'unavailable',
        reasons: [signal.aborted ? 'POSITION_DEADLINE' : 'OWNER_POSITION_UNVERIFIED'],
      });
      if (signal.aborted) break;
    }
  }
  return result;
}
