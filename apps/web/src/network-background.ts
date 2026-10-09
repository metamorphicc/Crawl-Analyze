import { spiderPalette } from './spider-renderer.js';

type Point = { x: number; y: number };
type BackgroundNode = Point & { phase: number };

// Abstract decoration: no addresses, report data or claims of live on-chain activity.
export class NetworkBackground {
  private readonly colors: ReturnType<typeof spiderPalette>;
  private readonly background: CanvasRenderingContext2D;
  private width = 1;
  private height = 1;
  private readonly backgroundNodes: BackgroundNode[] = Array.from({ length: 44 }, (_, i) => ({
    x: 0.06 + (i % 8) * 0.126 + Math.sin(i * 1.7) * 0.022,
    y: 0.04 + Math.floor(i / 8) * 0.182 + Math.cos(i * 2.3) * 0.032,
    phase: i * 1.71,
  }));
  private readonly backgroundEdges: [number, number][] = this.backgroundNodes.flatMap((_, i) => {
    const edges: [number, number][] = [];
    if (i % 8 < 7 && i + 1 < 44) edges.push([i, i + 1]);
    if (i + 8 < 44) edges.push([i, i + 8]);
    if (i % 3 === 0 && i + 9 < 44) edges.push([i, i + 9]);
    return edges;
  });

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: CanvasRenderingContext2D,
  ) {
    this.background = context;
    this.colors = spiderPalette(canvas);
    this.resize();
  }
  resize() {
    this.width = Math.max(1, this.canvas.clientWidth);
    this.height = Math.max(1, this.canvas.clientHeight);
    // Blurred atmosphere does not need high-DPI backing pixels.
    this.canvas.width = Math.round(this.width);
    this.canvas.height = Math.round(this.height);
  }
  draw(t: number) {
    const ctx = this.background,
      w = this.width,
      h = this.height;
    ctx.clearRect(0, 0, w, h);
    const points = this.backgroundNodes.map((node) => ({
      x: node.x * w + Math.sin(t * 0.25 + node.phase) * 15,
      y: node.y * h + Math.cos(t * 0.19 + node.phase) * 11,
    }));
    ctx.save();
    ctx.translate(Math.sin(t * 0.11) * 10, Math.cos(t * 0.13) * 8);
    // Large soft pools give the whole canvas depth, even between passing packets.
    for (const [index, anchor] of [points[8]!, points[31]!].entries()) {
      const radius = Math.max(w, h) * 0.32;
      const glow = ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius);
      glow.addColorStop(0, index ? this.colors.joint : this.colors.accent);
      glow.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.045 + Math.sin(t * 0.23 + index) * 0.009;
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.lineWidth = 1.4;
    this.backgroundEdges.forEach(([a, b], i) => {
      const start = points[a]!,
        end = points[b]!;
      ctx.strokeStyle = i % 4 ? this.colors.thread : this.colors.accent;
      ctx.globalAlpha = 0.48;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      const mid = (start.x + end.x) / 2;
      ctx.lineTo(mid, start.y);
      ctx.lineTo(mid, end.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      // Independent abstract traffic; no token addresses or report claims live in this layer.
      if (i % 2 === 0) {
        const fraction = (t * (0.28 + (i % 5) * 0.04) + i * 0.173) % 1;
        const travel =
          fraction < 0.25
            ? { x: start.x + (mid - start.x) * fraction * 4, y: start.y }
            : fraction < 0.75
              ? { x: mid, y: start.y + (end.y - start.y) * (fraction - 0.25) * 2 }
              : { x: mid + (end.x - mid) * (fraction - 0.75) * 4, y: end.y };
        ctx.globalAlpha = 1;
        ctx.fillStyle = i % 4 ? this.colors.joint : this.colors.accent;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(travel.x, travel.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
    points.forEach((point, i) => {
      ctx.globalAlpha = 0.65 + Math.sin(t * 1.3 + i) * 0.2;
      ctx.strokeStyle = this.colors.thread;
      ctx.fillStyle = this.colors.fill;
      if (i % 6 === 0) {
        ctx.strokeRect(point.x - 12, point.y - 7, 24, 14);
      }
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    for (const [index, hub] of [points[18]!, points[29]!].entries()) {
      ctx.globalAlpha = 0.38;
      ctx.strokeStyle = this.colors.accent;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 32 + ((t * 11 + index * 20) % 42), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
