import { describe, expect, it } from 'vitest';
import { scanRequestSchema, rawAmountSchema, qualitySchema, marketChartSchema } from './index.js';
describe('public contracts', () => {
  it('keeps display qualifications separate from chart unavailability through JSON round trips', () => {
    const chart = {
      status: 'available',
      mint: '1'.repeat(32),
      pool: '2'.repeat(32),
      provider: 'geckoterminal',
      observedAt: '2026-10-09T00:00:00.000Z',
      currency: 'USD',
      intervalSeconds: 300,
      reasons: [],
      qualifications: ['EXTERNAL_CHART_POOL_NOT_A_VERIFIED_SELL_MODEL'],
      candles: [{ time: 1700000000, open: '1', high: '2', low: '0.5', close: '1.5', volume: '10' }],
    };
    expect(marketChartSchema.parse(JSON.parse(JSON.stringify(chart)))).toEqual(chart);
    expect(marketChartSchema.safeParse({ ...chart, reasons: chart.qualifications }).success).toBe(
      false,
    );
    expect(
      marketChartSchema.safeParse({ ...chart, qualifications: ['UNREVIEWED_FLAG'] }).success,
    ).toBe(false);
    expect(marketChartSchema.safeParse({ ...chart, candles: [] }).success).toBe(false);
  });
  it('preserves amounts beyond floating point precision', () => {
    expect(rawAmountSchema.parse('18446744073709551615')).toBe('18446744073709551615');
    for (const v of [9007199254740993, '-1', '1e18', '01', '1.5'])
      expect(rawAmountSchema.safeParse(v).success).toBe(false);
  });
  it('rejects unsolicited fields and oversized input', () => {
    expect(scanRequestSchema.safeParse({ input: 'a'.repeat(600) }).success).toBe(false);
    expect(
      scanRequestSchema.safeParse({ input: 'a'.repeat(32), privateKey: 'secret' }).success,
    ).toBe(false);
  });
  it('cannot claim an atomic snapshot from paginated data', () => {
    expect(
      qualitySchema.safeParse({
        status: 'complete',
        reasons: [],
        observedAt: new Date().toISOString(),
        minSlot: '1',
        maxSlot: '1',
        indexedSlot: '1',
        supplyReconciled: true,
        atomic: true,
      }).success,
    ).toBe(false);
  });
});
