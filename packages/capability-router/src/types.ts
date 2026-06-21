/**
 * Capability Router types (v1.0 Backend §1.7 + §8).
 *
 * This module defines the contract between application code and external
 * data/LLM providers. Application code never calls a provider directly —
 * it calls `router.resolve(capability, args, ctx)`. Provider selection,
 * fallback chains, credential resolution, retries, circuit breaking,
 * and caching all happen inside the router.
 */

import type { AgencyContext, AgencyId, CaseId } from '@chainsight/shared-types';

/* ─── Capability registry ──────────────────────────────────────────────── */

/**
 * Every external dependency in ChainSight is named by a capability, not a
 * vendor. New capabilities are added here; new providers register against
 * an existing capability without code changes elsewhere.
 *
 * Phase-1 Week-4 ships three live capabilities:
 *   - get_tx_by_hash            (Etherscan default for evm:1)
 *   - get_address_attribution   (OpenSanctions OFAC SDN default — free)
 *   - llm_narrative             (Anthropic Claude default — BYOK)
 */
export type Capability =
  | 'get_tx_by_hash'
  | 'get_address_balance'
  | 'get_address_attribution'
  | 'get_price_at_timestamp'
  | 'decode_router_swap'
  | 'get_sanctions_status'
  | 'llm_narrative'
  | 'llm_narrative_stream';

/* ─── Provider connector contract ──────────────────────────────────────── */

/**
 * A connector knows how to call ONE provider (e.g. Etherscan) for one or
 * more capabilities. Router never sees provider-specific HTTP shapes.
 */
export interface ProviderConnector {
  /** Stable provider id, e.g. 'etherscan' or 'anthropic'. Must match agency_provider_installs.provider_id. */
  readonly provider_id: string;
  /** Capabilities this connector can serve. */
  readonly capabilities: readonly Capability[];
  /**
   * Execute one capability call. Throws on hard failure. Caller (router)
   * handles retry, circuit breaker, cache. Connector MUST NOT cache.
   */
  call<TPayload = unknown>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>>;
}

export interface ConnectorCallOptions {
  /** Deadline in milliseconds for the call (router enforces). */
  deadline_ms: number;
  /** Trace id propagated to provider where supported. */
  trace_id?: string;
  /** Abort signal — connector should pass to fetch / RPC. */
  signal?: AbortSignal;
}

export interface ConnectorResponse<TPayload> {
  /** Provider-shaped response payload (router caches this verbatim). */
  data: TPayload;
  /** Provider-side metadata: rate-limit headers, request id, billed cost, etc. */
  metadata: ConnectorMetadata;
}

export interface ConnectorMetadata {
  request_id?: string;
  rate_limit_remaining?: number;
  rate_limit_reset_at?: string;
  /** Tokens used (LLM connectors). */
  tokens_used?: number;
  /** Estimated USD cost (provider self-reported). */
  cost_usd?: number;
  /** Free-form provider headers the audit log may want to keep. */
  raw_headers?: Record<string, string>;
}

/* ─── Resolved credential (from credential store) ──────────────────────── */

export interface ResolvedCredential {
  /** Stable id for the credential record (audit). */
  credential_ref: string;
  /** Decrypted secret value. NEVER log. */
  secret: string;
  /** Optional secondary fields (e.g. account id for some APIs). */
  extra?: Record<string, string>;
}

/* ─── Agency provider install ──────────────────────────────────────────── */

export interface AgencyProviderInstall {
  id: string;
  agency_id: AgencyId;
  provider_id: string;
  /** Capabilities this install is enabled for (subset of connector caps). */
  enabled_capabilities: readonly Capability[];
  /** Priority within the fallback chain for each capability (lower = tried first). */
  priority: number;
  /** Reference into the credential store. */
  credential_ref: string | null;
  enabled: boolean;
  /** Per-case override — null = applies to entire agency. */
  case_id: CaseId | null;
  /** Optional per-install budget (USD per month). */
  budget_usd_per_month: number | null;
}

/* ─── Router result envelope ───────────────────────────────────────────── */

export type CapabilityResultSource =
  | 'cache_l1_redis'
  | 'cache_l2_postgres'
  | `provider:${string}`
  | `inhouse:${string}`;

export interface CapabilityResult<TPayload = unknown> {
  data: TPayload;
  source: CapabilityResultSource;
  cache_hit: boolean;
  provider_install_id: string | null;
  provider_id: string | null;
  latency_ms?: number;
  /** TTL tier used when persisting (informational). */
  ttl_tier?: CacheTtlTier;
  /** Fetched_at timestamp; for cache hits this is the original fetch time. */
  fetched_at: string;
}

/* ─── Cache tiers ──────────────────────────────────────────────────────── */

/**
 * Cache TTL tiers from v1.0 Backend §1.7. Confirmed chain data is permanent
 * once enough confirmations have accumulated; pricing snapshots and
 * attribution have shorter TTLs.
 */
export type CacheTtlTier =
  | 'permanent'        // confirmed chain data (block + tx fields)
  | 'long_24h'         // historical price snapshots
  | 'medium_1h'        // attribution lookups, sanctions checks
  | 'short_5m'         // LLM narrative (results vary)
  | 'no_cache';        // explicitly bypass

export interface CacheScope {
  /** 'global_chain_data' for confirmed chain rows, 'agency' for attribution, 'case' for narratives. */
  scope: 'global_chain_data' | 'agency' | 'case';
  /** scope_ref is null for global_chain_data; agency_id or case_id otherwise. */
  scope_ref: string | null;
}

/* ─── Resolve() options ────────────────────────────────────────────────── */

export interface ResolveOptions {
  /** Skip cache lookup (G16 first-touch-live). */
  bypass_cache?: boolean;
  /** Override TTL tier (agency admin policy). */
  ttl_override?: CacheTtlTier;
  /** Per-case budget context — router stops trying paid providers if exceeded. */
  budget_context?: BudgetContext;
  /** Override deadline (default 5s for chain, 10s for LLM). */
  deadline_ms?: number;
  /** Optional context for connectors that support tracing. */
  trace_id?: string;
}

export interface BudgetContext {
  case_id: CaseId;
  remaining_usd: number;
}

/* ─── Errors ───────────────────────────────────────────────────────────── */

export class CapabilityUnavailableError extends Error {
  constructor(message: string, readonly capability: Capability) {
    super(message);
    this.name = 'CapabilityUnavailableError';
  }
}

export class AllProvidersFailedError extends Error {
  constructor(
    message: string,
    readonly capability: Capability,
    readonly attempts: Array<{ provider_id: string; error: string }>,
  ) {
    super(message);
    this.name = 'AllProvidersFailedError';
  }
}

export class BudgetExhaustedError extends Error {
  constructor(message: string, readonly capability: Capability) {
    super(message);
    this.name = 'BudgetExhaustedError';
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string, readonly provider_install_id: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

/* ─── Re-export AgencyContext for callers ──────────────────────────────── */

export type { AgencyContext };
