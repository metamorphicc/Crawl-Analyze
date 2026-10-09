import type { ChainMarket, MintIdentity, DecodedFields } from '@crawlspider/contracts';
import { unsigned, ModelError } from './amounts.js';
const ZERO = '11111111111111111111111111111111';
const SOL_QUOTES = new Set([
  ZERO,
  'So11111111111111111111111111111111111111112',
  '9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP',
]);
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
type Rates = { lpBps: number; protocolBps: number; creatorBps: number };
export type SelectedFees = Rates & {
  schedule: 'sol-tier' | 'stable-tier' | 'exotic-flat' | 'flat';
  marketCapQuoteRaw: string;
  thresholdQuoteRaw: string | null;
};
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ModelError('INVALID_FEE_LAYOUT');
  return value as Record<string, unknown>;
}
export function knownLayout(decoded: DecodedFields | null, expected: string) {
  if (!decoded || decoded.name !== expected)
    throw new ModelError('REQUIRED_MARKET_ACCOUNT_UNKNOWN');
  if (
    decoded.missingFields.length ||
    (decoded.trailingBytes > 0 && decoded.trailingNonzero !== false)
  )
    throw new ModelError('UNREVIEWED_MARKET_LAYOUT');
  return decoded.value;
}
function rate(value: unknown) {
  const n = unsigned(value);
  if (n > 10000n) throw new ModelError('INVALID_FEE_RATE');
  return Number(n);
}
function rates(value: unknown): Rates {
  const r = record(value);
  return {
    lpBps: rate(r.lp_fee_bps),
    protocolBps: rate(r.protocol_fee_bps),
    creatorBps: rate(r.creator_fee_bps),
  };
}
export function selectFees(
  market: ChainMarket,
  identity: MintIdentity,
  effectiveQuote: bigint,
): SelectedFees {
  const state = knownLayout(market.state, market.venue === 'pump-curve' ? 'BondingCurve' : 'Pool');
  const global = knownLayout(
    market.global,
    market.venue === 'pump-curve' ? 'Global' : 'GlobalConfig',
  );
  const config = knownLayout(market.feeConfig, 'FeeConfig');
  if (typeof global.creator_fee_configurable !== 'boolean')
    throw new ModelError('CREATOR_FEE_GATE_UNKNOWN');
  if (typeof state.is_mayhem_mode !== 'boolean') throw new ModelError('MAYHEM_MODE_UNKNOWN');
  if (state.is_mayhem_mode) throw new ModelError('MAYHEM_SCENARIO_UNVERIFIED');
  const supply = market.venue === 'pump-curve' ? 1000000000000000n : unsigned(identity.supply);
  const base = unsigned(market.baseReserve);
  if (base === 0n || effectiveQuote <= 0n) throw new ModelError('NONPOSITIVE_EFFECTIVE_RESERVES');
  const cap = (supply * effectiveQuote) / base;
  let selected: Rates,
    schedule: SelectedFees['schedule'],
    threshold: string | null = null;
  if (!market.canonical && market.venue === 'pump-swap') {
    selected = rates(config.flat_fees);
    schedule = 'flat';
  } else if (SOL_QUOTES.has(market.quoteMint) || market.quoteMint === USDC) {
    const stable = market.quoteMint === USDC;
    const list = stable ? config.stable_fee_tiers : config.fee_tiers;
    if (!Array.isArray(list)) throw new ModelError('FEE_TIERS_UNKNOWN');
    const tiers = stable && list.length === 0 ? config.fee_tiers : list;
    if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 256)
      throw new ModelError('FEE_TIERS_EMPTY_OR_INVALID');
    let previous = -1n;
    const decoded = tiers.map((v) => {
      const tier = record(v),
        at = unsigned(tier.market_cap_lamports_threshold, 128);
      if (at <= previous) throw new ModelError('FEE_TIERS_UNSORTED');
      previous = at;
      return { at, fees: rates(tier.fees) };
    });
    let tier = decoded[0]!;
    for (const next of decoded) if (next.at <= cap) tier = next;
    selected = tier.fees;
    threshold = tier.at.toString();
    schedule = stable ? 'stable-tier' : 'sol-tier';
  } else {
    const exotic = rates(config.exotic_flat_fees);
    const unset = exotic.lpBps === 0 && exotic.protocolBps === 0 && exotic.creatorBps === 0;
    selected = unset ? rates(config.flat_fees) : exotic;
    schedule = unset ? 'flat' : 'exotic-flat';
  }
  if (global.creator_fee_configurable) {
    const override = rate(state.creator_fee_bps);
    if (override > 0) selected = { ...selected, creatorBps: override };
  }
  const creator = market.venue === 'pump-curve' ? state.creator : state.coin_creator;
  if (typeof creator !== 'string') throw new ModelError('COIN_CREATOR_UNKNOWN');
  if (creator === ZERO) selected = { ...selected, creatorBps: 0 };
  if (market.venue === 'pump-curve') selected = { ...selected, lpBps: 0 };
  if (selected.lpBps + selected.protocolBps + selected.creatorBps > 10000)
    throw new ModelError('COMBINED_FEE_RATE_INVALID');
  return { ...selected, schedule, marketCapQuoteRaw: cap.toString(), thresholdQuoteRaw: threshold };
}
