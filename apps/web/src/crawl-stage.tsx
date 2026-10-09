import { useEffect, useState, type ReactNode } from 'react';
import type { AnalysisReport, JobDetails, ScanEvent } from '@crawlspider/contracts';
import { Check, CircleDot } from 'lucide-react';
import { phaseLabel, stateLabel, date } from './format.js';
import { shortAddress } from './wallet-view.js';
import { RelationshipMap } from './relationship-map.js';

const steps = [
  { label: 'Token', phases: ['verify-mint'] },
  { label: 'Holders', phases: ['holders'] },
  { label: 'Markets', phases: ['markets', 'preview'] },
  { label: 'History', phases: ['launch-history', 'old-owner-positions', 'wallet-history'] },
  { label: 'Funding', phases: ['funding'] },
  { label: 'Report', phases: ['analysis', 'complete'] },
];
export function CrawlStage({
  mint,
  job,
  report,
  events,
  connection,
  error,
  children,
}: {
  mint: string;
  job: JobDetails | undefined;
  report: AnalysisReport | undefined;
  events: ScanEvent[];
  connection: string;
  error: string;
  children?: ReactNode;
}) {
  const [now, setNow] = useState(Date.now());
  const active = !job || ['queued', 'running'].includes(job.state);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const currentStep = steps.findIndex((step) => step.phases.includes(job?.phase || ''));
  const ended = events.findLast((event) =>
    ['complete', 'partial', 'failed', 'cancelled'].includes(event.kind),
  );
  const seconds = job
    ? Math.max(
        0,
        Math.floor(
          ((ended ? Date.parse(ended.createdAt) : now) - Date.parse(job.createdAt)) / 1000,
        ),
      )
    : null;
  const completed = job && ['complete', 'partial'].includes(job.state);
  return (
    <section
      className={`crawl-stage ${active ? 'is-crawling' : 'is-ended'}`}
      aria-label="Scan status"
    >
      <div className="crawl-status-bar">
        <div>
          <span className="crawl-status-dot" />
          <strong>{active ? 'Crawling' : stateLabel[job?.state || ''] || 'Stopped'}</strong>
          <code>{shortAddress(mint)}</code>
          <span role="status">
            {active
              ? phaseLabel[job?.phase || ''] || 'Connecting to scanner'
              : job?.state === 'partial'
                ? 'Partial data - inspect coverage'
                : job?.state === 'complete'
                  ? 'Report ready'
                  : 'Analysis stopped'}
          </span>
        </div>
        {completed && report?.id === job?.reportId && (
          <a className="scan-result-link" href="#scan-results">
            Open findings ↓
          </a>
        )}
        {seconds !== null && (
          <time title="Elapsed time since this request, including the queue">
            {Math.floor(seconds / 60)
              .toString()
              .padStart(2, '0')}
            :{(seconds % 60).toString().padStart(2, '0')}
          </time>
        )}
      </div>
      {active && (
        <>
          <ol className="crawl-phase-track" aria-label="Analysis stages">
            {steps.map((step, index) => {
              const done = currentStep > index || Boolean(completed);
              return (
                <li
                  key={step.label}
                  className={done ? 'phase-done' : currentStep === index ? 'phase-active' : ''}
                  aria-current={currentStep === index ? 'step' : undefined}
                >
                  {done ? <Check size={14} /> : <CircleDot size={14} />}
                  <span>{step.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="scan-findings-hint" role="status">
            <span aria-hidden="true">↓</span>
            <div>
              <strong>
                {report ? 'First findings are ready below' : 'Your analysis will appear below'}
              </strong>
              <p>
                {report
                  ? `${report.graph.analyzedOwners.length} wallet histories read. ${job?.mode === 'deep' ? 'Deep analysis continues as more evidence arrives.' : 'Saving the snapshot.'}`
                  : 'Collecting the first snapshot. We will take you to the panel when its data is ready.'}
              </p>
              {job?.mode === 'deep' && (
                <small>
                  Deep scans read transaction history under the provider request limit. You can
                  explore the first findings while they run.
                </small>
              )}
            </div>
            {report && <a href="#scan-results">Explore findings ↓</a>}
          </div>
          <RelationshipMap mint={mint} report={report} active={job?.state === 'running'} />
          <div className="crawl-stage-bottom">
            <p>
              {connection}
              {job?.state === 'queued' ? ' · Waiting for a worker' : ''}
            </p>
            {children}
          </div>
          {job?.deadlineAt && (
            <p className="crawl-deadline">
              Worker deadline: {date(job.deadlineAt)} · attempt {job.attempt}. Unread data stays
              unknown.
            </p>
          )}
          <details className="crawl-events">
            <summary>Worker activity · {events.length} recent events</summary>
            {events.length ? (
              <ol>
                {events.slice(-24).map((event) => (
                  <li key={event.id}>
                    <time>
                      {new Date(event.createdAt).toLocaleTimeString('en-US', { hour12: false })}
                    </time>
                    <span>{event.kind}</span>
                    <strong>
                      {typeof event.data.phase === 'string'
                        ? phaseLabel[event.data.phase] || event.data.phase
                        : typeof event.data.code === 'string'
                          ? event.data.code
                          : 'State updated'}
                    </strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p>Waiting for worker events. The status above is read from the server.</p>
            )}
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {job?.errorCode && <p role="alert">{job.errorCode}. Start another scan to retry.</p>}
    </section>
  );
}
