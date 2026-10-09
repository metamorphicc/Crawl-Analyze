import { describe, expect, it } from 'vitest';
import { tx, history } from '../../../tests/fixtures/intelligence.js';
import { traceFunding } from './funding.js';
describe('bounded causal funding trace', () => {
  it('follows only funding before the entry/outgoing hop and stops at the hop boundary', async () => {
    const first = tx('first', '90');
    first.nativeFlows = [{ from: 'parent', to: 'a', lamports: '100000', instruction: '0' }];
    const late = tx('late', '110');
    late.nativeFlows = [{ from: 'unrelated', to: 'a', lamports: '100000', instruction: '0' }];
    const second = tx('second', '80');
    second.nativeFlows = [{ from: 'cex', to: 'parent', lamports: '1000000', instruction: '0' }];
    const result = await traceFunding(
      [history('a', [first, late])],
      new Map([['a', '100']]),
      async () => history('parent', [second]),
      AbortSignal.timeout(1000),
    );
    expect(result.steps.map((s) => s.from)).toEqual(['parent', 'cex']);
    expect(result.steps.map((s) => s.hop)).toEqual([1, 2]);
    expect(result.reasons).toContain('FUNDING_HOP_BOUNDARY');
  });
  it('honors cancellation before reading funders', async () => {
    let reads = 0;
    const result = await traceFunding(
      [history('a')],
      new Map(),
      async () => {
        reads++;
        return history('parent');
      },
      AbortSignal.abort(),
    );
    expect(reads).toBe(0);
    expect(result.reasons).toContain('FUNDING_DEADLINE');
  });
});
