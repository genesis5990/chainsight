'use client';

/**
 * Path builder + Report Draft side drawer (Surface 5).
 *
 * Slides in from the right when PSR mode is active. Shows:
 *   - Path name editor
 *   - Color picker (curated palette only)
 *   - Methodology selector
 *   - Hop list (chronological, editable: remove last, reorder)
 *   - Investigator commentary textarea
 *   - Report draft sections (status chips per section, mock body)
 *   - Save as draft / Promote to under_review buttons
 */

import { ArrowDown, Award, CircleCheck, FileText, Loader2, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../../lib/cn';
import {
  PATH_HEX,
  type CanvasNode,
  type CanvasNodeId,
  type PathColor,
  type PsrDraft,
  type PsrReportDraft,
  type TaintMethodology,
} from '@chainsight/shared-types';

const PATH_COLOR_GROUPS: Array<{ label: string; colors: PathColor[] }> = [
  { label: 'Cool (default for investigator paths)', colors: ['cool_blue', 'cool_teal', 'cool_violet', 'cool_indigo'] },
  { label: 'Warm (AI-suggested, promoted)', colors: ['warm_orange', 'warm_red', 'warm_magenta'] },
  { label: 'Primary evidentiary (one per case)', colors: ['accent_gold', 'accent_lime'] },
  { label: 'Neutral (archived / reference)', colors: ['neutral_gray'] },
];

const METHODOLOGY_LABELS: Record<TaintMethodology, string> = {
  fifo: 'FIFO',
  lifo: 'LIFO',
  hifo: 'HIFO',
  libr: 'LIBR',
  pari_passu: 'Pari-passu',
  rolling_charge: 'Rolling charge',
};

export interface PsrDrawerProps {
  open: boolean;
  draft: PsrDraft;
  report: PsrReportDraft;
  nodeMap: Map<CanvasNodeId, CanvasNode>;
  onClose: () => void;
  onChange: (next: PsrDraft) => void;
  onRemoveHop: (index: number) => void;
  onSaveDraft: () => void;
  onPromote: () => void;
}

export function PsrDrawer({
  open,
  draft,
  report,
  nodeMap,
  onClose,
  onChange,
  onRemoveHop,
  onSaveDraft,
  onPromote,
}: PsrDrawerProps) {
  const totalHops = draft.ordered_nodes.length;

  const hopRows = useMemo(
    () =>
      draft.ordered_nodes.map((id, i) => ({
        id,
        node: nodeMap.get(id),
        index: i,
      })),
    [draft.ordered_nodes, nodeMap],
  );

  return (
    <aside
      className={cn(
        'fixed top-12 right-0 bottom-7 z-30 w-[420px] bg-white border-l border-context-100 shadow-xl flex flex-col transition-transform duration-200',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="px-4 py-3 border-b border-context-100 bg-context-100/30 flex items-center gap-2 shrink-0">
        <FileText className="size-4 text-markup-700" />
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-context-700 flex-1">
          Path & Report Draft
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-context-500 hover:text-context-700"
        >
          Close
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        {/* Path name */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
            Path name
          </label>
          <input
            type="text"
            value={draft.display_name}
            onChange={(e) => onChange({ ...draft, display_name: e.target.value })}
            placeholder='e.g. "Path C \u2014 Bridge to Tron"'
            className="w-full mt-1 px-2.5 py-1.5 text-[13px] border border-context-100 rounded focus:outline-none focus:border-markup-500"
          />
        </div>

        {/* Color picker */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
            Color
          </label>
          <div className="mt-1 space-y-2">
            {PATH_COLOR_GROUPS.map((g) => (
              <div key={g.label}>
                <div className="text-[10px] text-context-500 mb-1">{g.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.colors.map((c) => {
                    const active = draft.color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onChange({ ...draft, color: c })}
                        className={cn(
                          'size-6 rounded-full ring-2 ring-offset-1 transition-all',
                          active ? 'ring-context-700 scale-110' : 'ring-transparent hover:scale-105',
                        )}
                        style={{ background: PATH_HEX[c] }}
                        title={c.replace('_', ' ')}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Methodology + primary */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
              Methodology
            </label>
            <select
              value={draft.methodology}
              onChange={(e) =>
                onChange({ ...draft, methodology: e.target.value as TaintMethodology })
              }
              className="w-full mt-1 px-2 py-1.5 text-[12px] border border-context-100 rounded bg-white"
            >
              {(Object.keys(METHODOLOGY_LABELS) as TaintMethodology[]).map((m) => (
                <option key={m} value={m}>
                  {METHODOLOGY_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-end gap-2 text-[11px] text-context-700 pb-1.5">
            <input
              type="checkbox"
              checked={draft.is_primary_candidate}
              onChange={(e) =>
                onChange({ ...draft, is_primary_candidate: e.target.checked })
              }
            />
            <span className="leading-tight">
              Primary evidentiary path
              <span className="block text-[10px] text-context-500">
                (one per case wears gold)
              </span>
            </span>
          </label>
        </div>

        {/* Hop list */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
              Hops ({totalHops})
            </label>
            <span className="text-[10px] text-context-500">
              Shift+click in canvas to extend
            </span>
          </div>
          {totalHops === 0 ? (
            <p className="text-[12px] text-context-500 italic px-1">
              Empty path. Shift+click any node in the canvas to add the first hop.
            </p>
          ) : (
            <ol className="space-y-1">
              {hopRows.map(({ id, node, index }) => (
                <li
                  key={id}
                  className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded border border-context-100 bg-white"
                >
                  <span className="font-mono text-[10px] text-context-500 w-5 text-right tabular-nums">
                    {index + 1}
                  </span>
                  <span
                    className="size-2 rounded-full shrink-0"
                    style={{ background: PATH_HEX[draft.color] }}
                  />
                  <span className="flex-1 min-w-0 truncate text-context-700">
                    {nodeLabel(node, id)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider font-mono text-context-500 shrink-0">
                    {node?.kind === 'transaction'
                      ? 'tx'
                      : node?.kind === 'address'
                        ? 'addr'
                        : '?'}
                  </span>
                  {index === totalHops - 1 && (
                    <button
                      type="button"
                      onClick={() => onRemoveHop(index)}
                      title="Remove last hop (Alt+click in canvas)"
                      className="size-5 inline-flex items-center justify-center text-context-500 hover:text-taint-700"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Commentary */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
            Investigator commentary
          </label>
          <textarea
            value={draft.commentary}
            onChange={(e) => onChange({ ...draft, commentary: e.target.value })}
            rows={3}
            placeholder='Flows into Report \u00a76. e.g. "This is the off-ramp path \u2014 prosecutor will lead with it."'
            className="w-full mt-1 px-2.5 py-1.5 text-[12px] border border-context-100 rounded focus:outline-none focus:border-markup-500 resize-y"
          />
        </div>

        {/* Report draft sections */}
        <div>
          <label className="text-[10px] uppercase tracking-wider font-bold text-context-500">
            Report draft (Narrative Agent)
          </label>
          <ul className="mt-2 space-y-1">
            {report.sections.map((s, i) => (
              <li
                key={s.id}
                className="flex items-center gap-2 text-[12px] px-2 py-1.5 rounded border border-context-100 bg-white"
              >
                <span className="font-mono text-[10px] text-context-500 w-4 text-right">
                  {i + 1}
                </span>
                <span className="flex-1 text-context-700">{s.title}</span>
                <SectionStatusChip status={s.status} verifierPassed={s.verifier_passed} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <footer className="px-4 py-3 border-t border-context-100 flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={totalHops < 2 || !draft.display_name.trim()}
          className="text-[11px] font-medium px-2.5 py-1.5 rounded border border-context-100 hover:bg-context-100/60 text-context-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          <ArrowDown className="size-3" /> Save draft
        </button>
        <button
          type="button"
          onClick={onPromote}
          disabled={totalHops < 2 || !draft.display_name.trim()}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded border border-markup-500 bg-markup-100/40 hover:bg-markup-100/80 text-markup-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          <Award className="size-3" /> Promote to under_review
        </button>
      </footer>
    </aside>
  );
}

function SectionStatusChip({
  status,
  verifierPassed,
}: {
  status: 'pending' | 'drafting' | 'ready' | 'failed';
  verifierPassed: boolean;
}) {
  if (status === 'drafting') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-elevated-700">
        <Loader2 className="size-3 animate-spin" /> drafting
      </span>
    );
  }
  if (status === 'ready' && verifierPassed) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-clean-700">
        <CircleCheck className="size-3" /> verified
      </span>
    );
  }
  if (status === 'ready') {
    return <span className="text-[10px] text-context-500">draft</span>;
  }
  if (status === 'failed') {
    return <span className="text-[10px] text-taint-700">failed</span>;
  }
  return <span className="text-[10px] text-context-500 italic">pending</span>;
}

function nodeLabel(node: CanvasNode | undefined, id: string): string {
  if (!node) return id;
  if (node.kind === 'address') {
    return node.label ?? `${node.address.slice(0, 22)}\u2026`;
  }
  return `tx ${node.tx_hash.slice(0, 14)}\u2026`;
}
