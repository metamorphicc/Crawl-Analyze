import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, type UTCTimestamp } from 'lightweight-charts';
import { marketChartSchema, type MarketChart } from '@crawlspider/contracts';
import { useResource, errorMessage } from './api.js';
import { date } from './format.js';
import { External } from './report.js';
export function PriceChart({ mint }: { mint: string }) {
  const query = useResource(`/v1/tokens/${encodeURIComponent(mint)}/market`, marketChartSchema);
  if (query.data && query.data.mint !== mint)
    return <p role="alert">Источник вернул свечи другого токена.</p>;
  return query.error ? (
    <p role="alert">
      {errorMessage(query.error)}{' '}
      <button onClick={() => void query.refetch()}>Повторить загрузку свечей</button>
    </p>
  ) : !query.data ? (
    <p role="status">Загружаем свечи…</p>
  ) : query.data.status === 'unavailable' ? (
    <p>График недоступен: {query.data.reasons.join(', ')}. Цена не заменена нулём.</p>
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
      chart = createChart(ref.current, {
        autoSize: true,
        height: 300,
        layout: { attributionLogo: true },
      });
      const series = chart.addSeries(CandlestickSeries);
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
      setError('График не удалось отобразить. Данные доступны в таблице.');
    }
    return () => chart?.remove();
  }, [data]);
  return (
    <>
      <p>
        GeckoTerminal · USD · интервал 5 минут · получено {date(data.observedAt)} · пул {data.pool}.
      </p>
      <p>Отрисовка использует округлённые цены. Значения источника сохранены в таблице.</p>
      {data.candles.length > 0 && Date.now() - data.candles.at(-1)!.time * 1000 > 600000 && (
        <p role="status">Устаревшие свечи: последняя торговая свеча старше 10 минут.</p>
      )}
      <p>
        Последняя свеча:{' '}
        {data.candles.length
          ? new Date(data.candles.at(-1)!.time * 1000).toLocaleString('ru-RU')
          : 'нет'}
        . Пропущенные интервалы не заполнены искусственно.
      </p>
      {error && <p role="status">{error}</p>}
      <div
        ref={ref}
        className="chart"
        role="img"
        aria-label="Свечи цены USD; значения доступны в таблице ниже"
      />
      <p>
        <External url="https://www.tradingview.com/">TradingView Lightweight Charts</External> ·{' '}
        <External url={`https://www.geckoterminal.com/solana/pools/${data.pool}`}>
          Источник свечей
        </External>
      </p>
      <details>
        <summary>Таблица свечей (точные значения источника)</summary>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Свечи USD">
          <table>
            <caption>Свечи USD</caption>
            <thead>
              <tr>
                {['Время', 'Open', 'High', 'Low', 'Close', 'Volume'].map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.candles.map((c) => (
                <tr key={c.time}>
                  <td>{new Date(c.time * 1000).toLocaleString('ru-RU')}</td>
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
