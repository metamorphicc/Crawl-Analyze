import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  Link,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import {
  serviceStatusSchema,
  queueStatusSchema,
  scanAcceptanceSchema,
  cancellationSchema,
  reportSchema,
  recentReportsSchema,
  type AnalysisReport,
} from '@crawlspider/contracts';
import { request, useResource, errorMessage, saveCancellation, cancellation } from './api.js';
import { date, stateLabel, phaseLabel } from './format.js';
import { useLiveJob } from './live.js';
import { ReportView } from './report.js';
import { Watchlist } from './watches.js';
import './base.css';
const root = createRootRoute({
  component: Layout,
  notFoundComponent: () => (
    <p role="alert">
      Страница не найдена. <Link to="/">Открыть сканер</Link>
    </p>
  ),
  errorComponent: () => (
    <p role="alert">
      Не удалось открыть страницу. <a href="/">Вернуться к сканеру</a>
    </p>
  ),
});
const home = createRoute({ getParentRoute: () => root, path: '/', component: Home });
const token = createRoute({
  getParentRoute: () => root,
  path: '/token/$mint',
  validateSearch: (search: Record<string, unknown>) => ({
    job:
      typeof search.job === 'string' &&
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(search.job)
        ? search.job
        : undefined,
  }),
  component: Token,
});
const historical = createRoute({
  getParentRoute: () => root,
  path: '/report/$id',
  component: Historical,
});
const statusRoute = createRoute({ getParentRoute: () => root, path: '/status', component: Status });
const methodology = createRoute({
  getParentRoute: () => root,
  path: '/methodology',
  component: Methodology,
});
const watchlist = createRoute({
  getParentRoute: () => root,
  path: '/watchlist',
  component: Watchlist,
});
const router = createRouter({
  routeTree: root.addChildren([home, token, historical, statusRoute, methodology, watchlist]),
  defaultPreload: 'intent',
  scrollRestoration: true,
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
function Layout() {
  const location = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    document.title = `${location.startsWith('/report') ? 'Отчёт' : location.startsWith('/token') ? 'Токен' : 'Сканер'} · CrawlSpider`;
    document.getElementById('content')?.focus();
  }, [location]);
  return (
    <>
      <a className="skip" href="#content">
        К содержимому
      </a>
      <header>
        <nav aria-label="Основная навигация">
          <Link to="/">CrawlSpider / Сканер</Link>
          <Link to="/watchlist">Наблюдение</Link>
          <Link to="/methodology">Методология</Link>
          <Link to="/status">Состояние сервисов</Link>
        </nav>
      </header>
      <main id="content" tabIndex={-1}>
        <Outlet />
      </main>
    </>
  );
}
function Scanner({ initial = '' }: { initial?: string }) {
  const [input, setInput] = useState(initial),
    [mode, setMode] = useState<'preview' | 'deep'>('deep'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigate = useNavigate(),
    status = useResource('/v1/status', serviceStatusSchema, true);
  const available =
    status.data?.capabilities.rpc &&
    status.data?.capabilities.holderIndex &&
    status.data.status === 'ready';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const accepted = await request('/v1/scans', scanAcceptanceSchema, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, mode }),
      });
      saveCancellation(accepted.job.id, accepted.cancelToken);
      await navigate({
        to: '/token/$mint',
        params: { mint: accepted.job.mint },
        search: { job: accepted.job.id },
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-label="Сканирование токена">
      <label htmlFor="token-input">Mint или ссылка pump.fun / Axiom / GMGN</label>
      <input
        id="token-input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        required
        maxLength={512}
        autoComplete="off"
        spellCheck={false}
      />
      <label htmlFor="mode">Режим </label>
      <select
        id="mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'preview' | 'deep')}
      >
        <option value="deep">Глубокий анализ</option>
        <option value="preview">Предварительный анализ</option>
      </select>{' '}
      <button type="submit" disabled={busy || !available}>
        {busy ? 'Отправляем…' : 'Сканировать'}
      </button>
      <p>
        Предварительный режим проверяет распределение и рынки. Глубокий добавляет доступную историю
        и связи кошельков.
      </p>
      {status.isPending ? (
        <p role="status">Проверяем доступность сканирования…</p>
      ) : (
        !available && (
          <p role="status">
            {status.error
              ? errorMessage(status.error)
              : 'Сканирование временно недоступно: источники данных ещё не подключены или сервисы восстанавливаются.'}
          </p>
        )
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function Home() {
  const recent = useResource('/v1/reports', recentReportsSchema, true);
  return (
    <>
      <h1>Сканер Solana-токенов</h1>
      <Scanner />
      <details>
        <summary>Поддерживаемые ссылки</summary>
        <p>
          pump.fun/coin/… · gmgn.ai/sol/token/… · axiom.trade/meme/…?chain=sol или адрес mint. Для
          неподдерживаемого пула используйте mint.
        </p>
      </details>
      <Queue />
      <section>
        <h2>Последние отчёты</h2>
        {recent.isPending && <p role="status">Загружаем…</p>}
        {recent.error && <p role="alert">{errorMessage(recent.error)}</p>}
        {recent.data?.length === 0 && <p>Завершённых сканов пока нет.</p>}
        <ul>
          {recent.data?.map((r) => (
            <li key={r.id}>
              <Link to="/report/$id" params={{ id: r.id }}>
                {r.mint}
              </Link>{' '}
              · {date(r.observedAt)} · {stateLabel[r.mode]} · {stateLabel[r.state]}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
function Queue() {
  const queue = useResource('/v1/queue', queueStatusSchema, true);
  return (
    <section>
      <h2>Очередь</h2>
      {queue.error ? (
        <p role="alert">{errorMessage(queue.error)}</p>
      ) : !queue.data ? (
        <p role="status">Загружаем очередь…</p>
      ) : (
        <>
          <p>
            Ожидают:{' '}
            {queue.data.lanes.filter((l) => l.state === 'queued').reduce((n, l) => n + l.count, 0)}.
            Выполняются:{' '}
            {queue.data.lanes.filter((l) => l.state === 'running').reduce((n, l) => n + l.count, 0)}
            . Вместимость: {queue.data.capacity}.
          </p>
          <p>Доступность источников указана на странице состояния.</p>
        </>
      )}
    </section>
  );
}
function Token() {
  const { mint } = token.useParams(),
    { job } = token.useSearch();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
    return <p role="alert">Некорректный адрес Solana.</p>;
  return (
    <>
      <h1>Токен {mint}</h1>
      <Scanner key={mint} initial={mint} />
      {job ? <Live key={job} id={job} mint={mint} /> : <Latest key={mint} mint={mint} />}
    </>
  );
}
const latestSchema = {
  parse(value: unknown): { report: AnalysisReport | null } {
    if (!value || typeof value !== 'object' || !('report' in value)) throw new Error();
    return { report: value.report === null ? null : reportSchema.parse(value.report) };
  },
};
function Latest({ mint }: { mint: string }) {
  const query = useResource(`/v1/tokens/${encodeURIComponent(mint)}/latest`, latestSchema);
  if (query.error)
    return (
      <p role="alert">
        {errorMessage(query.error)}{' '}
        <button onClick={() => void query.refetch()}>Повторить загрузку</button>
      </p>
    );
  if (!query.data) return <p role="status">Загружаем отчёт…</p>;
  return query.data.report && query.data.report.identity.mint === mint ? (
    <ReportView report={query.data.report} />
  ) : (
    <p>Отчёт по токену ещё не создан. Запустите сканирование.</p>
  );
}
function Live({ id, mint }: { id: string; mint: string }) {
  const { job, report, error, connection } = useLiveJob(id),
    [cancelError, setCancelError] = useState(''),
    [cancelling, setCancelling] = useState(false);
  if (job && job.mint !== mint) return <p role="alert">Этот скан относится к другому токену.</p>;
  const active = job && ['queued', 'running'].includes(job.state),
    capability = cancellation(id);
  async function cancel() {
    if (!capability) return;
    setCancelling(true);
    setCancelError('');
    try {
      await request(`/v1/scans/${id}/cancel`, cancellationSchema, {
        method: 'POST',
        headers: { 'x-scan-cancel-token': capability },
      });
    } catch (e) {
      setCancelError(errorMessage(e));
    } finally {
      setCancelling(false);
    }
  }
  return (
    <>
      <section aria-label="Состояние скана">
        <h2>Скан {id}</h2>
        <p role="status">
          {job
            ? `${stateLabel[job.state]} · ${phaseLabel[job.phase] || job.phase}`
            : 'Загружаем состояние…'}
        </p>
        <p>{connection}</p>
        {job?.deadlineAt && active && (
          <p>
            Предельное время: {date(job.deadlineAt)}. Попытка: {job.attempt}.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {job?.errorCode && <p role="alert">Код: {job.errorCode}. Можно запустить новый скан.</p>}
        {active && capability && (
          <button disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Отменяем…' : 'Отменить скан'}
          </button>
        )}
        {cancelError && <p role="alert">{cancelError}</p>}
      </section>
      {report && (
        <ReportView key={report.id} report={report} provisional={report.id !== job?.reportId} />
      )}
    </>
  );
}
function Historical() {
  const { id } = historical.useParams(),
    query = useResource(`/v1/reports/${encodeURIComponent(id)}`, reportSchema);
  return (
    <>
      <h1>Исторический отчёт</h1>
      {query.error ? (
        <p role="alert">
          {errorMessage(query.error)}{' '}
          <button onClick={() => void query.refetch()}>Повторить загрузку</button>
        </p>
      ) : query.data ? (
        <ReportView report={query.data} historical />
      ) : (
        <p role="status">Загружаем отчёт…</p>
      )}
    </>
  );
}
function Status() {
  const query = useResource('/v1/status', serviceStatusSchema, true);
  return (
    <>
      <h1>Состояние сервисов</h1>
      {query.error ? (
        <p role="alert">{errorMessage(query.error)}</p>
      ) : !query.data ? (
        <p role="status">Проверяем…</p>
      ) : (
        <>
          <p role="status">
            {query.data.status === 'ready' ? 'Инфраструктура доступна' : 'Работа ограничена'}
          </p>
          <ul>
            {Object.entries(query.data.dependencies).map(([name, ok]) => (
              <li key={name}>
                {name}: {ok ? 'доступен' : 'недоступен'}
              </li>
            ))}
          </ul>
          <h2>Источники и каналы</h2>
          <ul>
            {Object.entries(query.data.capabilities).map(([name, ok]) => (
              <li key={name}>
                {name}: {ok ? 'настроен' : 'не подключён'}
              </li>
            ))}
          </ul>
          <p>
            «Настроен» означает наличие конфигурации. Доступность внешнего источника подтверждает
            выполненный скан.
          </p>
        </>
      )}
      <Queue />
    </>
  );
}
function Methodology() {
  return (
    <>
      <h1>Методология</h1>
      <p>
        Риск распределения — эвристический балл от 0 до 100: больше означает больше наблюдаемых
        признаков концентрации и координации. Это не вероятность мошенничества. Правила ещё не
        откалиброваны по будущим исходам.
      </p>
      <p>
        Полнота данных оценивается отдельно. Если обязательных данных недостаточно, балл недоступен.
        Отсутствующая история не означает отсутствие торговли, а неполная выборка не доказывает
        безопасное распределение.
      </p>
      <p>
        Баланс держателя объединяет его токен-аккаунты. Знаменатель — проиндексированные балансы за
        вычетом подтверждённой инфраструктуры. Постраничный снимок не атомарен; диапазон слотов и
        сверка supply указаны в отчёте.
      </p>
      <p>
        Транзакции подтверждают взаимодействие адресов. Общий плательщик или похожие покупки сами по
        себе не доказывают одного владельца. Группы общего контроля остаются гипотезами.
      </p>
      <p>
        Ранние покупатели определяются в прочитанном окне истории. Порядок внутри слота требует
        данных блока. Неизвестный порядок не является подтверждённым ранним входом.
      </p>
      <p>
        Изменение места в рейтинге не является продажей. Сравнение требует совместимых полных
        снимков; покупка, продажа, перевод, выпуск и сжигание различаются по фактическим
        инструкциям.
      </p>
      <p>
        Сценарии моделируют продажу 25%, 50% и 100% отмеченного баланса в поддерживаемых рынках с
        проверенными резервами и комиссиями. Они не предсказывают действия держателей. Неизвестные
        рынки и расширения токенов могут сделать расчёт недоступным. USD-график внешнего источника
        не используется в этих расчётах.
      </p>
      <p>
        Версии правил, условия срабатывания, причины неизвестных значений, время и доказательства
        доступны в каждом отчёте.
      </p>
    </>
  );
}
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10000, refetchOnWindowFocus: false } },
});
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
