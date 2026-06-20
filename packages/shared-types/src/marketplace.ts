/**
 * BYOK Provider Marketplace + Model Configuration shapes (Surface 4).
 *
 * Spec references:
 *   - docs/chainsight_v0_3_byok_addendum.md          (marketplace, capability-based abstraction)
 *   - docs/chainsight_v0_4_api_key_entry_addendum.md (.env-easy key entry)
 *   - docs/chainsight_v0_9_ai_strategy.md §3         (Model Override UI + cost telemetry)
 */

import type { Tier, UserId } from './index';

// ---------- IDs ----------

export type ProviderId = string & { readonly __brand: 'ProviderId' };
export type ProviderInstallId = string & { readonly __brand: 'ProviderInstallId' };
export type AgentRoleId = string & { readonly __brand: 'AgentRoleId' };
export type LlmModelId = string & { readonly __brand: 'LlmModelId' };

// ---------- provider catalog ----------

/** The category buckets from v0.3 §2. */
export type ProviderCategory =
  | 'rpc'
  | 'block_explorer'
  | 'attribution'
  | 'osint'
  | 'market_data'
  | 'historical_price'
  | 'contract_intelligence'
  | 'sanctions_screening'
  | 'kyc_kyb'
  | 'subpoena_correspondence'
  | 'llm'
  | 'embedding'
  | 'vector_store'
  | 'object_storage'
  | 'identity_verification';

export type AuthScheme =
  | 'api_key' // single header / bearer token
  | 'api_key_pair' // key + secret
  | 'oauth2'
  | 'mtls_cert'
  | 'aws_iam'
  | 'none';

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  vendor: string; // e.g. "Chainalysis Inc."
  category: ProviderCategory;
  /** Capability identifiers this provider can satisfy (from the capability router). */
  capabilities: string[];
  description: string;
  /** Where this provider stores/processes data (sovereignty signal). */
  data_residency: string[];
  pricing_model: 'usage_metered' | 'monthly_seat' | 'annual_contract' | 'free' | 'self_hosted';
  pricing_hint?: string; // human-readable pitch ("$0.20 per 100k commands")
  auth_scheme: AuthScheme;
  /** Env-var names this provider expects (used by the .env-easy entry parser). */
  env_var_names: string[];
  /** Logo / glyph identifier (emoji or icon name). */
  glyph: string;
  /** Docs deeplink for the agency admin. */
  docs_url?: string;
  /** Sovereignty markers \u2014 useful for filtering. */
  is_self_hostable?: boolean;
  is_us_gov_only?: boolean;
  is_air_gap_capable?: boolean;
}

// ---------- installed providers (per-agency state) ----------

export interface ProviderInstall {
  id: ProviderInstallId;
  provider_id: ProviderId;
  installed_by: UserId;
  installed_at: string;
  /** Where the keys live: agency-vault | case-scoped vault. */
  key_scope: 'agency' | 'case';
  case_id?: string;
  /** Health (last check). */
  health: 'green' | 'yellow' | 'red' | 'unknown';
  health_reason?: string;
  /** Approximate calls in the current billing window. */
  calls_this_month?: number;
  /** Approximate cost in the current billing window (USD). */
  cost_this_month_fiat?: string;
}

// ---------- LLM model registry (v0.9 §3.2) ----------

export type AiTier = 'A_local' | 'B_efficient' | 'C_frontier';

export interface LlmModel {
  id: LlmModelId;
  display_name: string; // "Claude Opus 4.6"
  vendor: string; // "Anthropic"
  tier: AiTier;
  context_window_tokens: number;
  input_cost_per_mtok: number; // $/MTok input
  output_cost_per_mtok: number; // $/MTok output
  is_self_hosted: boolean;
  is_default_for_roles?: AgentRoleId[];
  /** Tier-determinism marker (for the court-grade gate). */
  belief_tier_floor: Tier;
}

// ---------- agent role registry ----------

export interface AgentRole {
  id: AgentRoleId;
  display_name: string; // "Orchestrator"
  description: string;
  /** Default model for this role per the v0.9 baseline. */
  default_model_id: LlmModelId;
}

// ---------- model assignment matrix ----------

export interface ModelAssignment {
  role_id: AgentRoleId;
  /** Null = use default. */
  override_model_id: LlmModelId | null;
}

export interface ModelMatrix {
  /** Assignments keyed by role; missing keys = default. */
  assignments: ModelAssignment[];
  /** Estimated monthly spend at current case volume. */
  estimated_monthly_cost_fiat: string;
  /** What it would cost if every role used the most-expensive frontier model. */
  baseline_all_frontier_fiat: string;
}

// ---------- .env-easy parse result (v0.4 \u00a72.2) ----------

export interface EnvParseResult {
  /** Map of detected env-var name to a sketch of the value. Never the full secret. */
  detected: Array<{
    env_var: string;
    provider_id: ProviderId | null;
    masked_preview: string; // e.g. "AKIA****WXYZ"
    looks_valid: boolean;
    warning?: string;
  }>;
  /** Lines we couldn't recognize. Surfaced so the admin can sanity-check. */
  unknown_lines: string[];
}
