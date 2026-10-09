import type { FastifyInstance } from 'fastify';
import type { Config } from '@crawlspider/config';
import { marketChartSchema, type MarketChart } from '@crawlspider/contracts';
import { readMarketChart, validAddress } from '@crawlspider/providers';
import { ScanStore, sharedProviderBudget, type Storage } from '@crawlspider/storage';
export function registerChart(
  app: FastifyInstance,
  config: Config,
  storage: Storage,
  options: { request?: typeof fetch; namespace?: string } = {},
) {
  const store = new ScanStore(storage.pool, config);
  const budget = sharedProviderBudget(
    storage,
    config.PROVIDER_MAX_RPS,
    config.PROVIDER_DAILY_REQUEST_LIMIT,
  );
  app.get<{ Params: { mint: string } }>('/v1/tokens/:mint/market', async (req, reply) => {
    const mint = validAddress(req.params.mint);
    const report = await store.latest(mint);
    const pool =
      report?.scenarios.scenarios.flatMap((s) => s.quotes).find((q) => q.venue === 'pump-swap')
        ?.market ?? null;
    const unavailable = (reason: string): MarketChart => ({
      status: 'unavailable',
      mint,
      pool,
      provider: 'geckoterminal',
      observedAt: new Date().toISOString(),
      currency: 'USD',
      intervalSeconds: 300,
      candles: [],
      reasons: [reason],
    });
    if (!pool) return unavailable('VERIFIED_POOL_UNAVAILABLE');
    const stop = new AbortController();
    req.raw.once('aborted', () => stop.abort());
    reply.raw.once('close', () => stop.abort());
    const signal = AbortSignal.any([
      stop.signal,
      AbortSignal.timeout(config.PROVIDER_REQUEST_TIMEOUT_MS),
    ]);
    try {
      await storage.ensureRedis();
      const namespace = options.namespace || 'crawlspider:chart:v1';
      const cacheKey = `${namespace}:${mint}:${pool}`;
      const cached = await storage.redis.get(cacheKey);
      if (cached) {
        const chart = marketChartSchema.parse(JSON.parse(cached));
        if (chart.mint !== mint || chart.pool !== pool) return unavailable('CHART_CACHE_MISMATCH');
        return chart;
      }
      // Global cross-process public-provider gate: at most one request per 6 seconds.
      if (
        !(await storage.redis.set(
          options.namespace ? `${namespace}:gate` : 'crawlspider:gecko:gate',
          '1',
          'PX',
          6000,
          'NX',
        ))
      )
        return unavailable('CHART_BUDGET_BUSY');
      await budget.reserve('geckoterminal', signal);
      const chart = await readMarketChart(mint, pool, signal, options.request);
      await storage.redis.set(cacheKey, JSON.stringify(chart), 'EX', 60);
      return chart;
    } catch {
      return unavailable('CHART_PROVIDER_UNAVAILABLE');
    }
  });
}
