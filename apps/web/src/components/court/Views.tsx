'use client';

/**
 * The four primary courtroom views from v0.5 addendum §3.3:
 *   - OverTimeView    (View A)  horizontal timeline scrub
 *   - ByValueView     (View B)  Sankey of taint flow
 *   - ByTracePathView (View C)  TracePath hop-by-hop
 *   - ByEntityView    (View D)  actor-centric
 * Plus title-card and document-frame supporting views.
 *
 * Every view is a stateless presentational component. The CourtMode shell
 * drives state — these only render the current frame.
 */

import { ArrowRight, Clock, FileText, Hash, Network, Users } from 'lucide-react';
import type {
  ByEntityFramePayload,
  ByTracePathFramePayload,
  ByValueFramePayload,
  CourtFrame,
  DocumentFramePayload,
  OverTimeFramePayload,
  SankeyFlow,
  SankeyNode,
  TitleFramePayload,
} from '@chainsight/shared-types';
import { cn } from '../../lib/cn';

// =====================================================================
// Title card
// =====================================================================

export function TitleView({ frame }: { frame: CourtFrame & { payload: TitleFramePayload } }) {
  const p = frame.payload;
  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-12 text-center">
      <div className="text-[11px] uppercase tracking-[0.3em] text-context-500 font-semibold mb-6">
        ChainSight presentation
      </div>
      <h1 className="text-5xl font-bold text-context-700 leading-tight mb-3">{frame.title}</h1>
      {frame.subtitle && (
        <p className="text-xl text-context-500 mb-10 max-w-3xl">{frame.subtitle}</p>
      )}
      {p.hero && (
        <div className="text-7xl font-mono font-bold text-taint-700 mb-10 tabular-nums">
          {p.hero}
        </div>
      )}
      {p.bullets && p.bullets.length > 0 && (
        <ul className="space-y-3 text-2xl text-context-700 max-w-2xl text-left">
          {p.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="text-markup-500 font-bold mt-1">›</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// View A — Over Time (horizontal timeline)
// =====================================================================

export function OverTimeView({
  frame,
}: {
  frame: CourtFrame & { payload: OverTimeFramePayload };
}) {
  const p = frame.payload;
  const start = new Date(p.range_start).getTime();
  const end = new Date(p.range_end).getTime();
  const span = Math.max(1, end - start);
  const playheadAt = new Date(p.playhead_at).getTime();
  const playheadPct = ((playheadAt - start) / span) * 100;

  return (
    <div className="h-full w-full flex flex-col px-12 py-8">
      <ViewHeader icon={<Clock className="size-6" />} title={frame.title} subtitle={frame.subtitle} />

      <div className="flex-1 flex flex-col justify-center">
        {/* Event list (only those ≤ playhead) */}
        <ol className="space-y-2 max-h-[55vh] overflow-y-auto px-2">
          {p.events.map((ev) => {
            const at = new Date(ev.at).getTime();
            const isPlayhead = Math.abs(at - playheadAt) < 60_000;
            return (
              <li
                key={ev.id}
                className={cn(
                  'flex items-center gap-4 px-4 py-2.5 rounded border',
                  isPlayhead
                    ? 'border-markup-500/60 bg-markup-100/40'
                    : 'border-context-100 bg-white/50',
                )}
              >
                <span className="font-mono text-[11px] text-context-500 w-44 shrink-0">
                  {new Date(ev.at).toLocaleString('en-US', {
                    timeZone: 'UTC',
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}{' '}
                  UTC
                </span>
                <span
                  className={cn(
                    'text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0',
                    EVENT_KIND_TONE[ev.kind] ?? 'bg-context-100 text-context-700',
                  )}
                >
                  {ev.kind}
                </span>
                <span className="flex-1 text-[15px] text-context-700">{ev.label}</span>
                {ev.value_fiat && (
                  <span className="font-mono text-[13px] text-context-700 shrink-0">
                    {ev.value_fiat}
                  </span>
                )}
                {ev.chain && (
                  <span className="text-[10px] uppercase text-context-500 shrink-0">
                    {ev.chain}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Timeline scrubber */}
      <div className="mt-6">
        <div className="relative h-2 bg-context-100 rounded-full">
          <div
            className="absolute top-0 left-0 h-full bg-markup-500/30 rounded-full"
            style={{ width: `${playheadPct}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 size-4 rounded-full bg-markup-700 ring-4 ring-markup-100"
            style={{ left: `calc(${playheadPct}% - 8px)` }}
            aria-label="Playhead"
          />
        </div>
        <div className="flex justify-between mt-2 text-[10px] font-mono text-context-500">
          <span>{new Date(p.range_start).toISOString().slice(0, 10)}</span>
          <span className="text-markup-700 font-semibold">
            {new Date(p.playhead_at).toLocaleString('en-US', {
              timeZone: 'UTC',
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            UTC
          </span>
          <span>{new Date(p.range_end).toISOString().slice(0, 10)}</span>
        </div>
      </div>
    </div>
  );
}

const EVENT_KIND_TONE: Record<string, string> = {
  tx: 'bg-context-100 text-context-700',
  mark: 'bg-markup-100 text-markup-700',
  subpoena: 'bg-clean-100 text-clean-700',
  finding: 'bg-taint-100 text-taint-700',
  memo: 'bg-elevated-100 text-elevated-700',
};

// =====================================================================
// View B — By Value (Sankey)
// =====================================================================

export function ByValueView({ frame }: { frame: CourtFrame & { payload: ByValueFramePayload } }) {
  const p = frame.payload;
  return (
    <div className="h-full w-full flex flex-col px-12 py-8">
      <ViewHeader icon={<Network className="size-6" />} title={frame.title} subtitle={frame.subtitle} />
      <div className="flex-1 min-h-0">
        <SankeyDiagram
          nodes={p.sankey_nodes}
          flows={p.sankey_flows}
          highlightFlowId={p.highlight_flow_id}
        />
      </div>
    </div>
  );
}

/**
 * Minimal Sankey renderer in pure SVG.
 * Three columns (source / intermediate / sink); flows are quadratic
 * bezier ribbons whose width is proportional to share_of_source.
 * Phase 1 will swap this for d3-sankey when we need real layout.
 */
function SankeyDiagram({
  nodes,
  flows,
  highlightFlowId,
}: {
  nodes: SankeyNode[];
  flows: SankeyFlow[];
  highlightFlowId?: string;
}) {
  const W = 1100;
  const H = 500;
  const margin = { top: 40, right: 220, bottom: 20, left: 220 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const colX: Record<SankeyNode['side'], number> = {
    source: margin.left,
    intermediate: margin.left + innerW / 2,
    sink: margin.left + innerW,
  };

  // Group nodes by side and lay out vertically with even spacing weighted by
  // total flow share through them.
  const bySide: Record<SankeyNode['side'], SankeyNode[]> = {
    source: [],
    intermediate: [],
    sink: [],
  };
  for (const n of nodes) bySide[n.side].push(n);

  const nodeWeight = new Map<string, number>();
  for (const f of flows) {
    nodeWeight.set(f.from, (nodeWeight.get(f.from) ?? 0) + f.share_of_source);
    nodeWeight.set(f.to, (nodeWeight.get(f.to) ?? 0) + f.share_of_source);
  }

  const nodePos = new Map<string, { x: number; y: number; h: number }>();
  for (const side of ['source', 'intermediate', 'sink'] as const) {
    const list = bySide[side];
    const totalWeight =
      list.reduce((s, n) => s + (nodeWeight.get(n.id) ?? 0.001), 0) || list.length;
    let yCursor = margin.top;
    const gap = 10;
    const availableH = innerH - gap * Math.max(0, list.length - 1);
    for (const n of list) {
      const w = nodeWeight.get(n.id) ?? 0.001;
      const h = Math.max(20, (w / totalWeight) * availableH);
      nodePos.set(n.id, { x: colX[side], y: yCursor, h });
      yCursor += h + gap;
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      {/* Flows */}
      {flows.map((f) => {
        const a = nodePos.get(f.from);
        const b = nodePos.get(f.to);
        if (!a || !b) return null;
        const strokeW = Math.max(2, f.share_of_source * 80);
        const midX = (a.x + b.x) / 2;
        const ay = a.y + a.h / 2;
        const by = b.y + b.h / 2;
        const d = `M ${a.x + 14},${ay} C ${midX},${ay} ${midX},${by} ${b.x - 14},${by}`;
        const isHighlight = f.id === highlightFlowId;
        return (
          <g key={f.id}>
            <path
              d={d}
              fill="none"
              stroke={
                isHighlight
                  ? '#b91c1c'
                  : f.taint_share && f.taint_share > 0.5
                    ? '#ef4444'
                    : f.taint_share && f.taint_share > 0.1
                      ? '#f97316'
                      : '#cbd5e1'
              }
              strokeOpacity={isHighlight ? 0.85 : 0.55}
              strokeWidth={strokeW}
              strokeLinecap="round"
            />
            {/* Value label at midpoint when wide enough */}
            {strokeW > 18 && (
              <text
                x={midX}
                y={(ay + by) / 2}
                textAnchor="middle"
                fontSize="11"
                fill="#ffffff"
                fontWeight="600"
              >
                {f.value_fiat}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const pos = nodePos.get(n.id);
        if (!pos) return null;
        const fill = SANKEY_FAMILY_FILL[n.family];
        const stroke = SANKEY_FAMILY_STROKE[n.family];
        const labelX = n.side === 'source' ? pos.x - 18 : n.side === 'sink' ? pos.x + 18 : pos.x;
        const labelAnchor: 'start' | 'end' | 'middle' =
          n.side === 'source' ? 'end' : n.side === 'sink' ? 'start' : 'middle';
        return (
          <g key={n.id}>
            <rect
              x={pos.x - 14}
              y={pos.y}
              width={28}
              height={pos.h}
              rx={6}
              fill={fill}
              stroke={stroke}
              strokeWidth={1.5}
            />
            <text
              x={labelX}
              y={pos.y + pos.h / 2 + 4}
              textAnchor={labelAnchor}
              fontSize="12"
              fill="#374151"
              fontWeight="500"
            >
              {n.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const SANKEY_FAMILY_FILL: Record<SankeyNode['family'], string> = {
  taint: '#fee2e2',
  elevated: '#ffedd5',
  caution: '#fef9c3',
  clean: '#dcfce7',
  privacy: '#f3e8ff',
  context: '#f3f4f6',
};
const SANKEY_FAMILY_STROKE: Record<SankeyNode['family'], string> = {
  taint: '#b91c1c',
  elevated: '#c2410c',
  caution: '#a16207',
  clean: '#15803d',
  privacy: '#7e22ce',
  context: '#374151',
};

// =====================================================================
// View C — By Trace Path (hop-by-hop playback)
// =====================================================================

export function ByTracePathView({
  frame,
}: {
  frame: CourtFrame & { payload: ByTracePathFramePayload };
}) {
  const p = frame.payload;
  const hop = p.hop;
  const progress = (p.hop_index / p.hop_total) * 100;

  return (
    <div className="h-full w-full flex flex-col px-12 py-8">
      <ViewHeader icon={<Hash className="size-6" />} title={frame.title} subtitle={frame.subtitle} />

      <div className="mt-2 mb-6">
        <div className="flex items-baseline justify-between text-context-700">
          <span className="text-2xl font-semibold">
            Hop <span className="text-markup-700 tabular-nums">{p.hop_index}</span>
            <span className="text-context-500 text-lg"> of {p.hop_total}</span>
          </span>
          <span className="text-[12px] uppercase tracking-wider font-semibold text-context-500">
            {hop.chain} · {new Date(hop.at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC
          </span>
        </div>
        <div className="mt-2 h-1.5 bg-context-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-gold bg-elevated-500 transition-all"
            style={{ width: `${progress}%`, background: '#d97706' }}
          />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left: from \u2192 tx \u2192 to */}
        <div className="col-span-7 flex flex-col gap-4 justify-center">
          <HopRow label="From" value={hop.from_address} />
          <div className="self-center text-context-500">
            <ArrowRight className="size-6" />
          </div>
          <div className="rounded-lg border-2 border-elevated-500 bg-elevated-100/40 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-elevated-700 mb-1">
              Transaction
            </div>
            <div className="font-mono text-[13px] text-context-700 break-all">{hop.tx_hash}</div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
              <KV label="Value" value={`${hop.value_native}`} />
              <KV label="Fiat at tx" value={hop.value_fiat_at_tx} />
              <KV label="Cum. taint" value={`${(hop.cumulative_taint_pct * 100).toFixed(1)}%`} />
              <KV
                label="Since source"
                value={`${(hop.elapsed_since_source_ms / 1000 / 60).toFixed(0)} min`}
              />
            </div>
          </div>
          <div className="self-center text-context-500">
            <ArrowRight className="size-6" />
          </div>
          <HopRow label="To" value={hop.to_address} />
        </div>

        {/* Right: attributions + memo */}
        <div className="col-span-5 flex flex-col gap-4">
          {hop.attributions && hop.attributions.length > 0 && (
            <div className="rounded-lg border border-context-100 px-5 py-4 bg-white/60">
              <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2">
                Attributions in play
              </div>
              <ul className="space-y-1.5">
                {hop.attributions.map((a, i) => (
                  <li key={i} className="text-[13px] text-context-700 flex items-baseline gap-2">
                    <span className="text-[10px] uppercase font-mono text-context-500 w-20 shrink-0">
                      {a.provider}
                    </span>
                    <span className="flex-1">{a.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hop.memo && (
            <div className="rounded-lg border border-markup-500/40 bg-markup-100/30 px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-bold text-markup-700 mb-2">
                Investigator memo
              </div>
              <p className="text-[14px] text-context-700 leading-relaxed">{hop.memo}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HopRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-context-100 bg-white/60 px-5 py-3">
      <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-1">
        {label}
      </div>
      <div className="font-mono text-[14px] text-context-700 break-all">{value}</div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-context-500">{label}</div>
      <div className="font-mono text-context-700 tabular-nums">{value}</div>
    </div>
  );
}

// =====================================================================
// View D — By Entity (actor-centric)
// =====================================================================

export function ByEntityView({
  frame,
}: {
  frame: CourtFrame & { payload: ByEntityFramePayload };
}) {
  const p = frame.payload;
  return (
    <div className="h-full w-full flex flex-col px-12 py-8">
      <ViewHeader icon={<Users className="size-6" />} title={frame.title} subtitle={frame.subtitle} />

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left: entity identity + attributions */}
        <div className="col-span-5 flex flex-col gap-4 min-h-0">
          <div className="rounded-lg border-2 border-markup-500 bg-markup-100/30 px-5 py-4">
            <div className="text-[10px] uppercase tracking-wider font-bold text-markup-700 mb-1">
              Entity in focus
            </div>
            <div className="text-2xl font-semibold text-context-700">{p.entity_label}</div>
            <div className="font-mono text-[12px] text-context-500 mt-1 break-all">
              {p.entity_chain}:{p.entity_address}
            </div>
          </div>

          {p.attributions.length > 0 && (
            <div className="rounded-lg border border-context-100 bg-white/60 px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2">
                Attributions
              </div>
              <ul className="space-y-1.5">
                {p.attributions.map((a, i) => (
                  <li key={i} className="text-[13px] text-context-700 flex items-baseline gap-2">
                    <span className="text-[10px] uppercase font-mono text-context-500 w-20 shrink-0">
                      {a.provider}
                    </span>
                    <span className="flex-1">{a.label}</span>
                    <span className="text-[10px] font-mono text-context-500 shrink-0">
                      {(a.confidence * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.subpoena_refs.length > 0 && (
            <div className="rounded-lg border border-clean-500/40 bg-clean-100/30 px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-bold text-clean-700 mb-2">
                Subpoena returns
              </div>
              <ul className="space-y-1">
                {p.subpoena_refs.map((s) => (
                  <li key={s.id} className="text-[12px] text-context-700">
                    <span className="font-mono text-context-500 mr-2">{s.date.slice(0, 10)}</span>
                    {s.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {p.memos.length > 0 && (
            <div className="rounded-lg border border-elevated-500/40 bg-elevated-100/30 px-5 py-4">
              <div className="text-[10px] uppercase tracking-wider font-bold text-elevated-700 mb-2">
                Memos
              </div>
              <ul className="space-y-2">
                {p.memos.map((m) => (
                  <li key={m.id} className="text-[12px] text-context-700">
                    <span className="font-mono text-context-500 mr-2">
                      {m.at.slice(0, 10)} · {m.author}
                    </span>
                    {m.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right: chronological tx ledger */}
        <div className="col-span-7 flex flex-col min-h-0">
          <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2">
            All transactions ({p.transactions.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white/95 backdrop-blur">
                <tr className="text-left text-context-500">
                  <th className="py-1.5 px-2 font-medium">When</th>
                  <th className="py-1.5 px-2 font-medium">Dir</th>
                  <th className="py-1.5 px-2 font-medium">Counterparty</th>
                  <th className="py-1.5 px-2 font-medium text-right">Value</th>
                  <th className="py-1.5 px-2 font-medium text-right">Fiat</th>
                </tr>
              </thead>
              <tbody>
                {p.transactions.map((row) => (
                  <tr key={row.tx_ref} className="border-t border-context-100">
                    <td className="py-1.5 px-2 font-mono text-context-700">
                      {row.at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-1.5 px-2">
                      <span
                        className={cn(
                          'inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider',
                          row.direction === 'in'
                            ? 'bg-clean-100 text-clean-700'
                            : 'bg-elevated-100 text-elevated-700',
                        )}
                      >
                        {row.direction}
                      </span>
                    </td>
                    <td className="py-1.5 px-2">
                      <div className="text-context-700">
                        {row.counterparty_label ?? '—'}
                      </div>
                      <div className="font-mono text-[10px] text-context-500 truncate max-w-[260px]">
                        {row.counterparty_address}
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-context-700 tabular-nums">
                      {row.value_native}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-context-700 tabular-nums">
                      {row.value_fiat_at_tx}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Document frame
// =====================================================================

export function DocumentView({
  frame,
}: {
  frame: CourtFrame & { payload: DocumentFramePayload };
}) {
  const p = frame.payload;
  return (
    <div className="h-full w-full flex flex-col px-12 py-8">
      <ViewHeader icon={<FileText className="size-6" />} title={frame.title} subtitle={frame.subtitle} />
      <div className="flex-1 flex items-center justify-center">
        <div className="w-[560px] aspect-[8.5/11] bg-white shadow-2xl border border-context-100 rounded relative">
          <div className="absolute top-6 left-6 right-6 text-[10px] uppercase tracking-wider text-context-500">
            {p.document_title} · page {p.page_number}
          </div>
          <div className="absolute inset-x-6 top-12 text-[10px] leading-relaxed text-context-700 space-y-1">
            <p className="font-mono italic text-context-500">
              [Phase 0 mockup — production renders the actual page from the
              Reproducibility Pack with the bounding box highlighted.]
            </p>
          </div>
          {p.bounding_box && (
            <div
              className="absolute border-2 border-taint-500 bg-taint-100/30"
              style={{
                left: `${p.bounding_box.x}%`,
                top: `${p.bounding_box.y}%`,
                width: `${p.bounding_box.w}%`,
                height: `${p.bounding_box.h}%`,
              }}
            />
          )}
        </div>
      </div>
      {p.supports_claim && (
        <div className="mt-4 text-center text-[13px] text-context-700 italic">
          &ldquo;{p.supports_claim}&rdquo;
        </div>
      )}
    </div>
  );
}

// =====================================================================
// shared: view header
// =====================================================================

function ViewHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-3">
        <span className="text-markup-700">{icon}</span>
        <h2 className="text-3xl font-bold text-context-700">{title}</h2>
      </div>
      {subtitle && <p className="mt-1 text-[15px] text-context-500 max-w-3xl">{subtitle}</p>}
    </div>
  );
}
