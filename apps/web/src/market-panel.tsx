import { Component, lazy, Suspense, type ReactNode } from 'react';

const PriceChart = lazy(() =>
  import('./price-chart.js').then((module) => ({ default: module.PriceChart })),
);

class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">
        The chart could not load. Your scan and report are still available.{' '}
        <button onClick={() => location.reload()}>Reload page</button>
      </p>
    ) : (
      this.props.children
    );
  }
}

export function MarketPanel({ mint, refresh = false }: { mint: string; refresh?: boolean }) {
  return (
    <section className="market-panel" aria-label="Token market chart">
      <div className="panel-heading">
        <h3>Market chart</h3>
        <span>USD · 5-minute candles</span>
      </div>
      <p>External USD candles are separate from the report snapshot and reserve calculations.</p>
      <ChartBoundary key={mint}>
        <Suspense fallback={<p role="status">Loading chart…</p>}>
          <PriceChart mint={mint} refresh={refresh} />
        </Suspense>
      </ChartBoundary>
    </section>
  );
}
