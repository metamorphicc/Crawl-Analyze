import { lazy, Suspense } from 'react';

const PriceChart = lazy(() =>
  import('./price-chart.js').then((module) => ({ default: module.PriceChart })),
);

export function MarketPanel({ mint, refresh = false }: { mint: string; refresh?: boolean }) {
  return (
    <section className="market-panel" aria-label="Token market chart">
      <div className="panel-heading">
        <h3>Market chart</h3>
        <span>USD · 5-minute candles</span>
      </div>
      <p>External USD candles are separate from the report snapshot and reserve calculations.</p>
      <Suspense fallback={<p role="status">Loading chart…</p>}>
        <PriceChart mint={mint} refresh={refresh} />
      </Suspense>
    </section>
  );
}
