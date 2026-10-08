import { setTimeout as delay } from 'node:timers/promises';
import { PublicError } from '@crawlspider/contracts';
export type ProviderBudget = { reserve(provider: string, signal: AbortSignal): Promise<void> };
// Application services inject the DB/Redis gate; standalone diagnostics use this local gate.
export class LocalBudget implements ProviderBudget {
  private next = 0;
  private day = '';
  private count = 0;
  constructor(
    private readonly rps: number,
    private readonly dailyLimit: number,
  ) {}
  async reserve(_provider: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const now = Date.now();
    const wait = Math.max(0, this.next - now);
    this.next = Math.max(now, this.next) + 1000 / this.rps;
    if (wait) await delay(wait, undefined, { signal });
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.count = 0;
    }
    if (this.count >= this.dailyLimit)
      throw new PublicError(
        'PROVIDER_DAILY_BUDGET_EXHAUSTED',
        'Daily provider request limit reached',
        503,
      );
    this.count++;
  }
}
