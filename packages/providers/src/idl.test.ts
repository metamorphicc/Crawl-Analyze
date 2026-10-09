import { describe, expect, it } from 'vitest';
import { decodeIdl, protocolIdl } from './idl.js';
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM } from './input.js';
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};
describe('pinned Borsh layouts', () => {
  it('reads legacy curve fields and exposes missing appended fields', () => {
    const discriminator = protocolIdl(PUMP_PROGRAM)!.accounts.find(
      (a) => a.name === 'BondingCurve',
    )!.discriminator;
    const bytes = Buffer.concat([
      Buffer.from(discriminator),
      u64(9007199254740993n),
      u64(30n),
      u64(10n),
      u64(5n),
      u64(100n),
      Buffer.from([0]),
    ]);
    const curve = decodeIdl(PUMP_PROGRAM, 'account', bytes, true)!;
    expect(curve.value.virtual_token_reserves).toBe('9007199254740993');
    expect(curve.value.complete).toBe(false);
    expect(curve.missingFields).toContain('quote_mint');
    expect(() => decodeIdl(PUMP_PROGRAM, 'account', bytes)).toThrow('unavailable');
  });
  it('decodes signed i128 reserves, including a negative retained-fee adjustment', () => {
    const discriminator = protocolIdl(PUMP_AMM_PROGRAM)!.accounts.find(
      (a) => a.name === 'Pool',
    )!.discriminator;
    const data = Buffer.alloc(261);
    data.set(discriminator);
    data.writeBigInt64LE(-42n, 245);
    data.fill(255, 253, 261);
    expect(decodeIdl(PUMP_AMM_PROGRAM, 'account', data, true)!.value.virtual_quote_reserves).toBe(
      '-42',
    );
  });
  it.each([PUMP_PROGRAM, PUMP_AMM_PROGRAM])(
    'decodes tuple OptionBool and modern buy arguments for %s',
    (program) => {
      const ix = protocolIdl(program)!.instructions.find((i) => i.name === 'buy')!;
      const args = program === PUMP_PROGRAM ? Buffer.from([1, 0]) : Buffer.from([1]);
      const decoded = decodeIdl(
        program,
        'instruction',
        Buffer.concat([Buffer.from(ix.discriminator), u64(7n), u64(9n), args]),
      )!;
      expect(decoded.value.track_volume).toEqual({ '0': true });
      expect(decoded.missingFields).toEqual([]);
    },
  );
  it('rejects truncated primitive and invalid boolean rather than treating them as false', () => {
    const ix = protocolIdl(PUMP_AMM_PROGRAM)!.instructions.find((i) => i.name === 'buy')!;
    expect(() =>
      decodeIdl(
        PUMP_AMM_PROGRAM,
        'instruction',
        Buffer.concat([Buffer.from(ix.discriminator), u64(1n), Buffer.from([0])]),
        true,
      ),
    ).toThrow();
    expect(() =>
      decodeIdl(
        PUMP_AMM_PROGRAM,
        'instruction',
        Buffer.concat([Buffer.from(ix.discriminator), u64(1n), u64(1n), Buffer.from([2])]),
      ),
    ).toThrow();
  });
  it.each(['buy_v2', 'buy_v3', 'buy_exact_quote_in_v3', 'sell_v3', 'migrate_v2'])(
    'recognizes Pump variant %s',
    (name) => {
      const ix = protocolIdl(PUMP_PROGRAM)!.instructions.find((i) => i.name === name)!;
      const tail = ix.args?.length === 3 ? Buffer.from([0]) : Buffer.alloc(0);
      const bytes = Buffer.concat([
        Buffer.from(ix.discriminator),
        ...(ix.args?.length ? [u64(1n), u64(2n), tail] : []),
      ]);
      expect(decodeIdl(PUMP_PROGRAM, 'instruction', bytes)!.name).toBe(name);
    },
  );
});
