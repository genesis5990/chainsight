/**
 * Personal Attribution Library (Surface 8) data shapes.
 *
 * Spec: docs/chainsight_v0_6_addendum.md §F25 (Personal Attribution).
 *
 * The investigator's accumulated knowledge: labels they apply to addresses,
 * transactions, clusters, etc. that persist across every case they work.
 *
 * Phase 0 ships the library view at /attribution-demo with a seeded dataset.
 * Phase 1 wires the real BeliefAtom flow + canvas-side "Add my attribution".
 */

import type { WalletChain } from './wallet_history';

// ---------- targets ----------

export type AttributionTargetKind =
  | 'address'
  | 'transaction'
  | 'cluster'
  | 'entity'
  | 'swap_pool'
  | 'bridge_contract';

export interface AttributionTargetRef {
  kind: AttributionTargetKind;
  chain: WalletChain;
  /** Canonical, chain-qualified reference, e.g. "eth:0x742d…". */
  canonical: string;
  /** Short display form used in lists. */
  display: string;
}

// ---------- category, confidence, basis ----------

export type AttributionCategory =
  | 'exchange_deposit'
  | 'suspect_eoa'
  | 'victim_wallet'
  | 'mixer'
  | 'otc_desk'
  | 'sanctioned'
  | 'known_clean'
  | 'smart_contract'
  | 'bridge'
  | 'cluster_anchor'
  | 'custom';

export interface AttributionCategoryMeta {
  id: AttributionCategory;
  label: string;
  /** Tailwind background class used as a chip color. */
  chip_cls: string;
}

export const ATTRIBUTION_CATEGORIES: AttributionCategoryMeta[] = [
  { id: 'exchange_deposit', label: 'Exchange deposit',  chip_cls: 'bg-markup-100 text-markup-800' },
  { id: 'suspect_eoa',      label: 'Suspect EOA',       chip_cls: 'bg-taint-100 text-taint-800' },
  { id: 'victim_wallet',    label: 'Victim wallet',     chip_cls: 'bg-clean-100 text-clean-800' },
  { id: 'mixer',            label: 'Mixer',             chip_cls: 'bg-privacy-100 text-privacy-800' },
  { id: 'otc_desk',         label: 'OTC desk',          chip_cls: 'bg-caution-100 text-caution-800' },
  { id: 'sanctioned',       label: 'Sanctioned',        chip_cls: 'bg-taint-200 text-taint-900' },
  { id: 'known_clean',      label: 'Known clean',       chip_cls: 'bg-clean-100 text-clean-800' },
  { id: 'smart_contract',   label: 'Smart contract',    chip_cls: 'bg-context-100 text-context-800' },
  { id: 'bridge',           label: 'Bridge',            chip_cls: 'bg-elevated-100 text-elevated-800' },
  { id: 'cluster_anchor',   label: 'Cluster anchor',    chip_cls: 'bg-markup-100 text-markup-800' },
  { id: 'custom',           label: 'Custom',            chip_cls: 'bg-context-100 text-context-700' },
];

export type AttributionBasis =
  | 'subpoena_confirmed'
  | 'self_admitted'
  | 'osint_confirmed'
  | 'pattern_inferred'
  | 'provider_corroborated'
  | 'hypothesis';

export const BASIS_META: Record<AttributionBasis, { label: string; tier: 'T0' | 'T2' | 'T3' }> = {
  subpoena_confirmed:    { label: 'Subpoena confirmed',    tier: 'T0' },
  self_admitted:         { label: 'Self-admitted',          tier: 'T0' },
  osint_confirmed:       { label: 'OSINT confirmed',        tier: 'T2' },
  provider_corroborated: { label: 'Provider corroborated',  tier: 'T2' },
  pattern_inferred:      { label: 'Pattern inferred',       tier: 'T3' },
  hypothesis:            { label: 'Hypothesis',             tier: 'T3' },
};

// ---------- visibility + sharing ----------

export type AttributionVisibility =
  | 'private'
  | 'shared_with_users'
  | 'shared_with_team'
  | 'shared_with_org'
  | 'shared_externally';

export const VISIBILITY_META: Record<AttributionVisibility, { label: string; short: string }> = {
  private:              { label: 'Private (only me)',         short: 'Private' },
  shared_with_users:    { label: 'Shared with users',         short: 'Users' },
  shared_with_team:     { label: 'Shared with my team',       short: 'Team' },
  shared_with_org:      { label: 'Shared with organization',  short: 'Org' },
  shared_externally:    { label: 'Shared externally (CADNP)', short: 'External' },
};

export interface AcceptorEvent {
  recipient_id: string;
  recipient_name: string;
  action: 'accepted' | 'rejected' | 'counter_attributed' | 'viewed';
  at: string;                          // ISO
  /** For counter_attributed, points at the counter attribution. */
  counter_attribution_id?: string;
}

// ---------- evidence ----------

export interface SupportingEvidence {
  id: string;
  kind: 'subpoena' | 'memo' | 'case_doc' | 'url' | 'screenshot' | 'transcript';
  label: string;
  /** Optional URL or doc reference. */
  ref?: string;
}

// ---------- case linkage ----------

export interface AttributionCaseRef {
  case_id: string;
  case_code: string;
  case_name: string;
  /** Was this the case where the attribution was first established? */
  is_primary: boolean;
  /** ISO of when this attribution was last touched in the case. */
  last_used_at: string;
}

// ---------- the main shape ----------

export interface PersonalAttribution {
  id: string;
  attributor_id: string;
  attributor_name: string;             // for sharing UIs

  target: AttributionTargetRef;

  /** Primary short label. */
  label: string;
  category: AttributionCategory;
  custom_category?: string;
  /** Free-form longer note. */
  description: string;
  /** Optional canvas display color override (curated palette). */
  display_color?: string | null;
  /** Optional emoji or icon-id overlay. */
  display_icon?: string | null;

  /** 1..5 dots in the UI. */
  confidence: 1 | 2 | 3 | 4 | 5;
  basis: AttributionBasis;
  supporting_evidence: SupportingEvidence[];

  // lifecycle
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  use_count: number;

  // sharing
  visibility: AttributionVisibility;
  shared_with_names: string[];         // human-readable recipients (UI)
  shared_at?: string;
  acceptor_log: AcceptorEvent[];

  // case linkage
  cases_referenced_in: AttributionCaseRef[];
  primary_case_id?: string;

  // disagreement signal — true if at least one recipient counter-attributed
  has_disagreement: boolean;
  /** ID of the counter-attribution, if any (for cross-link in the UI). */
  counter_attribution_id?: string;
}

// ---------- incoming shares ----------

export interface IncomingShare {
  id: string;
  attribution: PersonalAttribution;
  shared_by_id: string;
  shared_by_name: string;
  shared_at: string;
  /** Has the recipient acted on it yet? */
  status: 'pending' | 'accepted' | 'rejected' | 'counter_attributed';
}

// ---------- library snapshot ----------

export interface AttributionLibrarySnapshot {
  user_name: string;
  user_role: string;                   // e.g. "Det. T. Nguyen · FBI Cyber 14"
  generated_at: string;
  /** Total counts grouped by visibility. */
  kpi: {
    total: number;
    private: number;
    shared_out: number;
    accepted_by_others: number;
    incoming_pending: number;
    cases_touched: number;
    disagreements: number;
  };
  attributions: PersonalAttribution[];
  incoming_shares: IncomingShare[];
}
