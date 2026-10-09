import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { AnalysisReport, RelationshipEdge } from '@crawlspider/contracts';
import { date, percent, safeLink, units, stateLabel } from './format.js';
import { Outcomes } from './outcomes.js';
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
  <External url={`https://solscan.io/account/${owner}`}>{owner}</External>
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
    [chart, setChart] = useState(false),
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
    <article aria-label="Analysis report">
      <header>
        <h2>{provisional ? 'Preview result' : 'Analysis report'}</h2>
        <p>
          {stateLabel[r.mode]} · {date(r.observedAt)} · quality: {quality.status}
        </p>
        {provisional && (
          <p role="status">Intermediate scan result. The final report has not been saved yet.</p>
        )}
        {stale && (
          <p role="status">
            Stale snapshot: over 2 minutes old. Current balances and reserves may have changed.
          </p>
        )}
        {historical && <p>Historical reports preserve values at the time of analysis.</p>}
        <p>
          Mint: {r.identity.mint}. Decimals: {decimals}. Supply:{' '}
          {units(r.identity.supply, decimals)} (raw: {r.identity.supply}).
        </p>
        <p>
          Mint authority: {r.identity.mintAuthority ?? 'revoked'} · Freeze authority:{' '}
          {r.identity.freezeAuthority ?? 'revoked'}
        </p>
        <p>
          Source: {r.identity.provenance.provider}; commitment: {r.identity.provenance.commitment};
          slot: {r.identity.provenance.slot ?? 'unknown'}.
        </p>
        <p>
          Versions: contract {r.contractVersion}; analysis {r.analysisVersion}; parser{' '}
          {r.parserVersion}.
        </p>
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
            </External>
          ))}
        </nav>
        {!provisional && <Outcomes id={r.id} />}
        <div className="actions">
          {!provisional && (
            <>
              <a href={`/watchlist?mint=${r.identity.mint}`}>Watch token</a>
              <Link to="/report/$id" params={{ id: r.id }}>
                Permanent report link
              </Link>
              <button onClick={() => void share()}>Copy link</button>
            </>
          )}
          <button onClick={download}>Download JSON{provisional ? ' preview result' : ''}</button>
          <Link to="/token/$mint" params={{ mint: r.identity.mint }} search={{ job: undefined }}>
            Open token
          </Link>
        </div>
        {copied && <p role="status">{copied}</p>}
      </header>
      <section>
        <h3>Distribution risk</h3>
        <p>
          Risk: {r.risk.riskScore === null ? 'Insufficient data' : `${r.risk.riskScore}/100`} ·{' '}
          {r.risk.classification}
        </p>
        <p>
          Data completeness: {r.risk.confidence.dataCompleteness}%. This measures data coverage, not
          prediction accuracy. The heuristic is not calibrated.
        </p>
        <p>
          Observed points: {r.risk.observedRiskPoints}. With insufficient data, these do not replace
          the final score.
        </p>
        <Reasons values={r.risk.eligibilityReasons} />
        <Reasons values={r.risk.confidence.reasons} />
        <p>
          Indexed holders: {metrics.ownerCount}. Top 1: {percent(metrics.top1Bps)} · Top 10:{' '}
          {percent(metrics.top10Bps)} · largest control hypothesis:{' '}
          {percent(metrics.largestHypothesisBps)}.
        </p>
        <p>
          Flagged balance: {units(metrics.flaggedBalance, decimals)} ({percent(metrics.flaggedBps)}
          ). Denominator: {units(metrics.eligibleBalance, decimals)}; verified infrastructure
          excluded: {units(metrics.excludedBalance, decimals)}.
        </p>
        <Table
          title="Risk rules"
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
      <section>
        <h3>Holders</h3>
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
          heads={['Owner', 'Balance / raw', 'Excluded', 'Frozen / delegated', 'Accounts']}
          rows={r.snapshot.holders
            .filter((h) => h.owner.includes(search))
            .map((h) => ({
              id: h.owner,
              cells: () => [
                ownerLink(h.owner),
                <>
                  {units(h.amount, decimals)}
                  <br />
                  raw: {h.amount}
                </>,
                units(h.excludedAmount, decimals),
                `${units(h.frozenAmount, decimals)} / ${units(h.delegatedAmount, decimals)}`,
                <details>
                  <summary>{h.accounts.length} accounts</summary>
                  <ul>
                    {h.accounts.map((a) => (
                      <li key={a}>{ownerLink(a)}</li>
                    ))}
                  </ul>
                </details>,
              ],
            }))}
        />
      </section>
      <section>
        <h3>Relationships and evidence</h3>
        <p>
          Address interactions do not prove owner identity. Suspected common control and behavioral
          similarity remain hypotheses.
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
      <section>
        <h3>Wallet history</h3>
        <Table
          title="Observed history"
          heads={['Owner', 'Entry', 'Prior trading', 'Coverage / reasons']}
          rows={r.signals.map((s) => ({
            id: s.owner,
            cells: () => [
              ownerLink(s.owner),
              s.entry ? (
                <>
                  <External url={`https://solscan.io/tx/${encodeURIComponent(s.entry.signature)}`}>
                    {s.entry.kind} · slot {s.entry.slot}
                  </External>
                  <p>{units(s.entry.amount, decimals)}</p>
                </>
              ) : (
                'unknown'
              ),
              `${s.priorTrading} · ${s.priorTradeCount ?? 'unknown'}`,
              <>
                {s.coverage.status} · {s.coverage.decoded}/{s.coverage.signatures} · window:{' '}
                {s.coverage.oldestSlot ?? '?'} - {s.coverage.newestSlot ?? '?'}
                <Reasons values={[...s.coverage.reasons, ...s.reasons]} />
              </>,
            ],
          }))}
        />
      </section>
      <section>
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
                      Fees raw: LP {q.fees.lp}, protocol {q.fees.protocol}, creator {q.fees.creator}
                      . Reserves raw: effective {q.effectiveQuoteReserve}; available{' '}
                      {q.realQuoteAvailable}.
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
      <section>
        <h3>Price chart</h3>
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
