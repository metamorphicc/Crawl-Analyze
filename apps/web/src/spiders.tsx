import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { phaseLabel, stateLabel } from './format.js';
import { SpiderRenderer, type CrawlActivity } from './spider-renderer.js';

type Activity = CrawlActivity;
const SpiderContext = createContext<{
  setActivity: (activity: Activity) => void;
  activity: Activity;
  still: boolean;
  motionPaused: boolean;
  toggleMotion: () => void;
}>({
  setActivity: () => {},
  activity: null,
  still: false,
  motionPaused: false,
  toggleMotion: () => {},
});
export const useSpiderActivity = () => useContext(SpiderContext);

export function SpiderMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 15 10 10 7 4M15 18 6 16 2 11M15 23 6 25 2 30M16 26 10 31 8 37M24 15 30 10 33 4M25 18 34 16 38 11M25 23 34 25 38 30M24 26 30 31 32 37" />
        <ellipse cx="20" cy="23" rx="6" ry="8" />
        <circle cx="20" cy="13" r="4" />
        <path d="M18 12h.1M22 12h.1M20 19v6" />
      </g>
    </svg>
  );
}

export function SpiderEnvironment({ children, route }: { children: ReactNode; route: string }) {
  const [activity, setActivity] = useState<Activity>(null),
    [paused, setPaused] = useState(() => {
      try {
        return localStorage.getItem('crawlspider:pause-motion') === 'true';
      } catch {
        return false;
      }
    }),
    [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)'),
      change = () => setReduced(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  const toggleMotion = () => {
    if (reduced) return;
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem('crawlspider:pause-motion', String(next));
    } catch {
      /* Motion controls also work when storage is restricted. */
    }
  };
  const settled = activity !== null && !['queued', 'running'].includes(activity.state);
  return (
    <SpiderContext.Provider
      value={{
        setActivity,
        activity,
        still: paused || reduced || settled,
        motionPaused: paused || reduced,
        toggleMotion,
      }}
    >
      <div className="site-shell" data-motion={paused || reduced ? 'paused' : 'running'}>
        {children}
        <div className="crawler-control">
          <span className="crawler-mode">
            {activity
              ? `${stateLabel[activity.state] || activity.state} · ${phaseLabel[activity.phase] || activity.phase}`
              : route === '/'
                ? 'Ambient crawlers'
                : 'Ambient network'}
          </span>
          <button
            className="motion-toggle"
            type="button"
            disabled={reduced}
            aria-pressed={paused || reduced}
            aria-label={
              reduced
                ? 'Scene motion disabled by system preference'
                : paused
                  ? 'Resume scene motion'
                  : 'Pause scene motion'
            }
            onClick={toggleMotion}
          >
            {paused || reduced ? (
              <Play size={14} aria-hidden="true" />
            ) : (
              <Pause size={14} aria-hidden="true" />
            )}
            <span>{reduced ? 'Reduced motion' : paused ? 'Resume' : 'Pause'}</span>
          </button>
        </div>
      </div>
    </SpiderContext.Provider>
  );
}

export function SpiderCanvas() {
  const { activity, still } = useContext(SpiderContext);
  const canvasRef = useRef<HTMLCanvasElement>(null),
    rendererRef = useRef<SpiderRenderer | null>(null),
    activityRef = useRef(activity);
  activityRef.current = activity;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const habitat = canvas.parentElement;
    if (!habitat) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const renderer = rendererRef.current ?? new SpiderRenderer(canvas, context, habitat);
    rendererRef.current = renderer;
    const bounds = habitat.getBoundingClientRect();
    let frame = 0,
      inView =
        bounds.bottom > 0 &&
        bounds.top < innerHeight &&
        bounds.right > 0 &&
        bounds.left < innerWidth,
      previous = performance.now();
    const paint = (now: number) => {
      const elapsed = now - previous;
      if (elapsed >= 1000 / 60 - 1) {
        renderer.draw(Math.min(elapsed / 1000, 0.05), activityRef.current, still);
        previous = now;
      }
      frame = requestAnimationFrame(paint);
    };
    const redraw = () => renderer.draw(0, activityRef.current, true);
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = performance.now();
      if (!document.hidden && inView) {
        redraw();
        if (!still) frame = requestAnimationFrame(paint);
      }
    };
    const resize = () => {
      renderer.resize();
      redraw();
    };
    const intersection = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      inView = entry.isIntersecting;
      visibility();
    });
    const dimensions = new ResizeObserver(resize);
    intersection.observe(habitat);
    dimensions.observe(habitat);
    redraw();
    visibility();
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      intersection.disconnect();
      dimensions.disconnect();
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [still]);
  return <canvas ref={canvasRef} className="spider-layer" aria-hidden="true" />;
}
