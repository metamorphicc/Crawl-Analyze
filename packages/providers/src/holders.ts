import { z } from 'zod';
import {
  PublicError,
  addressSchema,
  type DataQuality,
  type MintIdentity,
} from '@crawlspider/contracts';
import { getAccount } from './rpc.js';
import { decodeMintIdentity } from './mint.js';
import { integerString, ProviderError, type RpcTransport } from './rpc.js';
import { validAddress, WRAPPED_SOL } from './input.js';
const u64 = integerString.refine((v) => BigInt(v) <= 18446744073709551615n);
const accountSchema = z.object({
  address: addressSchema,
  mint: addressSchema,
  owner: addressSchema,
  amount: u64,
  delegated_amount: u64.optional(),
  frozen: z.boolean().optional(),
  burnt: z.unknown().optional(),
});
const pageSchema = z.object({
  last_indexed_slot: integerString.optional(),
  total: integerString.optional(),
  limit: integerString.optional(),
  cursor: z.string().nullable().optional(),
  token_accounts: z.array(accountSchema),
});
export type IndexedTokenAccount = z.infer<typeof accountSchema>;
export type Holder = {
  owner: string;
  amount: string;
  accounts: string[];
  frozenAmount: string | null;
  delegatedAmount: string | null;
  excludedAmount: string;
};
export type HolderSnapshot = {
  accounts: IndexedTokenAccount[];
  holders: Holder[];
  enumeratedBalance: string;
  eligibleBalance: string;
  accountCount: number;
  ownerCount: number;
  pages: number;
  enumerationComplete: boolean;
  quality: DataQuality;
};
export async function enumerateHolders(
  identity: MintIdentity,
  index: RpcTransport,
  rpc: RpcTransport,
  signal: AbortSignal,
  options: { maxPages: number; pageSize?: number; maxSlotSpread?: bigint; maxIndexLag?: bigint },
): Promise<HolderSnapshot> {
  const pageSize = options.pageSize || 1000;
  const accounts = new Map<string, IndexedTokenAccount>();
  const cursors = new Set<string>();
  const fingerprints = new Set<string>();
  const slots: bigint[] = [];
  const reasons: string[] = [];
  let complete = false,
    pages = 0,
    cursor: string | undefined;
  let chainSlot: bigint | undefined;
  try {
    chainSlot = BigInt(
      integerString.parse(await rpc.call('getSlot', [{ commitment: 'confirmed' }], signal)),
    );
  } catch {
    reasons.push('CHAIN_SLOT_UNAVAILABLE');
  }
  for (let page = 1; page <= options.maxPages; page++) {
    try {
      signal.throwIfAborted();
      const result = pageSchema.parse(
        await index.call(
          'getTokenAccounts',
          {
            mint: identity.mint,
            limit: pageSize,
            ...(cursor ? { cursor } : { page }),
            options: { showZeroBalance: false },
          },
          signal,
        ),
      );
      pages++;
      if (result.token_accounts.length > pageSize) throw new ProviderError('INDEX_PAGE_OVERSIZED');
      if (result.last_indexed_slot) slots.push(BigInt(result.last_indexed_slot));
      else reasons.push('INDEX_SLOT_UNAVAILABLE');
      const fingerprint = result.token_accounts.map((a) => a.address).join(',');
      if (result.token_accounts.length && fingerprints.has(fingerprint)) {
        reasons.push('REPEATED_PAGE');
        break;
      }
      fingerprints.add(fingerprint);
      let conflict = false;
      for (const item of result.token_accounts) {
        validAddress(item.address);
        validAddress(item.owner);
        if (item.mint !== identity.mint || (item.burnt === true && item.amount !== '0'))
          throw new ProviderError('INDEX_ACCOUNT_INVALID');
        const previous = accounts.get(item.address);
        if (previous) {
          if (previous.amount !== item.amount || previous.owner !== item.owner) conflict = true;
          reasons.push('DUPLICATE_ACCOUNT');
          continue;
        }
        if (item.amount !== '0') accounts.set(item.address, item);
      }
      if (conflict) {
        reasons.push('BALANCE_CHANGED_DURING_PAGINATION');
        break;
      }
      if (result.token_accounts.length < pageSize) {
        complete = true;
        break;
      }
      if (result.cursor) {
        if (cursors.has(result.cursor)) {
          reasons.push('CURSOR_LOOP');
          break;
        }
        cursors.add(result.cursor);
        cursor = result.cursor;
      } else cursor = undefined;
    } catch (error) {
      reasons.push(
        error instanceof PublicError
          ? error.code
          : signal.aborted
            ? 'DEADLINE_EXCEEDED'
            : 'INDEX_PAGE_INVALID',
      );
      break;
    }
  }
  if (!complete && pages >= options.maxPages) reasons.push('HOLDER_PAGE_LIMIT');
  const rows = [...accounts.values()];
  const holders = aggregateOwners(rows);
  const balance = rows.reduce((sum, a) => sum + BigInt(a.amount), 0n);
  const reconciled =
    complete && balance === BigInt(identity.supply) && identity.mint !== WRAPPED_SOL;
  if (!reconciled)
    reasons.push(
      identity.mint === WRAPPED_SOL ? 'NATIVE_MINT_SUPPLY_UNSUPPORTED' : 'SUPPLY_NOT_RECONCILED',
    );
  if (identity.token2022Extensions.length)
    reasons.push('TOKEN_2022_EXTENSION_SEMANTICS_REQUIRE_REVIEW');
  const min = slots.length ? slots.reduce((a, b) => (a < b ? a : b)) : null,
    max = slots.length ? slots.reduce((a, b) => (a > b ? a : b)) : null;
  if (min !== null && max !== null && max - min > (options.maxSlotSpread ?? 32n))
    reasons.push('INDEX_SLOT_SPREAD');
  if (chainSlot !== undefined && min !== null && chainSlot - min > (options.maxIndexLag ?? 150n))
    reasons.push('INDEX_LAG');
  if (chainSlot !== undefined && max !== null && max > chainSlot + 32n)
    reasons.push('RPC_BEHIND_INDEX');
  if (!complete) reasons.push('HOLDER_ENUMERATION_INCOMPLETE');
  return {
    accounts: rows,
    holders,
    enumeratedBalance: balance.toString(),
    eligibleBalance: balance.toString(),
    accountCount: rows.length,
    ownerCount: holders.length,
    pages,
    enumerationComplete: complete,
    quality: {
      status: reasons.length ? 'partial' : 'complete',
      reasons: [...new Set(reasons)],
      observedAt: new Date().toISOString(),
      minSlot: min?.toString() || null,
      maxSlot: max?.toString() || null,
      indexedSlot: min?.toString() || null,
      supplyReconciled: reconciled,
      atomic: false,
    },
  };
}
export function aggregateOwners(
  accounts: IndexedTokenAccount[],
  excluded = new Set<string>(),
): Holder[] {
  const owners = new Map<
    string,
    {
      amount: bigint;
      accounts: string[];
      frozen: bigint;
      delegated: bigint;
      excluded: bigint;
      flagsKnown: boolean;
      delegateKnown: boolean;
    }
  >();
  for (const row of accounts) {
    const amount = BigInt(row.amount),
      value = owners.get(row.owner) || {
        amount: 0n,
        accounts: [],
        frozen: 0n,
        delegated: 0n,
        excluded: 0n,
        flagsKnown: true,
        delegateKnown: true,
      };
    value.amount += amount;
    value.accounts.push(row.address);
    if (row.frozen) value.frozen += amount;
    if (row.frozen === undefined) value.flagsKnown = false;
    if (row.delegated_amount === undefined) value.delegateKnown = false;
    value.delegated += BigInt(row.delegated_amount || '0');
    if (excluded.has(row.address)) value.excluded += amount;
    owners.set(row.owner, value);
  }
  return [...owners]
    .map(([owner, v]) => ({
      owner,
      amount: v.amount.toString(),
      accounts: v.accounts,
      frozenAmount: v.flagsKnown ? v.frozen.toString() : null,
      delegatedAmount: v.delegateKnown ? v.delegated.toString() : null,
      excludedAmount: v.excluded.toString(),
    }))
    .sort((a, b) =>
      BigInt(a.amount) > BigInt(b.amount)
        ? -1
        : BigInt(a.amount) < BigInt(b.amount)
          ? 1
          : a.owner.localeCompare(b.owner),
    );
}
export async function consistentHolders(
  identity: MintIdentity,
  index: RpcTransport,
  rpc: RpcTransport,
  signal: AbortSignal,
  options: Parameters<typeof enumerateHolders>[4],
) {
  const first = await enumerateHolders(identity, index, rpc, signal, options);
  const drift = first.quality.reasons.some((r) =>
    [
      'SUPPLY_NOT_RECONCILED',
      'INDEX_SLOT_SPREAD',
      'BALANCE_CHANGED_DURING_PAGINATION',
      'DUPLICATE_ACCOUNT',
    ].includes(r),
  );
  if (!drift || signal.aborted || !first.enumerationComplete)
    return { identity, snapshot: first, reconciliationAttempts: 1 };
  try {
    const account = await getAccount(rpc, identity.mint, signal);
    if (!account) throw new Error('mint unavailable');
    const current = decodeMintIdentity(identity.mint, account);
    const snapshot = await enumerateHolders(current, index, rpc, signal, options);
    return { identity: current, snapshot, reconciliationAttempts: 2 };
  } catch {
    return {
      identity,
      snapshot: {
        ...first,
        quality: {
          ...first.quality,
          status: 'partial' as const,
          reasons: [...first.quality.reasons, 'RECONCILIATION_UNAVAILABLE'],
        },
      },
      reconciliationAttempts: 1,
    };
  }
}
