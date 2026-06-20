'use client';

/**
 * Surface 3 — Present in Court Mode
 *
 * Spec: docs/chainsight_v0_5_addendum.md §3
 *
 * Layout:
 *
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ Title bar · case name · presenter pill · close (Esc)              │
 *   ├──────────────────────────────────────────────────┬────────────────┤
 *   │                                                  │ Accounting     │
 *   │     <current frame view>                         │ panel (updates │
 *   │                                                  │ in lockstep    │
 *   │                                                  │ with frame)    │
 *   ├──────────────────────────────────────────────────┴────────────────┤
 *   │ frame strip · prev · numbered chips · next · pause · hotkeys      │
 *   └───────────────────────────────────────────────────────────────────┘
 */

import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Keyboard,
  PauseCircle,
  PlayCircle,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import type {
  AccountingState,
  CourtFrame,
  FrameDeck,
  TaintMethodology,
} from '@chainsight/shared-types';
import {
  ByEntityView,
  ByTracePathView,
  ByValueView,
  DocumentView,
  OverTimeView,
  TitleView,
} from './Views';

export interface CourtModeProps {
  deck: FrameDeck;
  onExit?: () => void;
}

export function CourtMode({ deck, onExit }: CourtModeProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [methodologyOverride, setMethodologyOverride] = useState<TaintMethodology | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);

  const frame = deck.frames[index];
  const total = deck.frames.length;

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const goFirst = useCallback(() => setIndex(0), []);

  // Keyboard nav per spec §3.2 + §3.5
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (e.shiftKey) goFirst();
        else onExit?.();
      } else if (e.key === 'p' || e.key === 'P') {
        setPaused((p) => !p);
      } else if (e.key === 'r' || e.key === 'R') {
        setReadAloud((r) => !r);
      } else if (e.key === 'm' || e.key === 'M') {
        // Cycle relative to whatever the user is currently seeing — if no
        // override yet, start from the deck's default so the first press
        // is a visible advance.
        const seed = frame?.accounting.frame_methodology ?? deck.methodology;
        setMethodologyOverride((cur) => cycleMethodology(cur ?? seed));
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        setShowHotkeys((s) => !s);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, goFirst, onExit]);

  if (!frame) return null;

  const effectiveAccounting: AccountingState = {
    ...frame.accounting,
    frame_methodology: methodologyOverride ?? frame.accounting.frame_methodology,
  };
  const effectiveFrame: CourtFrame = methodologyOverride
    ? { ...frame, methodology: methodologyOverride }
    : frame;

  return (
    <div className="fixed inset-0 z-50 bg-context-100/95 backdrop-blur-sm flex flex-col text-context-700">
      <TitleBar
        deckTitle={deck.title}
        caseName={deck.case_name}
        onExit={onExit}
        paused={paused}
      />

      <div className="flex-1 flex min-h-0">
        <main className="flex-1 min-w-0 bg-white">
          <FrameRouter frame={effectiveFrame} />
        </main>

        <aside className="w-80 border-l border-context-100 bg-white/90 backdrop-blur shrink-0 overflow-y-auto">
          <AccountingPanel
            state={effectiveAccounting}
            readAloud={readAloud}
            readAloudLine={frame.read_aloud}
          />
        </aside>
      </div>

      <FrameStrip
        deck={deck}
        index={index}
        onJump={setIndex}
        onPrev={goPrev}
        onNext={goNext}
        onTogglePause={() => setPaused((p) => !p)}
        paused={paused}
        onToggleHotkeys={() => setShowHotkeys((s) => !s)}
      />

      {showHotkeys && <HotkeyOverlay onClose={() => setShowHotkeys(false)} />}
    </div>
  );
}

function cycleMethodology(current: TaintMethodology): TaintMethodology {
  const order: TaintMethodology[] = ['fifo', 'lifo', 'hifo', 'libr', 'pari_passu', 'rolling_charge'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length]!;
}

// =====================================================================
// Title bar
// =====================================================================

function TitleBar({
  deckTitle,
  caseName,
  paused,
  onExit,
}: {
  deckTitle: string;
  caseName: string;
  paused: boolean;
  onExit?: () => void;
}) {
  return (
    <header className="h-12 border-b border-context-100 bg-white flex items-center px-5 shrink-0 gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-[0.25em] text-context-500 font-semibold">
          {caseName}
        </div>
        <div className="text-[13px] font-semibold text-context-700 truncate">{deckTitle}</div>
      </div>
      <span
        className={cn(
          'inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded',
          paused ? 'bg-elevated-100 text-elevated-700' : 'bg-clean-100 text-clean-700',
        )}
      >
        {paused ? (
          <>
            <PauseCircle className="size-3" /> Paused
          </>
        ) : (
          <>
            <PlayCircle className="size-3" /> Presenter
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onExit}
        className="size-8 inline-flex items-center justify-center rounded hover:bg-context-100 text-context-500 hover:text-context-700"
        title="Exit (Esc)"
      >
        <X className="size-4" />
      </button>
    </header>
  );
}

// =====================================================================
// Frame router
// =====================================================================

function FrameRouter({ frame }: { frame: CourtFrame }) {
  switch (frame.payload.kind) {
    case 'title':
      return <TitleView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
    case 'over_time':
      return <OverTimeView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
    case 'by_value':
      return <ByValueView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
    case 'by_trace_path':
      return <ByTracePathView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
    case 'by_entity':
      return <ByEntityView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
    case 'document':
      return <DocumentView frame={frame as CourtFrame & { payload: typeof frame.payload }} />;
  }
}

// =====================================================================
// Accounting panel — the "follows the frame" feature (§3.4)
// =====================================================================

function AccountingPanel({
  state,
  readAloud,
  readAloudLine,
}: {
  state: AccountingState;
  readAloud: boolean;
  readAloudLine?: string;
}) {
  return (
    <div className="divide-y divide-context-100">
      <PanelBlock heading="Current frame">
        <PanelRow label="Methodology" value={state.frame_methodology.toUpperCase()} highlight />
        <PanelRow label="Frame type" value={state.frame_type_label} />
        {state.frame_time && <PanelRow label="Time" value={formatTime(state.frame_time)} />}
        {state.frame_chain && <PanelRow label="Chain" value={state.frame_chain} />}
      </PanelBlock>

      {(state.value_native || state.cumulative_taint_pct !== undefined) && (
        <PanelBlock heading="Value at this hop">
          {state.value_native && <PanelRow label="Native" value={state.value_native} />}
          {state.value_fiat_at_frame && (
            <PanelRow label="Fiat at frame" value={state.value_fiat_at_frame} />
          )}
          {state.cumulative_taint_pct !== undefined && (
            <PanelRow
              label="Cum. taint from source"
              value={`${(state.cumulative_taint_pct * 100).toFixed(1)}%`}
              highlight
            />
          )}
          {state.fees_absorbed_fiat && (
            <PanelRow label="Fees absorbed on path" value={state.fees_absorbed_fiat} />
          )}
        </PanelBlock>
      )}

      <PanelBlock heading="Case-level context">
        <PanelRow label="Total tainted input" value={state.total_tainted_input_fiat} />
        <PanelRow
          label="Traceable at frame"
          value={`${state.traceable_at_frame_fiat} (${(state.traceable_at_frame_pct * 100).toFixed(1)}%)`}
          highlight
        />
        <PanelRow
          label="Lost to mixers"
          value={`${state.lost_to_mixers_fiat} (${(state.lost_to_mixers_pct * 100).toFixed(1)}%)`}
        />
        <PanelRow
          label="Off-ramped to fiat"
          value={`${state.off_ramped_fiat} (${(state.off_ramped_pct * 100).toFixed(1)}%)`}
        />
      </PanelBlock>

      {state.next_frame_label && (
        <PanelBlock heading="Next frame">
          <p className="text-[12px] text-context-700 font-medium">{state.next_frame_label}</p>
          {state.next_frame_anticipated_taint_pct !== undefined && (
            <PanelRow
              label="Anticipated taint"
              value={`${(state.next_frame_anticipated_taint_pct * 100).toFixed(1)}%`}
            />
          )}
        </PanelBlock>
      )}

      {readAloud && readAloudLine && (
        <PanelBlock heading="Read aloud">
          <p className="text-[13px] leading-relaxed text-markup-700 italic px-1">
            &ldquo;{readAloudLine}&rdquo;
          </p>
        </PanelBlock>
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return (
      d.toLocaleString('en-US', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }) + ' UTC'
    );
  } catch {
    return iso;
  }
}

function PanelBlock({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-3">
        {heading}
      </h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function PanelRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[12px]">
      <dt className="text-context-500">{label}</dt>
      <dd
        className={cn(
          'font-mono tabular-nums text-right',
          highlight ? 'text-markup-700 font-semibold' : 'text-context-700',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// =====================================================================
// Frame strip (bottom nav)
// =====================================================================

function FrameStrip({
  deck,
  index,
  onJump,
  onPrev,
  onNext,
  onTogglePause,
  paused,
  onToggleHotkeys,
}: {
  deck: FrameDeck;
  index: number;
  onJump: (i: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  paused: boolean;
  onToggleHotkeys: () => void;
}) {
  return (
    <footer className="border-t border-context-100 bg-white px-4 py-2 shrink-0 flex items-center gap-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={index === 0}
        className="size-8 inline-flex items-center justify-center rounded hover:bg-context-100 disabled:opacity-30 disabled:cursor-not-allowed text-context-700"
        title="Previous (←)"
      >
        <ChevronLeft className="size-5" />
      </button>

      <div className="flex-1 flex items-center gap-1.5 overflow-x-auto">
        {deck.frames.map((f, i) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onJump(i)}
            className={cn(
              'group flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium border transition-colors shrink-0',
              i === index
                ? 'border-markup-500 bg-markup-100/60 text-markup-700'
                : 'border-context-100 text-context-500 hover:bg-context-100/60 hover:text-context-700',
            )}
            title={f.title}
          >
            <span className="font-mono w-5 text-right tabular-nums">{f.index}</span>
            <span className="max-w-[140px] truncate">{f.title}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onTogglePause}
        className="size-8 inline-flex items-center justify-center rounded hover:bg-context-100 text-context-700"
        title={paused ? 'Resume (P)' : 'Pause (P)'}
      >
        {paused ? <PlayCircle className="size-5" /> : <PauseCircle className="size-5" />}
      </button>
      <button
        type="button"
        onClick={onToggleHotkeys}
        className="size-8 inline-flex items-center justify-center rounded hover:bg-context-100 text-context-700"
        title="Hotkeys (?)"
      >
        <Keyboard className="size-5" />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={index === deck.frames.length - 1}
        className="size-8 inline-flex items-center justify-center rounded hover:bg-context-100 disabled:opacity-30 disabled:cursor-not-allowed text-context-700"
        title="Next (→ / Space)"
      >
        <ChevronRight className="size-5" />
      </button>
    </footer>
  );
}

// =====================================================================
// Hotkey overlay (§3.5 — presenter's reference card)
// =====================================================================

const HOTKEYS: Array<{ keys: string; label: string }> = [
  { keys: '→ / Space', label: 'Advance one frame' },
  { keys: '←', label: 'Previous frame' },
  { keys: 'P', label: 'Pause / resume' },
  { keys: 'R', label: 'Read-aloud teleprompter' },
  { keys: 'M', label: 'Cycle methodology (FIFO → LIFO → …)' },
  { keys: 'Esc', label: 'Exit presenter mode' },
  { keys: 'Shift+Esc', label: 'Reset to opening frame' },
  { keys: '?', label: 'Toggle this overlay' },
];

function HotkeyOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-10 bg-context-700/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Presenter hotkeys"
        className="bg-white rounded-xl shadow-2xl border border-context-100 p-8 w-[440px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-5">
          <Eye className="size-5 text-markup-700" />
          <h2 className="text-lg font-semibold text-context-700">Presenter hotkeys</h2>
        </div>
        <dl className="space-y-2">
          {HOTKEYS.map((h) => (
            <div key={h.keys} className="flex items-baseline justify-between gap-4 text-[13px]">
              <dt className="text-context-700">{h.label}</dt>
              <dd>
                <kbd className="font-mono text-[11px] bg-context-100 text-context-700 px-2 py-1 rounded border border-context-100">
                  {h.keys}
                </kbd>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[11px] text-context-500 italic">
          Phase 1 will add J (jump-to-entity), C (Critic challenges), D (source
          document at exact bounding box).
        </p>
      </div>
    </div>
  );
}
