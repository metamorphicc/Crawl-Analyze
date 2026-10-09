import { useEffect, useRef, type ReactNode } from 'react';
import { useSpiderActivity } from './spiders.js';

// Move once, only after the matching final report has actually arrived.
export function ReportArrival({
  ready,
  reportId,
  children,
}: {
  ready: boolean;
  reportId: string;
  children: ReactNode;
}) {
  const target = useRef<HTMLDivElement>(null);
  const arrived = useRef<string | null>(null);
  const { motionPaused } = useSpiderActivity();
  useEffect(() => {
    if (!ready || arrived.current === reportId) return;
    let frame = 0;
    const reveal = () => {
      if (document.hidden || arrived.current === reportId || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const element = target.current;
        if (!element) return;
        arrived.current = reportId;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ behavior: motionPaused ? 'instant' : 'smooth', block: 'start' });
      });
    };
    document.addEventListener('visibilitychange', reveal);
    reveal();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', reveal);
    };
  }, [ready, reportId, motionPaused]);
  return (
    <div
      ref={target}
      id="scan-results"
      className="result-arrival"
      tabIndex={-1}
      role="region"
      aria-label={ready ? 'Scan results ready' : 'Intermediate scan results'}
    >
      {children}
    </div>
  );
}
