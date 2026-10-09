import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { forwardHistorySchema } from '@crawlspider/contracts';
import { request, errorMessage } from './api.js';
export function Outcomes({ id }: { id: string }) {
  const [enabled, setEnabled] = useState(false);
  const data = useQuery({
    queryKey: ['outcomes', id],
    queryFn: ({ signal }) =>
      request(`/v1/reports/${id}/outcomes`, forwardHistorySchema, { signal }),
    enabled,
    retry: false,
  });
  return (
    <section>
      <h2>Будущие наблюдения</h2>
      <p>
        Измерения после отчёта проверяют правила. Падение цены и уменьшение USD-глубины не
        доказывают мошенничество. Точность эвристики ещё не подтверждена.
      </p>
      <button
        onClick={() => {
          setEnabled(true);
          if (enabled) void data.refetch();
        }}
        disabled={data.isFetching}
      >
        Загрузить наблюдения
      </button>
      {enabled && data.isPending && <p>Загрузка…</p>}
      {data.error && <p role="alert">{errorMessage(data.error)}</p>}
      {data.data?.length === 0 && (
        <p>Наблюдения ещё не запланированы или отчёт не является глубоким.</p>
      )}
      <ul>
        {data.data?.map((row) => (
          <li key={row.horizonSeconds}>
            {row.horizonSeconds / 3600} ч —{' '}
            {row.result
              ? `${row.result.status === 'observed' ? 'наблюдалось' : 'данных недостаточно'}; изменение цены ${row.result.priceReturnBps ?? 'неизвестно'} bps; USD-глубины ${row.result.liquidityChangeBps ?? 'неизвестно'} bps; предложения ${row.result.supplyDelta ?? 'неизвестно'} raw. Время: ${row.result.current.observedAt}. Причины: ${row.result.reasons.join(', ')}`
              : `ожидается после ${new Date(row.dueAt).toLocaleString()}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
