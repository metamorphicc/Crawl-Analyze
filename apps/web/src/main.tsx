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
import { CrawlStage } from './crawl-stage.js';
import { SiteBackground } from './site-background.js';
import { ReportArrival } from './report-arrival.js';
import { Watchlist } from './watches.js';
import { ScanLine, Bookmark, BookOpen, Activity, Menu, ArrowUpRight } from 'lucide-react';
import { SpiderCanvas, SpiderEnvironment, SpiderMark, useSpiderActivity } from './spiders.js';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './base.css';
import './workbench.css';
import './identity.css';
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
    <SpiderEnvironment route={location}>
      <SiteBackground />
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link to="/" className="brand">
            <SpiderMark />
            CrawlSpider
          </Link>
          <span className="brand-descriptor">Solana field intelligence</span>
          <details className="site-menu" key={location}>
            <summary aria-label="Open navigation menu">
              <Menu size={18} aria-hidden="true" />
              <span>Menu</span>
            </summary>
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
          </details>
        </div>
      </header>
      <main id="content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="footer-brand">
          <SpiderMark size={22} />
          <span>CrawlSpider</span>
        </div>
        <div>
          <span>Read-only Solana intelligence.</span>
          <small>Distribution risk - a heuristic.</small>
        </div>
        <Link to="/methodology">
          Read the methodology <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </footer>
    </SpiderEnvironment>
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
      <div className="mint-entry">
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
        <button className="primary" type="submit" disabled={busy || !available} aria-busy={busy}>
          {busy ? 'Submitting…' : 'Scan'} <ArrowUpRight size={17} aria-hidden="true" />
        </button>
      </div>
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
        <span className="scan-note">Read-only · No wallet connection</span>
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
      <section className="scanner-hero">
        <SpiderCanvas />
        <div className="hero-copy">
          <div className="hero-network" data-crawl-anchor>
            <span className="network-dot" /> Solana / Read-only intelligence
          </div>
          <p className="field-eyebrow">THE CRAWLSPIDER FIELD JOURNAL</p>
          <h1 className="hero-title">
            <span className="hero-line">Every wallet</span>{' '}
            <span className="hero-line">
              leaves a <span className="thread-word">thread.</span>
            </span>
          </h1>
          <p className="hero-description">
            Pull one. See who holds the supply, where the money came from, and which wallets keep
            crossing paths.
          </p>
          <div className="hero-trace-key" aria-label="Analysis areas">
            <span>01 / Distribution</span>
            <span>02 / History</span>
            <span>03 / Connections</span>
          </div>
          <a className="hero-journal-link" href="#recent-crawls">
            Explore the field journal <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
        <div className="hero-scanner" data-crawl-anchor>
          <div className="scanner-heading">
            <span className="field-eyebrow">START AN INVESTIGATION</span>
            <ScanLine size={22} aria-hidden="true" />
          </div>
          <h2>Pick up the thread.</h2>
          <p className="scanner-intro">One token. Its wallets, history and evidence.</p>
          <Scanner />
          <div className="scanner-footnote">
            <span>pump.fun</span>
            <span>Axiom</span>
            <span>GMGN</span>
            <span>Solana mint</span>
          </div>
          <details className="supported-links">
            <summary>Supported link formats</summary>
            <p>
              pump.fun/coin/… · gmgn.ai/sol/token/… · axiom.trade/meme/…?chain=sol or a mint
              address. For unsupported pools, use the mint.
            </p>
          </details>
        </div>
        <div className="hero-baseline">
          <span>FOLLOW THE EVIDENCE</span>
          <span>Interactions are observable. Identity remains a hypothesis.</span>
        </div>
      </section>
      <div className="home-feed-grid">
        <section id="recent-crawls" className="recent-reports" data-crawl-anchor>
          <div className="feed-heading">
            <h2>Field journal</h2>
            <span>Open a saved report</span>
          </div>
          {recent.isPending && <p role="status">Loading…</p>}
          {recent.error && <p role="alert">{errorMessage(recent.error)}</p>}
          {recent.data?.length === 0 && (
            <div className="empty-state">
              <SpiderMark size={38} />
              <p>
                <strong>No completed scans yet.</strong>
              </p>
              <p>Completed reports will appear here with their timestamps and data quality.</p>
            </div>
          )}
          <ul className="report-list">
            {recent.data?.map((r) => (
              <li key={r.id} className="report-row">
                <Link
                  to="/report/$id"
                  params={{ id: r.id }}
                  title={r.mint}
                  aria-label={`Open report for ${r.mint}`}
                >
                  <span className="report-mint">
                    {r.mint.slice(0, 7)}…{r.mint.slice(-5)}
                  </span>
                </Link>{' '}
                <span className="report-mode">{stateLabel[r.mode]}</span>
                <span className={`report-state report-state-${r.state}`}>
                  {stateLabel[r.state]}
                </span>
                <time dateTime={r.observedAt}>{date(r.observedAt)}</time>
              </li>
            ))}
          </ul>
        </section>
        <Queue />
      </div>
      <section className="crawl-explainer">
        <div className="explainer-heading">
          <SpiderMark size={28} />
          <h2>Four passes. One trail.</h2>
        </div>
        <ol className="crawl-steps">
          <li>
            <h3>Read the holders</h3>
            <p>
              Combine token accounts by owner. Separate verified infrastructure and show snapshot
              coverage.
            </p>
            <span>Balances · Concentration · Supply</span>
          </li>
          <li>
            <h3>Walk the history</h3>
            <p>
              Look at available trades, early entries and funding traces. Missing history stays
              unknown.
            </p>
            <span>Trades · Entries · Funding</span>
          </li>
          <li>
            <h3>Follow the links</h3>
            <p>
              Trace transfers and shared funding. Common control remains a hypothesis, with evidence
              attached.
            </p>
            <span>Interactions · Hypotheses</span>
          </li>
          <li>
            <h3>Inspect the findings</h3>
            <p>
              Review distribution risk and sell scenarios. Open transactions or continue in Axiom
              and GMGN.
            </p>
            <Link to="/methodology">
              How the rules work <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </li>
        </ol>
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
      <div className="token-workbench-heading">
        <Link to="/">← Scanner</Link>
        <h1>Token analysis</h1>
      </div>
      <details className="rescan-panel">
        <summary>Scan another token or change analysis mode</summary>
        <Scanner key={mint} initial={mint} />
      </details>
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
  const { job, report, events, error, connection } = useLiveJob(id),
    [cancelError, setCancelError] = useState(''),
    [cancelling, setCancelling] = useState(false);
  const { setActivity } = useSpiderActivity();
  useEffect(() => {
    setActivity(job && job.mint === mint ? { id, state: job.state, phase: job.phase } : null);
    return () => setActivity(null);
  }, [id, mint, job?.mint, job?.state, job?.phase, setActivity]);
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
      <CrawlStage
        mint={mint}
        job={job}
        report={report}
        events={events}
        connection={connection}
        error={error}
      >
        {active && capability && (
          <button disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel scan'}
          </button>
        )}
      </CrawlStage>
      {cancelError && <p role="alert">{cancelError}</p>}
      {report && (
        <ReportArrival
          reportId={report.id}
          ready={Boolean(
            job &&
            ['complete', 'partial'].includes(job.state) &&
            job.reportId === report.id &&
            report.jobId === id &&
            report.identity.mint === mint,
          )}
        >
          <ReportView key={report.id} report={report} provisional={report.id !== job?.reportId} />
        </ReportArrival>
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
