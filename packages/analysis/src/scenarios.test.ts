import { describe, it, expect } from 'vitest';
import { sellQuoteSchema, liquidityScenariosSchema } from '@crawlspider/contracts';
import { decodeIdl, FEE_PROGRAM } from '@crawlspider/providers';
import { quoteSell, buildSellScenarios } from './scenarios.js';
import { selectFees } from './fees.js';
import {
  market,
  curve,
  identity,
  NOW,
  USDC,
  key,
  reference,
} from '../../../tests/fixtures/analytics.js';
const options = { observedAt: NOW };
const available = (m = market(), amount = '1000000000000', id = identity()) => {
  const result = quoteSell(m, id, amount, options);
  if (result.status !== 'available') throw new Error(result.reasons.join(','));
  return result;
};
describe('publisher account and independent reference quotes', () => {
  it('decodes all mainnet fee tiers and distinguishes allocation padding from new fields', () => {
    const bytes = Buffer.from(reference.dataBase64, 'base64'),
      d = decodeIdl(FEE_PROGRAM, 'account', bytes)!;
    expect(d.value.bump).toBe(String(reference.bump));
    expect(d.value.admin).toBe(reference.admin);
    const tiers = d.value.fee_tiers as {
      market_cap_lamports_threshold: string;
      fees: Record<string, string>;
    }[];
    expect(
      tiers.map((t) => [
        t.market_cap_lamports_threshold,
        t.fees.lp_fee_bps,
        t.fees.protocol_fee_bps,
        t.fees.creator_fee_bps,
      ]),
    ).toEqual(reference.feeTiers);
    expect(d.trailingBytes).toBeGreaterThan(0);
    expect(d.trailingNonzero).toBe(false);
    bytes[bytes.length - 1] = 1;
    expect(decodeIdl(FEE_PROGRAM, 'account', bytes)!.trailingNonzero).toBe(true);
  });
  it('matches the publisher canonical SOL sell case with independently rounded fees', () => {
    const q = available();
    expect(q.grossQuoteOut).toBe('99800399');
    expect(q.netQuoteOut).toBe('98552892');
    expect(q.minQuoteOut).toBe('97567363');
    expect(q.fees).toMatchObject({ lp: '19961', protocol: '928144', creator: '299402' });
    expect(q.quoteUnits).toBe('0.098552892');
    expect(sellQuoteSchema.safeParse(q).success).toBe(true);
  });
  it('matches the publisher boosted creatorless sell case', () => {
    const m = market();
    m.quoteVaultBalance = '1000000000000';
    m.virtualQuoteReserve = '30000000000';
    m.state.value.coin_creator = '11111111111111111111111111111111';
    const q = quoteSell(m, identity(), '10000000000000', { ...options, slippageBps: 500 });
    expect(q).toMatchObject({
      status: 'available',
      grossQuoteOut: '20196078431',
      netQuoteOut: '20145588234',
      minQuoteOut: '19138308822',
    });
  });
  it('preserves values above number precision and agrees with independent decimal rational division', () => {
    const m = market();
    m.baseReserve = '10000000000000001';
    m.quoteVaultBalance = '10000000000000003';
    const id = identity();
    id.supply = '18446744073709551615';
    const q = available(m, '123456789012345', id);
    // Independently evaluated integer quotient: 10000000000000003*123456789012345/(10000000000000001+123456789012345).
    expect(q.grossQuoteOut).toBe('121951218428018');
    expect(
      BigInt(q.netQuoteOut) + BigInt(q.fees.lp) + BigInt(q.fees.protocol) + BigInt(q.fees.creator),
    ).toBe(BigInt(q.grossQuoteOut));
  });
});
describe('fee selection and current program gates', () => {
  it('selects quote-denominated stable tiers instead of reusing SOL thresholds', () => {
    const sol = market(),
      stable = market();
    stable.quoteMint = USDC;
    stable.quoteDecimals = 6;
    expect(selectFees(sol, identity(), 50000000000n)).toMatchObject({
      schedule: 'sol-tier',
      creatorBps: 30,
    });
    expect(selectFees(stable, identity(), 50000000000n)).toMatchObject({
      schedule: 'stable-tier',
      creatorBps: 95,
      thresholdQuoteRaw: '59000000000',
    });
  });
  it('uses the fixed normal curve supply and exact tier boundaries', () => {
    const m = curve(),
      id = identity();
    id.supply = '1000000000000';
    expect(selectFees(m, id, 210000000000n)).toMatchObject({
      marketCapQuoteRaw: '420000000000',
      creatorBps: 95,
      thresholdQuoteRaw: '420000000000',
    });
    expect(selectFees(m, id, 209999999999n)).toMatchObject({
      creatorBps: 30,
      thresholdQuoteRaw: '0',
    });
    const stable = market();
    stable.quoteMint = USDC;
    stable.feeConfig!.value.stable_fee_tiers = [];
    expect(selectFees(stable, identity(), 50000000000n)).toMatchObject({
      schedule: 'stable-tier',
      creatorBps: 30,
    });
  });
  it('uses flat fees on noncanonical pools and exotic fallback, then explicit exotic fees', () => {
    const m = market();
    m.canonical = false;
    expect(available(m).fees.rates).toMatchObject({
      schedule: 'flat',
      lpBps: 25,
      protocolBps: 5,
      creatorBps: 0,
    });
    m.canonical = true;
    m.quoteMint = key(8);
    expect(available(m).fees.rates.schedule).toBe('flat');
    m.feeConfig!.value.exotic_flat_fees = {
      lp_fee_bps: '30',
      protocol_fee_bps: '20',
      creator_fee_bps: '10',
    };
    expect(available(m).fees.rates.schedule).toBe('exotic-flat');
  });
  it('applies the per-coin creator override only while the global gate is enabled', () => {
    const m = market();
    m.state.value.creator_fee_bps = '250';
    expect(available(m).fees.rates.creatorBps).toBe(30);
    m.global!.value.creator_fee_configurable = true;
    expect(available(m).fees.rates.creatorBps).toBe(250);
    m.state.value.coin_creator = '11111111111111111111111111111111';
    expect(available(m).fees.creator).toBe('0');
  });
  it('does not add buyback splitting to the protocol fee twice', () => {
    const m = market();
    m.global!.value.buyback_basis_points = '9999';
    expect(available(m).netQuoteOut).toBe(available().netQuoteOut);
  });
  it('rejects unknown mandatory fees, unsorted tiers, new trailing fields and combined rates', () => {
    const m = market();
    m.feeConfig = null;
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      status: 'unavailable',
      reasons: ['REQUIRED_MARKET_ACCOUNT_UNKNOWN'],
    });
    m.feeConfig = market().feeConfig;
    m.feeConfig!.value.fee_tiers = (m.feeConfig!.value.fee_tiers as unknown[]).toReversed();
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      status: 'unavailable',
      reasons: ['FEE_TIERS_UNSORTED'],
    });
    m.feeConfig = market().feeConfig;
    m.feeConfig!.trailingNonzero = true;
    expect(quoteSell(m, identity(), '1000', options).status).toBe('unavailable');
    m.feeConfig = market().feeConfig;
    m.canonical = false;
    m.feeConfig!.value.flat_fees = {
      lp_fee_bps: '5000',
      protocol_fee_bps: '5001',
      creator_fee_bps: '0',
    };
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      status: 'unavailable',
      reasons: ['COMBINED_FEE_RATE_INVALID'],
    });
  });
});
describe('signed reserves, spendable liquidity and failure states', () => {
  it('keeps quotes invariant across fee sweep without double-subtracting buckets', () => {
    const before = market();
    before.quoteVaultBalance = '50100000000';
    before.virtualQuoteReserve = '-100000000';
    before.state.value.protocol_fees = '60000000';
    before.state.value.creator_fees = '40000000';
    const q = available(before),
      after = available();
    expect(q.netQuoteOut).toBe(after.netQuoteOut);
    expect(q.effectiveQuoteReserve).toBe('50000000000');
    expect(q.realQuoteAvailable).toBe('50000000000');
  });
  it('checks gross outflow instead of net user payout against real liquidity', () => {
    const m = market();
    m.quoteVaultBalance = '98552892';
    m.virtualQuoteReserve = (50000000000n - 98552892n).toString();
    const q = quoteSell(m, identity(), '1000000000000', options);
    expect(q).toMatchObject({
      status: 'unavailable',
      reasons: ['INSUFFICIENT_REAL_QUOTE_RESERVES'],
    });
    m.quoteVaultBalance = '99780438';
    m.virtualQuoteReserve = (50000000000n - 99780438n).toString();
    expect(available(m).realQuoteAvailable).toBe('99780438');
  });
  it.each(['0', '-50000000000', '-50000000001'])(
    'rejects zero/negative effective liquidity (%s)',
    (adjustment) => {
      const m = market();
      m.virtualQuoteReserve = adjustment;
      if (adjustment === '0') m.quoteVaultBalance = '0';
      expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
        status: 'unavailable',
        reasons: ['NONPOSITIVE_EFFECTIVE_RESERVES'],
      });
    },
  );
  it('distinguishes migrated and incomplete/unknown data from zero impact', () => {
    const m = curve();
    m.curveComplete = true;
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      status: 'unavailable',
      reasons: ['CURVE_COMPLETE_USE_MIGRATED_VENUE'],
    });
    m.curveComplete = false;
    m.realQuoteReserve = null;
    expect(quoteSell(m, identity(), '1000', options).status).toBe('unavailable');
    m.realQuoteReserve = '0';
    expect(quoteSell(m, identity(), '1000000000000', options)).toMatchObject({
      status: 'unavailable',
      reasons: ['INSUFFICIENT_REAL_QUOTE_RESERVES'],
    });
  });
  it('refuses unsupported extensions, mayhem, multihop, disabled sells and future timestamps', () => {
    const id = identity();
    id.token2022Extensions = [1];
    expect(quoteSell(market(), id, '1000', options).status).toBe('unavailable');
    id.token2022Extensions = [18, 19];
    expect(quoteSell(market(), id, '1000000000000', options).status).toBe('available');
    const m = market();
    m.state.value.is_mayhem_mode = true;
    expect(quoteSell(m, identity(), '1000', options).status).toBe('unavailable');
    m.state.value.is_mayhem_mode = false;
    m.global!.value.disable_flags = '16';
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      reasons: ['POOL_SELL_DISABLED'],
    });
    const c = curve();
    c.state.value.depth = '1';
    expect(quoteSell(c, identity(), '1000', options)).toMatchObject({
      reasons: ['MULTIHOP_CURVE_SCENARIO_UNVERIFIED'],
    });
    m.global!.value.disable_flags = '0';
    m.observedAt = '2026-10-09T00:00:01.000Z';
    expect(quoteSell(m, identity(), '1000', options)).toMatchObject({
      reasons: ['MARKET_STALE_OR_TIME_UNKNOWN'],
    });
  });
  it('keeps raw quote output when decimals are unknown and never invents USD', () => {
    const m = market();
    m.quoteDecimals = null;
    expect(available(m)).toMatchObject({ quoteUnits: null, netQuoteOut: '98552892' });
  });
  it('enforces freshness/slot/amount limits and rounding exhaustion', () => {
    const m = market();
    expect(
      quoteSell(m, identity(), '1000', { observedAt: '2026-10-09T00:01:01.000Z' }),
    ).toMatchObject({ reasons: ['MARKET_STALE_OR_TIME_UNKNOWN'] });
    expect(
      quoteSell(m, identity(), '1000', { ...options, referenceSlot: '445187127' }),
    ).toMatchObject({ reasons: ['MARKET_SLOT_DRIFT'] });
    expect(quoteSell(m, identity(), '18446744073709551616', options).status).toBe('unavailable');
    expect(quoteSell(m, identity(), '1', options)).toMatchObject({
      reasons: ['OUTPUT_ZERO_OR_FEE_ROUNDING_EXHAUSTED'],
    });
    const staleMint = identity();
    staleMint.provenance.observedAt = '2026-10-08T23:57:59.000Z';
    expect(quoteSell(m, staleMint, '1000000000000', options)).toMatchObject({
      reasons: ['MINT_STATE_STALE_OR_TIME_UNKNOWN'],
    });
  });
  it('has increasing proceeds and decreasing spot prices on curve and AMM sweeps', () => {
    for (const m of [market(), curve()]) {
      let output = 0n,
        impact = 0;
      for (let step = 1; step <= 100; step++) {
        const q = available(m, (BigInt(step) * 1000000000000n).toString());
        expect(BigInt(q.netQuoteOut)).toBeGreaterThan(output);
        expect(Number(q.postSpotDropBps)).toBeGreaterThan(impact);
        expect(Number(q.executionImpactBps)).toBeGreaterThanOrEqual(0);
        expect(Number(q.postSpotDropBps)).toBeLessThan(10000);
        output = BigInt(q.netQuoteOut);
        impact = Number(q.postSpotDropBps);
      }
    }
  });
});
describe('bounded multiple-venue alternatives', () => {
  it('returns exact fractions, explicit model bounds, and improved equal split on identical pools', () => {
    const a = market(),
      b = market();
    b.address = key(9);
    const result = buildSellScenarios(identity(), [a, b], '10000000000000', options);
    expect(liquidityScenariosSchema.safeParse(result).success).toBe(true);
    expect(result.scenarios.map((s) => s.baseIn)).toEqual([
      '2500000000000',
      '5000000000000',
      '10000000000000',
    ]);
    for (const s of result.scenarios) {
      const single = s.routes.find((r) => r.kind === 'best-single-known')!,
        split = s.routes.find((r) => r.kind === 'equal-split-known')!;
      expect(BigInt(split.netQuoteOut)).toBeGreaterThan(BigInt(single.netQuoteOut));
      expect(split.legs.reduce((n, l) => n + BigInt(l.baseIn), 0n).toString()).toBe(s.baseIn);
    }
    expect(result.limitations).toContain('MARKET_DISCOVERY_NOT_EXHAUSTIVE');
  });
  it('does not combine currencies or stale cross-slot reserves or duplicate pools', () => {
    const a = market(),
      b = market();
    b.address = key(9);
    b.quoteMint = USDC;
    let result = buildSellScenarios(identity(), [a, b], '1000000000000', options);
    expect(result.scenarios[0]!.routes.filter((r) => r.kind === 'equal-split-known')).toHaveLength(
      0,
    );
    b.quoteMint = a.quoteMint;
    b.slot = '445186160';
    result = buildSellScenarios(identity(), [a, b], '1000000000000', options);
    expect(result.limitations).toContain('CROSS_VENUE_SLOT_SPREAD');
    expect(() => buildSellScenarios(identity(), [a, a], '1000', options)).toThrow('Duplicate');
  });
  it('does not substitute generic math when all known venues are incomplete', () => {
    const m = market();
    m.feeConfig = null;
    const result = buildSellScenarios(identity(), [m], '1000', options);
    expect(result.scenarios.every((s) => s.routes.length === 0)).toBe(true);
    expect(result.scenarios[0]!.quotes[0]!.status).toBe('unavailable');
    expect(result.limitations).toContain('NO_SUPPORTED_ROUTE_FOR_SOME_FRACTIONS');
  });
  it('preserves an inconsistent flagged balance without pretending the whole amount can sell', () => {
    const result = buildSellScenarios(identity(), [market()], '2000000000000000', options);
    expect(result.limitations).toContain('BASIS_EXCEEDS_MINT_SUPPLY_SNAPSHOT_INCONSISTENT');
    expect(result.scenarios[2]!.quotes[0]).toMatchObject({
      status: 'unavailable',
      reasons: ['BASE_INPUT_EXCEEDS_MINT_SUPPLY'],
    });
  });
});
