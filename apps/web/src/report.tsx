import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { AnalysisReport, RelationshipEdge } from '@crawlspider/contracts';
import { date, percent, safeLink, units, stateLabel } from './format.js';
import { Outcomes } from './outcomes.js';
import { ReportMetrics, ReportOverview } from './report-overview.js';
import { RelationshipMap } from './relationship-map.js';
import { shortAddress, shareBps, WalletFlags } from './wallet-view.js';
import { ArrowUpRight, Download, Copy, Eye } from 'lucide-react';
const PriceChart = lazy(() =>
  import('./price-chart.js').then((module) => ({ default: module.PriceChart })),
);
export function External({ url, children }: { url: string; children: ReactNode }) {
  const safe = safeLink(url);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children} (link unavailable)</span>
  );
}
const ownerLink = (owner: string) => (
  <External url={`https://solscan.io/account/${owner}`}>
    <abbr title={owner}>{shortAddress(owner)}</abbr>
  </External>
);
function Reasons({ values }: { values: string[] }) {
  return values.length ? (
    <ul>
      {[...new Set(values)].map((v) => (
        <li key={v}>{v}</li>
      ))}
    </ul>
  ) : null;
}
function Table({
  title,
  heads,
  rows,
}: {
  title: string;
  heads: string[];
  rows: { id: string; cells: () => ReactNode[] }[];
}) {
  const [page, setPage] = useState(0),
    size = 25,
    pages = Math.max(1, Math.ceil(rows.length / size)),
    actual = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
        <table>
          <caption>
            {title} · {rows.length}
          </caption>
          <thead>
            <tr>
              {heads.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(actual * size, (actual + 1) * size).map((r) => (
              <tr key={r.id}>
                {r.cells().map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <p>No records in this report. This does not prove a lack of activity.</p>
      )}
      {pages > 1 && (
        <div className="actions">
          <button disabled={actual === 0} onClick={() => setPage(actual - 1)}>
            Previous page
          </button>
          <span role="status">
            Page {actual + 1} of {pages}
          </span>
          <button disabled={actual === pages - 1} onClick={() => setPage(actual + 1)}>
            Next page
          </button>
        </div>
      )}
    </>
  );
}
export function ReportView({
  report: r,
  provisional = false,
  historical = false,
}: {
  report: AnalysisReport;
  provisional?: boolean;
  historical?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [edge, setEdge] = useState<RelationshipEdge>(),
    [copied, setCopied] = useState(''),
    [chart, setChart] = useState(!provisional),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const quality = r.snapshot.quality,
    metrics = r.risk.metrics,
    stale = [
      r.observedAt,
      quality.observedAt,
      ...r.scenarios.scenarios.flatMap((s) => s.quotes.map((q) => q.observedAt)),
    ].some((time) => now - Date.parse(time) > 120000),
    decimals = r.identity.decimals;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(new URL(`/report/${r.id}`, location.origin).href);
      setCopied('Link copied');
    } catch {
      setCopied('Copying is unavailable. Open the report link and copy the page address.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = `crawlspider-${r.id}${provisional ? '-preview' : ''}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <article className="report-workbench" aria-label="Analysis report">
      <header className="report-token-header">
        <div className="report-token-identity">
          <span className="chain-badge">SOL</span>
          <div>
            <span className="field-eyebrow">
              {provisional ? 'WORK IN PROGRESS' : 'CRAWLSPIDER / FIELD REPORT'}
            </span>
            <h2>{shortAddress(r.identity.mint)}</h2>
            <p>
              {provisional
                ? 'Preview - analysis in progress'
                : historical
                  ? 'Saved report'
                  : 'Analysis report'}{' '}
              · {stateLabel[r.mode]} · {date(r.observedAt)}
            </p>
            <code className="report-mint">{r.identity.mint}</code>
          </div>
        </div>
        <nav aria-label="Terminals">
          {Object.entries(r.links).map(([name, url]) => (
            <External key={name} url={url}>
              {name === 'pump'
                ? 'pump.fun'
                : name === 'axiom'
                  ? 'Axiom'
                  : name === 'gmgn'
                    ? 'GMGN'
                    : 'Solscan'}
              <ArrowUpRight size={14} aria-hidden="true" />
            </External>
          ))}
        </nav>
      </header>
      {provisional && (
        <p className="report-notice" role="status">
          Intermediate scan result. The final report has not been saved yet.
        </p>
      )}
      {stale && (
        <p className="report-notice" role="status">
          Snapshot over 2 minutes old. Current balances and reserves may have changed.
        </p>
      )}
      {historical && (
        <p className="report-notice">Historical reports preserve values at the time of analysis.</p>
      )}
      <nav className="report-section-index" aria-label="Report sections">
        <a href={`#${r.id}-overview`}>
          <span>01</span> Findings
        </a>
        <a href={`#${r.id}-holders`}>
          <span>02</span> Wallets
        </a>
        <a
          href={`#${r.id}-web`}
          onClick={() => {
            const panel = document.getElementById(`${r.id}-web`);
            if (panel instanceof HTMLDetailsElement) panel.open = true;
          }}
        >
          <span>03</span> The web
        </a>
        <a href="#report-checks">
          <span>04</span> Evidence
        </a>
      </nav>
      <div id={`${r.id}-overview`} className="findings-heading">
        <div>
          <span className="field-eyebrow">01 / THE FINDINGS</span>
          <h3>What the crawl found.</h3>
        </div>
        <span>{provisional ? 'Still gathering evidence' : 'A snapshot, with the receipts.'}</span>
      </div>
      <ReportMetrics report={r} />
      <div className="report-findings">
        <section className="market-panel">
          <div className="panel-heading">
            <h3>Market chart</h3>
            <span>USD · 5-minute candles</span>
          </div>
          <p>
            External USD candles are displayed separately from the report snapshot and reserve
            calculations.
          </p>
          {chart ? (
            <Suspense fallback={<p role="status">Loading chart…</p>}>
              <PriceChart mint={r.identity.mint} />
            </Suspense>
          ) : (
            <button onClick={() => setChart(true)}>Load candles</button>
          )}
        </section>
        <aside className="verdict-panel" aria-label="Risk verdict">
          <ReportOverview report={r} />
          <div className="verdict-actions">
            {!provisional && (
              <button onClick={() => void share()}>
                <Copy size={15} />
                Copy link
              </button>
            )}
            <Link to="/">
              New scan <ArrowUpRight size={14} />
            </Link>
          </div>
          {copied && <p role="status">{copied}</p>}
        </aside>
      </div>
      <div className="report-columns">
        <section id={`${r.id}-holders`} className="holder-panel">
          <div className="panel-heading">
            <h3>
              <span className="panel-index">02 /</span> Wallet ledger
            </h3>
            <span>{metrics.ownerCount} indexed owners</span>
          </div>
          <p className="panel-caption">
            Flags describe observed evidence. Unread history does not mean a clean wallet.
          </p>
          <label htmlFor={`owner-search-${r.id}`}>Search holders</label>
          <input
            id={`owner-search-${r.id}`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value.trim())}
          />
          <Table
            key={search}
            title="Holders"
            heads={['Wallet', 'Share of eligible balance', 'Flags', 'Details']}
            rows={r.snapshot.holders
              .filter((h) => h.owner.includes(search))
              .map((h) => ({
                id: h.owner,
                cells: () => {
                  const eligible = (BigInt(h.amount) - BigInt(h.excludedAmount)).toString();
                  const share = shareBps(eligible, metrics.eligibleBalance);
                  return [
                    ownerLink(h.owner),
                    <div className="holder-share">
                      <span>{share === null ? 'unknown' : percent(share)}</span>
                      {share !== null && (
                        <meter
                          min={0}
                          max={10000}
                          value={share}
                          aria-label={percent(share) + ' of eligible balance'}
                        />
                      )}
                    </div>,
                    <WalletFlags report={r} owner={h.owner} />,
                    <details className="wallet-detail">
                      <summary>Inspect</summary>
                      <p>
                        Balance: {units(h.amount, decimals)} (raw: {h.amount}). Excluded:{' '}
                        {units(h.excludedAmount, decimals)}. Frozen / delegated:{' '}
                        {units(h.frozenAmount, decimals)} / {units(h.delegatedAmount, decimals)}.
                      </p>
                      <ul>
                        {h.accounts.map((address) => (
                          <li key={address}>{ownerLink(address)}</li>
                        ))}
                      </ul>
                    </details>,
                  ];
                },
              }))}
          />
        </section>
      </div>
      <details id={`${r.id}-web`} className="report-disclosure wallet-web-disclosure">
        <summary>
          03 / The wallet web · {r.graph.controlHypotheses.length} control hypotheses ·{' '}
          {r.graph.edges.length} evidence edges
        </summary>
        <RelationshipMap mint={r.identity.mint} report={r} onEvidence={setEdge} />
        <section>
          <h3>Relationships and evidence</h3>
          <p>
            Address interactions do not prove owner identity. Suspected common control and
            behavioral similarity remain hypotheses.
          </p>
          <Table
            title="Wallet relationships"
            heads={['From', 'To', 'Type / strength', 'Confidence', 'Evidence']}
            rows={r.graph.edges.map((e) => ({
              id: e.id,
              cells: () => [
                ownerLink(e.from),
                ownerLink(e.to),
                `${e.kind} / ${e.strength}`,
                e.confidence,
                <button onClick={() => setEdge(e)}>Open evidence</button>,
              ],
            }))}
          />
          <Table
            title="Common-control hypotheses"
            heads={['Group', 'Balance', 'Owners', 'Evidence']}
            rows={r.graph.controlHypotheses.map((h) => ({
              id: h.id,
              cells: () => [
                `${h.id} · identity not proven`,
                units(h.amount, decimals),
                h.owners.join(', '),
                h.evidenceIds.join(', '),
              ],
            }))}
          />
        </section>
      </details>
      <section className="early-panel">
        <h3>Early buyers</h3>
        {!r.earlyBuyers ? (
          <p>This data was not read for this report.</p>
        ) : (
          <>
            <p>
              Status: {r.earlyBuyers.status}. The observed window does not guarantee a complete list
              of buyers.
            </p>
            <Reasons values={r.earlyBuyers.reasons} />
            {r.earlyBuyers.launch && (
              <p>
                Observed launch:{' '}
                <External
                  url={`https://solscan.io/tx/${encodeURIComponent(r.earlyBuyers.launch.signature)}`}
                >
                  {r.earlyBuyers.launch.signature}
                </External>
                , slot {r.earlyBuyers.launch.slot}.
              </p>
            )}
            <Table
              title="First observed buys"
              heads={['Owner', 'Buy', 'Current balance', 'Order / early entry']}
              rows={r.earlyBuyers.buyers.map((b) => ({
                id: b.owner,
                cells: () => [
                  ownerLink(b.owner),
                  <>
                    <External url={`https://solscan.io/tx/${encodeURIComponent(b.signature)}`}>
                      {b.signature}
                    </External>
                    <p>
                      {units(b.amount, decimals)} · slot {b.slot}
                    </p>
                  </>,
                  units(b.currentBalance, decimals),
                  `${b.transactionOrder ?? 'order unknown'} / ${b.early === null ? 'unknown' : b.early ? 'confirmed within window' : 'no'} · ${b.entryClaim}`,
                ],
              }))}
            />
          </>
        )}
      </section>
      <section id="report-checks" className="criteria-panel">
        <div className="panel-heading">
          <h3>What the crawlers checked</h3>
          <span>
            {r.risk.rules.filter((rule) => rule.status === 'triggered').length} rules triggered
          </span>
        </div>
        <p className="panel-caption">
          Inspect the thresholds and the evidence behind each finding. Unknown criteria remain
          unknown.
        </p>
        <Table
          title="Risk criteria"
          heads={['Rule', 'Status / points', 'Threshold / observed', 'Evidence']}
          rows={r.risk.rules.map((rule) => ({
            id: rule.id,
            cells: () => [
              rule.id,
              `${rule.status} / ${rule.points}`,
              `${rule.threshold} / ${rule.observed ?? 'unknown'}`,
              <>
                {rule.evidenceIds.map((id) => {
                  const evidence = r.graph.edges.find((e) => e.id === id);
                  return evidence ? (
                    <button key={id} onClick={() => setEdge(evidence)}>
                      {id}
                    </button>
                  ) : (
                    <span key={id}>{id} </span>
                  );
                })}
              </>,
            ],
          }))}
        />
      </section>
      <details className="report-disclosure">
        <summary>Sell scenarios - reserves, fees and price impact</summary>
        <section>
          <h3>Sell scenarios</h3>
          <p>
            Scenario basis: flagged balance {units(r.scenarios.basisAmount, decimals)}. Model:{' '}
            {r.scenarios.modelVersion}. Time: {date(r.scenarios.observedAt)}. This is a calculation
            for known markets, not a sale prediction.
          </p>
          <Reasons values={r.scenarios.limitations} />
          {r.scenarios.scenarios.map((s) => (
            <details key={s.fractionBps} open>
              <summary>
                {percent(s.fractionBps)} of flagged balance · {units(s.baseIn, decimals)}
              </summary>
              {!s.quotes.length && <p>Supported markets are unavailable.</p>}
              {s.quotes.map((q) => (
                <div key={q.market}>
                  <p>
                    {q.venue} · {q.market} · slot {q.slot} · {stateLabel[q.status]}. Quote mint:{' '}
                    {q.quoteMint}.
                  </p>
                  {q.status === 'unavailable' ? (
                    <Reasons values={q.reasons} />
                  ) : (
                    <>
                      <p>
                        Output: {q.quoteUnits ?? `${q.netQuoteOut} raw (decimals unknown)`}; minimum
                        raw: {q.minQuoteOut}. Spot price change, bps: {q.postSpotDropBps}; execution
                        impact, bps: {q.executionImpactBps}.
                      </p>
                      <p>
                        Fees raw: LP {q.fees.lp}, protocol {q.fees.protocol}, creator{' '}
                        {q.fees.creator}. Reserves raw: effective {q.effectiveQuoteReserve};
                        available {q.realQuoteAvailable}.
                      </p>
                      <Reasons values={q.assumptions} />
                    </>
                  )}
                </div>
              ))}
              {s.routes.map((route) => (
                <p key={`${route.kind}:${route.quoteMint}`}>
                  {route.kind} · quote {route.quoteMint} · output {route.netQuoteOut} raw ·{' '}
                  {route.legs.length} markets; attainable in the model, global optimum not proven.
                </p>
              ))}
            </details>
          ))}
        </section>
      </details>
      <details className="report-disclosure">
        <summary>Position changes - compare observed snapshots</summary>
        <section>
          <h3>Position changes</h3>
          {!r.changes ? (
            <p>No comparison has been performed yet.</p>
          ) : (
            <>
              <p>
                Snapshots {r.changes.comparable ? 'comparable' : 'not comparable'}. A ranking change
                does not mean a sale.
              </p>
              {r.changes.previousReportId && (
                <Link to="/report/$id" params={{ id: r.changes.previousReportId }}>
                  Previous report
                </Link>
              )}
              <Reasons values={r.changes.reasons} />
              <Table
                title="Balance changes"
                heads={['Owner', 'Before', 'After', 'Difference', 'Unexplained difference']}
                rows={r.changes.positions.map((p) => ({
                  id: p.owner,
                  cells: () => [
                    ownerLink(p.owner),
                    units(p.before, decimals),
                    units(p.after, decimals),
                    units(p.delta, decimals),
                    units(p.unexplainedDelta, decimals),
                  ],
                }))}
              />
              <Table
                title="Observed movements"
                heads={['Owner / counterparty', 'Type', 'Amount', 'Slot / transaction', 'Basis']}
                rows={r.changes.movements.map((m) => ({
                  id: m.id,
                  cells: () => [
                    `${m.owner} / ${m.counterparty ?? 'unknown'}`,
                    m.kind,
                    units(m.amount, decimals),
                    m.signature ? (
                      <External url={`https://solscan.io/tx/${encodeURIComponent(m.signature)}`}>
                        {m.slot ?? '?'} · {m.signature}
                      </External>
                    ) : (
                      'unknown'
                    ),
                    `${m.explanation}${m.controlHypothesis ? ` · hypothesis ${m.controlHypothesis}; identity not proven` : ''}`,
                  ],
                }))}
              />
            </>
          )}
        </section>
      </details>
      <details className="report-disclosure">
        <summary>Data quality, limitations and provenance</summary>
        <section>
          <h3>Quality and limitations</h3>
          <p>
            Holder enumeration: {r.snapshot.enumerationComplete ? 'complete' : 'partial'}. Supply
            reconciled: {quality.supplyReconciled ? 'yes' : 'no'}. The snapshot is not atomic.
          </p>
          <p>
            Slots: {quality.minSlot ?? 'unknown'} - {quality.maxSlot ?? 'unknown'}; index:{' '}
            {quality.indexedSlot ?? 'unknown'}; time: {date(quality.observedAt)}.
          </p>
          <Reasons values={[...quality.reasons, ...r.limitations, ...r.graph.limitations]} />
        </section>
        <p>
          Mint: {r.identity.mint}. Decimals: {decimals}. Supply:{' '}
          {units(r.identity.supply, decimals)} (raw: {r.identity.supply}).
        </p>
        <p>
          Mint authority: {r.identity.mintAuthority ?? 'revoked'} · Freeze authority:{' '}
          {r.identity.freezeAuthority ?? 'revoked'}.
        </p>
        <p>
          Source: {r.identity.provenance.provider}; commitment: {r.identity.provenance.commitment};
          slot: {r.identity.provenance.slot ?? 'unknown'}.
        </p>
        <p>
          Versions: contract {r.contractVersion}; analysis {r.analysisVersion}; parser{' '}
          {r.parserVersion}.
        </p>
        <p>
          Flagged balance: {units(metrics.flaggedBalance, decimals)}. Eligible denominator:{' '}
          {units(metrics.eligibleBalance, decimals)}; verified infrastructure excluded:{' '}
          {units(metrics.excludedBalance, decimals)}.
        </p>
        <Reasons values={r.risk.confidence.reasons} />
      </details>
      {!provisional && (
        <details className="report-disclosure">
          <summary>Follow-up observations</summary>
          <Outcomes id={r.id} />
        </details>
      )}
      <div className="report-tools actions">
        {!provisional && (
          <>
            <a href={`/watchlist?mint=${r.identity.mint}`}>
              <Eye size={15} />
              Watch token
            </a>
            <Link to="/report/$id" params={{ id: r.id }}>
              Permanent report link <ArrowUpRight size={14} />
            </Link>
          </>
        )}
        <button onClick={download}>
          <Download size={15} />
          Download JSON{provisional ? ' preview' : ''}
        </button>
        <Link to="/token/$mint" params={{ mint: r.identity.mint }} search={{ job: undefined }}>
          Open token <ArrowUpRight size={14} />
        </Link>
      </div>
      {edge && <EvidenceDialog edge={edge} close={() => setEdge(undefined)} />}
    </article>
  );
}
function EvidenceDialog({ edge: e, close }: { edge: RelationshipEdge; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current,
      previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="evidence-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="evidence-title">Evidence {e.id}</h2>
      <button autoFocus onClick={close}>
        Close evidence
      </button>
      <p>{e.explanation}</p>
      <p>
        {e.from} → {e.to}
      </p>
      <p>
        Type: {e.kind}; strength: {e.strength}; confidence: {e.confidence}. Owner identity is not
        proven.
      </p>
      <p>
        Amount raw: {e.amount ?? 'unknown'}. Rule version: {e.ruleVersion}.
      </p>
      <p>
        Supports a common-control hypothesis: {e.supportsControlHypothesis ? 'yes' : 'no'}; service
        excluded: {e.serviceExcluded ? 'yes' : 'no'}.
      </p>
      <p>
        Source: {e.provenance.provider}; time: {date(e.provenance.observedAt)}; slot:{' '}
        {e.provenance.slot ?? 'unknown'}; commitment: {e.provenance.commitment}; parser:{' '}
        {e.provenance.parserVersion}.
      </p>
      <ul>
        {e.transactionLinks.map((url) => (
          <li key={url}>
            <External url={url}>{url}</External>
          </li>
        ))}
      </ul>
      <p>
        Signatures: {e.signatures.join(', ') || e.signature || 'unknown'}. Related evidence:{' '}
        {e.relatedEvidenceIds.join(', ') || 'no'}.
      </p>
    </dialog>
  );
}
