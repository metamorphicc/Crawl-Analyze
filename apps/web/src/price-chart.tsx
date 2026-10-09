import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, ColorType, type UTCTimestamp } from 'lightweight-charts';
import { marketChartSchema, type MarketChart } from '@crawlspider/contracts';
import { useResource, errorMessage } from './api.js';
import { date } from './format.js';
import { External } from './report.js';
import { shortAddress } from './wallet-view.js';
export function PriceChart({ mint, refresh = false }: { mint: string; refresh?: boolean }) {
  const retryCount = useRef(0);
  useEffect(() => {
    retryCount.current = 0;
  }, [mint]);
  const query = useResource(
    `/v1/tokens/${encodeURIComponent(mint)}/market`,
    marketChartSchema,
    refresh,
  );
  useEffect(() => {
    if (
      retryCount.current >= 3 ||
      query.data?.status !== 'unavailable' ||
      !query.data.reasons.some((r) =>
        ['CHART_BUDGET_BUSY', 'CHART_PROVIDER_UNAVAILABLE'].includes(r),
      )
    )
      return;
    // A shared public-provider gate can be occupied by another visitor. Retry automatically,
    // including on saved reports, without resetting or re-running the token scan.
    const timer = setTimeout(() => {
      retryCount.current++;
      void query.refetch();
    }, 6500);
    return () => clearTimeout(timer);
  }, [query.data, query.refetch]);
  if (query.data && query.data.mint !== mint)
    return <p role="alert">The source returned candles for another token.</p>;
  return query.error ? (
    <p role="alert">
      {errorMessage(query.error)}{' '}
      <button onClick={() => void query.refetch()}>Retry candles</button>
    </p>
  ) : !query.data ? (
    <p role="status">Loading candles…</p>
  ) : query.data.status === 'unavailable' ? (
    <p>
      Chart unavailable:{' '}
      {query.data.reasons.includes('CHART_POOL_NOT_INDEXED')
        ? 'The chart provider has not indexed a trading pool for this token yet.'
        : query.data.reasons.includes('CHART_BUDGET_BUSY')
          ? 'The market data source is busy. Automatic retries are limited.'
          : query.data.reasons.includes('CHART_PROVIDER_UNAVAILABLE')
            ? 'The market data source did not respond. Automatic retries are limited.'
            : query.data.reasons.join(', ')}{' '}
      Missing prices are not replaced with zero.
    </p>
  ) : (
    <Candles data={query.data} />
  );
}
function Candles({ data }: { data: MarketChart }) {
  const ref = useRef<HTMLDivElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    if (!ref.current) return;
    let chart: ReturnType<typeof createChart> | undefined;
    try {
      const styles = getComputedStyle(ref.current);
      // Resolve the shared OKLCH palette to RGB for the chart library's colour parser.
      const canvas = document.createElement('canvas'),
        context = canvas.getContext('2d')!;
      const color = (token: string) => {
        context.fillStyle = styles.getPropertyValue(token).trim();
        context.fillRect(0, 0, 1, 1);
        const pixels = context.getImageData(0, 0, 1, 1).data;
        return `rgb(${pixels[0]}, ${pixels[1]}, ${pixels[2]})`;
      };
      const surface = color('--color-paper-2'),
        ink = color('--color-muted'),
        rule = color('--color-rule'),
        up = color('--color-accent'),
        down = color('--color-error');
      chart = createChart(ref.current, {
        autoSize: true,
        height: ref.current.clientHeight || 340,
        layout: {
          attributionLogo: true,
          background: { type: ColorType.Solid, color: surface },
          textColor: ink,
          fontFamily: styles.fontFamily,
        },
        grid: { vertLines: { color: rule }, horzLines: { color: rule } },
        rightPriceScale: { borderColor: rule },
        timeScale: { borderColor: rule },
      });
      const series = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
      series.setData(
        data.candles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
        })),
      );
      chart.timeScale().fitContent();
    } catch {
      setError('Unable to display the chart. Data is available in the table.');
    }
    return () => chart?.remove();
  }, [data]);
  return (
    <>
      <div className="chart-source-bar">
        <span>GeckoTerminal · USD</span>
        <span>
          Pool{' '}
          <External url={`https://www.geckoterminal.com/solana/pools/${data.pool}`}>
            {shortAddress(data.pool!)}
          </External>
        </span>
        <span>Updated {date(data.observedAt)}</span>
      </div>
      {data.candles.length > 0 && Date.now() - data.candles.at(-1)!.time * 1000 > 600000 && (
        <p role="status">Stale candles: the last trading candle is over 10 minutes old.</p>
      )}
      {error && <p role="status">{error}</p>}
      <div
        ref={ref}
        className="chart"
        role="img"
        aria-label="USD price candles; values are available in the table below"
      />
      <p>
        <External url="https://www.tradingview.com/">TradingView Lightweight Charts</External> ·{' '}
        <External url={`https://www.geckoterminal.com/solana/pools/${data.pool}`}>
          Candle source
        </External>
      </p>
      <details>
        <summary>Candle source and exact values</summary>
        <p>
          The chart uses rounded prices. Exact source values are preserved below. Missing intervals
          are not filled artificially. Last candle:{' '}
          {data.candles.length
            ? new Date(data.candles.at(-1)!.time * 1000).toLocaleString('en-US')
            : 'unavailable'}
          .
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="USD candles">
          <table>
            <caption>USD candles</caption>
            <thead>
              <tr>
                {['Time', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.candles.map((c) => (
                <tr key={c.time}>
                  <td>{new Date(c.time * 1000).toLocaleString('en-US')}</td>
                  <td>{c.open}</td>
                  <td>{c.high}</td>
                  <td>{c.low}</td>
                  <td>{c.close}</td>
                  <td>{c.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
