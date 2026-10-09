import type {
  OwnerBalance,
  WalletHistory,
  WalletSignals,
  ChainTransaction,
} from '@crawlspider/contracts';
const programs = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
]);
export function observedTrades(tx: ChainTransaction, owner: string) {
  return tx.failed
    ? []
    : tx.calls.filter(
        (c) =>
          programs.has(c.program) &&
          c.accounts.user === owner &&
          /^(buy|sell)(_|$)/.test(c.instruction),
      );
}
export function summarizeWallet(
  history: WalletHistory,
  mint: string,
  launch: { slot: string; signature: string } | null = null,
): WalletSignals {
  const transactions = [...history.transactions]
    .filter((t) => !t.failed)
    .sort((a, b) =>
      BigInt(a.slot) < BigInt(b.slot)
        ? -1
        : BigInt(a.slot) > BigInt(b.slot)
          ? 1
          : a.signature.localeCompare(b.signature),
    );
  let entry: WalletSignals['entry'] = null;
  for (const tx of transactions) {
    const inflows = tx.flows.filter(
      (f) =>
        f.mint === mint &&
        f.to === history.owner &&
        f.from !== history.owner &&
        BigInt(f.amount) > 0n,
    );
    const buys = observedTrades(tx, history.owner).filter(
      (c) => (c.accounts.base_mint || c.accounts.mint) === mint && c.instruction.startsWith('buy'),
    );
    const delta = tx.ownerDeltas.find((d) => d.owner === history.owner && d.mint === mint)?.delta;
    if (!inflows.length && !(buys.length && delta && BigInt(delta) > 0n)) continue;
    entry = {
      signature: tx.signature,
      slot: tx.slot,
      kind: buys.length ? 'buy' : inflows.some((f) => f.kind === 'mint') ? 'mint' : 'transfer',
      amount: buys.length
        ? null
        : inflows.reduce((sum, f) => sum + BigInt(f.amount), 0n).toString(),
    };
    // Receipt size is used for timing/size hypotheses only when one leg exactly explains the delta.
    if (
      buys.length === 1 &&
      inflows.length === 1 &&
      delta &&
      BigInt(delta) === BigInt(inflows[0]!.amount)
    ) {
      const call = buys[0]!,
        userAccount =
          call.accounts.associated_base_user ||
          call.accounts.associated_user ||
          call.accounts.user_base_token_account;
      const vault =
        call.accounts.associated_base_bonding_curve ||
        call.accounts.associated_bonding_curve ||
        call.accounts.pool_base_token_account;
      if (
        userAccount &&
        vault &&
        inflows[0]!.sourceAccount === vault &&
        inflows[0]!.destinationAccount === userAccount
      )
        entry.amount = inflows[0]!.amount;
    }
    break;
  }
  const prior = entry
    ? transactions
        .filter((t) => BigInt(t.slot) < BigInt(entry.slot))
        .flatMap((tx) => observedTrades(tx, history.owner))
    : [];
  const windowDecoded =
    history.coverage.exhausted &&
    history.coverage.addressesRead === history.coverage.addressesRequested &&
    history.coverage.missing === 0 &&
    history.coverage.decoded + history.coverage.failed === history.coverage.signatures &&
    !history.coverage.reasons.some((r) =>
      [
        'ACCOUNT_HISTORY_LIMIT',
        'TRANSACTION_DECODE_PARTIAL',
        'HISTORY_PAGE_UNAVAILABLE',
        'HISTORY_DEADLINE',
      ].includes(r),
    );
  const reasons = [
    ...history.coverage.reasons,
    'WALLET_CREATION_NOT_PROVEN',
    'PRIOR_TRADE_PARSER_PUMP_ONLY',
  ];
  if (!entry) reasons.push('ENTRY_NOT_OBSERVED');
  if (launch && entry && BigInt(entry.slot) < BigInt(launch.slot))
    reasons.push('ENTRY_PRECEDES_REPORTED_LAUNCH');
  return {
    owner: history.owner,
    entry,
    priorTrading: prior.length
      ? 'observed'
      : entry && windowDecoded
        ? 'none-observed-in-window'
        : 'unknown',
    priorTradeCount: entry && (windowDecoded || prior.length) ? prior.length : null,
    shortObservedHistory: entry && windowDecoded ? prior.length < 3 : null,
    earlyObservedEntry:
      entry &&
      launch &&
      BigInt(entry.slot) >= BigInt(launch.slot) &&
      BigInt(entry.slot) <= BigInt(launch.slot) + 4n
        ? true
        : entry && launch && windowDecoded && BigInt(entry.slot) > BigInt(launch.slot) + 4n
          ? false
          : null,
    freshWallet: null,
    coverage: history.coverage,
    reasons: [...new Set(reasons)],
  };
}
export function eligibleAmount(holder: OwnerBalance): bigint {
  const amount = BigInt(holder.amount),
    excluded = BigInt(holder.excludedAmount);
  if (amount < 0n || excluded < 0n || excluded > amount)
    throw new Error('Invalid owner balance/exclusion');
  return amount - excluded;
}
export function selectHistoryCandidates(
  holders: OwnerBalance[],
  options = { maxOwners: 100, minOwners: 25, targetSupplyBps: 9500 },
) {
  if (
    options.maxOwners < 1 ||
    options.minOwners < 0 ||
    options.targetSupplyBps < 1 ||
    options.targetSupplyBps > 10000
  )
    throw new Error('Invalid history selection policy');
  const ranked = holders
    .filter((h) => eligibleAmount(h) > 0n)
    .sort((a, b) =>
      eligibleAmount(a) > eligibleAmount(b)
        ? -1
        : eligibleAmount(a) < eligibleAmount(b)
          ? 1
          : a.owner.localeCompare(b.owner),
    );
  const total = ranked.reduce((sum, h) => sum + eligibleAmount(h), 0n),
    selected: OwnerBalance[] = [];
  let covered = 0n;
  for (const holder of ranked) {
    if (selected.length >= options.maxOwners) break;
    if (
      selected.length >= options.minOwners &&
      covered * 10000n >= total * BigInt(options.targetSupplyBps)
    )
      break;
    selected.push(holder);
    covered += eligibleAmount(holder);
  }
  return {
    candidates: selected,
    eligibleSupply: total.toString(),
    selectedAmount: covered.toString(),
    selectedSupplyBps: total ? Number((covered * 10000n) / total) : 0,
    targetReached: total > 0n && covered * 10000n >= total * BigInt(options.targetSupplyBps),
    reasons:
      covered * 10000n < total * BigInt(options.targetSupplyBps)
        ? ['HISTORY_OWNER_CAP_BELOW_SUPPLY_TARGET']
        : [],
  };
}
export function counterpartyCandidates(
  holders: OwnerBalance[],
  histories: WalletHistory[],
  selectedOwners: Set<string>,
  limit = 20,
) {
  const observed = new Set<string>();
  for (const history of histories)
    for (const tx of history.transactions)
      if (!tx.failed)
        for (const flow of tx.flows) {
          if (flow.from) observed.add(flow.from);
          if (flow.to) observed.add(flow.to);
        }
  return holders
    .filter((h) => !selectedOwners.has(h.owner) && observed.has(h.owner) && eligibleAmount(h) > 0n)
    .sort((a, b) =>
      eligibleAmount(a) > eligibleAmount(b)
        ? -1
        : eligibleAmount(a) < eligibleAmount(b)
          ? 1
          : a.owner.localeCompare(b.owner),
    )
    .slice(0, limit);
}
