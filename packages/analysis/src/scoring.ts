import type {
  MintIdentity,
  DataQuality,
  OwnerBalance,
  WalletSignals,
  EvidenceGraph,
  RiskAssessment,
} from '@crawlspider/contracts';
import { unsigned, shareBps } from './amounts.js';
import { supportedMintSemantics } from '@crawlspider/contracts';
export const SCORING_VERSION = 'heuristic-1';
export const DISTRIBUTION_SCORING_VERSION = 'distribution-1';
export type RiskInput = {
  identity: MintIdentity;
  holders: OwnerBalance[];
  quality: DataQuality;
  enumerationComplete: boolean;
  signals: WalletSignals[];
  graph: EvidenceGraph;
  observedAt: string;
  supportedMarket: boolean;
  scope?: 'distribution' | 'extended';
};
function fresh(stamp: string, now: number) {
  const at = Date.parse(stamp);
  return Number.isFinite(at) && at <= now && now - at <= 120000;
}
export function assessRisk(input: RiskInput): RiskAssessment {
  const { identity, quality, graph, observedAt } = input,
    now = Date.parse(observedAt);
  if (!Number.isFinite(now)) throw new Error('Invalid assessment time');
  const owners = new Map<string, bigint>();
  let excluded = 0n,
    frozen = 0n,
    delegated = 0n,
    flagsKnown = true;
  for (const holder of input.holders) {
    if (owners.has(holder.owner)) throw new Error('Duplicate owner balance');
    const amount = unsigned(holder.amount),
      omit = unsigned(holder.excludedAmount);
    if (omit > amount) throw new Error('Exclusion exceeds owner balance');
    const balance = amount - omit;
    owners.set(holder.owner, balance);
    excluded += omit;
    if (!balance) continue;
    for (const kind of ['frozenAmount', 'delegatedAmount'] as const) {
      const value = holder[kind];
      if (value === null) {
        flagsKnown = false;
        continue;
      }
      const flag = unsigned(value);
      if (flag > amount) throw new Error('Flagged account balance exceeds owner balance');
      // Infrastructure flags are not attributed to circulating owners. When overlap is unknown,
      // this is a conservative observed amount and the rule is ineligible below its threshold.
      const eligibleFlag = flag > omit ? flag - omit : 0n;
      if (kind === 'frozenAmount') frozen += eligibleFlag;
      else delegated += eligibleFlag;
      if (omit > 0n && flag > 0n && flag < amount) flagsKnown = false;
    }
  }
  const ranked = [...owners]
    .filter(([, n]) => n > 0n)
    .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0].localeCompare(b[0])));
  const total = ranked.reduce((n, [, amount]) => n + amount, 0n);
  // Pagination can observe both sides of an intervening transfer. Preserve that qualified
  // denominator, but never grant eligibility when it disagrees with the mint supply.
  unsigned(identity.supply);
  const signals = new Map(input.signals.map((s) => [s.owner, s]));
  if (signals.size !== input.signals.length) throw new Error('Duplicate wallet signals');
  let historyAmount = 0n,
    entryAmount = 0n,
    earlyKnownAmount = 0n,
    earlyAmount = 0n;
  const flagged = new Set<string>(),
    evidenceIds = new Set<string>();
  for (const [owner, amount] of ranked) {
    if (amount * 10000n >= total * 2000n) flagged.add(owner);
    const signal = signals.get(owner);
    if (!signal) continue;
    const c = signal.coverage;
    const windowKnown =
      c.status !== 'unavailable' &&
      c.exhausted &&
      c.addressesRequested > 0 &&
      c.addressesRead === c.addressesRequested &&
      c.missing === 0 &&
      c.decoded + c.failed === c.signatures &&
      c.reasons.every((r) => r === 'ARCHIVE_COMPLETENESS_UNKNOWN' || r === 'NO_HISTORY_RETURNED');
    if (windowKnown) historyAmount += amount;
    if (signal.entry) entryAmount += amount;
    if (signal.earlyObservedEntry !== null) earlyKnownAmount += amount;
    if (signal.earlyObservedEntry && signal.entry?.kind === 'buy') {
      earlyAmount += amount;
      flagged.add(owner);
      evidenceIds.add(signal.entry.signature);
    }
  }
  let largestGroup = 0n;
  for (const hypothesis of graph.controlHypotheses) {
    const members = new Set(hypothesis.owners);
    // Recompute from unique current eligible owners; supplied aggregate amounts are never trusted.
    const amount = [...members].reduce((n, o) => n + (owners.get(o) || 0n), 0n);
    if (amount > largestGroup) largestGroup = amount;
    for (const owner of members) if ((owners.get(owner) || 0n) > 0n) flagged.add(owner);
    for (const id of hypothesis.evidenceIds) evidenceIds.add(id);
  }
  const top1 = shareBps(ranked[0]?.[1] || 0n, total),
    top10 = shareBps(
      ranked.slice(0, 10).reduce((n, [, a]) => n + a, 0n),
      total,
    ),
    groupBps = shareBps(largestGroup, total);
  const flaggedBalance = [...flagged].reduce((n, o) => n + (owners.get(o) || 0n), 0n);
  const historyBps = shareBps(historyAmount, total),
    entryBps = shareBps(entryAmount, total),
    earlyKnownBps = shareBps(earlyKnownAmount, total);
  const holdersKnown =
    input.enumerationComplete &&
    quality.status === 'complete' &&
    quality.supplyReconciled &&
    total + excluded === unsigned(identity.supply) &&
    fresh(quality.observedAt, now);
  const metadataKnown =
    supportedMintSemantics(identity.token2022Extensions) &&
    fresh(identity.provenance.observedAt, now);
  const rules: RiskAssessment['rules'] = [];
  const add = (
    id: string,
    value: number | null,
    threshold: number,
    points: number,
    known: boolean,
    ids: string[] = [],
  ) => {
    const triggered = value !== null && value >= threshold;
    rules.push({
      id,
      status: triggered ? 'triggered' : known ? 'not-triggered' : 'unknown',
      points: triggered ? points : 0,
      threshold: `${threshold} bps`,
      observed: value === null ? null : `${value} bps`,
      evidenceIds: ids,
    });
  };
  add('TOP_OWNER', top1, 2000, 25, holdersKnown, ranked[0] ? [`owner:${ranked[0][0]}`] : []);
  add(
    'TOP_TEN_OWNERS',
    top10,
    6000,
    20,
    holdersKnown,
    ranked.slice(0, 10).map(([o]) => `owner:${o}`),
  );
  if (input.scope !== 'distribution')
    add(
      'CORROBORATED_CONTROL_GROUP',
      groupBps,
      2000,
      25,
      holdersKnown && historyBps >= 8000 && graph.limitations.length === 0,
      [...evidenceIds],
    );
  for (const [id, active, points] of [
    ['ACTIVE_MINT_AUTHORITY', identity.mintAuthority, 20],
    ['ACTIVE_FREEZE_AUTHORITY', identity.freezeAuthority, 10],
  ] as const)
    rules.push({
      id,
      status: active ? 'triggered' : metadataKnown ? 'not-triggered' : 'unknown',
      points: active ? points : 0,
      threshold: 'authority present',
      observed: active,
      evidenceIds: active ? [`authority:${active}`] : [],
    });
  add('FROZEN_BALANCE', shareBps(frozen, total), 1000, 10, holdersKnown && flagsKnown);
  add('DELEGATED_BALANCE', shareBps(delegated, total), 1000, 5, holdersKnown && flagsKnown);
  if (input.scope !== 'distribution')
    add(
      'VERIFIED_EARLY_BUYERS',
      shareBps(earlyAmount, total),
      2500,
      10,
      holdersKnown && earlyKnownBps >= 8000,
      [...evidenceIds],
    );
  const reasons = new Set<string>();
  if (!holdersKnown) reasons.add('HOLDER_SNAPSHOT_PARTIAL_STALE_OR_UNRECONCILED');
  if (!total) reasons.add('NO_ELIGIBLE_BALANCE');
  if (ranked.length < 5) reasons.add('TOO_FEW_ELIGIBLE_OWNERS');
  if (!metadataKnown) reasons.add('MINT_METADATA_STALE_OR_EXTENSION_UNREVIEWED');
  if (!flagsKnown) reasons.add('ACCOUNT_FLAGS_UNKNOWN');
  if (input.scope !== 'distribution') {
    if (historyBps < 8000) reasons.add('USABLE_HISTORY_BELOW_80_PERCENT');
    if (entryBps < 8000) reasons.add('OBSERVED_ENTRY_BELOW_80_PERCENT');
    if (!input.supportedMarket) reasons.add('SUPPORTED_FRESH_MARKET_UNAVAILABLE');
  }
  for (const rule of rules) if (rule.status === 'unknown') reasons.add(`RULE_UNKNOWN:${rule.id}`);
  const observedPoints = Math.min(
      100,
      rules.reduce((n, r) => n + r.points, 0),
    ),
    eligible = reasons.size === 0;
  // Completeness of a retained observation window is not lifetime history or statistical accuracy.
  const confidence =
    input.scope === 'distribution'
      ? (holdersKnown ? 75 : 0) + (metadataKnown ? 10 : 0) + (flagsKnown ? 10 : 0)
      : Math.min(
          95,
          (holdersKnown ? 35 : 0) +
            (metadataKnown ? 10 : 0) +
            (input.supportedMarket ? 15 : 0) +
            Math.floor((historyBps * 25) / 10000) +
            Math.floor((entryBps * 10) / 10000) +
            Math.floor((earlyKnownBps * 5) / 10000),
        );
  return {
    ruleVersion: input.scope === 'distribution' ? DISTRIBUTION_SCORING_VERSION : SCORING_VERSION,
    scope: input.scope || 'extended',
    heuristic: true,
    calibrated: false,
    observedAt,
    eligible,
    eligibilityReasons: [...reasons],
    riskScore: eligible ? observedPoints : null,
    observedRiskPoints: observedPoints,
    classification: !eligible
      ? 'insufficient-data'
      : observedPoints >= 60
        ? 'high'
        : observedPoints >= 30
          ? 'moderate'
          : 'low',
    confidence: {
      dataCompleteness: confidence,
      meaning: 'coverage-not-predictive-accuracy',
      reasons: [
        ...new Set([
          'ARCHIVE_COMPLETENESS_UNKNOWN',
          'PUBLIC_DATA_CANNOT_PROVE_PERSONAL_IDENTITY',
          'HEURISTIC_RULES_NOT_CALIBRATED',
          ...quality.reasons,
          ...graph.limitations,
          ...reasons,
        ]),
      ],
    },
    metrics: {
      denominator: 'indexed-balance-excluding-verified-infrastructure',
      eligibleBalance: total.toString(),
      excludedBalance: excluded.toString(),
      ownerCount: ranked.length,
      top1Bps: top1,
      top10Bps: top10,
      largestHypothesisBps: groupBps,
      flaggedBalance: flaggedBalance.toString(),
      flaggedBps: shareBps(flaggedBalance, total),
      flaggedOwners: [...flagged].sort(),
      usableHistoryBps: historyBps,
      knownEntryBps: entryBps,
      knownEarlyEntryBps: earlyKnownBps,
    },
    rules,
  };
}
