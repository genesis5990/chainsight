/**
 * Court Mode data shapes (Surface 3).
 *
 * Spec: docs/chainsight_v0_5_addendum.md §3 (Feature 3 — Present in Court Mode)
 *
 * The presenter loads a FrameDeck (an ordered sequence of frames), advances
 * one frame at a time with the arrow keys or remote clicker, and the
 * AccountingState side panel updates in lockstep. Network calls are disabled
 * by default — everything plays back from the Reproducibility Pack.
 */

import type {
  AddressNodeId,
  TracePathId,
  TransactionNodeId,
  TaintMethodology,
} from './canvas';
import type { CaseId, UserId } from './index';

// ---------- IDs ----------

export type FrameDeckId = string & { readonly __brand: 'FrameDeckId' };
export type FrameId = string & { readonly __brand: 'FrameId' };

// ---------- view modes ----------

/** The four primary views from §3.3. */
export type CourtFrameKind =
  | 'over_time' // View A — horizontal timeline scrub
  | 'by_value' // View B — Sankey of taint flow
  | 'by_trace_path' // View C — TracePath hop-by-hop playback
  | 'by_entity' // View D — actor-centric
  | 'title' // Opening/transition title card
  | 'document'; // Exhibit display (subpoena return, ledger PDF page)

/** A single frame in the courtroom presentation. */
export interface CourtFrame {
  id: FrameId;
  index: number;
  kind: CourtFrameKind;
  /** Investigator-set frame title shown at the top of the presenter view. */
  title: string;
  /** Optional one-line subtitle / context */
  subtitle?: string;
  /** Methodology pinned at this frame (defaults to deck-level methodology). */
  methodology?: TaintMethodology;
  /** Discriminated payload per kind. */
  payload:
    | TitleFramePayload
    | OverTimeFramePayload
    | ByValueFramePayload
    | ByTracePathFramePayload
    | ByEntityFramePayload
    | DocumentFramePayload;
  /** What the presenter should verbalize at this frame (the teleprompter line). */
  read_aloud?: string;
  /** Per-frame snapshot of the accounting numbers (the "follow the frame" state). */
  accounting: AccountingState;
}

// ---------- per-kind payloads ----------

export interface TitleFramePayload {
  kind: 'title';
  /** Optional large hero number — e.g. "$42,610" */
  hero?: string;
  /** Lead bullet points to project. */
  bullets?: string[];
}

export interface OverTimeFramePayload {
  kind: 'over_time';
  /** Anchor moment in ISO 8601 — the playhead is at this point. */
  playhead_at: string;
  /** Timeline events visible at this playhead (already filtered to be ≤ playhead). */
  events: TimelineEvent[];
  /** Min/max of the timeline scrub range (deck-level). */
  range_start: string;
  range_end: string;
}

export interface TimelineEvent {
  id: string;
  at: string; // ISO 8601
  kind: 'tx' | 'mark' | 'subpoena' | 'finding' | 'memo';
  label: string;
  value_fiat?: string;
  chain?: string;
  /** Refs back to canvas entities if relevant. */
  tx_ref?: TransactionNodeId;
  address_ref?: AddressNodeId;
}

export interface ByValueFramePayload {
  kind: 'by_value';
  /** Sankey nodes (sources, intermediates, sinks). */
  sankey_nodes: SankeyNode[];
  /** Flow bands between nodes (width ∝ value_fiat). */
  sankey_flows: SankeyFlow[];
  /** Currently highlighted flow (for narration). */
  highlight_flow_id?: string;
}

export interface SankeyNode {
  id: string;
  label: string;
  side: 'source' | 'intermediate' | 'sink';
  family: 'taint' | 'elevated' | 'caution' | 'clean' | 'privacy' | 'context';
}

export interface SankeyFlow {
  id: string;
  from: string; // SankeyNode.id
  to: string; // SankeyNode.id
  value_native: string;
  value_fiat: string;
  share_of_source: number; // 0..1
  taint_share?: number; // share of original tainted value, 0..1
  methodology?: TaintMethodology;
}

export interface ByTracePathFramePayload {
  kind: 'by_trace_path';
  path_id: TracePathId;
  /** 1-indexed hop number within the path (matches presenter narration). */
  hop_index: number;
  /** Total hops in the path. */
  hop_total: number;
  /** What's at this hop. */
  hop: TracePathHop;
}

export interface TracePathHop {
  tx_ref: TransactionNodeId;
  tx_hash: string;
  chain: string;
  at: string;
  from_address: string;
  to_address: string;
  value_native: string;
  value_fiat_at_tx: string;
  cumulative_taint_pct: number; // 0..1
  elapsed_since_source_ms: number;
  memo?: string;
  /** Entity attributions in play at this hop. */
  attributions?: Array<{ provider: string; label: string }>;
}

export interface ByEntityFramePayload {
  kind: 'by_entity';
  entity_label: string;
  entity_address: string;
  entity_chain: string;
  /** All transactions involving this entity (in chronological order). */
  transactions: EntityTxRow[];
  attributions: Array<{ provider: string; label: string; confidence: number }>;
  subpoena_refs: Array<{ id: string; label: string; date: string }>;
  memos: Array<{ id: string; text: string; author: string; at: string }>;
}

export interface EntityTxRow {
  tx_ref: TransactionNodeId;
  tx_hash: string;
  at: string;
  direction: 'in' | 'out';
  counterparty_address: string;
  counterparty_label?: string;
  value_native: string;
  value_fiat_at_tx: string;
}

export interface DocumentFramePayload {
  kind: 'document';
  document_id: string;
  document_title: string;
  page_number: number;
  /** Where the relevant evidence sits on the page. */
  bounding_box?: { x: number; y: number; w: number; h: number };
  /** Cite-back to what claim this supports. */
  supports_claim?: string;
}

// ---------- accounting state ----------

/**
 * The numbers the side panel always shows — they update lockstep with the
 * frame advance. Authored at deck-bake time so playback is deterministic
 * (G7 lock — case-level math anchor remains canonical).
 */
export interface AccountingState {
  frame_methodology: TaintMethodology;
  frame_type_label: string; // "By Trace Path — Path A, Hop 7 of 14"
  frame_time?: string; // ISO 8601
  frame_chain?: string;

  // Value at this hop
  value_native?: string;
  value_fiat_at_frame?: string;
  cumulative_taint_pct?: number; // 0..1
  fees_absorbed_fiat?: string;

  // Case-level context
  total_tainted_input_fiat: string;
  traceable_at_frame_fiat: string;
  traceable_at_frame_pct: number;
  lost_to_mixers_fiat: string;
  lost_to_mixers_pct: number;
  off_ramped_fiat: string;
  off_ramped_pct: number;

  // Lookahead
  next_frame_label?: string;
  next_frame_anticipated_taint_pct?: number;
}

// ---------- frame deck ----------

export interface FrameDeck {
  id: FrameDeckId;
  case_id: CaseId;
  case_name: string;
  /** Investigator-set title shown on the opening frame and presenter card. */
  title: string;
  /** Curator who sequenced the deck. */
  curated_by: UserId;
  curated_at: string;
  /** Deck-level default methodology (frame can override). */
  methodology: TaintMethodology;
  /** Frames in presentation order. */
  frames: CourtFrame[];
  /** Hash of the Reproducibility Pack snapshot this deck was baked against. */
  reproducibility_hash: string;
}

// ---------- presenter UI state (runtime only) ----------

export type PresenterMode = 'live' | 'rehearsal';

export interface PresenterRuntimeState {
  current_index: number;
  paused: boolean;
  /** Active read-aloud line index, if R was pressed. */
  read_aloud_active: boolean;
  /** Methodology override for the current frame (M to cycle). */
  methodology_override?: TaintMethodology;
  /** Whether the Critic-challenges overlay is on (C). */
  show_critic_overlay: boolean;
}

export const INITIAL_PRESENTER_STATE: PresenterRuntimeState = {
  current_index: 0,
  paused: false,
  read_aloud_active: false,
  show_critic_overlay: false,
};
