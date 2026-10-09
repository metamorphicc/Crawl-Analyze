import {
  extractPumpTrades,
  type ChainTransaction,
  type OwnerBalance,
  type HistoryCoverage,
  type EarlyBuyers,
} from '@crawlspider/contracts';
import { eligibleAmount } from './history.js';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const compareIndex = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
};
export function analyzeEarlyBuyers(input: {
  mint: string;
  transactions: ChainTransaction[];
  coverage: HistoryCoverage | null;
  holders: OwnerBalance[];
  holdersComplete: boolean;
  observedAt: string;
  blockOrders?: Map<string, string[]>;
  limit?: number;
}): EarlyBuyers {
  const reasons = new Set<string>(),
    orders = input.blockOrders || new Map<string, string[]>();
  const available = [...new Map(input.transactions.map((t) => [t.signature, t])).values()].filter(
    (t) =>
      !t.failed && t.calls.some((c) => (c.accounts.base_mint || c.accounts.mint) === input.mint),
  );
  available.sort((a, b) =>
    BigInt(a.slot) < BigInt(b.slot) ? -1 : BigInt(a.slot) > BigInt(b.slot) ? 1 : 0,
  );
  if (available.length > 500) reasons.add('EARLY_TRANSACTION_CAP');
  const transactions = available.slice(0, 500),
    bySignature = new Map(transactions.map((t) => [t.signature, t]));
  const creations = transactions.flatMap((t) =>
    t.calls
      .filter(
        (c) =>
          c.program === PUMP &&
          /^create(_v2)?$/.test(c.instruction) &&
          c.accounts.mint === input.mint &&
          c.missingFields.length === 0,
      )
      .map((c) => ({
        signature: t.signature,
        slot: t.slot,
        instruction: c.index,
        program: c.program,
      })),
  );
  const launch = creations.length === 1 ? creations[0]! : null;
  if (!launch)
    reasons.add(
      creations.length > 1 ? 'AMBIGUOUS_LAUNCH_CREATION' : 'VERIFIED_LAUNCH_NOT_IN_WINDOW',
    );
  const coverage = input.coverage;
  const windowKnown =
    !!coverage &&
    coverage.exhausted &&
    coverage.addressesRead === coverage.addressesRequested &&
    coverage.missing === 0 &&
    coverage.decoded + coverage.failed === coverage.signatures &&
    coverage.reasons.every((r) => r === 'ARCHIVE_COMPLETENESS_UNKNOWN');
  if (!windowKnown) reasons.add('EARLY_BUYER_WINDOW_INCOMPLETE');
  const trades = transactions
    .flatMap((t) => extractPumpTrades(t))
    .filter((t) => t.mint === input.mint && t.side === 'buy');
  if (trades.some((t) => t.program !== PUMP)) reasons.add('MIGRATED_VENUE_COVERAGE_UNKNOWN');
  const order = (slot: string, signature: string) => {
    const index = orders.get(slot)?.indexOf(signature);
    return index !== undefined && index >= 0 ? index : null;
  };
  trades.sort((a, b) =>
    BigInt(a.slot) < BigInt(b.slot)
      ? -1
      : BigInt(a.slot) > BigInt(b.slot)
        ? 1
        : (order(a.slot, a.signature) ?? Number.MAX_SAFE_INTEGER) -
            (order(b.slot, b.signature) ?? Number.MAX_SAFE_INTEGER) ||
          a.signature.localeCompare(b.signature) ||
          compareIndex(a.instruction, b.instruction),
  );
  const holders = new Map(input.holders.map((h) => [h.owner, eligibleAmount(h).toString()])),
    seen = new Set<string>();
  const buyers: EarlyBuyers['buyers'] = [];
  for (const trade of trades) {
    const tx = bySignature.get(trade.signature)!;
    if (
      !tx.ownerDeltas.some(
        (d) => d.owner === trade.user && d.mint === input.mint && BigInt(d.delta) > 0n,
      ) &&
      !tx.flows.some(
        (f) =>
          f.mint === input.mint &&
          f.to === trade.user &&
          f.from !== trade.user &&
          BigInt(f.amount) > 0n,
      )
    ) {
      reasons.add('BUY_RECEIPT_NOT_OBSERVED');
      continue;
    }
    if (seen.has(trade.user)) continue;
    seen.add(trade.user);
    const transactionOrder = order(trade.slot, trade.signature);
    if (transactionOrder === null) reasons.add('WITHIN_SLOT_TRANSACTION_ORDER_UNKNOWN');
    let early: boolean | null = null;
    if (launch && BigInt(trade.slot) >= BigInt(launch.slot)) {
      early = BigInt(trade.slot) <= BigInt(launch.slot) + 4n;
      if (trade.slot === launch.slot) {
        const start = order(launch.slot, launch.signature);
        if (start === null || transactionOrder === null) {
          early = null;
          reasons.add('LAUNCH_SLOT_ORDER_UNKNOWN');
        } else if (
          transactionOrder < start ||
          (trade.signature === launch.signature &&
            compareIndex(trade.instruction, launch.instruction) < 0)
        ) {
          early = null;
          reasons.add('BUY_PRECEDES_VERIFIED_LAUNCH');
        }
      }
    }
    buyers.push({
      owner: trade.user,
      signature: trade.signature,
      slot: trade.slot,
      instruction: trade.instruction,
      transactionOrder,
      amount: trade.amount,
      currentBalance: holders.get(trade.user) ?? (input.holdersComplete ? '0' : null),
      early,
      entryClaim:
        transactionOrder === null
          ? 'earliest-observed-slot-candidate'
          : 'first-observed-buy-in-covered-window',
    });
  }
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Invalid early-buyer limit');
  if (buyers.length > limit) reasons.add('EARLY_BUYER_DISPLAY_CAP');
  // Complete covers the observed venue window since verified creation; it is not all venues/lifetime.
  const complete = !!launch && windowKnown && !reasons.size;
  return {
    status: complete ? 'complete' : transactions.length ? 'partial' : 'unavailable',
    launch,
    observedAt: input.observedAt,
    reasons: [...reasons],
    coverage,
    buyers: buyers.slice(0, limit),
  };
}
