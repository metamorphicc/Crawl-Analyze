import { Decimal } from 'decimal.js';
import {
  OUTCOME_POLICY_VERSION,
  forwardOutcomeSchema,
  outcomeObservationSchema,
  type OutcomeObservation,
  type ForwardOutcome,
} from '@crawlspider/contracts';
const D = Decimal.clone({ precision: 100 });
export function classifyOutcome(
  baseline: OutcomeObservation,
  current: OutcomeObservation,
  horizonSeconds: number,
): ForwardOutcome {
  baseline = outcomeObservationSchema.parse(baseline);
  current = outcomeObservationSchema.parse(current);
  const reasons: string[] = [];
  const gap =
    Date.parse(current.observedAt) - Date.parse(baseline.observedAt) - horizonSeconds * 1000;
  if (gap < 0 || gap > 300000) reasons.push('OUTCOME_TIME_MISSED');
  if (baseline.pool !== current.pool) reasons.push('OUTCOME_POOL_CHANGED');
  function delta(a: string | null, b: string | null) {
    return a === null || b === null || new D(a).lte(0)
      ? null
      : new D(b).div(a).minus(1).mul(10000).toFixed(0);
  }
  let price = delta(baseline.priceUsd, current.priceUsd),
    liquidity = delta(baseline.liquidityUsd, current.liquidityUsd);
  if (reasons.length) {
    price = null;
    liquidity = null;
  }
  if (price === null) reasons.push('PRICE_CENSORED');
  if (liquidity === null) reasons.push('LIQUIDITY_CENSORED');
  const supplyDelta =
    gap >= 0 && gap <= 300000 && baseline.supply !== null && current.supply !== null
      ? (BigInt(current.supply) - BigInt(baseline.supply)).toString()
      : null;
  return forwardOutcomeSchema.parse({
    policyVersion: OUTCOME_POLICY_VERSION,
    status: price === null ? 'censored' : 'observed',
    baseline,
    current,
    horizonSeconds,
    priceReturnBps: price,
    liquidityChangeBps: liquidity,
    supplyDelta,
    labels: {
      marketDrawdown:
        price === null ? null : new D(current.priceUsd!).lte(new D(baseline.priceUsd!).mul('0.5')),
      liquidityDepthDecline:
        liquidity === null
          ? null
          : new D(current.liquidityUsd!).lte(new D(baseline.liquidityUsd!).mul('0.5')),
      liquidityWithdrawal: null,
      confirmedMaliciousAction: null,
    },
    reasons: [
      ...reasons,
      'USD_DEPTH_DOES_NOT_PROVE_LIQUIDITY_WITHDRAWAL',
      'MALICIOUS_ACTION_REQUIRES_INDEPENDENT_REVIEW',
    ],
  });
}
export type EvaluationSample = {
  reportId: string;
  mint: string;
  observedAt: string;
  labelObservedAt: string;
  ruleVersion: string;
  policyVersion: string;
  horizonSeconds: number;
  score: number | null;
  label: boolean | null;
};
export function evaluateRules(
  input: EvaluationSample[],
  ruleVersion: string,
  horizonSeconds = 3600,
) {
  const rows = input
    .filter(
      (r) =>
        r.ruleVersion === ruleVersion &&
        r.policyVersion === OUTCOME_POLICY_VERSION &&
        r.horizonSeconds === horizonSeconds,
    )
    .sort(
      (a, b) => a.observedAt.localeCompare(b.observedAt) || a.reportId.localeCompare(b.reportId),
    );
  if (
    rows.some(
      (r) =>
        !Number.isFinite(Date.parse(r.observedAt)) ||
        !Number.isFinite(Date.parse(r.labelObservedAt)) ||
        Date.parse(r.labelObservedAt) < Date.parse(r.observedAt) + horizonSeconds * 1000 ||
        (r.score !== null && (!Number.isInteger(r.score) || r.score < 0 || r.score > 100)),
    )
  )
    throw new Error('Invalid or future-leaking evaluation sample');
  const seen = new Set<string>(),
    unique = rows.filter((r) => {
      if (seen.has(r.mint)) return false;
      seen.add(r.mint);
      return true;
    });
  const split = Math.floor(unique.length * 0.8),
    cutoff = unique[split]?.observedAt || null;
  const train = unique.slice(0, split).filter((r) => cutoff !== null && r.labelObservedAt < cutoff),
    holdout = unique.slice(split);
  const usable = holdout.filter((r) => r.score !== null && r.label !== null),
    positive = usable.filter((r) => r.label).length,
    negative = usable.length - positive;
  const enough = train.length >= 200 && usable.length >= 100 && positive >= 30 && negative >= 30;
  const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (const r of usable) {
    const predicted = r.score! >= 50;
    if (predicted && r.label) counts.tp++;
    else if (predicted) counts.fp++;
    else if (r.label) counts.fn++;
    else counts.tn++;
  }
  const bins = Array.from({ length: 10 }, (_, i) => {
    const values = usable.filter((r) => Math.min(9, Math.floor(r.score! / 10)) === i);
    return {
      from: i * 10,
      to: i === 9 ? 100 : i * 10 + 9,
      n: values.length,
      drawdowns: values.filter((r) => r.label).length,
      rate: values.length ? values.filter((r) => r.label).length / values.length : null,
    };
  });
  return {
    policyVersion: OUTCOME_POLICY_VERSION,
    ruleVersion,
    horizonSeconds,
    label: 'market-drawdown-at-horizon >=50%',
    threshold: 50,
    status: enough ? 'sufficient-for-descriptive-evaluation' : 'insufficient-sample',
    predictiveClaimAllowed: false,
    total: unique.length,
    training: train.length,
    holdout: holdout.length,
    censored: holdout.length - usable.length,
    cutoff,
    confusion: enough ? counts : null,
    bins,
    slices: enough
      ? {
          falsePositives: usable.filter((r) => r.score! >= 50 && !r.label).map((r) => r.reportId),
          falseNegatives: usable.filter((r) => r.score! < 50 && r.label).map((r) => r.reportId),
        }
      : null,
  };
}
