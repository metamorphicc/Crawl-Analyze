import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { phaseLabel, stateLabel } from './format.js';

type Activity = { id: string; state: string; phase: string } | null;
const SpiderContext = createContext<{ setActivity: (activity: Activity) => void }>({
  setActivity: () => {},
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
  const settled = activity !== null && !['queued', 'running'].includes(activity.state);
  return (
    <SpiderContext.Provider value={{ setActivity }}>
      <SpiderCanvas activity={activity} still={paused || reduced || settled} route={route} />
      {children}
      <div className="crawler-control">
        <span className="crawler-mode">
          {activity
            ? `${stateLabel[activity.state] || activity.state} · ${phaseLabel[activity.phase] || activity.phase}`
            : 'Ambient crawlers'}
        </span>
        <button
          className="motion-toggle"
          type="button"
          disabled={reduced}
          aria-pressed={paused || reduced}
          aria-label={
            reduced
              ? 'Crawler motion disabled by system preference'
              : paused
                ? 'Resume crawlers'
                : 'Pause crawlers'
          }
          onClick={() => {
            const next = !paused;
            setPaused(next);
            try {
              localStorage.setItem('crawlspider:pause-motion', String(next));
            } catch {
              /* Motion controls also work when storage is restricted. */
            }
          }}
        >
          {paused || reduced ? (
            <Play size={14} aria-hidden="true" />
          ) : (
            <Pause size={14} aria-hidden="true" />
          )}
          <span>{reduced ? 'Reduced motion' : paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>
    </SpiderContext.Provider>
  );
}

type Point = { x: number; y: number };
type Anchor = { x: number; y: number; width: number; height: number };
type Crawler = {
  x: number;
  y: number;
  angle: number;
  goal: Point;
  stride: number;
  feet: Point[];
  trail: Point[];
  seed: number;
  size: number;
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function SpiderCanvas({
  activity,
  still,
  route,
}: {
  activity: Activity;
  still: boolean;
  route: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null),
    crawlers = useRef<Crawler[]>([]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const styles = getComputedStyle(canvas),
      accent = styles.getPropertyValue('--color-accent').trim(),
      joint = styles.getPropertyValue('--color-spider-joint').trim(),
      thread = styles.getPropertyValue('--color-spider-thread').trim(),
      fill = styles.getPropertyValue('--color-spider-fill').trim();
    let width = innerWidth,
      height = innerHeight,
      frame = 0,
      previous = 0,
      lastLayout = 0;
    let anchors: Anchor[] = [];
    const collect = () => {
      anchors = Array.from(
        document.querySelectorAll(
          '[data-crawl-anchor], .hero-line, main section h2, main article h3, .scanner-form, .table-scroll',
        ),
      )
        .flatMap((element) => Array.from(element.getClientRects()))
        .filter((rect) => rect.width > 20 && rect.bottom > 65 && rect.top < height - 70)
        .slice(0, 24)
        .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
      if (!anchors.length)
        anchors = [{ x: width * 0.15, y: height * 0.3, width: width * 0.6, height: height * 0.25 }];
    };
    const pick = (index: number): Point => {
      const anchor = anchors[index % anchors.length]!;
      const edge = index % 4,
        position = 0.15 + Math.random() * 0.7;
      return {
        x: clamp(
          edge % 2
            ? anchor.x + (edge === 1 ? anchor.width + 8 : -8)
            : anchor.x + anchor.width * position,
          34,
          width - 34,
        ),
        y: clamp(
          edge % 2
            ? anchor.y + anchor.height * position
            : anchor.y + (edge === 0 ? -10 : anchor.height + 10),
          76,
          height - 70,
        ),
      };
    };
    const resize = () => {
      width = innerWidth;
      height = innerHeight;
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      collect();
      const count = width < 600 ? 2 : width < 1024 ? 4 : 6;
      crawlers.current = Array.from({ length: count }, (_, index) => {
        const old = crawlers.current[index],
          point = pick(index * 3 + 1);
        return old
          ? {
              ...old,
              x: clamp(old.x, 34, width - 34),
              y: clamp(old.y, 76, height - 70),
              goal: point,
              feet: [],
              trail: [],
            }
          : {
              ...point,
              angle: index * 1.2,
              goal: pick(index * 3 + 2),
              stride: index,
              feet: [],
              trail: [],
              seed: index,
              size: width < 600 ? 0.65 : 0.9 + (index % 3) * 0.12,
            };
      });
      if (still || document.hidden) paint(performance.now());
    };
    const paint = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      if (now - lastLayout > 650) {
        collect();
        lastLayout = now;
      }
      ctx.clearRect(0, 0, width, height);
      if (document.querySelector('dialog[open]')) return;
      ctx.lineCap = 'round';
      for (const spider of crawlers.current) {
        const moving = !still && !document.hidden;
        if (moving) {
          if (distance(spider, spider.goal) < 22 || spider.goal.y > height - 65) {
            spider.seed += 5;
            spider.goal = pick(spider.seed);
          }
          const desired = Math.atan2(spider.goal.y - spider.y, spider.goal.x - spider.x),
            turn = Math.atan2(Math.sin(desired - spider.angle), Math.cos(desired - spider.angle));
          spider.angle += turn * Math.min(dt * 2.8, 1);
          const speed = activity?.state === 'running' ? 38 : activity?.state === 'queued' ? 12 : 23;
          spider.x = clamp(spider.x + Math.cos(spider.angle) * speed * dt, 32, width - 32);
          spider.y = clamp(spider.y + Math.sin(spider.angle) * speed * dt, 72, height - 66);
          spider.stride += speed * dt * 0.08;
          if (!spider.trail.length || distance(spider, spider.trail.at(-1)!) > 10) {
            spider.trail.push({ x: spider.x, y: spider.y });
            if (spider.trail.length > 13) spider.trail.shift();
          }
        }
        const project = (x: number, y: number): Point => ({
          x: spider.x + (x * Math.cos(spider.angle) - y * Math.sin(spider.angle)) * spider.size,
          y: spider.y + (x * Math.sin(spider.angle) + y * Math.cos(spider.angle)) * spider.size,
        });
        // Trails are decorative movement traces, never wallet relationship evidence.
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = thread;
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        spider.trail.forEach((p, index) => (index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (let leg = 0; leg < 8; leg++) {
          const side = leg < 4 ? -1 : 1,
            row = leg % 4,
            hip = project(9 - row * 6, side * 5),
            gait = Math.sin(spider.stride + (row * Math.PI) / 2 + (side < 0 ? 0 : Math.PI)),
            reach = project(29 - row * 18 + gait * 8, side * (47 + (row % 2) * 9));
          let foot = spider.feet[leg];
          if (!foot || distance(foot, hip) > 78 * spider.size) foot = spider.feet[leg] = reach;
          if (moving && gait > 0.3) {
            foot.x += (reach.x - foot.x) * Math.min(dt * 13, 1);
            foot.y += (reach.y - foot.y) * Math.min(dt * 13, 1);
          }
          const knee = project(21 - row * 13 + gait * 3, side * 24);
          ctx.globalAlpha = 0.68;
          ctx.strokeStyle = leg % 3 ? joint : accent;
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.moveTo(hip.x, hip.y);
          ctx.lineTo(knee.x, knee.y);
          ctx.lineTo(foot.x, foot.y);
          ctx.stroke();
          ctx.fillStyle = joint;
          ctx.beginPath();
          ctx.arc(knee.x, knee.y, 1.3 * spider.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.88;
          ctx.fillStyle = accent;
          ctx.shadowColor = accent;
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.arc(foot.x, foot.y, 1.7 * spider.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        ctx.save();
        ctx.translate(spider.x, spider.y);
        ctx.rotate(spider.angle);
        ctx.scale(spider.size, spider.size);
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = fill;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(-6, 0, 12, 7.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(9, 0, 6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.ellipse(-6, 0, 7, 4, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        for (const eye of [-2, 2]) {
          ctx.beginPath();
          ctx.arc(12, eye, 1, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    };
    const tick = (now: number) => {
      if (now - previous >= 1000 / 30) paint(now);
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden && !still) frame = requestAnimationFrame(tick);
      else paint(performance.now());
    };
    resize();
    if (!still && !document.hidden) frame = requestAnimationFrame(tick);
    addEventListener('resize', resize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [still, route, activity?.state, activity?.phase]);
  return <canvas ref={canvasRef} className="spider-layer" aria-hidden="true" />;
}
