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
import { Bug, ScanLine, Bookmark, BookOpen, Activity, FileSearch } from 'lucide-react';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './base.css';
const root = createRootRoute({
  component: Layout,
  notFoundComponent: () => (
    <p role="alert">
      Page not found. <Link to="/">Open scanner</Link>
    </p>
  ),
  errorComponent: () => (
    <p role="alert">
      Unable to open this page. <a href="/">Return to scanner</a>
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
    document.title = `${location.startsWith('/report') ? 'Report' : location.startsWith('/token') ? 'Token' : 'Scanner'} · CrawlSpider`;
    document.getElementById('content')?.focus();
  }, [location]);
  return (
    <>
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <Bug size={24} aria-hidden="true" />
            CrawlSpider
          </Link>
          <nav aria-label="Main navigation">
            <Link to="/" activeOptions={{ exact: true }}>
              <ScanLine size={16} aria-hidden="true" />
              Scanner
            </Link>
            <Link to="/watchlist">
              <Bookmark size={16} aria-hidden="true" />
              Watchlist
            </Link>
            <Link to="/methodology">
              <BookOpen size={16} aria-hidden="true" />
              Methodology
            </Link>
            <Link to="/status">
              <Activity size={16} aria-hidden="true" />
              Services
            </Link>
          </nav>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <span>CrawlSpider · Solana</span>
        <span>Distribution risk - a heuristic.</span>
      </footer>
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
    <form className="scanner-form" onSubmit={submit} aria-label="Token scanner" aria-busy={busy}>
      <label htmlFor="token-input">Mint or pump.fun / Axiom / GMGN link</label>
      <input
        id="token-input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        required
        maxLength={512}
        autoComplete="off"
        spellCheck={false}
        placeholder="Mint address or https://pump.fun/coin/…"
        aria-describedby="scan-help"
        aria-invalid={!!error}
      />
      <div className="scan-controls">
        <div className="mode-field">
          <label htmlFor="mode">Mode </label>
          <select
            id="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'preview' | 'deep')}
          >
            <option value="deep">Deep analysis</option>
            <option value="preview">Preview analysis</option>
          </select>
        </div>
        <button className="primary" type="submit" disabled={busy || !available} aria-busy={busy}>
          {busy ? 'Submitting…' : 'Scan'}
        </button>
      </div>
      <p className="helper" id="scan-help">
        Preview checks distribution and markets. Deep analysis adds available wallet history and
        relationships.
      </p>
      {status.isPending ? (
        <p role="status">Checking scanner availability…</p>
      ) : (
        !available && (
          <p role="status">
            {status.error
              ? errorMessage(status.error)
              : 'Scanning is temporarily unavailable: data sources are not connected yet or services are recovering.'}
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
      <div className="page-heading">
        <h1>Solana token scanner</h1>
        <p>Holder distribution, wallet relationships and on-chain evidence.</p>
      </div>
      <div className="scanner-workspace">
        <div>
          <Scanner />
          <details>
            <summary>Supported links</summary>
            <p>
              pump.fun/coin/… · gmgn.ai/sol/token/… · axiom.trade/meme/…?chain=sol or a mint
              address. For unsupported pools, use the mint.
            </p>
          </details>
        </div>
        <Queue />
      </div>
      <section className="recent-reports">
        <h2>Recent reports</h2>
        {recent.isPending && <p role="status">Loading…</p>}
        {recent.error && <p role="alert">{errorMessage(recent.error)}</p>}
        {recent.data?.length === 0 && (
          <div className="empty-state">
            <FileSearch size={24} aria-hidden="true" />
            <p>
              <strong>No completed scans yet.</strong>
            </p>
            <p>Completed reports will appear here with their timestamps and data quality.</p>
          </div>
        )}
        <ul className="report-list">
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
    <section className="queue-panel">
      <h2>Queue</h2>
      {queue.error ? (
        <p role="alert">{errorMessage(queue.error)}</p>
      ) : !queue.data ? (
        <p role="status">Loading queue…</p>
      ) : (
        <>
          <p>
            Queued:{' '}
            {queue.data.lanes.filter((l) => l.state === 'queued').reduce((n, l) => n + l.count, 0)}.
            Running:{' '}
            {queue.data.lanes.filter((l) => l.state === 'running').reduce((n, l) => n + l.count, 0)}
            . Capacity: {queue.data.capacity}.
          </p>
          <p>See the status page for data source availability.</p>
        </>
      )}
    </section>
  );
}
function Token() {
  const { mint } = token.useParams(),
    { job } = token.useSearch();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))
    return <p role="alert">Invalid Solana address.</p>;
  return (
    <>
      <h1>Token {mint}</h1>
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
        {errorMessage(query.error)} <button onClick={() => void query.refetch()}>Retry</button>
      </p>
    );
  if (!query.data) return <p role="status">Loading report…</p>;
  return query.data.report && query.data.report.identity.mint === mint ? (
    <ReportView report={query.data.report} />
  ) : (
    <p>No report exists for this token yet. Start a scan.</p>
  );
}
function Live({ id, mint }: { id: string; mint: string }) {
  const { job, report, error, connection } = useLiveJob(id),
    [cancelError, setCancelError] = useState(''),
    [cancelling, setCancelling] = useState(false);
  if (job && job.mint !== mint) return <p role="alert">This scan belongs to another token.</p>;
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
      <section aria-label="Scan status">
        <h2>Scan {id}</h2>
        <p role="status">
          {job
            ? `${stateLabel[job.state]} · ${phaseLabel[job.phase] || job.phase}`
            : 'Loading status…'}
        </p>
        <p>{connection}</p>
        {job?.deadlineAt && active && (
          <p>
            Deadline: {date(job.deadlineAt)}. Attempt: {job.attempt}.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {job?.errorCode && <p role="alert">Code: {job.errorCode}. You can start a new scan.</p>}
        {active && capability && (
          <button disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel scan'}
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
      <h1>Historical report</h1>
      {query.error ? (
        <p role="alert">
          {errorMessage(query.error)} <button onClick={() => void query.refetch()}>Retry</button>
        </p>
      ) : query.data ? (
        <ReportView report={query.data} historical />
      ) : (
        <p role="status">Loading report…</p>
      )}
    </>
  );
}
function Status() {
  const query = useResource('/v1/status', serviceStatusSchema, true);
  return (
    <>
      <h1>Service status</h1>
      {query.error ? (
        <p role="alert">{errorMessage(query.error)}</p>
      ) : !query.data ? (
        <p role="status">Checking…</p>
      ) : (
        <>
          <p role="status">
            {query.data.status === 'ready' ? 'Infrastructure available' : 'Service degraded'}
          </p>
          <ul>
            {Object.entries(query.data.dependencies).map(([name, ok]) => (
              <li key={name}>
                {name}: {ok ? 'available' : 'unavailable'}
              </li>
            ))}
          </ul>
          <h2>Data sources and channels</h2>
          <ul>
            {Object.entries(query.data.capabilities).map(([name, ok]) => (
              <li key={name}>
                {name}: {ok ? 'configured' : 'not connected'}
              </li>
            ))}
          </ul>
          <p>
            “Configured” means settings are present. A completed scan confirms external source
            availability.
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
      <h1>Methodology</h1>
      <p>
        Distribution risk is a heuristic score from 0 to 100: higher values indicate more observed
        signs of concentration and coordination. It is not a probability of fraud. Rules have not
        yet been calibrated against future outcomes.
      </p>
      <p>
        Data completeness is assessed separately. The score is unavailable when required data is
        insufficient. Missing history does not mean no trading occurred, and an incomplete sample
        does not prove safe distribution.
      </p>
      <p>
        A holder balance combines its token accounts. The denominator is indexed balances minus
        verified infrastructure. A paginated snapshot is not atomic; the report includes the slot
        range and supply reconciliation.
      </p>
      <p>
        Transactions confirm interactions between addresses. A shared payer or similar purchases
        alone do not prove shared ownership. Common-control groups remain hypotheses.
      </p>
      <p>
        Early buyers are identified within the observed history window. Ordering within a slot
        requires block data. Unknown ordering does not confirm an early entry.
      </p>
      <p>
        A ranking change is not a sale. Comparisons require compatible complete snapshots; buys,
        sells, transfers, mints and burns are distinguished by actual instructions.
      </p>
      <p>
        Scenarios model selling 25%, 50% and 100% of the flagged balance in supported markets with
        verified reserves and fees. They do not predict holder actions. Unknown markets and token
        extensions may prevent calculation. External USD charts are not used in these calculations.
      </p>
      <p>
        Each report includes rule versions, trigger conditions, reasons for unknown values,
        timestamps and evidence.
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
