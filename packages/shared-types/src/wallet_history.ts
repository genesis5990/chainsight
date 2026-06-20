/**
 * Wallet History Analyzer (Surface 6) data shapes.
 *
 * Spec: docs/chainsight_v0_5_addendum_2.md §F21 (Wallet History Analyzer).
 *
 * Phase 0 ships a UI mockup of the full workflow with streaming progress per
 * address. Phase 1 wires Math Service / Tracer Agent / chain-data providers.
 *
 * The Wallet is a first-class object alongside Case and TracePath.
 */

import type { CanvasNodeId, PathColor } from './canvas';

// ---------- intake ----------

export type WalletSource =
  | 'forensic_seizure'
  | 'subpoena_dump'
  | 'osint'
  | 'self_reported_victim'
  | 'suspect_voluntary'
  | 'exchange_export'
  | 'seed_recovered';

export interface WalletSourceMeta {
  id: WalletSource;
  label: string;
  hint: string;
}

export const WALLET_SOURCES: WalletSourceMeta[] = [
  { id: 'forensic_seizure', label: 'Forensic seizure', hint: 'Drive image, seized device, recovered keystore' },
  { id: 'subpoena_dump', label: 'Subpoena dump', hint: 'Exchange returned the suspect’s controlled deposit addresses' },
  { id: 'osint', label: 'OSINT', hint: 'Public posts, Telegram dump, GitHub leaks, doxxed wallet' },
  { id: 'self_reported_victim', label: 'Victim self-reported', hint: 'Victim shared their own addresses with the investigator' },
  { id: 'suspect_voluntary', label: 'Suspect voluntary', hint: 'Suspect cooperated and disclosed addresses' },
  { id: 'exchange_export', label: 'Exchange export', hint: 'CSV the suspect exported from their account' },
  { id: 'seed_recovered', label: 'Seed phrase recovered', hint: 'Platform derives addresses in-memory only — never persisted' },
];

export type WalletChain = 'btc' | 'eth' | 'sol' | 'tron' | 'polygon' | 'arbitrum' | 'base' | 'unknown';

export interface WalletAddressInput {
  raw_address: string;
  /** Detected from format. */
  chain: WalletChain;
  /** True if the address parsed cleanly. */
  valid: boolean;
  /** Why invalid (if applicable). */
  reason?: string;
  /** Label provided in the source (e.g. CSV column). */
  label_from_source?: string;
}

// ---------- per-address analysis ----------

export type AddressAnalysisStage =
  | 'queued'
  | 'fetching_history'
  | 'clustering'
  | 'attribution'
  | 'obfuscation_scan'
  | 'tracing_hops'
  | 'scoring'
  | 'ready'
  | 'failed';

export interface StageMeta {
  id: AddressAnalysisStage;
  label: string;
  description: string;
}

export const ADDRESS_ANALYSIS_STAGES: StageMeta[] = [
  { id: 'queued', label: 'Queued', description: 'Waiting for worker' },
  { id: 'fetching_history', label: 'Fetching history', description: 'Chain-data provider call' },
  { id: 'clustering', label: 'Clustering', description: 'Common-input / behavioral grouping' },
  { id: 'attribution', label: 'Attribution', description: 'Multi-provider entity resolution' },
  { id: 'obfuscation_scan', label: 'Obfuscation scan', description: 'Mixer / peel / bridge pattern detection' },
  { id: 'tracing_hops', label: 'Hop tracing', description: '3-hop incoming, 5-hop outgoing' },
  { id: 'scoring', label: 'Scoring', description: 'Composite evidentiary value' },
  { id: 'ready', label: 'Ready', description: 'Available for canvas + report' },
  { id: 'failed', label: 'Failed', description: 'See error — retryable in Phase 1' },
];

export interface AddressActivitySummary {
  first_activity_at: string | null;
  last_activity_at: string | null;
  tx_count: number;
  /** Native amount, formatted for display. */
  total_inflow_display: string;
  total_outflow_display: string;
  current_balance_display: string;
  /** Top 3 counterparty entity names. */
  top_counterparties: string[];
  /** True if any obfuscation finding hit. */
  obfuscation_hit: boolean;
  /** True if any attribution finding hit. */
  attribution_hit: boolean;
}

export interface AddressAnalysis {
  raw_address: string;
  chain: WalletChain;
  label_from_source?: string;
  stage: AddressAnalysisStage;
  /** 0..1, percent of the per-address pipeline complete. */
  progress: number;
  /** Optional progress message displayed in the row. */
  message?: string;
  /** Filled once stage = 'ready'. */
  summary?: AddressActivitySummary;
  /** Filled if the address was flagged for investigator review. */
  flag?: FlagReason;
  /** Composite evidentiary value 0..100. Filled at 'scoring' stage. */
  score?: number;
  /** Canvas node id once the sub-graph is rendered. */
  canvas_node_id?: CanvasNodeId;
}

export type FlagReasonKind =
  | 'high_value_moved'
  | 'mixer_entry'
  | 'sanctions_hit'
  | 'exchange_deposit'
  | 'attribution_conflict'
  | 'cluster_anchor'
  | 'peel_chain_origin';

export interface FlagReason {
  kind: FlagReasonKind;
  label: string;
  /** Short investigator-facing rationale. */
  rationale: string;
  /** 0..100. Higher = higher priority for review. */
  weight: number;
}

// ---------- wallet-level ----------

export type WalletAnalysisStatus = 'not_run' | 'running' | 'complete' | 'partial' | 'failed';

export interface WalletAnalysisConfig {
  hop_depth_incoming: number;
  hop_depth_outgoing: number;
  hop_branching_cap: number;
  taint_threshold: number;
  obfuscation_detection: boolean;
  attribution_resolution: boolean;
}

export const DEFAULT_WALLET_ANALYSIS_CONFIG: WalletAnalysisConfig = {
  hop_depth_incoming: 3,
  hop_depth_outgoing: 5,
  hop_branching_cap: 50,
  taint_threshold: 0.01,
  obfuscation_detection: true,
  attribution_resolution: true,
};

export interface WalletDraft {
  name: string;
  description: string;
  source: WalletSource;
  source_provenance: string;
  /** Color from curated palette — the wallet rings on canvas use this. */
  color: PathColor;
  addresses: WalletAddressInput[];
  config: WalletAnalysisConfig;
}

export interface WalletAnalysisRun {
  status: WalletAnalysisStatus;
  started_at: string | null;
  completed_at: string | null;
  per_address: AddressAnalysis[];
  /** Aggregate metrics, populated as addresses finish. */
  aggregate: WalletAggregateSummary | null;
}

export interface WalletAggregateSummary {
  addresses_analyzed: number;
  addresses_failed: number;
  total_inflow_fiat_display: string;
  total_outflow_fiat_display: string;
  current_balance_fiat_display: string;
  top_counterparty_entities: string[];
  identified_cluster_count: number;
  obfuscation_finding_count: number;
  flagged_address_count: number;
}
