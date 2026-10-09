import { SpiderRenderer } from './spider-renderer.js';

type Point = { x: number; y: number };
type Node = Point & { owner: string; indexed: boolean };
type Edge = { id: string; from: string; to: string; strength: string };
type Viewport = { x: number; y: number; zoom: number };
type Scene = {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  mint: string;
  active: boolean;
  paused: boolean;
};

// One scene clock owns wallet drift, packets and the homepage spider model.
// None of this motion changes report data or claims a new on-chain observation.
export class WalletScene {
  private readonly spiders: SpiderRenderer;
  private scene: Scene = {
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    mint: '',
    active: false,
    paused: false,
  };
  private nodeElements = new Map<string, SVGGElement>();
  private spokes = new Map<string, SVGPathElement>();
  private outgoing = new Map<string, SVGGElement>();
  private incoming = new Map<string, SVGGElement>();
  private edgeElements = new Map<string, SVGGElement>();
  private edgePackets = new Map<string, SVGCircleElement>();
  private halo: SVGGElement | null = null;
  private orbit: SVGGElement | null = null;
  private time = 0;
  private previous = 0;
  private frame = 0;
  private inView = false;
  private destroyed = false;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly intersection: IntersectionObserver;
  private readonly dimensions: ResizeObserver;

  constructor(
    private readonly stage: HTMLElement,
    private readonly svg: SVGSVGElement,
    spiderCanvas: HTMLCanvasElement,
  ) {
    const spiders = spiderCanvas.getContext('2d');
    if (!spiders) throw new Error('Canvas unavailable');
    this.spiders = new SpiderRenderer(spiderCanvas, spiders, stage);
    const bounds = stage.getBoundingClientRect();
    this.inView =
      bounds.width > 0 && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight;
    this.intersection = new IntersectionObserver(([entry]) => {
      this.inView = Boolean(entry?.isIntersecting);
      this.schedule();
    });
    this.dimensions = new ResizeObserver(() => this.resize());
    this.intersection.observe(stage);
    this.dimensions.observe(stage);
    document.addEventListener('visibilitychange', this.schedule);
    this.reduced.addEventListener('change', this.schedule);
    this.resize();
  }

  update(scene: Scene) {
    const changed = scene.nodes !== this.scene.nodes || scene.viewport !== this.scene.viewport;
    this.scene = scene;
    this.nodeElements = this.elements<SVGGElement>('data-wallet-group');
    this.spokes = this.elements<SVGPathElement>('data-spoke');
    this.outgoing = this.elements<SVGGElement>('data-signal-out');
    this.incoming = this.elements<SVGGElement>('data-signal-in');
    this.edgeElements = this.elements<SVGGElement>('data-map-edge');
    this.edgePackets = this.elements<SVGCircleElement>('data-evidence-packet');
    this.halo = this.svg.querySelector('[data-core-halo]');
    this.orbit = this.svg.querySelector('[data-core-orbit]');
    if (changed) this.spiders.retarget();
    this.draw(0, true);
    this.schedule();
  }

  private elements<T extends SVGElement>(attribute: string) {
    return new Map(
      [...this.svg.querySelectorAll<T>(`[${attribute}]`)].map((element) => [
        element.getAttribute(attribute)!,
        element,
      ]),
    );
  }

  private resize() {
    this.spiders.resize();
    this.draw(0, true);
    this.schedule();
  }

  private schedule = () => {
    if (this.destroyed) return;
    const running = this.inView && !document.hidden && !this.scene.paused && !this.reduced.matches;
    if (!running) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.previous = 0;
      return;
    }
    if (!this.frame) {
      this.previous = 0;
      this.frame = requestAnimationFrame(this.animate);
    }
  };

  private animate = (now: number) => {
    this.frame = 0;
    if (
      this.destroyed ||
      !this.inView ||
      document.hidden ||
      this.scene.paused ||
      this.reduced.matches
    )
      return;
    const elapsed = this.previous ? now - this.previous : 0;
    if (!this.previous || elapsed >= 1000 / 60 - 1) {
      const dt = Math.min(elapsed / 1000, 0.04);
      this.time += dt;
      this.draw(dt, false);
      this.previous = now;
    }
    this.frame = requestAnimationFrame(this.animate);
  };

  private draw(dt: number, still: boolean) {
    const t = this.time;
    const positions = new Map(
      this.scene.nodes.map((node, i): [string, Point] => [
        node.owner,
        {
          x: node.x + Math.sin(t * 0.66 + i * 1.31) * 7 + Math.cos(t * 0.24 + i) * 3,
          y: node.y + Math.cos(t * 0.58 + i * 1.17) * 5,
        },
      ]),
    );
    this.scene.nodes.forEach((node, i) => {
      const position = positions.get(node.owner)!;
      this.nodeElements
        .get(node.owner)
        ?.setAttribute('transform', `translate(${position.x - node.x} ${position.y - node.y})`);
      this.spokes.get(node.owner)?.setAttribute('d', `M 500 280 L ${position.x} ${position.y}`);
      const cycle = (t / (this.scene.active ? 1.55 : 2.15) + i * 0.37) % 2;
      this.packet(this.outgoing.get(node.owner), { x: 500, y: 280 }, position, cycle, cycle < 1);
      this.packet(
        this.incoming.get(node.owner),
        position,
        { x: 500, y: 280 },
        cycle - 1,
        cycle >= 1,
      );
      const contact = this.nodeElements
        .get(node.owner)
        ?.querySelector<SVGRectElement>('.wallet-contact');
      if (contact)
        contact.style.opacity = String(
          cycle > 0.82 && cycle < 1.22 ? Math.sin(((cycle - 0.82) / 0.4) * Math.PI) * 0.9 : 0.12,
        );
    });
    this.scene.edges.forEach((edge, i) => {
      const from = positions.get(edge.from),
        to = positions.get(edge.to);
      if (!from || !to) return;
      const control = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + 38 };
      const path = `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`;
      this.edgeElements
        .get(edge.id)
        ?.querySelectorAll('path')
        .forEach((element) => element.setAttribute('d', path));
      const progress = (t * 0.34 + i * 0.183) % 1,
        inverse = 1 - progress;
      const packet = this.edgePackets.get(edge.id);
      if (packet) {
        packet.setAttribute(
          'cx',
          String(
            inverse * inverse * from.x +
              2 * inverse * progress * control.x +
              progress * progress * to.x,
          ),
        );
        packet.setAttribute(
          'cy',
          String(
            inverse * inverse * from.y +
              2 * inverse * progress * control.y +
              progress * progress * to.y,
          ),
        );
      }
    });
    this.halo?.setAttribute(
      'transform',
      `translate(500 280) scale(${1 + Math.sin(t * 1.7) * 0.06})`,
    );
    this.orbit?.setAttribute('transform', `rotate(${t * 24} 500 280)`);
    this.spiders.draw(
      dt,
      this.scene.active ? { id: this.scene.mint, state: 'running', phase: 'wallet-web' } : null,
      still,
    );
  }

  private packet(
    element: SVGGElement | undefined,
    start: Point,
    end: Point,
    progress: number,
    visible: boolean,
  ) {
    if (!element) return;
    element.style.opacity = visible ? '0.95' : '0';
    if (!visible) return;
    const fraction = Math.max(0, Math.min(progress, 1));
    const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    element.setAttribute(
      'transform',
      `translate(${start.x + (end.x - start.x) * fraction} ${start.y + (end.y - start.y) * fraction}) rotate(${angle})`,
    );
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.intersection.disconnect();
    this.dimensions.disconnect();
    document.removeEventListener('visibilitychange', this.schedule);
    this.reduced.removeEventListener('change', this.schedule);
  }
}
