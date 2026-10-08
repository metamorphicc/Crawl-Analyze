import { describe, expect, it } from 'vitest';
import { LocalBudget } from './budget.js';
describe('bounded request gate', () => {
  it('limits daily requests including retries', async () => {
    const gate = new LocalBudget(1000, 1);
    await gate.reserve('rpc', AbortSignal.timeout(1000));
    await expect(gate.reserve('rpc', AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: 'PROVIDER_DAILY_BUDGET_EXHAUSTED',
    });
  });
  it('does not wait beyond the caller deadline', async () => {
    const gate = new LocalBudget(1, 100);
    await gate.reserve('rpc', AbortSignal.timeout(1000));
    const start = Date.now();
    await expect(gate.reserve('rpc', AbortSignal.timeout(30))).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(300);
  });
});
