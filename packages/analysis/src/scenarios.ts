import type {
  ChainMarket,
  MintIdentity,
  SellQuote,
  LiquidityScenarios,
} from '@crawlspider/contracts';
import { unsigned, signed, ceilFee, Precise, ModelError } from './amounts.js';
import { knownLayout, selectFees } from './fees.js';
import { supportedMintSemantics } from '@crawlspider/contracts';
export const MODEL_VERSION = 'pump-sell-1';
export type QuoteOptions = {
  observedAt: string;
  maxAgeMs?: number;
  referenceSlot?: string;
  maxSlotLag?: bigint;
  slippageBps?: number;
};
type Available = Extract<SellQuote, { status: 'available' }>;
function policy(options: QuoteOptions) {
  const now = Date.parse(options.observedAt),
    age = options.maxAgeMs ?? 60000,
    slippage = options.slippageBps ?? 100;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(age) ||
    age <= 0 ||
    !Number.isInteger(slippage) ||
    slippage < 0 ||
    slippage > 10000 ||
    (options.maxSlotLag ?? 150n) < 0n
  )
    throw new Error('Invalid scenario policy');
  return { now, age, slippage };
}
export function quoteSell(
  market: ChainMarket,
  identity: MintIdentity,
  baseIn: string,
  options: QuoteOptions,
): SellQuote {
  const { now, age, slippage } = policy(options);
  const common = {
    modelVersion: MODEL_VERSION,
    market: market.address,
    venue: market.venue,
    quoteMint: market.quoteMint,
    slot: market.slot,
    observedAt: market.observedAt,
    baseIn,
  };
  try {
    const amount = unsigned(baseIn),
      base = unsigned(market.baseReserve),
      vault = unsigned(market.quoteVaultBalance),
      adjustment = signed(market.virtualQuoteReserve);
    if (market.baseMint !== identity.mint) throw new ModelError('BASE_MINT_MISMATCH');
    if (amount === 0n) throw new ModelError('BASE_INPUT_ZERO');
    if (amount > unsigned(identity.supply)) throw new ModelError('BASE_INPUT_EXCEEDS_MINT_SUPPLY');
    if (base + amount >= 1n << 64n) throw new ModelError('POST_BASE_RESERVE_OVERFLOW');
    if (!supportedMintSemantics(identity.token2022Extensions))
      throw new ModelError('TOKEN_EXTENSION_SEMANTICS_UNVERIFIED');
    const mintStamp = Date.parse(identity.provenance.observedAt);
    if (!Number.isFinite(mintStamp) || mintStamp > now || now - mintStamp > 120000)
      throw new ModelError('MINT_STATE_STALE_OR_TIME_UNKNOWN');
    const stamp = Date.parse(market.observedAt);
    if (!Number.isFinite(stamp) || stamp > now || now - stamp > age)
      throw new ModelError('MARKET_STALE_OR_TIME_UNKNOWN');
    const slot = unsigned(market.slot);
    if (options.referenceSlot) {
      const reference = unsigned(options.referenceSlot),
        gap = reference > slot ? reference - slot : slot - reference;
      if (gap > (options.maxSlotLag ?? 150n)) throw new ModelError('MARKET_SLOT_DRIFT');
    }
    if (market.limitations.length) throw new ModelError(market.limitations[0]!);
    if (market.venue === 'pump-curve' && market.curveComplete)
      throw new ModelError('CURVE_COMPLETE_USE_MIGRATED_VENUE');
    const state = knownLayout(
      market.state,
      market.venue === 'pump-curve' ? 'BondingCurve' : 'Pool',
    );
    if (market.venue === 'pump-curve' && unsigned(state.depth) !== 0n)
      throw new ModelError('MULTIHOP_CURVE_SCENARIO_UNVERIFIED');
    if (market.venue === 'pump-swap') {
      const global = knownLayout(market.global, 'GlobalConfig');
      const flags = unsigned(global.disable_flags);
      if (flags > 255n) throw new ModelError('INVALID_DISABLE_FLAGS');
      if ((flags & 16n) !== 0n) throw new ModelError('POOL_SELL_DISABLED');
    }
    const effective =
      market.venue === 'pump-curve' ? unsigned(market.virtualQuoteReserve) : vault + adjustment;
    if (effective <= 0n || base === 0n) throw new ModelError('NONPOSITIVE_EFFECTIVE_RESERVES');
    if (effective >= 1n << 64n) throw new ModelError('EFFECTIVE_QUOTE_RESERVE_OVERFLOW');
    const real =
      market.venue === 'pump-curve'
        ? unsigned(market.realQuoteReserve)
        : vault - unsigned(state.protocol_fees) - unsigned(state.creator_fees);
    if (real < 0n) throw new ModelError('FEE_BUCKETS_EXCEED_VAULT');
    const rates = selectFees(market, identity, effective),
      gross = (effective * amount) / (base + amount);
    const lp = ceilFee(gross, rates.lpBps),
      protocol = ceilFee(gross, rates.protocolBps),
      creator = ceilFee(gross, rates.creatorBps),
      net = gross - lp - protocol - creator;
    // LP fees stay in the AMM reserve. Retained creator/protocol buckets are already in the signed adjustment.
    const grossOutflow = gross - lp;
    if (real < grossOutflow) throw new ModelError('INSUFFICIENT_REAL_QUOTE_RESERVES');
    if (net <= 0n) throw new ModelError('OUTPUT_ZERO_OR_FEE_ROUNDING_EXHAUSTED');
    if (
      market.quoteDecimals !== null &&
      (!Number.isInteger(market.quoteDecimals) ||
        market.quoteDecimals < 0 ||
        market.quoteDecimals > 255)
    )
      throw new ModelError('QUOTE_DECIMALS_INVALID');
    const initialSpot = new Precise(effective.toString()).div(base.toString());
    const average = new Precise(gross.toString()).div(amount.toString());
    const finalSpot = new Precise((effective - grossOutflow).toString()).div(
      (base + amount).toString(),
    );
    return {
      ...common,
      status: 'available',
      grossQuoteOut: gross.toString(),
      netQuoteOut: net.toString(),
      minQuoteOut: ((net * BigInt(10000 - slippage)) / 10000n).toString(),
      slippageBps: slippage,
      quoteUnits:
        market.quoteDecimals === null
          ? null
          : new Precise(net.toString())
              .div(new Precise(10).pow(market.quoteDecimals))
              .toFixed(market.quoteDecimals),
      effectiveQuoteReserve: effective.toString(),
      realQuoteAvailable: real.toString(),
      fees: {
        lp: lp.toString(),
        protocol: protocol.toString(),
        creator: creator.toString(),
        rates,
      },
      executionImpactBps: new Precise(1).minus(average.div(initialSpot)).mul(10000).toFixed(6),
      postSpotDropBps: new Precise(1).minus(finalSpot.div(initialSpot)).mul(10000).toFixed(6),
      assumptions: [
        'SINGLE_TRADE_AT_OBSERVED_RESERVES',
        'CURRENT_PRE_TRADE_FEE_TIER',
        'NO_COMPETING_TRADES_OR_MEV',
        'NETWORK_AND_ROUTER_FEES_EXCLUDED',
        'TRANSFERABILITY_AND_WALLET_RESTRICTIONS_NOT_PROVEN',
        ...(market.quoteDecimals === null ? ['QUOTE_DECIMALS_UNKNOWN_RAW_UNITS_ONLY'] : []),
      ],
    };
  } catch (error) {
    return {
      ...common,
      status: 'unavailable',
      reasons: [error instanceof ModelError ? error.code : 'INVALID_MODEL_DATA'],
    };
  }
}
export function buildSellScenarios(
  identity: MintIdentity,
  markets: ChainMarket[],
  basisAmount: string,
  options: QuoteOptions & { fractionsBps?: number[]; limitations?: string[] },
): LiquidityScenarios {
  policy(options);
  const basis = unsigned(basisAmount, 128),
    fractions = options.fractionsBps ?? [2500, 5000, 10000];
  if (fractions.length > 10 || fractions.some((v) => !Number.isInteger(v) || v <= 0 || v > 10000))
    throw new Error('Invalid scenario fractions');
  if (markets.length > 10 || new Set(markets.map((m) => m.address)).size !== markets.length)
    throw new Error('Duplicate or excessive market states');
  const limitations = new Set([
    'MARKET_DISCOVERY_NOT_EXHAUSTIVE',
    'NO_GLOBAL_OPTIMAL_ROUTING_CLAIM',
    'NO_USD_CONVERSION_WITHOUT_PRICE_SOURCE',
    ...(options.limitations || []),
  ]);
  if (basis > unsigned(identity.supply))
    limitations.add('BASIS_EXCEEDS_MINT_SUPPLY_SNAPSHOT_INCONSISTENT');
  const scenarios = [...new Set(fractions)]
    .sort((a, b) => a - b)
    .map((fractionBps) => {
      const baseIn = ((basis * BigInt(fractionBps)) / 10000n).toString();
      const quotes = markets.map((m) => quoteSell(m, identity, baseIn, options));
      const groups = new Map<string, Available[]>();
      for (const quote of quotes)
        if (quote.status === 'available') {
          const group = groups.get(quote.quoteMint) || [];
          group.push(quote);
          groups.set(quote.quoteMint, group);
        }
      // A pool that cannot take the entire sale can still take one leg of a split.
      const splitGroups = new Map<string, ChainMarket[]>();
      for (const market of markets) {
        if (market.venue === 'pump-curve' && market.curveComplete) continue;
        const group = splitGroups.get(market.quoteMint) || [];
        group.push(market);
        splitGroups.set(market.quoteMint, group);
      }
      const routes: LiquidityScenarios['scenarios'][number]['routes'] = [];
      for (const [quoteMint, group] of groups) {
        const best = group.reduce((a, b) =>
          BigInt(a.netQuoteOut) >= BigInt(b.netQuoteOut) ? a : b,
        );
        routes.push({
          quoteMint,
          kind: 'best-single-known',
          legs: [best],
          netQuoteOut: best.netQuoteOut,
          referenceBound: 'achievable-in-model-not-global-optimum',
        });
      }
      for (const [quoteMint, group] of splitGroups) {
        if (group.length < 2) continue;
        const slots = group.map((m) => unsigned(m.slot)),
          gap = slots.reduce((a, b) => (a > b ? a : b)) - slots.reduce((a, b) => (a < b ? a : b));
        if (gap > 32n) {
          limitations.add('CROSS_VENUE_SLOT_SPREAD');
          continue;
        }
        const total = BigInt(baseIn),
          piece = total / BigInt(group.length),
          remainder = total % BigInt(group.length);
        const legs = group.map((m, i) =>
          quoteSell(m, identity, (piece + (BigInt(i) < remainder ? 1n : 0n)).toString(), options),
        );
        if (!legs.every((leg): leg is Available => leg.status === 'available')) continue;
        routes.push({
          quoteMint,
          kind: 'equal-split-known',
          legs,
          netQuoteOut: legs.reduce((n, l) => n + BigInt(l.netQuoteOut), 0n).toString(),
          referenceBound: 'achievable-in-model-not-global-optimum',
        });
      }
      if (!routes.length) limitations.add('NO_SUPPORTED_ROUTE_FOR_SOME_FRACTIONS');
      return { fractionBps, baseIn, quotes, routes };
    });
  return {
    modelVersion: MODEL_VERSION,
    baseMint: identity.mint,
    basis: 'flagged-owner-balance',
    basisAmount,
    observedAt: options.observedAt,
    limitations: [...limitations],
    scenarios,
  };
}
