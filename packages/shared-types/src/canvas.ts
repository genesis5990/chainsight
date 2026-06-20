/**
 * Canvas data shapes (Surface 2).
 *
 * Spec references:
 *   - docs/chainsight_v0_4_canvas_ux_addendum.md   (Important marks, value-split, iconography, color discipline)
 *   - docs/chainsight_v0_5_addendum_2.md           (Path styling, transaction-centric graph model)
 *
 * Architectural lock from §6.2: graph is transaction-centric.
 *   AddressNode (circle) ── Edge ──> TransactionNode (diamond) ── Edge ──> AddressNode (circle)
 *
 * The canvas reads this shape from a case-scoped store. The Math Service
 * computes value-split / cumulative-taint annotations on every edge in the
 * case and the canvas reads them; no math happens in the browser.
 */

import type { AddressRef } from './inspector';
import type { CaseId, Tier, UserId } from './index';

// ---------- node identifiers ----------

export type AddressNodeId = string & { readonly __brand: 'AddressNodeId' };
export type TransactionNodeId = string & { readonly __brand: 'TransactionNodeId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };
export type TracePathId = string & { readonly __brand: 'TracePathId' };
export type InvestigatorMarkId = string & { readonly __brand: 'InvestigatorMarkId' };

export type CanvasNodeId = AddressNodeId | TransactionNodeId;

// ---------- shared semantics ----------

/** The risk family that drives node fill color (semantic palette). */
export type SemanticFamily =
  | 'taint' // red — sanctions, criminal
  | 'elevated' // orange — risk, unattributed
  | 'caution' // yellow — soft attribution
  | 'clean' // green — attributed legit
  | 'markup' // blue — investigator markup
  | 'privacy' // purple — mixers, privacy chains
  | 'context'; // gray — reference only

/** Entity-type icons from canvas UX §3.1. */
export type EntityIcon =
  | 'centralized_exchange'
  | 'dex'
  | 'bridge'
  | 'mixer'
  | 'otc'
  | 'cold_storage'
  | 'hot_wallet'
  | 'payment_processor'
  | 'gambling'
  | 'darknet'
  | 'sanctioned'
  | 'smart_contract'
  | 'eoa'
  | 'unattributed';

/** Activity-type icons (auto-applied to TransactionNodes by tx classification). */
export type ActivityIcon =
  | 'transfer'
  | 'swap'
  | 'bridge_in'
  | 'bridge_out'
  | 'exchange_deposit'
  | 'exchange_withdrawal'
  | 'approve'
  | 'lock'
  | 'unlock'
  | 'mint'
  | 'burn'
  | 'airdrop'
  | 'nft_op'
  | 'contract_creation'
  | 'failed'
  | 'mev_victim'
  | 'atomic_swap';

/** Investigator-applied semantic markers from §3.1. */
export type MarkerIcon =
  | 'pivot'
  | 'off_ramp'
  | 'trap'
  | 'watched'
  | 'awaiting_subpoena'
  | 'awaiting_mlat'
  | 'frozen'
  | 'court_grade'
  | 'red_flag'
  | 'has_note'
  | 'cross_case_ref';

// ---------- nodes ----------

export interface AddressNode {
  kind: 'address';
  id: AddressNodeId;
  address: AddressRef; // chain-prefixed
  label?: string; // attributed label, e.g. "Binance Hot Wallet 14"
  family: SemanticFamily;
  entity_icon: EntityIcon;
  marker_icons: MarkerIcon[];
  /** Is this address marked important by an investigator on this case? */
  marked_important?: boolean;
  /** Free-form display tags shown in the side panel. */
  tags?: string[];
  /** Cumulative taint percentage at this node (0..1) under the active methodology. */
  cumulative_taint?: number;
}

export interface TransactionNode {
  kind: 'transaction';
  id: TransactionNodeId;
  tx_hash: string;
  chain: string;
  block_height: number;
  block_timestamp: string;
  activity_icon: ActivityIcon;
  marker_icons: MarkerIcon[];
  marked_important?: boolean;
  /** The dominant family for this tx — driven by attribution + obfuscation findings. */
  family: SemanticFamily;
  /** Convenience: total native value moved by this tx. */
  total_value_native?: string;
  total_value_fiat_at_tx?: string;
  /** True if any obfuscation detector flagged this transaction. */
  has_obfuscation_finding?: boolean;
}

export type CanvasNode = AddressNode | TransactionNode;

// ---------- edges ----------

/**
 * Edges are always address↔transaction (never address↔address) per the
 * transaction-centric architectural lock.
 */
export interface CanvasEdge {
  id: EdgeId;
  source: CanvasNodeId;
  target: CanvasNodeId;
  /** Absolute value moved on this edge, in native units. */
  absolute_value_native: string;
  absolute_value_fiat_at_tx?: string;
  /** This edge's share of its parent transaction's value (0..1). */
  share_of_parent_tx: number;
  /** Cumulative-from-source share per methodology (filled by Math Service). */
  cumulative_share_from_source?: Partial<Record<TaintMethodology, number>>;
  /** Optional: the path IDs this edge belongs to (drives ring/color overlay). */
  path_ids?: TracePathId[];
  /** Display hint for thickness scaling. */
  edge_weight?: number;
}

export type TaintMethodology = 'fifo' | 'lifo' | 'hifo' | 'libr' | 'pari_passu' | 'rolling_charge';

// ---------- trace paths ----------

/** Curated color slots for paths (canvas UX §5.3). */
export type PathColor =
  // Cool palette — primary investigator-built
  | 'cool_blue'
  | 'cool_teal'
  | 'cool_violet'
  | 'cool_indigo'
  // Warm palette — AI-suggested promoted
  | 'warm_orange'
  | 'warm_red'
  | 'warm_magenta'
  // High-contrast accent — primary evidentiary path (one per case)
  | 'accent_gold'
  | 'accent_lime'
  // Neutral — archived / reference
  | 'neutral_gray';

export interface TracePath {
  id: TracePathId;
  case_id: CaseId;
  display_name: string; // "Path A — Victim → Binance"
  color: PathColor;
  /** True if this is the case's primary evidentiary path (only one per case). */
  is_primary: boolean;
  /** Lifecycle from G5 — colors can be edited only while draft. */
  status: 'draft' | 'under_review' | 'finalized' | 'archived';
  /** Hop sequence: alternating address and tx steps. */
  ordered_steps: PathStep[];
  methodology: TaintMethodology;
  value_at_terminus_fiat?: string;
  hop_count: number;
}

export interface PathStep {
  step_index: number;
  step_type: 'address' | 'transaction';
  node_ref: CanvasNodeId;
  inbound_edge: EdgeId | null;
  outbound_edge: EdgeId | null;
}

// ---------- investigator marks ----------

export type ImportanceLevel = 'reference' | 'noteworthy' | 'critical' | 'court_grade';

export interface InvestigatorMark {
  id: InvestigatorMarkId;
  case_id: CaseId;
  target_kind: 'address' | 'transaction' | 'edge' | 'path' | 'memo' | 'finding';
  target_id: string;
  importance: ImportanceLevel;
  rationale?: string;
  tags?: string[];
  marked_by: UserId;
  marked_at: string;
  /** The BeliefAtom binding makes this first-class evidence. */
  belief_tier: Tier;
}

// ---------- full case graph envelope ----------

export interface CanvasCaseGraph {
  case_id: CaseId;
  case_name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  paths: TracePath[];
  marks: InvestigatorMark[];
  /** Active taint methodology (drives edge coloring intensity). */
  active_methodology: TaintMethodology;
  /** Last refresh time — when the Math Service last recomputed annotations. */
  last_refreshed_at: string;
}

// ---------- layer / display toggles (UI state, not persisted on the case) ----------

export interface CanvasLayerToggles {
  show_value_labels: boolean;
  show_cumulative_taint_overlay: boolean;
  show_path_rings: boolean;
  show_obfuscation_highlights: boolean;
  show_marker_icons: boolean;
  show_address_labels: boolean;
  /** Hide reference-only / context-family nodes to reduce clutter. */
  hide_context_only: boolean;
}

export const DEFAULT_LAYER_TOGGLES: CanvasLayerToggles = {
  show_value_labels: true,
  show_cumulative_taint_overlay: false,
  show_path_rings: true,
  show_obfuscation_highlights: true,
  show_marker_icons: true,
  show_address_labels: true,
  hide_context_only: false,
};

// ---------- helpers ----------

/** Map SemanticFamily → CSS color tokens (matches tailwind.config.ts palette). */
export const FAMILY_HEX: Record<SemanticFamily, { fill: string; stroke: string }> = {
  taint: { fill: '#fee2e2', stroke: '#b91c1c' },
  elevated: { fill: '#ffedd5', stroke: '#c2410c' },
  caution: { fill: '#fef9c3', stroke: '#a16207' },
  clean: { fill: '#dcfce7', stroke: '#15803d' },
  markup: { fill: '#dbeafe', stroke: '#1d4ed8' },
  privacy: { fill: '#f3e8ff', stroke: '#7e22ce' },
  context: { fill: '#f3f4f6', stroke: '#374151' },
};

/** Map PathColor → hex used for path rings + path-styled edges. */
export const PATH_HEX: Record<PathColor, string> = {
  cool_blue: '#2563eb',
  cool_teal: '#0d9488',
  cool_violet: '#7c3aed',
  cool_indigo: '#4338ca',
  warm_orange: '#ea580c',
  warm_red: '#dc2626',
  warm_magenta: '#c026d3',
  accent_gold: '#d97706',
  accent_lime: '#65a30d',
  neutral_gray: '#6b7280',
};

/** Map entity / activity / marker icon enums → emoji glyphs from §3.1. */
export const ENTITY_GLYPH: Record<EntityIcon, string> = {
  centralized_exchange: '🏦',
  dex: '💱',
  bridge: '🌉',
  mixer: '🌀',
  otc: '🛒',
  cold_storage: '🧊',
  hot_wallet: '🔥',
  payment_processor: '💳',
  gambling: '🎰',
  darknet: '🏴‍☠️',
  sanctioned: '📜',
  smart_contract: '🤖',
  eoa: '👤',
  unattributed: '❓',
};

export const ACTIVITY_GLYPH: Record<ActivityIcon, string> = {
  transfer: '➡️',
  swap: '🔄',
  bridge_in: '🌉',
  bridge_out: '🌉',
  exchange_deposit: '📥',
  exchange_withdrawal: '📤',
  approve: '✅',
  lock: '🔒',
  unlock: '🔓',
  mint: '🪙',
  burn: '🔥',
  airdrop: '🎁',
  nft_op: '🧾',
  contract_creation: '⚡',
  failed: '⚠️',
  mev_victim: '🥪',
  atomic_swap: '🤝',
};

export const MARKER_GLYPH: Record<MarkerIcon, string> = {
  pivot: '🎯',
  off_ramp: '🚪',
  trap: '🪤',
  watched: '👁️',
  awaiting_subpoena: '⏸️',
  awaiting_mlat: '📞',
  frozen: '❄️',
  court_grade: '⚖️',
  red_flag: '🚩',
  has_note: '✏️',
  cross_case_ref: '🔗',
};
