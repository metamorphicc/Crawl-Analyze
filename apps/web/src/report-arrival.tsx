import { useEffect, useRef, type ReactNode } from 'react';
import { useSpiderActivity } from './spiders.js';

// The chart/results destination exists as soon as the scan starts, not only at completion.
export function ReportArrival({
  ready,
  arrivalKey,
  children,
}: {
  ready: boolean;
  arrivalKey: string;
  children: ReactNode;
}) {
  const target = useRef<HTMLDivElement>(null);
  const arrived = useRef<string | null>(null);
  const { motionPaused } = useSpiderActivity();
  useEffect(() => {
    if (!ready || arrived.current === arrivalKey) return;
    let frame = 0;
    const reveal = () => {
      if (document.hidden || arrived.current === arrivalKey || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const element = target.current;
        if (!element) return;
        arrived.current = arrivalKey;
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
  }, [ready, arrivalKey, motionPaused]);
  return (
    <div
      ref={target}
      id="scan-results"
      className="result-arrival"
      tabIndex={-1}
      role="region"
      aria-label="Scan chart and results"
    >
      {children}
    </div>
  );
}
