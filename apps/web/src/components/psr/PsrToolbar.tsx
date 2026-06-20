'use client';

/**
 * Selection toolbar shown above the canvas when PSR mode is active.
 * Houses the four selection modes + the start/cancel buttons.
 *
 * Spec: docs/chainsight_v0_3_addendum.md \u00a72.3
 */

import { Bot, Lasso, MapPin, MousePointerClick, Pause, Play, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { PSR_SELECTION_MODES, type PsrSelectionMode } from '@chainsight/shared-types';

const ICONS: Record<PsrSelectionMode, React.ReactNode> = {
  click: <MousePointerClick className="size-3.5" />,
  lasso: <Lasso className="size-3.5" />,
  auto_pathfind: <MapPin className="size-3.5" />,
  natural_language: <Bot className="size-3.5" />,
};

export interface PsrToolbarProps {
  active: boolean;
  mode: PsrSelectionMode;
  hopCount: number;
  onActivate: () => void;
  onCancel: () => void;
  onModeChange: (mode: PsrSelectionMode) => void;
}

export function PsrToolbar({
  active,
  mode,
  hopCount,
  onActivate,
  onCancel,
  onModeChange,
}: PsrToolbarProps) {
  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded border border-context-100 hover:bg-context-100/60 text-context-700"
      >
        <Play className="size-3.5" /> Start Path Selection
      </button>
    );
  }

  const modeMeta = PSR_SELECTION_MODES.find((m) => m.id === mode);

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded border border-markup-500 bg-markup-100/60 text-markup-700">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold pr-2 border-r border-markup-500/40">
        <Pause className="size-3" /> Path mode
      </span>
      <div className="flex items-center gap-0.5">
        {PSR_SELECTION_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onModeChange(m.id)}
            title={`${m.label} \u2014 ${m.hint}${m.hotkey ? ` (${m.hotkey})` : ''}`}
            className={cn(
              'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors',
              mode === m.id
                ? 'bg-white text-markup-700 shadow-sm'
                : 'text-markup-700/70 hover:bg-white/60',
            )}
          >
            {ICONS[m.id]}
            <span className="hidden md:inline">{m.label}</span>
          </button>
        ))}
      </div>
      {modeMeta && (
        <span className="text-[10px] text-markup-700/80 italic max-w-[280px] truncate">
          {modeMeta.hint}
        </span>
      )}
      <span className="ml-auto text-[10px] font-mono text-markup-700 tabular-nums">
        {hopCount} hop{hopCount === 1 ? '' : 's'}
      </span>
      <button
        type="button"
        onClick={onCancel}
        title="Cancel selection"
        className="size-6 inline-flex items-center justify-center rounded hover:bg-white/60 text-markup-700"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
