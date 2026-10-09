import { useEffect, useRef } from 'react';
import { NetworkBackground } from './network-background.js';
import { useSpiderActivity } from './spiders.js';

export function SiteBackground() {
  const { motionPaused } = useSpiderActivity();
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<NetworkBackground | null>(null);
  const time = useRef(0);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;
    const network = renderer.current ?? new NetworkBackground(element, context);
    renderer.current = network;
    let frame = 0,
      previous = 0;
    const animate = (now: number) => {
      frame = 0;
      if (document.hidden || motionPaused) return;
      const elapsed = previous ? now - previous : 0;
      // Background atmosphere runs at 30 fps; foreground spiders retain 60 fps.
      if (!previous || elapsed >= 1000 / 30 - 1) {
        time.current += Math.min(elapsed / 1000, 0.06);
        network.draw(time.current);
        previous = now;
      }
      frame = requestAnimationFrame(animate);
    };
    const visibility = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
      if (!document.hidden) {
        network.draw(time.current);
        if (!motionPaused) frame = requestAnimationFrame(animate);
      }
    };
    const resize = () => {
      network.resize();
      network.draw(time.current);
    };
    const dimensions = new ResizeObserver(resize);
    dimensions.observe(element);
    document.addEventListener('visibilitychange', visibility);
    resize();
    visibility();
    return () => {
      cancelAnimationFrame(frame);
      dimensions.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [motionPaused]);

  return <canvas ref={canvas} className="site-network-background" aria-hidden="true" />;
}
