/**
 * PSR (Path Selection \u2192 Report) data shapes (Surface 5).
 *
 * Spec: docs/chainsight_v0_3_addendum.md \u00a72 + docs/chainsight_v0_5_addendum_2.md \u00a75
 *
 * The investigator picks a starting node, builds a path through the canvas
 * via one of four selection modes, names it + colors it, and the Narrative
 * Agent drafts a structured report scoped to that path. The path itself
 * becomes a first-class TracePath object (already defined in canvas.ts).
 */

import type { CanvasNodeId, PathColor, TaintMethodology } from './canvas';

// ---------- selection modes ----------

export type PsrSelectionMode = 'click' | 'lasso' | 'auto_pathfind' | 'natural_language';

export interface PsrSelectionModeMeta {
  id: PsrSelectionMode;
  label: string;
  hint: string;
  hotkey?: string;
}

export const PSR_SELECTION_MODES: PsrSelectionModeMeta[] = [
  {
    id: 'click',
    label: 'Click to extend',
    hint: 'Shift+click each next hop to grow the path. Alt+click removes the last hop.',
    hotkey: 'C',
  },
  {
    id: 'lasso',
    label: 'Lasso',
    hint: 'Draw a freeform region; the Tracer Agent finds candidate sub-paths inside it.',
    hotkey: 'L',
  },
  {
    id: 'auto_pathfind',
    label: 'Auto-pathfind',
    hint: 'Pick origin + destination; the Tracer Agent enumerates ranked candidates.',
    hotkey: 'A',
  },
  {
    id: 'natural_language',
    label: 'Natural language',
    hint: 'Describe what you want in plain English; the AI proposes paths for review.',
    hotkey: 'N',
  },
];

// ---------- in-progress path draft (runtime UI state) ----------

export interface PsrDraft {
  /** Investigator-visible name. Starts blank, the AI may suggest one. */
  display_name: string;
  /** Color from the curated palette. */
  color: PathColor;
  /** Methodology pinned to this draft. */
  methodology: TaintMethodology;
  /** Path is primary candidate (one per case can wear accent_gold). */
  is_primary_candidate: boolean;
  /** Ordered node sequence as built so far. */
  ordered_nodes: CanvasNodeId[];
  /** Which selection mode produced the latest hop. */
  last_selection_mode: PsrSelectionMode;
  /** Free-text commentary that flows into Report \u00a76. */
  commentary: string;
}

// ---------- report sections (sketch of what the Narrative Agent will fill) ----------

export type ReportSectionId =
  | 'executive_summary'
  | 'path_overview'
  | 'step_by_step_trace'
  | 'accounting_methodologies'
  | 'open_challenges'
  | 'investigator_commentary'
  | 'citations'
  | 'reproducibility';

export interface ReportSection {
  id: ReportSectionId;
  title: string;
  /** Empty until the Narrative Agent fills it. */
  body_markdown: string;
  /** Whether the Verifier Agent gated it. */
  verifier_passed: boolean;
  /** Streaming status \u2014 mirrors the Inspector pattern. */
  status: 'pending' | 'drafting' | 'ready' | 'failed';
}

export interface PsrReportDraft {
  draft: PsrDraft;
  sections: ReportSection[];
  /** ms since draft start. */
  last_updated_ms: number;
}

/** Build an empty report skeleton for a draft. */
export function emptyReportDraft(draft: PsrDraft): PsrReportDraft {
  const sec = (
    id: ReportSectionId,
    title: string,
    status: ReportSection['status'] = 'pending',
  ): ReportSection => ({
    id,
    title,
    body_markdown: '',
    verifier_passed: false,
    status,
  });
  return {
    draft,
    sections: [
      sec('executive_summary', 'Executive summary'),
      sec('path_overview', 'Path overview'),
      sec('step_by_step_trace', 'Step-by-step trace'),
      sec('accounting_methodologies', 'Accounting under each methodology'),
      sec('open_challenges', 'Open Critic challenges'),
      sec('investigator_commentary', 'Investigator commentary'),
      sec('citations', 'Citations'),
      sec('reproducibility', 'Reproducibility sub-pack'),
    ],
    last_updated_ms: 0,
  };
}
