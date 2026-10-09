import type { Config } from '@crawlspider/config';

// A scan is a bounded investigation, not a crawl of every holder's lifetime history.
export function historyPolicy(mode: 'preview' | 'deep', config: Config) {
  const quick = mode === 'preview';
  return {
    maxOwners: Math.min(config.MAX_HISTORY_OWNERS, quick ? 6 : 12),
    minOwners: quick ? 2 : 3,
    targetSupplyBps: 9500,
    budgetMs: quick ? 6000 : 20000,
    options: {
      maxPages: 1,
      pageSize: quick ? 8 : 16,
      maxTransactions: quick ? 4 : 8,
      // Token-account receipts concern this mint; the owner window also captures funding/activity.
      maxAccounts: 1,
    },
  };
}
