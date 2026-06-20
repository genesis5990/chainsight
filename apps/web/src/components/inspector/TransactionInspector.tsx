'use client';

/**
 * Surface 1 — Transaction Inspector
 *
 * A non-modal popup that floats next to a transaction node on the canvas
 * (or in this Phase 0 demo, in fixed position over a placeholder canvas).
 *
 * Behaviors locked from v0.5 addendum 3 §8.6:
 *   - draggable by the header strip
 *   - pinnable (stays put when canvas moves)
 *   - closable (Esc or X button)
 *   - resizable horizontally
 *   - multiple popups can be open simultaneously (one component per popup)
 *
 * Streaming: the parent supplies a `TransactionAnalysis` whose section payloads
 * may be null while the corresponding `sections.<name>.status` is 'pending' or
 * 'loading'. Each section renders its own skeleton/error state.
 */

import {
  ChevronDown,
  Copy,
  ExternalLink,
  GripHorizontal,
  Pin,
  PinOff,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  CaseContextSection,
  CounterpartyIntelSection,
  CriticNotesSection,
  DecodedActionSection,
  ObfuscationSection,
  SectionShell,
  StructuredFactsSection,
  SuggestedActionsSection,
  SummarySection,
} from './Sections';
import type {
  ActionSuggestion,
  TransactionAnalysis,
} from './types';
import { copyToClipboard, formatTs, truncate } from './utils';

export interface TransactionInspectorProps {
  analysis: TransactionAnalysis;
  /** Initial pixel position of the popup top-left, relative to viewport. */
  initialPosition?: { x: number; y: number };
  /** Initial popup width in px. Default 440. */
  initialWidth?: number;
  /** When pinned, the popup ignores canvas pan/zoom. (Phase 0: visual only.) */
  initiallyPinned?: boolean;
  onClose?: () => void;
  onPivotAddress?: (address: string) => void;
  onActionClick?: (action: ActionSuggestion) => void;
}

export function TransactionInspector({
  analysis,
  initialPosition = { x: 80, y: 80 },
  initialWidth = 440,
  initiallyPinned = false,
  onClose,
  onPivotAddress,
  onActionClick,
}: TransactionInspectorProps) {
  const [pos, setPos] = useState(initialPosition);
  const [width, setWidth] = useState(initialWidth);
  const [pinned, setPinned] = useState(initiallyPinned);
  const [collapsed, setCollapsed] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Drag handlers — mouse-only for Phase 0.
  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't initiate drag from buttons inside the header.
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: pos.x,
        origY: pos.y,
      };
      document.body.style.userSelect = 'none';
    },
    [pos.x, pos.y],
  );

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({
        x: Math.max(0, dragRef.current.origX + dx),
        y: Math.max(0, dragRef.current.origY + dy),
      });
    }
    function onUp() {
      dragRef.current = null;
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Esc closes the popup.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && onClose) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Resize via right-edge handle.
  const resizeRef = useRef<{ startX: number; origWidth: number } | null>(null);
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      resizeRef.current = { startX: e.clientX, origWidth: width };
      document.body.style.userSelect = 'none';
    },
    [width],
  );
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizeRef.current) return;
      const dx = e.clientX - resizeRef.current.startX;
      setWidth(Math.max(340, Math.min(720, resizeRef.current.origWidth + dx)));
    }
    function onUp() {
      resizeRef.current = null;
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const completionPct = computeCompletionPct(analysis);

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Transaction Inspector"
      className={cn(
        'fixed z-50 bg-white border border-context-100 rounded-lg shadow-xl',
        'flex flex-col overflow-hidden',
        pinned && 'ring-2 ring-markup-500/40',
      )}
      style={{
        left: pos.x,
        top: pos.y,
        width,
        maxHeight: 'calc(100vh - 32px)',
      }}
    >
      {/* Header strip */}
      <div
        onMouseDown={onHeaderMouseDown}
        className="cursor-move px-3 py-2 border-b border-context-100 bg-context-100/30 flex items-center gap-2 select-none"
      >
        <GripHorizontal className="size-3.5 text-context-500 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-context-500">
              {analysis.header.chain}
            </span>
            <span className="font-mono text-[12px] text-context-700 truncate">
              {truncate(analysis.header.tx_hash, 10, 6)}
            </span>
            <button
              type="button"
              onClick={async () => {
                await copyToClipboard(analysis.header.tx_hash);
              }}
              title="Copy full tx hash"
              className="text-context-500 hover:text-context-700"
            >
              <Copy className="size-3" />
            </button>
            <a
              href={analysis.header.explorer_url}
              target="_blank"
              rel="noreferrer noopener"
              title="Open in explorer"
              className="text-context-500 hover:text-context-700"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-context-500 mt-0.5">
            <span>block {analysis.header.block_height.toLocaleString()}</span>
            <span>·</span>
            <span>{formatTs(analysis.header.block_timestamp)}</span>
            <span>·</span>
            <FinalityChip
              depth={analysis.header.confirmation_depth}
              finality={analysis.header.finality}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="size-6 inline-flex items-center justify-center rounded hover:bg-context-100 text-context-500"
        >
          <ChevronDown
            className={cn('size-4 transition-transform', collapsed && '-rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={() => setPinned((p) => !p)}
          title={pinned ? 'Unpin (follows canvas)' : 'Pin (stays in place)'}
          className={cn(
            'size-6 inline-flex items-center justify-center rounded hover:bg-context-100',
            pinned ? 'text-markup-700' : 'text-context-500',
          )}
        >
          {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => onClose?.()}
          title="Close (Esc)"
          className="size-6 inline-flex items-center justify-center rounded hover:bg-taint-100 text-context-500 hover:text-taint-700"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Progress strip */}
      <ProgressStrip pct={completionPct} status={analysis.status} />

      {/* Body */}
      {!collapsed && (
        <div className="overflow-y-auto flex-1 min-h-0">
          <SectionShell index={1} title="Plain-language summary" meta={analysis.sections.summary}>
            {analysis.summary && <SummarySection data={analysis.summary} />}
          </SectionShell>

          <SectionShell
            index={2}
            title="Structured facts"
            meta={analysis.sections.structured_facts}
          >
            {analysis.structured_facts && (
              <StructuredFactsSection
                rows={analysis.structured_facts}
                onPivotAddress={onPivotAddress}
              />
            )}
          </SectionShell>

          <SectionShell
            index={3}
            title="Decoded action"
            meta={analysis.sections.decoded_action}
          >
            {analysis.decoded_action && (
              <DecodedActionSection action={analysis.decoded_action} />
            )}
          </SectionShell>

          <SectionShell
            index={4}
            title="Counterparty intelligence"
            meta={analysis.sections.counterparty_intel}
          >
            {analysis.counterparty_intel && (
              <CounterpartyIntelSection entries={analysis.counterparty_intel} />
            )}
          </SectionShell>

          <SectionShell
            index={5}
            title="Context within the case"
            meta={analysis.sections.case_context}
          >
            {analysis.case_context && <CaseContextSection entries={analysis.case_context} />}
          </SectionShell>

          <SectionShell
            index={6}
            title="Obfuscation findings"
            meta={analysis.sections.obfuscation_findings}
          >
            {analysis.obfuscation_findings && (
              <ObfuscationSection findings={analysis.obfuscation_findings} />
            )}
          </SectionShell>

          <SectionShell index={7} title="Critic notes" meta={analysis.sections.critic_notes}>
            {analysis.critic_notes && <CriticNotesSection notes={analysis.critic_notes} />}
          </SectionShell>

          <SectionShell
            index={8}
            title="Suggested next actions"
            meta={analysis.sections.suggested_actions}
          >
            {analysis.suggested_actions && (
              <SuggestedActionsSection
                actions={analysis.suggested_actions}
                onActionClick={onActionClick}
              />
            )}
          </SectionShell>

          {/* Footer caveat — Phase 0 placeholder */}
          <div className="px-4 py-2 border-t border-context-100 bg-context-100/30 text-[10px] text-context-500 leading-relaxed">
            Phase 0 mockup. Production version emits a BeliefAtom on completion
            so this analysis is fully reproducible.
          </div>
        </div>
      )}

      {/* Resize handle */}
      <div
        onMouseDown={onResizeMouseDown}
        className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-markup-500/20"
        aria-hidden
      />
    </div>
  );
}

function FinalityChip({
  depth,
  finality,
}: {
  depth: number;
  finality: 'unconfirmed' | 'probable' | 'final';
}) {
  const tone =
    finality === 'final'
      ? 'text-clean-700 bg-clean-100/60'
      : finality === 'probable'
        ? 'text-elevated-700 bg-elevated-100/60'
        : 'text-taint-700 bg-taint-100/60';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1 py-px rounded-sm text-[9px] uppercase tracking-wider font-semibold',
        tone,
      )}
    >
      {finality} · {depth.toLocaleString()}
    </span>
  );
}

function ProgressStrip({
  pct,
  status,
}: {
  pct: number;
  status: TransactionAnalysis['status'];
}) {
  const label =
    status === 'complete'
      ? 'Analysis complete'
      : status === 'failed'
        ? 'Analysis failed'
        : status === 'partial'
          ? 'Partial — some sections failed'
          : 'Analyzing…';
  const tone =
    status === 'complete'
      ? 'bg-clean-500'
      : status === 'failed'
        ? 'bg-taint-500'
        : status === 'partial'
          ? 'bg-elevated-500'
          : 'bg-markup-500';
  return (
    <div className="px-3 py-1.5 border-b border-context-100 flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full bg-context-100 overflow-hidden">
        <div
          className={cn('h-full transition-all duration-300', tone)}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </div>
      <span className="text-[10px] uppercase tracking-wider text-context-500 font-semibold">
        {label}
      </span>
    </div>
  );
}

function computeCompletionPct(analysis: TransactionAnalysis): number {
  const sections = Object.values(analysis.sections);
  if (sections.length === 0) return 0;
  const done = sections.filter(
    (s) => s.status === 'ready' || s.status === 'empty' || s.status === 'failed',
  ).length;
  return Math.round((done / sections.length) * 100);
}
