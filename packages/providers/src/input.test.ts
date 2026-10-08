import { describe, expect, it } from 'vitest';
import {
  parseInput,
  terminalLinks,
  WRAPPED_SOL,
  decodePumpPoolBase,
  PUMP_AMM_PROGRAM,
  PUMP_PROGRAM,
} from './input.js';
import { address, getAddressEncoder } from '@solana/kit';
import { readFileSync } from 'node:fs';
describe('canonical input', () => {
  it.each([
    [WRAPPED_SOL, 'mint'],
    [`https://pump.fun/coin/${WRAPPED_SOL}?utm_source=anything`, 'pump'],
    [`https://gmgn.ai/sol/token/ref_${WRAPPED_SOL}`, 'gmgn'],
    [`https://axiom.trade/meme/${WRAPPED_SOL}?chain=sol`, 'axiom'],
  ])('accepts %s', (value, source) => {
    expect(parseInput(value!).address).toBe(WRAPPED_SOL);
    expect(parseInput(value!).source).toBe(source);
  });
  it.each([
    `https://pump.fun.evil.org/coin/${WRAPPED_SOL}`,
    `https://pump.fun@evil.org/coin/${WRAPPED_SOL}`,
    `https://evil.org/?mint=${WRAPPED_SOL}`,
    `http://pump.fun/coin/${WRAPPED_SOL}`,
    `https://gmgn.ai/eth/token/${WRAPPED_SOL}`,
    `https://axiom.trade/meme/${WRAPPED_SOL}?chain=bsc`,
    `https://pump.fun/coin/${WRAPPED_SOL}/anything`,
    `https://pump.fun:443/coin/${WRAPPED_SOL}#data`,
    `https://pump.fun/coin/${WRAPPED_SOL}?mint=11111111111111111111111111111111`,
    `${WRAPPED_SOL} 11111111111111111111111111111111`,
    '0'.repeat(44),
  ])('rejects hostile/ambiguous input %s', (value) => expect(() => parseInput(value)).toThrow());
  it('uses only validated addresses in terminal destinations', () => {
    const links = terminalLinks(WRAPPED_SOL);
    expect(new URL(links.gmgn).pathname).toBe(`/sol/token/${WRAPPED_SOL}`);
    expect(() => terminalLinks('javascript:alert(1)')).toThrow();
  });
  it('reads base mint from the pinned PumpSwap layout and verifies program constants', () => {
    const idl = JSON.parse(readFileSync(new URL('../idl/pump_amm.json', import.meta.url), 'utf8'));
    expect(idl.address).toBe(PUMP_AMM_PROGRAM);
    expect(
      JSON.parse(readFileSync(new URL('../idl/pump.json', import.meta.url), 'utf8')).address,
    ).toBe(PUMP_PROGRAM);
    const data = new Uint8Array(300);
    data.set(idl.accounts.find((v: { name: string }) => v.name === 'Pool').discriminator);
    data.set(getAddressEncoder().encode(address(WRAPPED_SOL)), 43);
    expect(decodePumpPoolBase(data)).toBe(WRAPPED_SOL);
    expect(() => decodePumpPoolBase(new Uint8Array(300))).toThrow('not a supported');
  });
});
