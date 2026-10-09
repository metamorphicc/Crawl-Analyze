/* Original canvas anatomy and locomotion. Decorative trails are never analytical evidence. */
type Point = { x: number; y: number };
type Foot = {
  position: Point;
  origin: Point;
  destination: Point;
  swinging: boolean;
  landedAt: number;
  lift: number;
};
type Trace = Point & { time: number };
type Crawler = Point & {
  angle: number;
  speed: number;
  cycle: number;
  size: number;
  rail: Point[];
  railIndex: number;
  waypoint: number;
  feet: Foot[];
  trace: Trace[];
  travelled: number;
  goalAge: number;
  rest: number;
};
type Palette = { accent: string; joint: string; thread: string; fill: string; highlight: string };
export type CrawlActivity = { id: string; state: string; phase: string } | null;
const TAU = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const length = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const project = (spider: Crawler, x: number, y: number): Point => ({
  x: spider.x + (x * Math.cos(spider.angle) - y * Math.sin(spider.angle)) * spider.size,
  y: spider.y + (x * Math.sin(spider.angle) + y * Math.cos(spider.angle)) * spider.size,
});

function palette(canvas: HTMLCanvasElement): Palette {
  const styles = getComputedStyle(canvas),
    sample = document.createElement('canvas');
  sample.width = sample.height = 1;
  const context = sample.getContext('2d');
  // Resolve shared CSS colour tokens before using canvas shadows/gradient stops.
  const resolve = (token: string) => {
    const value = styles.getPropertyValue(token).trim();
    if (!context) return value;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  };
  return {
    accent: resolve('--color-accent'),
    joint: resolve('--color-spider-joint'),
    thread: resolve('--color-spider-thread'),
    fill: resolve('--color-spider-fill'),
    highlight: resolve('--color-spider-highlight'),
  };
}

function glowSprite(color: string): HTMLCanvasElement {
  const image = document.createElement('canvas');
  image.width = image.height = 64;
  const context = image.getContext('2d');
  if (!context) return image;
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.18, color);
  gradient.addColorStop(1, 'transparent');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return image;
}

export class SpiderRenderer {
  private readonly colors: Palette;
  private readonly glow: HTMLCanvasElement;
  private readonly crawlers: Crawler[] = [];
  private rails: Point[][] = [];
  private width = 0;
  private height = 0;
  private clock = 0;
  private phase = '';
  private layoutAt = -1000;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {
    this.colors = palette(canvas);
    this.glow = glowSprite(this.colors.accent);
    this.resize();
  }

  resize() {
    const previousWidth = this.width,
      previousHeight = this.height;
    this.width = innerWidth;
    this.height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.collect();
    const count = this.width < 600 ? 2 : this.width < 1024 ? 4 : 6;
    this.crawlers.length = Math.min(count, this.crawlers.length);
    for (const spider of this.crawlers) {
      spider.x = clamp(
        (spider.x * this.width) / (previousWidth || this.width),
        38,
        this.width - 38,
      );
      spider.y = clamp(
        (spider.y * this.height) / (previousHeight || this.height),
        88,
        Math.max(89, this.height - 68),
      );
      spider.feet = [];
      spider.trace = [];
      this.assignRail(spider, this.crawlers.indexOf(spider));
    }
    while (this.crawlers.length < count) {
      const index = this.crawlers.length,
        rail = this.rails[index % this.rails.length]!,
        point = rail[(index * 2) % rail.length]!;
      const spider: Crawler = {
        ...point,
        angle: 0,
        speed: 88 + index * 6,
        cycle: index * 0.16,
        size: this.width < 600 ? 0.72 : 1.05 + (index % 3) * 0.13,
        rail,
        railIndex: index % this.rails.length,
        waypoint: (index * 2 + 1) % rail.length,
        feet: [],
        trace: [{ ...point, time: this.clock }],
        travelled: 0,
        goalAge: 0,
        rest: 0,
      };
      const next = rail[spider.waypoint]!;
      spider.angle = Math.atan2(next.y - spider.y, next.x - spider.x);
      this.crawlers.push(spider);
    }
  }

  private collect() {
    const minY = 88,
      maxY = Math.max(minY + 1, this.height - 68);
    this.rails = Array.from(
      document.querySelectorAll(
        '.hero-line, [data-crawl-anchor], main section h2, main article h3, .scanner-form',
      ),
    )
      .flatMap((element) => Array.from(element.getClientRects()))
      .filter((rect) => rect.width > 36 && rect.bottom > minY && rect.top < maxY)
      .slice(0, 18)
      .map((rect) => {
        const left = clamp(rect.left - 10, 38, this.width - 38),
          right = clamp(rect.right + 10, 38, this.width - 38),
          top = clamp(rect.top - 14, minY, maxY),
          bottom = clamp(rect.bottom + 14, minY, maxY),
          midX = (left + right) / 2;
        return [
          { x: left, y: top },
          { x: midX, y: top },
          { x: right, y: top },
          { x: right, y: bottom },
          { x: midX, y: bottom },
          { x: left, y: bottom },
        ];
      });
    if (!this.rails.length)
      this.rails = [
        [
          { x: this.width * 0.18, y: clamp(this.height * 0.3, minY, maxY) },
          { x: this.width * 0.82, y: clamp(this.height * 0.3, minY, maxY) },
          { x: this.width * 0.82, y: clamp(this.height * 0.65, minY, maxY) },
          { x: this.width * 0.18, y: clamp(this.height * 0.65, minY, maxY) },
        ],
      ];
    this.layoutAt = this.clock;
  }

  private assignRail(spider: Crawler, index: number) {
    // Choose nearby edges, keeping the journey attached to the interface.
    const ordered = this.rails
      .map((rail, railIndex) => ({
        rail,
        railIndex,
        nearest: Math.min(...rail.map((point) => length(spider, point))),
      }))
      .sort((a, b) => a.nearest - b.nearest);
    const selected = ordered[index % Math.min(3, ordered.length)]!;
    spider.rail = selected.rail;
    spider.railIndex = selected.railIndex;
    spider.waypoint = spider.rail.reduce(
      (best, point, candidate) =>
        length(spider, point) < length(spider, spider.rail[best]!) ? candidate : best,
      0,
    );
    spider.goalAge = 0;
  }

  retarget() {
    this.collect();
    for (const [index, spider] of this.crawlers.entries()) this.assignRail(spider, index);
  }

  draw(dt: number, activity: CrawlActivity, still: boolean) {
    if (!still) this.clock += dt * 1000;
    if (this.clock - this.layoutAt > 550) {
      this.collect();
      for (const [index, spider] of this.crawlers.entries()) {
        // Reattach after scrolling, not every frame or at each footstep.
        const rail = this.rails[spider.railIndex];
        if (!rail || length(rail[0]!, spider.rail[0]!) > 70) this.assignRail(spider, index);
        else {
          spider.rail = rail;
          spider.waypoint %= rail.length;
        }
      }
    }
    const phase = activity ? `${activity.id}:${activity.phase}` : '';
    if (phase !== this.phase) {
      this.phase = phase;
      for (const [index, spider] of this.crawlers.entries()) this.assignRail(spider, index);
    }
    this.ctx.clearRect(0, 0, this.width, this.height);
    if (document.querySelector('dialog[open]')) return;
    for (const [index, spider] of this.crawlers.entries()) {
      if (!still) this.move(spider, index, dt, activity);
      this.drawTrail(spider);
      this.drawLegs(spider, dt, still);
      this.drawBody(spider, still);
    }
    this.ctx.globalAlpha = 1;
    this.ctx.setLineDash([]);
  }

  private move(spider: Crawler, index: number, dt: number, activity: CrawlActivity) {
    let goal = spider.rail[spider.waypoint]!;
    spider.goalAge += dt;
    if (length(spider, goal) < 18) {
      spider.waypoint =
        (spider.waypoint + (index % 2 ? spider.rail.length - 1 : 1)) % spider.rail.length;
      spider.goalAge = 0;
      spider.rest = 0.08 + (index % 3) * 0.04;
      if (spider.waypoint === 0) this.assignRail(spider, index + Math.floor(this.clock / 3000));
      goal = spider.rail[spider.waypoint]!;
    }
    if (spider.goalAge > 7) this.assignRail(spider, index + 1);
    const desired = Math.atan2(goal.y - spider.y, goal.x - spider.x),
      turn = Math.atan2(Math.sin(desired - spider.angle), Math.cos(desired - spider.angle));
    spider.angle += clamp(turn * 10 * dt, -7 * dt, 7 * dt);
    spider.rest = Math.max(0, spider.rest - dt);
    const base = activity?.state === 'running' ? 165 : activity?.state === 'queued' ? 72 : 112,
      burst = 0.9 + 0.18 * Math.sin(this.clock / 650 + index * 1.7),
      target = spider.rest ? 0 : base * burst * clamp(1 - Math.abs(turn) / 2.5, 0.12, 1);
    spider.speed += (target - spider.speed) * Math.min(dt * 9, 1);
    const old = { x: spider.x, y: spider.y };
    spider.x = clamp(spider.x + Math.cos(spider.angle) * spider.speed * dt, 38, this.width - 38);
    spider.y = clamp(
      spider.y + Math.sin(spider.angle) * spider.speed * dt,
      88,
      Math.max(89, this.height - 68),
    );
    const travelled = length(old, spider);
    spider.cycle = (spider.cycle + travelled / (55 * spider.size)) % 1;
    spider.travelled += travelled;
    if (spider.travelled > 5) {
      spider.trace.push({ x: spider.x, y: spider.y, time: this.clock });
      spider.travelled = 0;
    }
    while (spider.trace.length && this.clock - spider.trace[0]!.time > 2600) spider.trace.shift();
    if (spider.trace.length > 96) spider.trace.splice(0, spider.trace.length - 96);
  }

  private drawTrail(spider: Crawler) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (let i = 1; i < spider.trace.length; i++) {
      const start = spider.trace[i - 1]!,
        end = spider.trace[i]!,
        fade = Math.pow(clamp(1 - (this.clock - end.time) / 2600, 0, 1), 1.1);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = this.colors.accent;
      ctx.globalAlpha = fade * 0.16;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = this.colors.thread;
      ctx.globalAlpha = fade * 0.68;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      if (i % 4 === 0) {
        ctx.globalAlpha = fade * 0.34;
        ctx.drawImage(this.glow, end.x - 8, end.y - 8, 16, 16);
        ctx.fillStyle = this.colors.accent;
        ctx.beginPath();
        ctx.arc(end.x, end.y, 1, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawLegs(spider: Crawler, dt: number, still: boolean) {
    const ctx = this.ctx;
    for (let leg = 0; leg < 8; leg++) {
      const side = leg < 4 ? -1 : 1,
        row = leg % 4,
        hip = project(spider, 12 - row * 7, side * 6),
        phase = (spider.cycle + ((row + (side > 0 ? 1 : 0)) % 2) * 0.5) % 1,
        stance = 0.6,
        landing = project(
          spider,
          35 - row * 22 + clamp(spider.speed * 0.13, 3, 23),
          side * (row === 1 || row === 2 ? 61 : 49),
        );
      let foot = spider.feet[leg];
      if (!foot) {
        const initial = project(spider, 35 - row * 22, side * (row === 1 || row === 2 ? 61 : 49));
        foot = spider.feet[leg] = {
          position: initial,
          origin: initial,
          destination: initial,
          swinging: false,
          landedAt: this.clock,
          lift: 0,
        };
      }
      if (!still && dt > 0) {
        const shouldStep = phase >= stance || length(hip, foot.position) > 88 * spider.size;
        if (shouldStep && !foot.swinging) {
          foot.swinging = true;
          foot.origin = { ...foot.position };
          foot.destination = landing;
        }
        if (foot.swinging) {
          const t = phase >= stance ? (phase - stance) / (1 - stance) : 1;
          foot.position = mix(foot.origin, foot.destination, smooth(clamp(t, 0, 1)));
          foot.lift = Math.sin(t * Math.PI) * 7;
          // Slight lateral arc conveys lift; stance feet stay fixed in world coordinates.
          foot.position.y -= foot.lift;
          if (t >= 0.97 || phase < stance) {
            foot.position = { ...foot.destination };
            foot.swinging = false;
            foot.landedAt = this.clock;
            foot.lift = 0;
          }
        }
      }
      const dx = foot.position.x - hip.x,
        dy = foot.position.y - hip.y,
        reach = clamp(Math.hypot(dx, dy), 1, 89 * spider.size),
        ux = dx / Math.max(Math.hypot(dx, dy), 1),
        uy = dy / Math.max(Math.hypot(dx, dy), 1),
        upper = 39 * spider.size,
        lower = 52 * spider.size,
        along = (upper * upper - lower * lower + reach * reach) / (2 * reach),
        bend = Math.sqrt(Math.max(0, upper * upper - along * along)),
        preferred = project(spider, 24 - row * 15, side * 28),
        optionA = { x: hip.x + ux * along - uy * bend, y: hip.y + uy * along + ux * bend },
        optionB = { x: hip.x + ux * along + uy * bend, y: hip.y + uy * along - ux * bend },
        knee = length(optionA, preferred) < length(optionB, preferred) ? optionA : optionB;
      ctx.setLineDash([]);
      ctx.globalAlpha = foot.swinging ? 0.7 : 0.9;
      ctx.strokeStyle = this.colors.joint;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(knee.x, knee.y);
      ctx.lineTo(foot.position.x, foot.position.y);
      ctx.stroke();
      ctx.strokeStyle = this.colors.accent;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hip.x, hip.y);
      ctx.lineTo(hip.x + (knee.x - hip.x) * 0.44, hip.y + (knee.y - hip.y) * 0.44);
      ctx.stroke();
      ctx.fillStyle = this.colors.joint;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(knee.x, knee.y, 1.6 * spider.size, 0, TAU);
      ctx.fill();
      const contact = clamp(1 - (this.clock - foot.landedAt) / 220, 0, 1),
        halo = (18 + contact * 9) * spider.size;
      ctx.globalAlpha = foot.swinging ? 0.28 : 0.48 + contact * 0.16;
      ctx.drawImage(this.glow, foot.position.x - halo / 2, foot.position.y - halo / 2, halo, halo);
      if (contact > 0 && !still) {
        ctx.globalAlpha = contact * 0.65;
        ctx.strokeStyle = this.colors.accent;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(foot.position.x, foot.position.y, (3 + (1 - contact) * 5) * spider.size, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = this.colors.accent;
      ctx.beginPath();
      ctx.arc(foot.position.x, foot.position.y, (foot.swinging ? 1.6 : 2.35) * spider.size, 0, TAU);
      ctx.fill();
      ctx.fillStyle = this.colors.highlight;
      ctx.beginPath();
      ctx.arc(foot.position.x - 0.3, foot.position.y - 0.3, 0.75 * spider.size, 0, TAU);
      ctx.fill();
    }
  }

  private drawBody(spider: Crawler, still: boolean) {
    const ctx = this.ctx,
      bob = still ? 0 : Math.sin(spider.cycle * TAU * 2) * 0.65;
    ctx.save();
    ctx.translate(spider.x, spider.y + bob);
    ctx.rotate(spider.angle);
    ctx.scale(spider.size, spider.size);
    ctx.globalAlpha = 0.25;
    ctx.drawImage(this.glow, -35, -24, 56, 48);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colors.fill;
    ctx.strokeStyle = this.colors.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(-8, 0, 14, 9, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(9, 0, 7.5, 6, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(-8, 0, 9.5, 5.3, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-1, 0);
    ctx.stroke();
    ctx.strokeStyle = this.colors.joint;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(14, -3);
    ctx.lineTo(20, -5);
    ctx.lineTo(23, -2);
    ctx.moveTo(14, 3);
    ctx.lineTo(20, 5);
    ctx.lineTo(23, 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.colors.highlight;
    for (const eye of [-2.5, 2.5]) {
      ctx.beginPath();
      ctx.arc(12, eye, 1.3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
