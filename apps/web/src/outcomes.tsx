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
      <h2>Follow-up observations</h2>
      <p>
        Measurements after a report help evaluate rules. Price drops and reduced USD depth do not
        prove fraud. The heuristic has not yet demonstrated accuracy.
      </p>
      <button
        onClick={() => {
          setEnabled(true);
          if (enabled) void data.refetch();
        }}
        disabled={data.isFetching}
      >
        Load observations
      </button>
      {enabled && data.isPending && <p>Loading…</p>}
      {data.error && <p role="alert">{errorMessage(data.error)}</p>}
      {data.data?.length === 0 && (
        <p>Observations are not scheduled yet or this is not a deep report.</p>
      )}
      <ul>
        {data.data?.map((row) => (
          <li key={row.horizonSeconds}>
            {row.horizonSeconds / 3600} h -{' '}
            {row.result
              ? `${row.result.status === 'observed' ? 'observed' : 'insufficient data'}; price change ${row.result.priceReturnBps ?? 'unknown'} bps; USD depth ${row.result.liquidityChangeBps ?? 'unknown'} bps; supply ${row.result.supplyDelta ?? 'unknown'} raw. Time: ${row.result.current.observedAt}. Reasons: ${row.result.reasons.join(', ')}`
              : `pending after ${new Date(row.dueAt).toLocaleString('en-US')}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
