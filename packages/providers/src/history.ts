import { z } from 'zod';
import type { ChainTransaction, WalletHistory } from '@crawlspider/contracts';
import { integerString, ProviderError, type RpcTransport } from './rpc.js';
import { getTransaction } from './transactions.js';
import { validAddress } from './input.js';
const signatureSchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{80,90}$/),
  slot: integerString,
  err: z.unknown().nullable(),
});
export type HistoryOptions = {
  maxPages: number;
  pageSize: number;
  maxTransactions: number;
  maxAccounts: number;
  fromSlot?: string;
};
export function transactionReader(rpc: RpcTransport, signal: AbortSignal, maxEntries = 10000) {
  const cache = new Map<string, Promise<ChainTransaction | null>>();
  return async (signature: string) => {
    if (!cache.has(signature)) {
      if (cache.size >= maxEntries) throw new ProviderError('TRANSACTION_CACHE_LIMIT');
      cache.set(signature, getTransaction(rpc, signature, signal));
    }
    return cache.get(signature)!;
  };
}
export async function readWalletHistory(
  owner: string,
  tokenAccounts: string[],
  rpc: RpcTransport,
  signal: AbortSignal,
  options: HistoryOptions,
  read = transactionReader(rpc, signal),
): Promise<WalletHistory> {
  validAddress(owner);
  if (
    options.maxPages < 1 ||
    options.pageSize < 1 ||
    options.pageSize > 1000 ||
    options.maxTransactions < 1 ||
    options.maxAccounts < 0
  )
    throw new Error('Invalid history limits');
  const allAddresses = [...new Set([owner, ...tokenAccounts])];
  allAddresses.forEach(validAddress);
  const addresses = allAddresses.slice(0, 1 + options.maxAccounts);
  const reasons = ['ARCHIVE_COMPLETENESS_UNKNOWN'];
  if (addresses.length !== allAddresses.length) reasons.push('ACCOUNT_HISTORY_LIMIT');
  const signatures = new Map<string, z.infer<typeof signatureSchema>>();
  let addressesRead = 0,
    exhausted = true;
  for (const key of addresses) {
    let before: string | undefined,
      finished = false;
    for (let page = 0; page < options.maxPages; page++) {
      try {
        signal.throwIfAborted();
        const rows = z
          .array(signatureSchema)
          .max(options.pageSize)
          .parse(
            await rpc.call(
              'getSignaturesForAddress',
              [
                key,
                { limit: options.pageSize, commitment: 'confirmed', ...(before ? { before } : {}) },
              ],
              signal,
            ),
          );
        if (rows.some((row) => !Object.hasOwn(row, 'err')))
          throw new ProviderError('HISTORY_INVALID_RESPONSE');
        if (page === 0) addressesRead++;
        const previousSize = signatures.size;
        for (const row of rows) signatures.set(row.signature, row);
        if (rows.length < options.pageSize) {
          finished = true;
          break;
        }
        const last = rows.at(-1)!;
        if (last.signature === before) {
          reasons.push('HISTORY_CURSOR_LOOP');
          break;
        }
        if (options.fromSlot && BigInt(last.slot) < BigInt(options.fromSlot)) {
          finished = true;
          reasons.push('HISTORY_WINDOW_BOUNDARY');
          break;
        }
        before = last.signature;
        if (page > 0 && signatures.size === previousSize) {
          reasons.push('HISTORY_REPEATED_PAGE');
          break;
        }
      } catch {
        reasons.push(signal.aborted ? 'HISTORY_DEADLINE' : 'HISTORY_PAGE_UNAVAILABLE');
        break;
      }
    }
    if (!finished) {
      exhausted = false;
      reasons.push('HISTORY_PAGE_LIMIT');
    }
    if (signal.aborted) break;
  }
  const ordered = [...signatures.values()].sort((a, b) =>
    BigInt(a.slot) > BigInt(b.slot)
      ? -1
      : BigInt(a.slot) < BigInt(b.slot)
        ? 1
        : a.signature.localeCompare(b.signature),
  );
  const transactions: ChainTransaction[] = [];
  let failed = 0,
    missing = 0,
    attempted = 0;
  for (const entry of ordered) {
    if (entry.err !== null) {
      failed++;
      continue;
    }
    if (attempted >= options.maxTransactions) {
      reasons.push('HISTORY_TRANSACTION_LIMIT');
      break;
    }
    attempted++;
    try {
      signal.throwIfAborted();
      const tx = await read(entry.signature);
      if (!tx) {
        missing++;
        reasons.push('TRANSACTION_UNAVAILABLE');
      } else {
        transactions.push(tx);
        if (tx.limitations.length) reasons.push('TRANSACTION_DECODE_PARTIAL');
      }
    } catch {
      missing++;
      reasons.push(signal.aborted ? 'HISTORY_DEADLINE' : 'TRANSACTION_READ_FAILED');
      if (signal.aborted) break;
    }
  }
  if (!signatures.size) reasons.push('NO_HISTORY_RETURNED');
  // Exhausting a retained RPC window does not prove lifetime history or wallet creation.
  return {
    owner,
    transactions,
    observedAt: new Date().toISOString(),
    coverage: {
      status: addressesRead === 0 ? 'unavailable' : 'partial',
      scope: 'provider-retained-window',
      addressesRequested: allAddresses.length,
      addressesRead,
      signatures: signatures.size,
      decoded: transactions.length,
      failed,
      missing,
      oldestSlot: ordered.at(-1)?.slot || null,
      newestSlot: ordered[0]?.slot || null,
      exhausted,
      reasons: [...new Set(reasons)],
    },
  };
}
export async function collectWalletHistories(
  candidates: { owner: string; accounts: string[] }[],
  rpc: RpcTransport,
  signal: AbortSignal,
  options: HistoryOptions,
  read = transactionReader(rpc, signal),
) {
  const histories: WalletHistory[] = [];
  for (const candidate of candidates) {
    if (signal.aborted) break;
    histories.push(
      await readWalletHistory(candidate.owner, candidate.accounts, rpc, signal, options, read),
    );
  }
  return {
    histories,
    complete: histories.length === candidates.length,
    reasons: histories.length === candidates.length ? [] : ['OWNER_HISTORY_DEADLINE'],
  };
}
