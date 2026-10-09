import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { AnalysisReport, RelationshipEdge } from '@crawlspider/contracts';
import { Minus, Plus, RotateCcw, Pause, Play, ArrowUpRight } from 'lucide-react';
import { percent, units } from './format.js';
import { shareBps, shortAddress, WalletFlags } from './wallet-view.js';

type Point = { x: number; y: number };
type MapNode = Point & { owner: string; amount: string; flagged: boolean; indexed: boolean };
export function RelationshipMap({
  mint,
  report,
  active = false,
  onEvidence,
}: {
  mint: string;
  report?: AnalysisReport | undefined;
  active?: boolean;
  onEvidence?: ((edge: RelationshipEdge) => void) | undefined;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const svg = useRef<SVGSVGElement>(null),
    host = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const animationTime = useRef(0);
  const trails = useRef<Point[][]>(Array.from({ length: 6 }, () => []));
  const pattern = useId();
  const nodes = useMemo(() => {
    if (!report) return [];
    const candidates = new Map<string, string>();
    // Preserve group/evidence endpoints before filling the remaining view with large holders.
    for (const owner of report.risk.metrics.flaggedOwners.slice(0, 12)) {
      const holder = report.snapshot.holders.find((h) => h.owner === owner);
      candidates.set(
        owner,
        holder?.amount || report.graph.nodes.find((n) => n.owner === owner)?.amount || '0',
      );
    }
    for (const edge of report.graph.edges.slice(0, 12)) {
      for (const owner of [edge.from, edge.to]) {
        if (candidates.size >= 24 || owner === mint) continue;
        candidates.set(
          owner,
          report.snapshot.holders.find((h) => h.owner === owner)?.amount ||
            report.graph.nodes.find((n) => n.owner === owner)?.amount ||
            '0',
        );
      }
    }
    for (const holder of report.snapshot.holders) {
      if (candidates.size >= 24) break;
      if (!candidates.has(holder.owner)) candidates.set(holder.owner, holder.amount);
    }
    const list = [...candidates].slice(0, 24);
    return list.map(([owner, amount], i): MapNode => {
      const outer = i < 16,
        index = outer ? i : i - 16;
      const count = outer ? Math.min(list.length, 16) : list.length - 16;
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count + (outer ? 0 : 0.2);
      return {
        owner,
        amount,
        indexed: report.snapshot.holders.some((holder) => holder.owner === owner),
        flagged: report.risk.metrics.flaggedOwners.includes(owner),
        x: 500 + Math.cos(angle) * (outer ? 382 : 242),
        y: 280 + Math.sin(angle) * (outer ? 217 : 142),
      };
    });
  }, [report, mint]);
  const positions = useMemo(() => new Map(nodes.map((node) => [node.owner, node])), [nodes]);
  const edges = useMemo(
    () =>
      (report?.graph.edges || [])
        .filter((edge) => positions.has(edge.from) && positions.has(edge.to))
        .slice(0, 80),
    [report, positions],
  );
  const selectedNode = nodes.find((node) => node.owner === selected);
  const related =
    report?.graph.edges.filter((edge) => edge.from === selected || edge.to === selected) || [];
  useEffect(() => {
    const container = host.current,
      element = svg.current;
    if (!container || !element || !active || !nodes.length) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true,
      last = 0,
      frame = 0;
    const crawlers = [...element.querySelectorAll<SVGGElement>('[data-crawler]')];
    const traces = [...element.querySelectorAll<SVGPathElement>('[data-trace]')];
    const legs = crawlers.map((crawler) => [
      ...crawler.querySelectorAll<SVGPathElement>('[data-leg]'),
    ]);
    const feet = crawlers.map((crawler) => [
      ...crawler.querySelectorAll<SVGCircleElement>('[data-foot]'),
    ]);
    const paths = trails.current;
    function schedule() {
      const running = visible && !document.hidden && !paused && !reduced.matches;
      if (running && !frame) {
        last = 0;
        frame = requestAnimationFrame(animate);
      } else if (!running && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      if (reduced.matches)
        crawlers.forEach((crawler) => {
          crawler.style.opacity = '0';
        });
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      schedule();
    });
    observer.observe(container);
    function animate(now: number) {
      frame = 0;
      const delta = last ? Math.min((now - last) / 1000, 0.04) : 0;
      last = now;
      if (visible && !document.hidden && !paused && !reduced.matches) {
        animationTime.current += delta;
        crawlers.forEach((crawler, i) => {
          const elapsed = animationTime.current + i * 1.14;
          const leg = Math.floor(elapsed / 2.6),
            fraction = (elapsed % 2.6) / 2.6;
          const start =
            leg % 2 === 0
              ? { x: 500, y: 280 }
              : nodes[(Math.floor(leg / 2) * 3 + i * 4) % nodes.length]!;
          const end =
            leg % 2 === 0
              ? nodes[(Math.floor(leg / 2) * 3 + i * 4) % nodes.length]!
              : { x: 500, y: 280 };
          const position = {
            x: start.x + (end.x - start.x) * fraction,
            y: start.y + (end.y - start.y) * fraction,
          };
          const angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
          crawler.setAttribute(
            'transform',
            `translate(${position.x} ${position.y}) rotate(${angle})`,
          );
          legs[i]!.forEach((path, n) => {
            const side = n < 4 ? -1 : 1,
              pair = n % 4;
            const gait = Math.sin(elapsed * 17 + (n % 2) * Math.PI);
            const hip = -8 + pair * 5,
              tipX = hip + (pair - 1.5) * 9 + gait * 8;
            const tipY = side * (27 + Math.max(0, gait) * 5);
            path.setAttribute(
              'd',
              `M ${hip} ${side * 5} L ${tipX - 8} ${side * 17} L ${tipX} ${tipY}`,
            );
            feet[i]![n]!.setAttribute('cx', String(tipX));
            feet[i]![n]!.setAttribute('cy', String(tipY));
          });
          const trail = paths[i]!;
          trail.push(position);
          if (trail.length > 26) trail.shift();
          traces[i]?.setAttribute(
            'd',
            trail.map((point, n) => `${n ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '),
          );
          crawler.style.opacity = '1';
        });
      } else if (reduced.matches) {
        crawlers.forEach((crawler) => {
          crawler.style.opacity = '0';
        });
      }
      if (visible && !document.hidden && !paused && !reduced.matches)
        frame = requestAnimationFrame(animate);
    }
    reduced.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [active, nodes, paused]);
  const zoom = (direction: number) =>
    setViewport((v) => ({ ...v, zoom: Math.max(0.75, Math.min(2.5, v.zoom + direction * 0.25)) }));
  function beginDrag(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button,[data-edge]')) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: viewport.x, panY: viewport.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    const scale = 1000 / event.currentTarget.getBoundingClientRect().width / viewport.zoom;
    const start = drag.current;
    setViewport((v) => ({
      ...v,
      x: Math.max(-600, Math.min(600, start.panX - (event.clientX - start.x) * scale)),
      y: Math.max(-300, Math.min(300, start.panY - (event.clientY - start.y) * scale)),
    }));
  }
  return (
    <div className="relationship-map" ref={host}>
      <div className="map-toolbar">
        <div>
          <strong>Wallet web</strong>
          <span>
            {nodes.length ? `${nodes.length} observed addresses in view` : 'Awaiting holder data'}
          </span>
        </div>
        <div className="map-controls">
          {active && (
            <button
              aria-label={paused ? 'Resume crawler animation' : 'Pause crawler animation'}
              aria-pressed={paused}
              onClick={() => setPaused(!paused)}
            >
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </button>
          )}
          <button aria-label="Zoom out" disabled={viewport.zoom <= 0.75} onClick={() => zoom(-1)}>
            <Minus size={16} />
          </button>
          <button aria-label="Zoom in" disabled={viewport.zoom >= 2.5} onClick={() => zoom(1)}>
            <Plus size={16} />
          </button>
          <button aria-label="Reset map view" onClick={() => setViewport({ x: 0, y: 0, zoom: 1 })}>
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      <svg
        ref={svg}
        className="wallet-web"
        viewBox={`${500 + viewport.x - 500 / viewport.zoom} ${280 + viewport.y - 280 / viewport.zoom} ${1000 / viewport.zoom} ${560 / viewport.zoom}`}
        role="group"
        aria-label="Observed wallet map. Use address buttons to inspect wallets; relationship evidence is also available below."
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <defs>
          <pattern id={pattern} width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" className="map-grid-dot" />
          </pattern>
        </defs>
        <rect x="-1000" y="-1000" width="3000" height="2500" fill={`url(#${pattern})`} />
        <g aria-hidden="true" className="map-orbits">
          <circle cx="500" cy="280" r="80" />
          <circle cx="500" cy="280" r="108" />
          <circle cx="500" cy="280" r="138" />
        </g>
        <g aria-hidden="true">
          {nodes
            .filter((node) => node.indexed)
            .map((node) => (
              <path
                key={node.owner}
                d={`M 500 280 L ${node.x} ${node.y}`}
                className="holder-spoke"
              />
            ))}
        </g>
        {edges.map((edge) => {
          const from = positions.get(edge.from)!,
            to = positions.get(edge.to)!;
          return (
            <g
              key={edge.id}
              data-edge="true"
              role={onEvidence ? 'button' : undefined}
              tabIndex={onEvidence ? 0 : undefined}
              aria-label={
                onEvidence
                  ? `Open ${edge.kind} evidence between ${shortAddress(edge.from)} and ${shortAddress(edge.to)}`
                  : undefined
              }
              onClick={() => onEvidence?.(edge)}
              onKeyDown={(event) => {
                if (onEvidence && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onEvidence(edge);
                }
              }}
              className={`map-edge edge-${edge.strength} ${selected && edge.from !== selected && edge.to !== selected ? 'is-muted' : ''}`}
            >
              <title>
                {edge.kind}: {edge.explanation}
              </title>
              <path
                d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + 38} ${to.x} ${to.y}`}
              />
              {onEvidence && (
                <path
                  className="map-edge-hit"
                  d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 + 38} ${to.x} ${to.y}`}
                />
              )}
            </g>
          );
        })}
        <g className="map-center">
          <circle cx="500" cy="280" r="68" />
          <text x="500" y="272">
            {shortAddress(mint)}
          </text>
          <text x="500" y="297" className="center-detail">
            {report ? `${report.risk.metrics.ownerCount} indexed holders` : 'Awaiting data'}
          </text>
        </g>
        {nodes.map((node) => (
          <foreignObject key={node.owner} x={node.x - 55} y={node.y - 19} width="110" height="38">
            <button
              className={`map-wallet ${node.flagged ? 'is-flagged' : ''} ${selected === node.owner ? 'is-selected' : ''}`}
              title={node.owner}
              aria-label={`Inspect wallet ${node.owner}${node.flagged ? ', risk evidence' : ''}`}
              aria-pressed={selected === node.owner}
              onClick={() => setSelected(selected === node.owner ? null : node.owner)}
            >
              {shortAddress(node.owner)}
            </button>
          </foreignObject>
        ))}
        {active && nodes.length > 0 && (
          <g aria-hidden="true" className="graph-crawlers">
            {Array.from({ length: Math.min(6, nodes.length) }, (_, i) => (
              <path key={`trace-${i}`} data-trace="true" className="crawler-trace" />
            ))}
            {Array.from({ length: Math.min(6, nodes.length) }, (_, i) => (
              <g
                data-crawler="true"
                className="graph-crawler"
                key={i}
                transform="translate(500 280)"
                style={{ opacity: 0 }}
              >
                {Array.from({ length: 8 }, (_, n) => (
                  <path data-leg={n} key={`leg-${n}`} className="crawler-leg" />
                ))}
                <ellipse cx="-4" cy="0" rx="14" ry="8" className="crawler-body" />
                <circle cx="13" cy="0" r="6" className="crawler-body" />
                {Array.from({ length: 8 }, (_, n) => (
                  <circle data-foot={n} key={`foot-${n}`} r="2.5" className="crawler-foot" />
                ))}
              </g>
            ))}
          </g>
        )}
      </svg>
      {nodes.length > 0 && (
        <div className="map-wallet-picker">
          <label htmlFor={`${pattern}-wallet`}>Inspect an observed wallet</label>
          <select
            id={`${pattern}-wallet`}
            value={selected || ''}
            onChange={(event) => setSelected(event.target.value || null)}
          >
            <option value="">Choose a wallet</option>
            {nodes.map((node) => (
              <option key={node.owner} value={node.owner}>
                {shortAddress(node.owner)}
                {node.flagged ? ' · risk evidence' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-direct" />
          On-chain interaction
        </span>
        <span>
          <i className="legend-inferred" />
          Common-control hypothesis
        </span>
        <span>
          <i className="legend-behavior" />
          Behavioral hypothesis
        </span>
      </div>
      <p className="map-note">
        Dotted spokes locate indexed wallets around the mint; they are not wallet-to-wallet
        evidence. Crawlers are a visual guide, not a measure of coverage.
      </p>
      {selectedNode && report && (
        <div className="selected-wallet">
          <div>
            <strong>Selected wallet</strong>
            <button onClick={() => setSelected(null)}>Clear selection</button>
          </div>
          <a
            href={`https://solscan.io/account/${selectedNode.owner}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <code>{selectedNode.owner}</code>
            <ArrowUpRight size={14} />
          </a>
          {selectedNode.indexed ? (
            <p>
              Observed balance: {units(selectedNode.amount, report.identity.decimals)}. Share of
              mint supply:{' '}
              {BigInt(report.identity.supply) > 0n
                ? percent(shareBps(selectedNode.amount, report.identity.supply)!)
                : 'unknown'}
              .
            </p>
          ) : (
            <p>
              This address appears in evidence. A current holder balance was not collected for it.
            </p>
          )}
          <WalletFlags report={report} owner={selectedNode.owner} />
          {related.length ? (
            <ul>
              {related.slice(0, 12).map((edge) => (
                <li key={edge.id}>
                  <span>
                    {edge.kind} · {edge.strength.replaceAll('-', ' ')} · {edge.confidence}{' '}
                    confidence
                  </span>
                  {onEvidence ? (
                    <button onClick={() => onEvidence(edge)}>Open evidence</button>
                  ) : (
                    <span>
                      {edge.signature ? (
                        <a
                          href={`https://solscan.io/tx/${edge.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Transaction ↗
                        </a>
                      ) : (
                        'No single transaction proves this hypothesis'
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No relationship evidence was collected for this address. This does not establish
              independence.
            </p>
          )}
        </div>
      )}
      {report && (
        <p className="map-note">
          {edges.length} of {report.graph.edges.length} evidence edges in view. The tables retain
          all collected addresses and relationships.
        </p>
      )}
    </div>
  );
}
