import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { serviceStatusSchema, type ServiceStatus } from '@crawlspider/contracts';

function App() {
  const [status, setStatus] = useState<ServiceStatus>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/v1/status`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => setStatus(serviceStatusSchema.parse(data)))
      .catch(() => {
        if (!controller.signal.aborted) setError('API недоступен');
      });
    return () => controller.abort();
  }, []);
  return (
    <main>
      <h1>CrawlSpider</h1>
      <p>Функциональная основа. Дизайн ожидает design.md.</p>
      <h2>Состояние сервисов</h2>
      <p role="status">{error || status?.status || 'Проверяем…'}</p>
      {status && (
        <>
          <p>
            PostgreSQL: {String(status.dependencies.postgres)} · Redis:{' '}
            {String(status.dependencies.redis)}
          </p>
          <p>
            RPC: {String(status.capabilities.rpc)} · Индекс держателей:{' '}
            {String(status.capabilities.holderIndex)}
          </p>
        </>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
