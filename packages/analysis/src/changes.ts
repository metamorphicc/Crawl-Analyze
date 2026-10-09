import {
  extractPumpTrades,
  type AnalysisReport,
  type PositionComparison,
} from '@crawlspider/contracts';
import { eligibleAmount } from './history.js';
const sumExcluded = (report: AnalysisReport) =>
  report.snapshot.holders.reduce((n, h) => n + BigInt(h.excludedAmount), 0n);
export function comparePositions(
  previous: AnalysisReport | null,
  current: AnalysisReport,
): PositionComparison {
  const result: PositionComparison = {
    previousReportId: previous?.id || null,
    currentReportId: current.id,
    comparable: false,
    reasons: [],
    positions: [],
    movements: [],
  };
  if (!previous) {
    result.reasons = ['NO_PREVIOUS_REPORT'];
    return result;
  }
  if (previous.identity.mint !== current.identity.mint)
    throw new Error('Cannot compare different mints');
  if (
    previous.identity.program !== current.identity.program ||
    previous.identity.decimals !== current.identity.decimals
  )
    result.reasons.push('MINT_IDENTITY_CHANGED');
  const start = Date.parse(previous.observedAt),
    end = Date.parse(current.observedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 3600000)
    result.reasons.push('SNAPSHOT_TIME_GAP_INVALID');
  for (const report of [previous, current]) {
    const q = report.snapshot.quality,
      age = Date.parse(report.observedAt) - Date.parse(q.observedAt);
    if (
      !report.snapshot.enumerationComplete ||
      q.status !== 'complete' ||
      !q.supplyReconciled ||
      !q.minSlot ||
      !q.maxSlot ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 120000
    )
      result.reasons.push('SNAPSHOT_PARTIAL_OR_STALE');
    if (
      report.snapshot.holders.reduce((n, h) => n + BigInt(h.amount), 0n) !==
      BigInt(report.identity.supply)
    )
      result.reasons.push('SNAPSHOT_SUPPLY_MISMATCH');
  }
  if (previous.identity.supply !== current.identity.supply)
    result.reasons.push('MINT_SUPPLY_CHANGED');
  if (sumExcluded(previous) !== sumExcluded(current))
    result.reasons.push('EXCLUSION_DENOMINATOR_CHANGED');
  const before = new Map(previous.snapshot.holders.map((h) => [h.owner, h])),
    after = new Map(current.snapshot.holders.map((h) => [h.owner, h]));
  const owners = new Set([...before.keys(), ...after.keys()]);
  for (const report of [previous, current])
    if (
      new Set(report.snapshot.holders.map((h) => h.owner)).size !== report.snapshot.holders.length
    )
      throw new Error('Duplicate owner in snapshot');
  for (const target of current.targetedBalances || []) {
    if (target.status !== 'complete' || target.amount === null || target.slot === null) continue;
    const gap = current.snapshot.quality.maxSlot
      ? BigInt(target.slot) - BigInt(current.snapshot.quality.maxSlot)
      : 0n;
    if (
      gap < -150n ||
      gap > 150n ||
      BigInt(target.amount) !== BigInt(after.get(target.owner)?.amount || '0')
    )
      result.reasons.push('TARGETED_POSITION_DISAGREES_WITH_INDEX');
  }
  const lower = previous.snapshot.quality.maxSlot,
    upper = current.snapshot.quality.minSlot;
  if (!lower || !upper || BigInt(upper) <= BigInt(lower))
    result.reasons.push('SNAPSHOT_SLOT_INTERVAL_NOT_ORDERED');
  const explained = new Map<string, bigint>();
  const addDelta = (owner: string | null, n: bigint) => {
    if (owner && owners.has(owner)) explained.set(owner, (explained.get(owner) || 0n) + n);
  };
  const hypothesis = (a: string | null, b: string | null) =>
    a && b
      ? current.graph.controlHypotheses.find((g) => g.owners.includes(a) && g.owners.includes(b))
          ?.id ||
        previous.graph.controlHypotheses.find((g) => g.owners.includes(a) && g.owners.includes(b))
          ?.id ||
        null
      : null;
  const txs = [...new Map(current.transactions.map((t) => [t.signature, t])).values()].filter(
    (t) =>
      !t.failed &&
      lower &&
      upper &&
      BigInt(t.slot) > BigInt(lower) &&
      BigInt(t.slot) <= BigInt(upper),
  );
  for (const tx of txs) {
    const used = new Set<number>();
    for (const trade of extractPumpTrades(tx).filter(
      (t) => t.mint === current.identity.mint && owners.has(t.user),
    )) {
      result.movements.push({
        id: `${tx.signature}:trade:${trade.instruction}`,
        owner: trade.user,
        counterparty: null,
        kind: trade.amount === null ? 'trade-observed' : trade.side,
        amount: trade.amount,
        signature: tx.signature,
        slot: tx.slot,
        instruction: trade.instruction,
        controlHypothesis: null,
        identityProven: false,
        explanation:
          trade.amount === null
            ? 'Pump instruction observed; receipt amount could not be isolated'
            : 'Pump instruction and exact token receipt agree with owner delta',
      });
      if (trade.amount !== null) {
        addDelta(trade.user, (trade.side === 'buy' ? 1n : -1n) * BigInt(trade.amount));
        const call = tx.calls.find((c) => c.index === trade.instruction)!,
          account =
            call.accounts.associated_base_user ||
            call.accounts.associated_user ||
            call.accounts.user_base_token_account,
          vault =
            call.accounts.associated_base_bonding_curve ||
            call.accounts.associated_bonding_curve ||
            call.accounts.pool_base_token_account;
        tx.flows.forEach((f, i) => {
          if (
            f.mint === trade.mint &&
            f.kind === 'transfer' &&
            (trade.side === 'buy'
              ? f.sourceAccount === vault && f.destinationAccount === account
              : f.sourceAccount === account && f.destinationAccount === vault)
          )
            used.add(i);
        });
      }
    }
    if (
      tx.limitations.includes('ACCOUNT_OWNER_CHANGED') ||
      tx.limitations.includes('TOKEN_2022_INSTRUCTION_UNSUPPORTED')
    )
      continue;
    tx.flows.forEach((flow, i) => {
      if (
        used.has(i) ||
        flow.mint !== current.identity.mint ||
        (!flow.from && !flow.to) ||
        (!owners.has(flow.from || '') && !owners.has(flow.to || ''))
      )
        return;
      const n = BigInt(flow.amount);
      if (!n) return;
      const owner = flow.from || flow.to!;
      if (flow.kind === 'transfer' && (!flow.from || !flow.to)) return;
      const self = flow.from !== null && flow.from === flow.to;
      result.movements.push({
        id: `${tx.signature}:flow:${i}`,
        owner,
        counterparty: flow.to && flow.to !== owner ? flow.to : null,
        kind: self ? 'self-transfer' : flow.kind,
        amount: flow.amount,
        signature: tx.signature,
        slot: tx.slot,
        instruction: flow.instruction,
        controlHypothesis: hypothesis(flow.from, flow.to),
        identityProven: false,
        explanation: self
          ? 'Token accounts changed within the same on-chain owner'
          : flow.kind === 'transfer'
            ? 'Confirmed token transfer; purpose and personal ownership are not proven'
            : `Confirmed token ${flow.kind}`,
      });
      addDelta(flow.from, -n);
      addDelta(flow.to, n);
    });
  }
  result.comparable = result.reasons.length === 0;
  if (result.comparable) {
    for (const owner of owners) {
      const old = before.get(owner),
        next = after.get(owner),
        a = old ? eligibleAmount(old) : 0n,
        b = next ? eligibleAmount(next) : 0n;
      if (!a && !b) continue;
      const delta = b - a,
        unexplained = delta - (explained.get(owner) || 0n);
      if (delta !== 0n || unexplained !== 0n)
        result.positions.push({
          owner,
          before: a.toString(),
          after: b.toString(),
          delta: delta.toString(),
          unexplainedDelta: unexplained.toString(),
        });
      for (const [field, kind] of [
        ['frozenAmount', 'freeze-change'],
        ['delegatedAmount', 'delegation-change'],
      ] as const) {
        if (
          old?.[field] !== null &&
          next?.[field] !== null &&
          old &&
          next &&
          old[field] !== next[field]
        )
          result.movements.push({
            id: `${current.id}:${kind}:${owner}`,
            owner,
            counterparty: null,
            kind,
            amount: next[field],
            signature: null,
            slot: upper,
            instruction: null,
            controlHypothesis: null,
            identityProven: false,
            explanation:
              kind === 'freeze-change'
                ? 'Account frozen balance changed; not proof of a time-lock contract'
                : 'Delegated spendable balance changed',
          });
      }
    }
  }
  result.reasons = [...new Set(result.reasons)];
  return result;
}
