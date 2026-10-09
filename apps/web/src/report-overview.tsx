import type { AnalysisReport } from '@crawlspider/contracts';
import { percent } from './format.js';
import { shortAddress } from './wallet-view.js';
import { ArrowUpRight, ShieldAlert, ShieldQuestion } from 'lucide-react';

export function ReportMetrics({ report: r }: { report: AnalysisReport }) {
  const m = r.risk.metrics;
  return (
    <dl className="report-metrics">
      <div>
        <dt>Indexed holders</dt>
        <dd>{m.ownerCount.toLocaleString('en-US')}</dd>
      </div>
      <div>
        <dt>Top 10 share</dt>
        <dd>{percent(m.top10Bps)}</dd>
      </div>
      <div>
        <dt>Flagged balance</dt>
        <dd>{percent(m.flaggedBps)}</dd>
      </div>
      <div>
        <dt>Wallets analyzed</dt>
        <dd>{r.graph.analyzedOwners.length.toLocaleString('en-US')}</dd>
      </div>
      <div>
        <dt>Data coverage</dt>
        <dd>{r.risk.confidence.dataCompleteness}%</dd>
      </div>
      <div>
        <dt>Snapshot</dt>
        <dd className={`quality-${r.snapshot.quality.status}`}>{r.snapshot.quality.status}</dd>
      </div>
    </dl>
  );
}
export function ReportOverview({ report: r }: { report: AnalysisReport }) {
  const score = r.risk.riskScore,
    metrics = r.risk.metrics;
  const fullSell = r.scenarios.scenarios.find((s) => s.fractionBps === 10000);
  const quotes = fullSell?.quotes.filter((q) => q.status === 'available') || [];
  const highestDrop = quotes.reduce<number | null>((highest, quote) => {
    const drop = quote.postSpotDropBps === null ? null : Number(quote.postSpotDropBps);
    return drop !== null && Number.isFinite(drop) ? Math.max(highest ?? 0, drop) : highest;
  }, null);
  return (
    <div className={`verdict-content verdict-${r.risk.classification}`}>
      <div className="verdict-heading">
        <span>Distribution risk</span>
        {score === null ? <ShieldQuestion size={18} /> : <ShieldAlert size={18} />}
      </div>
      <div className="verdict-score">
        {score ?? '?'}
        <span>/100</span>
      </div>
      <strong className="verdict-label">
        {score === null ? 'Insufficient data' : `${r.risk.classification} risk`}
      </strong>
      <p className="verdict-explanation">
        Higher means more observed risk. This is a heuristic, not a safety guarantee.
      </p>
      <p>
        {metrics.ownerCount} indexed wallets. Top 10 hold {percent(metrics.top10Bps)} of eligible
        balance; the largest common-control hypothesis holds {percent(metrics.largestHypothesisBps)}
        .
      </p>
      <div className="scenario-highlight">
        <span>Flagged-cohort sell scenario</span>
        <strong>
          {highestDrop === null ? 'Unavailable' : `${percent(highestDrop)} modeled spot-price drop`}
        </strong>
        <small>
          {highestDrop === null
            ? 'Verified market data is insufficient.'
            : 'Largest drop across supported markets if the full flagged balance sells. A model, not a forecast.'}
        </small>
      </div>
      <a className="terminal-action" href={r.links.axiom} target="_blank" rel="noopener noreferrer">
        Open in Axiom <ArrowUpRight size={16} />
      </a>
      <div className="rule-breakdown">
        <h3>What contributed</h3>
        {r.risk.rules.map((rule) => (
          <div className={`rule-meter rule-${rule.status}`} key={rule.id}>
            <div>
              <span>{rule.id.replaceAll('_', ' ').replaceAll('-', ' ')}</span>
              <strong>{rule.status === 'unknown' ? '?' : `+${rule.points}`}</strong>
            </div>
            <meter
              min={0}
              max={100}
              value={rule.status === 'triggered' ? rule.points : 0}
              aria-label={`${rule.id}: ${rule.status}; ${rule.points} points`}
            />
            <small>
              {rule.status === 'unknown'
                ? 'Unknown - data missing'
                : rule.status === 'triggered'
                  ? 'Evidence matched'
                  : 'Not triggered'}
            </small>
          </div>
        ))}
      </div>
      {score === null && (
        <details>
          <summary>Why no verdict?</summary>
          <ul>
            {r.risk.eligibilityReasons.map((reason) => (
              <li key={reason}>{reason.replaceAll('_', ' ')}</li>
            ))}
          </ul>
          <p>Observed points: {r.risk.observedRiskPoints}; these do not replace a final score.</p>
        </details>
      )}
      <div className="coverage-meter">
        <div>
          <span>Data completeness</span>
          <strong>{r.risk.confidence.dataCompleteness}%</strong>
        </div>
        <meter
          min={0}
          max={100}
          value={r.risk.confidence.dataCompleteness}
          aria-label="Data completeness"
        />
        <small>Coverage of this scan, not prediction accuracy.</small>
      </div>
      <a href="#report-checks">
        Inspect rules and evidence <ArrowUpRight size={14} />
      </a>
      <span className="verdict-mint" title={r.identity.mint}>
        {shortAddress(r.identity.mint)}
      </span>
    </div>
  );
}
