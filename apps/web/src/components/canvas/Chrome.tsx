'use client';

/**
 * Surface 2 — Canvas chrome: top bar, left layer rail, right Important
 * sidebar, bottom status bar. The actual graph viewport is rendered by
 * <CanvasView /> inside the shell's center region.
 *
 * Layout (desktop only — canvas isn't a phone surface):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ Top bar — case name · refresh · methodology · layer summary │
 *   ├──────┬─────────────────────────────────────────┬────────────┤
 *   │ Left │                                         │ Important  │
 *   │ rail │     <CanvasView />                      │ sidebar    │
 *   │      │                                         │            │
 *   ├──────┴─────────────────────────────────────────┴────────────┤
 *   │ Status bar — node count · path count · last refresh         │
 *   └─────────────────────────────────────────────────────────────┘
 */

import {
  Eye,
  EyeOff,
  Filter,
  Layers,
  Play,
  RefreshCw,
  Star,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import {
  type CanvasCaseGraph,
  type CanvasLayerToggles,
  type CanvasNode,
  type InvestigatorMark,
  type ImportanceLevel,
  type PathColor,
  PATH_HEX,
  type TaintMethodology,
  type TracePath,
} from '@chainsight/shared-types';

// =====================================================================
// Top bar
// =====================================================================

export interface TopBarProps {
  caseName: string;
  methodology: TaintMethodology;
  onMethodologyChange: (m: TaintMethodology) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  /** When set, show a tiny "Inspector spawned" indicator. */
  lastEvent?: string;
}

const METHODOLOGY_LABELS: Record<TaintMethodology, string> = {
  fifo: 'FIFO',
  lifo: 'LIFO',
  hifo: 'HIFO',
  libr: 'LIBR',
  pari_passu: 'Pari-passu',
  rolling_charge: 'Rolling charge',
};

export function TopBar({
  caseName,
  methodology,
  onMethodologyChange,
  onRefresh,
  isRefreshing,
  lastEvent,
}: TopBarProps) {
  return (
    <header className="h-12 border-b border-context-100 bg-white/95 backdrop-blur flex items-center gap-3 px-4 shrink-0 z-10">
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-context-500">
          Case
        </div>
        <div className="text-[13px] font-semibold text-context-700 truncate">{caseName}</div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-[11px] text-context-500 flex items-center gap-1.5">
          Taint methodology
          <select
            value={methodology}
            onChange={(e) => onMethodologyChange(e.target.value as TaintMethodology)}
            className="text-[11px] border border-context-100 rounded px-2 py-1 bg-white text-context-700"
          >
            {(Object.keys(METHODOLOGY_LABELS) as TaintMethodology[]).map((m) => (
              <option key={m} value={m}>
                {METHODOLOGY_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded border',
            'border-context-100 text-context-700 hover:bg-context-100/60',
            isRefreshing && 'opacity-50',
          )}
          title="Re-run Math Service annotations"
        >
          <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
          Refresh
        </button>

        {lastEvent && (
          <span className="text-[10px] text-context-500 italic ml-2">{lastEvent}</span>
        )}
      </div>
    </header>
  );
}

// =====================================================================
// Left layer rail
// =====================================================================

export interface LayerRailProps {
  layers: CanvasLayerToggles;
  onLayersChange: (l: CanvasLayerToggles) => void;
}

const LAYER_LABELS: Array<{
  key: keyof CanvasLayerToggles;
  label: string;
  hint: string;
}> = [
  { key: 'show_value_labels', label: 'Edge value labels', hint: 'percentages + amounts on each edge' },
  { key: 'show_path_rings', label: 'Path coloring', hint: 'tint edges with path colors' },
  { key: 'show_marker_icons', label: 'Entity / activity glyphs', hint: 'emoji prefix on node labels' },
  { key: 'show_address_labels', label: 'Address labels', hint: 'human-readable attribution next to nodes' },
  {
    key: 'show_cumulative_taint_overlay',
    label: '"Where did the money go?"',
    hint: 'color every edge by cumulative taint',
  },
  { key: 'show_obfuscation_highlights', label: 'Obfuscation highlights', hint: 'flag peel chains, mixer hops' },
  { key: 'hide_context_only', label: 'Hide context-only nodes', hint: 'reduce visual clutter' },
];

export function LayerRail({ layers, onLayersChange }: LayerRailProps) {
  return (
    <aside className="w-56 border-r border-context-100 bg-white/90 backdrop-blur flex flex-col shrink-0 z-10">
      <SidebarHeader icon={<Layers className="size-4" />} title="Layers" />
      <div className="px-3 py-2 space-y-1">
        {LAYER_LABELS.map((row) => {
          const checked = !!layers[row.key];
          return (
            <label
              key={row.key}
              className="flex items-start gap-2 text-[12px] text-context-700 cursor-pointer hover:bg-context-100/40 px-2 py-1 rounded"
              title={row.hint}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) =>
                  onLayersChange({ ...layers, [row.key]: e.target.checked })
                }
                className="mt-0.5"
              />
              <span className="flex-1 leading-snug">{row.label}</span>
              {checked ? (
                <Eye className="size-3 text-context-500 shrink-0 mt-0.5" />
              ) : (
                <EyeOff className="size-3 text-context-500 shrink-0 mt-0.5 opacity-50" />
              )}
            </label>
          );
        })}
      </div>

      <SidebarHeader icon={<Filter className="size-4" />} title="Quick filters" />
      <div className="px-3 py-2 space-y-1 text-[11px] text-context-500">
        <div className="italic">Phase 1 hookups: family, tier, importance, time window.</div>
      </div>
    </aside>
  );
}

// =====================================================================
// Right Important sidebar (per canvas UX §1.4) + Paths panel
// =====================================================================

export interface ImportantSidebarProps {
  graph: CanvasCaseGraph;
  onJumpTo?: (nodeIdOrPathId: string) => void;
}

const IMPORTANCE_ORDER: ImportanceLevel[] = [
  'court_grade',
  'critical',
  'noteworthy',
  'reference',
];

const IMPORTANCE_LABELS: Record<ImportanceLevel, { label: string; classes: string }> = {
  court_grade: { label: 'Court-grade', classes: 'text-clean-700 bg-clean-100' },
  critical: { label: 'Critical', classes: 'text-taint-700 bg-taint-100' },
  noteworthy: { label: 'Noteworthy', classes: 'text-elevated-700 bg-elevated-100' },
  reference: { label: 'Reference', classes: 'text-context-700 bg-context-100' },
};

export function ImportantSidebar({ graph, onJumpTo }: ImportantSidebarProps) {
  const groupedMarks = useMemo(() => {
    const byLvl: Record<ImportanceLevel, InvestigatorMark[]> = {
      court_grade: [],
      critical: [],
      noteworthy: [],
      reference: [],
    };
    for (const m of graph.marks) byLvl[m.importance].push(m);
    return byLvl;
  }, [graph.marks]);

  const nodeById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of graph.nodes) m.set(n.id, n);
    return m;
  }, [graph.nodes]);

  return (
    <aside className="w-72 border-l border-context-100 bg-white/95 backdrop-blur flex flex-col shrink-0 overflow-y-auto z-10">
      <SidebarHeader icon={<Star className="size-4" />} title="Important" />

      <div className="px-3 py-2 space-y-3">
        {IMPORTANCE_ORDER.map((lvl) => {
          const marks = groupedMarks[lvl];
          if (marks.length === 0) return null;
          const labels = IMPORTANCE_LABELS[lvl];
          return (
            <section key={lvl}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
                    labels.classes,
                  )}
                >
                  {labels.label}
                </span>
                <span className="text-[10px] text-context-500">({marks.length})</span>
              </div>
              <ul className="space-y-1">
                {marks.map((m) => {
                  const node = nodeById.get(m.target_id);
                  const display =
                    node?.kind === 'address'
                      ? (node.label ?? node.address.slice(0, 16) + '…')
                      : node?.kind === 'transaction'
                        ? `tx ${node.tx_hash.slice(0, 10)}…`
                        : m.target_id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => onJumpTo?.(m.target_id)}
                        className="w-full text-left text-[12px] text-context-700 hover:bg-context-100/60 rounded px-2 py-1.5"
                      >
                        <div className="font-medium truncate">{display}</div>
                        {m.rationale && (
                          <div className="text-[11px] text-context-500 leading-snug line-clamp-2 mt-0.5">
                            {m.rationale}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <SidebarHeader icon={<Play className="size-4" />} title="Paths" />
      <ul className="px-3 py-2 space-y-1">
        {graph.paths.map((p) => (
          <PathRow key={p.id} path={p} onClick={() => onJumpTo?.(p.id)} />
        ))}
      </ul>

      <div className="px-3 py-3 border-t border-context-100 mt-auto">
        <button
          type="button"
          className="w-full text-[11px] font-medium border border-markup-500 text-markup-700 hover:bg-markup-100/40 rounded px-2.5 py-1.5"
        >
          Generate report from marked items
        </button>
      </div>
    </aside>
  );
}

function PathRow({ path, onClick }: { path: TracePath; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-start gap-2 text-left text-[12px] text-context-700 hover:bg-context-100/60 rounded px-2 py-1.5"
      >
        <span
          className="size-3 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: PATH_HEX[path.color] }}
        />
        <span className="flex-1 min-w-0">
          <span className="font-medium truncate block">{path.display_name}</span>
          <span className="text-[10px] text-context-500">
            {path.hop_count} hops · {path.methodology.toUpperCase()} ·{' '}
            {path.value_at_terminus_fiat ?? '—'}
            {path.is_primary && ' · primary'}
          </span>
        </span>
        <PathStatusBadge status={path.status} />
      </button>
    </li>
  );
}

function PathStatusBadge({ status }: { status: TracePath['status'] }) {
  const labels: Record<TracePath['status'], { label: string; classes: string }> = {
    draft: { label: 'draft', classes: 'text-context-700 bg-context-100' },
    under_review: { label: 'review', classes: 'text-elevated-700 bg-elevated-100' },
    finalized: { label: 'final', classes: 'text-clean-700 bg-clean-100' },
    archived: { label: 'archived', classes: 'text-context-500 bg-context-100' },
  };
  const l = labels[status];
  return (
    <span
      className={cn(
        'text-[9px] uppercase tracking-wider font-semibold px-1 py-0.5 rounded shrink-0',
        l.classes,
      )}
    >
      {l.label}
    </span>
  );
}

// =====================================================================
// Bottom status bar
// =====================================================================

export interface StatusBarProps {
  nodeCount: number;
  edgeCount: number;
  pathCount: number;
  markCount: number;
  lastRefreshedAt: string;
}

export function StatusBar({
  nodeCount,
  edgeCount,
  pathCount,
  markCount,
  lastRefreshedAt,
}: StatusBarProps) {
  return (
    <footer className="h-7 border-t border-context-100 bg-context-100/30 flex items-center gap-4 px-4 text-[10px] text-context-500 shrink-0 z-10">
      <span>
        <strong className="text-context-700 font-mono">{nodeCount}</strong> nodes
      </span>
      <span>
        <strong className="text-context-700 font-mono">{edgeCount}</strong> edges
      </span>
      <span>
        <strong className="text-context-700 font-mono">{pathCount}</strong> paths
      </span>
      <span>
        <strong className="text-context-700 font-mono">{markCount}</strong> marks
      </span>
      <span className="ml-auto">Last refresh {formatLocal(lastRefreshedAt)}</span>
    </footer>
  );
}

function formatLocal(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// =====================================================================
// Sidebar header — local sub-component
// =====================================================================

function SidebarHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-context-100 bg-context-100/40">
      <span className="text-context-500">{icon}</span>
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-context-700">
        {title}
      </h2>
    </div>
  );
}

// Re-export PathColor only to silence unused-import lints if the host doesn't need it.
export type { PathColor };
