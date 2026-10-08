import { describe, expect, it } from 'vitest';
import { scanRequestSchema, rawAmountSchema, qualitySchema } from './index.js';
describe('public contracts', () => {
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
