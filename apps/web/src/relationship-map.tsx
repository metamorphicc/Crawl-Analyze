import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { AnalysisReport, RelationshipEdge } from '@crawlspider/contracts';
import { Minus, Plus, RotateCcw, ArrowUpRight } from 'lucide-react';
import { percent, units } from './format.js';
import { shareBps, shortAddress, WalletFlags } from './wallet-view.js';
import { WalletScene } from './wallet-scene.js';
import { useSpiderActivity } from './spiders.js';

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
  const { motionPaused: paused } = useSpiderActivity();
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const svg = useRef<SVGSVGElement>(null),
    stage = useRef<HTMLDivElement>(null),
    spiderCanvas = useRef<HTMLCanvasElement>(null),
    scene = useRef<WalletScene | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
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
    if (!stage.current || !svg.current || !spiderCanvas.current) return;
    if (!spiderCanvas.current.getContext('2d')) return;
    const controller = new WalletScene(stage.current, svg.current, spiderCanvas.current);
    scene.current = controller;
    return () => {
      controller.destroy();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update({ nodes, edges, viewport, mint, active, paused });
  }, [nodes, edges, viewport, mint, active, paused]);
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
    <div className="relationship-map">
      <div className="map-toolbar">
        <div>
          <strong>Wallet web</strong>
          <span>
            {nodes.length ? `${nodes.length} observed addresses in view` : 'Awaiting holder data'}
          </span>
        </div>
        <div className="map-controls">
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
      <div className="wallet-scene-stage" ref={stage}>
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
                  data-spoke={node.owner}
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
                data-map-edge={edge.id}
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
                <circle
                  data-evidence-packet={edge.id}
                  className="evidence-packet"
                  r="2.5"
                  cx={from.x}
                  cy={from.y}
                  aria-hidden="true"
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
          <g
            aria-hidden="true"
            className="map-core-halo"
            data-core-halo="true"
            transform="translate(500 280)"
          >
            <circle r="84" />
          </g>
          <g aria-hidden="true" className="map-core-orbit" data-core-orbit="true">
            <circle cx="500" cy="280" r="96" strokeDasharray="45 112 8 112" />
            <circle cx="500" cy="280" r="121" strokeDasharray="14 175 35 175" />
          </g>
          <g aria-hidden="true" className="map-scan-signals">
            {nodes
              .filter((node) => node.indexed)
              .map((node) => (
                <g key={node.owner}>
                  <g
                    data-signal-out={node.owner}
                    className="scan-signal-out"
                    style={{ opacity: 0 }}
                  >
                    <path d="M -20 0 L 0 0" />
                    <circle r="3" />
                  </g>
                  <g data-signal-in={node.owner} className="scan-signal-in" style={{ opacity: 0 }}>
                    <path d="M -16 0 L 0 0" />
                    <circle r="2.5" />
                  </g>
                </g>
              ))}
          </g>
          <g className="map-center" data-crawl-anchor="true">
            <circle cx="500" cy="280" r="68" />
            <text x="500" y="272">
              {shortAddress(mint)}
            </text>
            <text x="500" y="297" className="center-detail">
              {report ? `${report.risk.metrics.ownerCount} indexed holders` : 'Awaiting data'}
            </text>
          </g>
          {nodes.map((node) => (
            <g key={node.owner} data-wallet-group={node.owner}>
              <rect
                className="wallet-contact"
                x={node.x - 58}
                y={node.y - 22}
                width="116"
                height="44"
                rx="3"
                aria-hidden="true"
              />
              <foreignObject x={node.x - 55} y={node.y - 19} width="110" height="38">
                <button
                  data-crawl-anchor="true"
                  className={`map-wallet ${node.flagged ? 'is-flagged' : ''} ${selected === node.owner ? 'is-selected' : ''}`}
                  title={node.owner}
                  aria-label={`Inspect wallet ${node.owner}${node.flagged ? ', risk evidence' : ''}`}
                  aria-pressed={selected === node.owner}
                  onClick={() => setSelected(selected === node.owner ? null : node.owner)}
                >
                  {shortAddress(node.owner)}
                </button>
              </foreignObject>
            </g>
          ))}
        </svg>
        <canvas ref={spiderCanvas} className="wallet-scene-spiders" aria-hidden="true" />
      </div>
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
        evidence. Spiders and scanning pulses are visual effects, not a measure of coverage. A saved
        report does not refresh as the scene moves.
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
