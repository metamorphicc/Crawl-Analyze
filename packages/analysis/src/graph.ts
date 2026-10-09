import { createHash } from 'node:crypto';
import {
  PARSER_VERSION,
  type EvidenceGraph,
  type RelationshipEdge,
  type WalletHistory,
  type WalletSignals,
  type WalletLabel,
  type FundingTrace,
  type OwnerBalance,
  type Provenance,
} from '@crawlspider/contracts';
import { eligibleAmount, observedTrades } from './history.js';
export const GRAPH_RULE_VERSION = 'relationships-1';
export const GRAPH_POLICY = {
  hubFanout: 6,
  behaviorSlotWindow: 2n,
  controlSlotWindow: 8n,
  sizeToleranceBps: 500n,
  maxPairComparisons: 5000,
  maxEdges: 2000,
};
const hash = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24);
const pair = (a: string, b: string) => [a, b].sort().join(':');
export function buildEvidenceGraph(input: {
  mint: string;
  holders: OwnerBalance[];
  histories: WalletHistory[];
  signals: WalletSignals[];
  funding: FundingTrace;
  labels?: WalletLabel[];
  observedAt: string;
}): EvidenceGraph {
  const owners = new Map(input.holders.map((h) => [h.owner, h])),
    signals = new Map(input.signals.map((s) => [s.owner, s]));
  const labels = new Map(
    (input.labels || [])
      .filter(
        (l) =>
          l.verified &&
          l.source &&
          Date.parse(l.reviewedAt) <= Date.parse(input.observedAt) &&
          Date.parse(l.expiresAt) > Date.parse(input.observedAt),
      )
      .map((l) => [l.address, l]),
  );
  const edges: RelationshipEdge[] = [],
    ids = new Set<string>(),
    limitations = [...input.funding.reasons];
  if (input.histories.some((h) => h.coverage.status !== 'complete'))
    limitations.push('HISTORY_COVERAGE_PARTIAL');
  const transactions = new Map(
    input.histories.flatMap((h) => h.transactions).map((tx) => [tx.signature, tx]),
  );
  const fanout = new Map<string, Set<string>>();
  const fan = (from: string, to: string) => {
    const targets = fanout.get(from) || new Set<string>();
    targets.add(to);
    fanout.set(from, targets);
  };
  for (const tx of transactions.values())
    if (!tx.failed) {
      for (const f of tx.nativeFlows) if (BigInt(f.lamports) > 0n) fan(f.from, f.to);
      for (const f of tx.flows) if (f.from && f.to && BigInt(f.amount) > 0n) fan(f.from, f.to);
    }
  for (const step of input.funding.steps) fan(step.from, step.to);
  const hubs = new Set(
    [...fanout]
      .filter(([, targets]) => targets.size >= GRAPH_POLICY.hubFanout)
      .map(([from]) => from),
  );
  const service = (key: string) => labels.has(key) || hubs.has(key);
  const add = (edge: RelationshipEdge) => {
    if (ids.has(edge.id)) return;
    if (edges.length >= GRAPH_POLICY.maxEdges) {
      limitations.push('GRAPH_EDGE_LIMIT');
      return;
    }
    ids.add(edge.id);
    edges.push(edge);
  };
  const provenance = (slot: string, observedAt = input.observedAt): Provenance => ({
    provider: 'solana-rpc',
    slot,
    observedAt,
    commitment: 'confirmed',
    parserVersion: PARSER_VERSION,
  });
  const make = (
    params: Omit<
      RelationshipEdge,
      'id' | 'transactionLinks' | 'ruleVersion' | 'relatedEvidenceIds'
    >,
    related: string[] = [],
  ) => {
    const id = hash(
      JSON.stringify([params.kind, params.from, params.to, params.signatures, params.explanation]),
    );
    return {
      ...params,
      id,
      ruleVersion: GRAPH_RULE_VERSION,
      transactionLinks: params.signatures.map((sig) => `https://solscan.io/tx/${sig}`),
      relatedEvidenceIds: related,
    };
  };
  const direct = new Map<string, RelationshipEdge[]>(),
    distributors = new Map<string, Map<string, RelationshipEdge>>();
  for (const tx of transactions.values()) {
    if (tx.failed) continue;
    const trades = tx.calls.some(
      (c) =>
        /^(buy|sell|multi_hop_swap)(_|$)/.test(c.instruction) &&
        (c.accounts.base_mint === input.mint ||
          c.accounts.mint === input.mint ||
          c.instruction === 'multi_hop_swap'),
    );
    for (const flow of tx.flows) {
      if (
        flow.kind !== 'transfer' ||
        flow.mint !== input.mint ||
        !flow.from ||
        !flow.to ||
        flow.from === flow.to ||
        BigInt(flow.amount) === 0n
      )
        continue;
      if (trades) {
        limitations.push('MIXED_SWAP_TRANSFERS_NOT_CONTROL_EVIDENCE');
        continue;
      }
      const edge = make({
        kind: 'transfer',
        from: flow.from,
        to: flow.to,
        strength: 'onchain-interaction',
        signature: tx.signature,
        signatures: [tx.signature],
        amount: flow.amount,
        explanation:
          'Observed token transfer; this proves an interaction, not common wallet ownership.',
        provenance: flow.provenance,
        confidence: 'high',
        assetMint: input.mint,
        supportsControlHypothesis: false,
        serviceExcluded: service(flow.from) || service(flow.to),
      });
      add(edge);
      const id = pair(flow.from, flow.to),
        list = direct.get(id) || [];
      list.push(edge);
      direct.set(id, list);
      const targets = distributors.get(flow.from) || new Map<string, RelationshipEdge>();
      targets.set(flow.to, edge);
      distributors.set(flow.from, targets);
    }
  }
  const sharedFunders = new Map<string, Map<string, RelationshipEdge>>();
  const rootService = new Set(
    input.funding.steps.filter((s) => service(s.from)).map((s) => s.root),
  );
  for (const step of input.funding.steps) {
    const edge = make({
      kind: 'funding',
      from: step.from,
      to: step.to,
      strength: 'onchain-interaction',
      signature: step.signature,
      signatures: [step.signature],
      amount: step.amount,
      explanation: `Observed SOL funding transfer at hop ${step.hop}; funding purpose and common control are unproven.`,
      provenance: provenance(step.slot, step.observedAt),
      confidence: 'high',
      assetMint: 'So11111111111111111111111111111111111111112',
      supportsControlHypothesis: false,
      serviceExcluded: service(step.from) || service(step.to),
    });
    add(edge);
    const funded = sharedFunders.get(step.from) || new Map<string, RelationshipEdge>();
    funded.set(step.root, edge);
    sharedFunders.set(step.from, funded);
  }
  const support = new Map<string, RelationshipEdge[]>();
  let comparisons = 0;
  const hypothesisPairs = (
    groups: Map<string, Map<string, RelationshipEdge>>,
    kind: 'shared-funder' | 'transfer',
  ) => {
    for (const [source, targets] of groups) {
      const members = [...targets.keys()].filter((key) => owners.has(key)).sort();
      if (service(source)) {
        limitations.push('SERVICE_HUB_NOT_CONTROL_EVIDENCE');
        continue;
      }
      for (let i = 0; i < members.length; i++)
        for (let j = i + 1; j < members.length; j++) {
          if (++comparisons > GRAPH_POLICY.maxPairComparisons) {
            limitations.push('GRAPH_PAIR_LIMIT');
            return;
          }
          const from = members[i]!,
            to = members[j]!,
            a = targets.get(from)!,
            b = targets.get(to)!;
          const signatures = [...new Set([...a.signatures, ...b.signatures])];
          const edge = make(
            {
              kind,
              from,
              to,
              strength: 'behavioral-hypothesis',
              signature: signatures[0] || null,
              signatures,
              amount: null,
              explanation:
                kind === 'shared-funder'
                  ? `Common observed funder ${source}; shared funding alone does not establish common control.`
                  : `Common observed token distributor ${source}; a distribution alone does not establish common control.`,
              provenance: a.provenance,
              confidence: 'low',
              assetMint: kind === 'transfer' ? input.mint : null,
              supportsControlHypothesis: false,
              serviceExcluded:
                service(from) || service(to) || rootService.has(from) || rootService.has(to),
            },
            [a.id, b.id],
          );
          add(edge);
          const id = pair(from, to),
            list = support.get(id) || [];
          list.push(edge);
          support.set(id, list);
        }
    }
  };
  hypothesisPairs(sharedFunders, 'shared-funder');
  hypothesisPairs(distributors, 'transfer');
  const buyers = input.signals
    .filter((s) => s.entry?.kind === 'buy' && s.entry.amount && BigInt(s.entry.amount) > 0n)
    .sort((a, b) => a.owner.localeCompare(b.owner));
  for (let i = 0; i < buyers.length; i++)
    for (let j = i + 1; j < buyers.length; j++) {
      if (++comparisons > GRAPH_POLICY.maxPairComparisons) {
        limitations.push('GRAPH_PAIR_LIMIT');
        break;
      }
      const a = buyers[i]!,
        b = buyers[j]!,
        slotDiff = BigInt(a.entry!.slot) - BigInt(b.entry!.slot),
        amountA = BigInt(a.entry!.amount!),
        amountB = BigInt(b.entry!.amount!),
        difference = amountA > amountB ? amountA - amountB : amountB - amountA;
      if (
        (slotDiff < 0n ? -slotDiff : slotDiff) > GRAPH_POLICY.behaviorSlotWindow ||
        difference * 10000n >
          (amountA > amountB ? amountA : amountB) * GRAPH_POLICY.sizeToleranceBps
      )
        continue;
      const signatures = [...new Set([a.entry!.signature, b.entry!.signature])];
      add(
        make({
          kind: 'behavior',
          from: a.owner,
          to: b.owner,
          strength: 'behavioral-hypothesis',
          signature: signatures[0]!,
          signatures,
          amount: null,
          explanation:
            'Similar observed buy timing and size; independent bots can produce this pattern.',
          provenance: provenance(a.entry!.slot),
          confidence: 'low',
          assetMint: input.mint,
          supportsControlHypothesis: false,
          serviceExcluded: service(a.owner) || service(b.owner),
        }),
      );
    }
  for (const [id, related] of support) {
    const [from, to] = id.split(':') as [string, string];
    const funding = related.filter((e) => e.kind === 'shared-funder' && !e.serviceExcluded),
      distribution = [
        ...related.filter((e) => e.kind === 'transfer' && !e.serviceExcluded),
        ...(direct.get(id) || []).filter((e) => !e.serviceExcluded),
      ];
    const a = signals.get(from)?.entry,
      b = signals.get(to)?.entry;
    if (
      !funding.length ||
      !distribution.length ||
      !a ||
      !b ||
      service(from) ||
      service(to) ||
      rootService.has(from) ||
      rootService.has(to)
    )
      continue;
    const diff = BigInt(a.slot) - BigInt(b.slot);
    if ((diff < 0n ? -diff : diff) > GRAPH_POLICY.controlSlotWindow) continue;
    const refs = [...funding, ...distribution],
      signatures = [...new Set(refs.flatMap((e) => e.signatures))];
    if (signatures.length < 2) continue;
    add(
      make(
        {
          kind: 'authority',
          from,
          to,
          strength: 'inferred-control',
          signature: signatures[0]!,
          signatures,
          amount: null,
          explanation:
            'Corroborated funding, token-transfer/distributor and acquisition timing support a common-control hypothesis. Personal identity is not proven.',
          provenance: refs[0]!.provenance,
          confidence: 'medium',
          assetMint: input.mint,
          supportsControlHypothesis: true,
          serviceExcluded: false,
        },
        refs.map((e) => e.id),
      ),
    );
  }
  const parent = new Map<string, string>();
  const find = (v: string): string => {
    const p = parent.get(v);
    if (!p || p === v) return v;
    const root = find(p);
    parent.set(v, root);
    return root;
  };
  for (const edge of edges)
    if (edge.supportsControlHypothesis && !edge.serviceExcluded) {
      const a = find(edge.from),
        b = find(edge.to);
      parent.set(a, a);
      parent.set(b, a);
    }
  const components = new Map<string, string[]>();
  for (const owner of parent.keys()) {
    const root = find(owner),
      list = components.get(root) || [];
    list.push(owner);
    components.set(root, list);
  }
  const controlHypotheses = [...components.values()]
    .filter((group) => group.length > 1)
    .map((group) => {
      group.sort();
      const set = new Set(group);
      return {
        id: hash(group.join(':')),
        owners: group,
        amount: group
          .reduce((sum, key) => sum + (owners.has(key) ? eligibleAmount(owners.get(key)!) : 0n), 0n)
          .toString(),
        evidenceIds: edges
          .filter((e) => e.supportsControlHypothesis && set.has(e.from) && set.has(e.to))
          .map((e) => e.id),
        confidence: 'medium' as const,
        identityProven: false as const,
      };
    });
  const nodeOwners = new Set([
    ...input.histories.map((h) => h.owner),
    ...edges.flatMap((e) => [e.from, e.to]),
  ]);
  return {
    ruleVersion: GRAPH_RULE_VERSION,
    nodes: [...nodeOwners].sort().map((owner) => ({
      owner,
      amount: owners.has(owner) ? eligibleAmount(owners.get(owner)!).toString() : '0',
      label: labels.get(owner) || null,
      observedHub: hubs.has(owner),
    })),
    edges,
    controlHypotheses,
    suspiciousOwners: [...new Set(controlHypotheses.flatMap((h) => h.owners))].sort(),
    limitations: [...new Set(limitations)],
    analyzedOwners: input.histories.map((h) => h.owner),
  };
}
