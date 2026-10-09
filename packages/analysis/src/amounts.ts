import { Decimal } from 'decimal.js';
export const Precise = Decimal.clone({ precision: 100, rounding: Decimal.ROUND_DOWN });
export class ModelError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export function unsigned(value: unknown, bits = 64): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 40)
    throw new ModelError('INVALID_UNSIGNED_AMOUNT');
  const n = BigInt(value);
  if (n >= 1n << BigInt(bits)) throw new ModelError('AMOUNT_OVERFLOW');
  return n;
}
export function signed(value: unknown): bigint {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value) || value.length > 40)
    throw new ModelError('INVALID_SIGNED_RESERVE');
  const n = BigInt(value);
  if (n < -(1n << 127n) || n >= 1n << 127n) throw new ModelError('RESERVE_OVERFLOW');
  return n;
}
export function shareBps(amount: bigint, total: bigint): number {
  if (amount < 0n || amount > total || total < 0n) throw new Error('Invalid share');
  return total ? Number((amount * 10000n) / total) : 0;
}
export const ceilFee = (amount: bigint, bps: number) => (amount * BigInt(bps) + 9999n) / 10000n;
