import type { WalletHistory, FundingTrace } from '@crawlspider/contracts';
export async function traceFunding(
  histories: WalletHistory[],
  entrySlots: Map<string, string | null>,
  read: (owner: string) => Promise<WalletHistory>,
  signal: AbortSignal,
  options = {
    maxHops: 2,
    maxNodes: 20,
    maxFundersPerNode: 2,
    lookbackSlots: 216000n,
    minLamports: 10000n,
  },
): Promise<FundingTrace> {
  if (
    options.maxHops < 1 ||
    options.maxHops > 3 ||
    options.maxNodes < 1 ||
    options.maxFundersPerNode < 1
  )
    throw new Error('Invalid funding limits');
  const result: FundingTrace = { steps: [], nodesRead: 0, complete: true, reasons: [] };
  const cache = new Map(histories.map((h) => [h.owner, Promise.resolve(h)]));
  for (const root of histories) {
    const visited = new Set([root.owner]);
    const queue = [
      { owner: root.owner, hop: 1, before: entrySlots.get(root.owner) || root.coverage.newestSlot },
    ];
    while (queue.length) {
      if (signal.aborted) {
        result.complete = false;
        result.reasons.push('FUNDING_DEADLINE');
        break;
      }
      const next = queue.shift()!;
      if (!cache.has(next.owner)) {
        if (result.nodesRead >= options.maxNodes) {
          result.complete = false;
          result.reasons.push('FUNDING_NODE_LIMIT');
          continue;
        }
        result.nodesRead++;
        cache.set(next.owner, read(next.owner));
      }
      let history: WalletHistory;
      try {
        history = await cache.get(next.owner)!;
      } catch {
        result.complete = false;
        result.reasons.push('FUNDER_HISTORY_UNAVAILABLE');
        continue;
      }
      if (history.coverage.status !== 'complete') {
        result.complete = false;
        result.reasons.push('FUNDING_HISTORY_PARTIAL');
      }
      const incoming = history.transactions
        .filter(
          (t) =>
            !t.failed &&
            (!next.before || BigInt(t.slot) <= BigInt(next.before)) &&
            (!next.before || BigInt(next.before) - BigInt(t.slot) <= options.lookbackSlots),
        )
        .flatMap((tx) =>
          tx.nativeFlows
            .filter(
              (f) =>
                f.to === next.owner && f.from !== f.to && BigInt(f.lamports) >= options.minLamports,
            )
            .map((flow) => ({ tx, flow })),
        );
      incoming.sort((a, b) =>
        BigInt(a.tx.slot) > BigInt(b.tx.slot)
          ? -1
          : BigInt(a.tx.slot) < BigInt(b.tx.slot)
            ? 1
            : a.tx.signature.localeCompare(b.tx.signature),
      );
      const chosen = new Set<string>();
      for (const { tx, flow } of incoming) {
        if (chosen.has(flow.from)) continue;
        if (chosen.size >= options.maxFundersPerNode) {
          result.complete = false;
          result.reasons.push('FUNDER_FANIN_LIMIT');
          break;
        }
        chosen.add(flow.from);
        result.steps.push({
          root: root.owner,
          from: flow.from,
          to: flow.to,
          amount: flow.lamports,
          signature: tx.signature,
          slot: tx.slot,
          hop: next.hop,
          instruction: flow.instruction,
          observedAt: history.observedAt,
        });
        if (next.hop < options.maxHops && !visited.has(flow.from)) {
          visited.add(flow.from);
          queue.push({ owner: flow.from, hop: next.hop + 1, before: tx.slot });
        } else if (next.hop === options.maxHops) {
          result.complete = false;
          result.reasons.push('FUNDING_HOP_BOUNDARY');
        }
      }
    }
    if (signal.aborted) break;
  }
  result.reasons = [...new Set(result.reasons)];
  return result;
}
