import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  serviceStatusSchema,
  resolvedInputSchema,
  type ServiceStatus,
  type ResolvedInput,
} from '@crawlspider/contracts';

function App() {
  const [status, setStatus] = useState<ServiceStatus>();
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [resolved, setResolved] = useState<ResolvedInput>();
  const [busy, setBusy] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const resolve = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResolveError('');
    setResolved(undefined);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/v1/resolve`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
          signal: AbortSignal.timeout(20000),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(typeof data.message === 'string' ? data.message : 'Ошибка проверки токена');
      setResolved(resolvedInputSchema.parse(data));
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : 'Ошибка подключения');
    } finally {
      setBusy(false);
    }
  };
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
      <form onSubmit={resolve}>
        <label htmlFor="token">Mint или ссылка pump.fun / Axiom / GMGN</label>
        <input
          id="token"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          required
          maxLength={512}
        />
        <button disabled={busy} type="submit">
          {busy ? 'Проверяем…' : 'Проверить токен'}
        </button>
      </form>
      {resolveError && <p role="alert">{resolveError}</p>}
      {resolved && (
        <section>
          <h2>Подтверждённый mint</h2>
          <p>{resolved.identity.mint}</p>
          <p>
            Decimals: {resolved.identity.decimals} · Supply (raw): {resolved.identity.supply}
          </p>
          <p>
            Mint authority: {resolved.identity.mintAuthority || 'отозвана'} · Freeze authority:{' '}
            {resolved.identity.freezeAuthority || 'отозвана'}
          </p>
          <nav aria-label="Терминалы">
            {Object.entries(resolved.links).map(([name, url]) => (
              <React.Fragment key={name}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {name}
                </a>{' '}
              </React.Fragment>
            ))}
          </nav>
        </section>
      )}
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
