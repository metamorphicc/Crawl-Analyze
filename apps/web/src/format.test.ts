import { it, expect } from 'vitest';
import { units, safeLink } from './format.js';
it('keeps u64 and signed differences exact at any token precision', () => {
  expect(units('18446744073709551615', 9)).toBe('18446744073.709551615');
  expect(units('-9007199254740993', 6)).toBe('-9007199254.740993');
  expect(units('1', 18)).toBe('0.000000000000000001');
  expect(units(null, 6)).toBe('unknown');
});
it('never makes report-provided hostile URLs clickable', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://solscan.io.evil.test/',
    'https://user:pass@solscan.io/',
    'http://gmgn.ai/',
    'data:text/html,evil',
  ])
    expect(safeLink(url)).toBeNull();
  expect(safeLink('https://axiom.trade/t/test')).toBe('https://axiom.trade/t/test');
});
