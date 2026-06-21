/**
 * CapabilityRouter — Pillar 3 (BYOK Capability Router) implementation.
 *
 * Single point of contact between application code and any external
 * data/LLM provider. See v1.0 Backend §1.7 + §8 for the contract.
 *
 * Flow per call (resolve()):
 *   1. Cache check  (L1 Redis → L2 Supabase)
 *   2. Install lookup (ordered fallback chain)
 *   3. For each install:
 *        a. Circuit breaker check
 *        b. Budget check (when budget_context supplied)
 *        c. Credential resolve
 *        d. Connector call with deadline + retry
 *        e. On success: persist cache + audit, return
 *        f. On failure: record + continue
 *   4. If all installs fail → AllProvidersFailedError
 */

import type {
  AgencyContext,
  AgencyProviderInstall,
  Capability,
  CapabilityResult,
  ConnectorCallOptions,
  ProviderConnector,
  ResolveOptions,
  ResolvedCredential,
} from './types';
import {
  AllProvidersFailedError,
  CapabilityUnavailableError,
} from './types';
import type { CacheBackend } from './cache';
import {
  computeCacheKey,
  deriveScope,
  deriveTtlTier,
} from './cache';
import { ProviderCircuitBreaker } from './circuit_breaker';
import type { CredentialStore } from './credential_store';
import type { InstallRegistry } from './install_registry';
import type Redis from 'ioredis';

export interface ResolutionAudit {
  record(input: {
    agency_id: string;
    case_id: string | null;
    capability: Capability;
    provider_install_id: string | null;
    provider_id: string | null;
    cache_hit: boolean;
    latency_ms: number | null;
    error?: string;
  }): Promise<void>;
}

/** No-op audit — useful when the router is constructed before Supabase is ready (tests). */
export class NoopAudit implements ResolutionAudit {
  async record(): Promise<void> {
    /* intentionally empty */
  }
}

export interface CapabilityRouterOptions {
  connectors: ProviderConnector[];
  installs: InstallRegistry;
  credentials: CredentialStore;
  caches: { l1?: CacheBackend; l2?: CacheBackend };
  /** Redis for circuit breaker state. Optional — router degrades to no-breaker if null. */
  redis?: Redis | null;
  /** Resolution audit log. Defaults to no-op. */
  audit?: ResolutionAudit;
  /** Default deadline. Override per-capability via deadline_ms in resolve(). */
  default_deadline_ms?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

export class CapabilityRouter {
  private readonly connectorsByProvider = new Map<string, ProviderConnector>();
  private readonly audit: ResolutionAudit;
  private readonly defaultDeadlineMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: CapabilityRouterOptions) {
    for (const c of opts.connectors) this.connectorsByProvider.set(c.provider_id, c);
    this.audit = opts.audit ?? new NoopAudit();
    this.defaultDeadlineMs = opts.default_deadline_ms ?? 5_000;
    this.now = opts.now ?? (() => Date.now());
  }

  async resolve<TPayload = unknown>(
    capability: Capability,
    args: Record<string, unknown>,
    ctx: AgencyContext,
    options: ResolveOptions = {},
  ): Promise<CapabilityResult<TPayload>> {
    const scope = deriveScope(capability, { agency_id: ctx.agency_id, active_case_id: ctx.active_case_id });
    const cacheKey = computeCacheKey(capability, args, scope);

    /* ─── 1. cache check ─────────────────────────────────────────────── */
    if (!options.bypass_cache) {
      const l1Hit = this.opts.caches.l1 ? await this.opts.caches.l1.get<TPayload>(cacheKey, scope) : null;
      if (l1Hit) {
        await this.audit.record({
          agency_id: ctx.agency_id, case_id: ctx.active_case_id, capability,
          provider_install_id: l1Hit.provider_install_id,
          provider_id: l1Hit.provider_id,
          cache_hit: true, latency_ms: 0,
        });
        return {
          data: l1Hit.data,
          source: 'cache_l1_redis',
          cache_hit: true,
          provider_install_id: l1Hit.provider_install_id,
          provider_id: l1Hit.provider_id,
          fetched_at: l1Hit.fetched_at,
          ttl_tier: l1Hit.ttl_tier,
          latency_ms: 0,
        };
      }
      const l2Hit = this.opts.caches.l2 ? await this.opts.caches.l2.get<TPayload>(cacheKey, scope) : null;
      if (l2Hit) {
        // Promote to L1
        if (this.opts.caches.l1) {
          await this.opts.caches.l1.set(cacheKey, scope, l2Hit);
        }
        await this.audit.record({
          agency_id: ctx.agency_id, case_id: ctx.active_case_id, capability,
          provider_install_id: l2Hit.provider_install_id,
          provider_id: l2Hit.provider_id,
          cache_hit: true, latency_ms: 0,
        });
        return {
          data: l2Hit.data,
          source: 'cache_l2_postgres',
          cache_hit: true,
          provider_install_id: l2Hit.provider_install_id,
          provider_id: l2Hit.provider_id,
          fetched_at: l2Hit.fetched_at,
          ttl_tier: l2Hit.ttl_tier,
          latency_ms: 0,
        };
      }
    }

    /* ─── 2. install lookup ──────────────────────────────────────────── */
    const installs = await this.opts.installs.installsFor(capability, ctx);
    if (installs.length === 0) {
      throw new CapabilityUnavailableError(
        `No installed provider for capability '${capability}' (agency=${ctx.agency_id})`,
        capability,
      );
    }

    /* ─── 3. iterate installs ────────────────────────────────────────── */
    const attempts: Array<{ provider_id: string; error: string }> = [];
    const ttlTier = options.ttl_override ?? deriveTtlTier(capability);
    const deadlineMs = options.deadline_ms ?? this.defaultDeadlineMs;

    for (const install of installs) {
      const connector = this.connectorsByProvider.get(install.provider_id);
      if (!connector) {
        attempts.push({ provider_id: install.provider_id, error: 'no connector registered' });
        continue;
      }

      const breaker = new ProviderCircuitBreaker(install.id, this.opts.redis ?? null, { now: this.now });
      if (await breaker.isOpen()) {
        attempts.push({ provider_id: install.provider_id, error: 'circuit breaker open' });
        continue;
      }

      // Budget check
      if (options.budget_context && install.budget_usd_per_month !== null && options.budget_context.remaining_usd <= 0) {
        attempts.push({ provider_id: install.provider_id, error: 'budget exhausted' });
        continue;
      }

      // Credential resolve (null is OK for free providers)
      let credential: ResolvedCredential | null = null;
      if (install.credential_ref) {
        credential = await this.opts.credentials.resolve(install.credential_ref);
        if (!credential) {
          attempts.push({ provider_id: install.provider_id, error: `credential ${install.credential_ref} not configured` });
          continue;
        }
      }

      const startMs = this.now();
      const callOpts: ConnectorCallOptions = {
        deadline_ms: deadlineMs,
        trace_id: options.trace_id,
        signal: AbortSignal.timeout(deadlineMs),
      };

      try {
        const response = await connector.call<TPayload>(capability, args, credential, callOpts);
        const latencyMs = this.now() - startMs;
        await breaker.recordSuccess();

        // Persist cache (best-effort)
        const fetched_at = new Date().toISOString();
        const entry = {
          data: response.data,
          provider_install_id: install.id,
          provider_id: install.provider_id,
          fetched_at,
          ttl_tier: ttlTier,
        };
        if (this.opts.caches.l1 && ttlTier !== 'no_cache') {
          await this.opts.caches.l1.set(cacheKey, scope, entry);
        }
        if (this.opts.caches.l2 && ttlTier !== 'no_cache') {
          await this.opts.caches.l2.set(cacheKey, scope, entry);
        }

        await this.audit.record({
          agency_id: ctx.agency_id, case_id: ctx.active_case_id, capability,
          provider_install_id: install.id,
          provider_id: install.provider_id,
          cache_hit: false, latency_ms: latencyMs,
        });

        return {
          data: response.data,
          source: `provider:${install.provider_id}`,
          cache_hit: false,
          provider_install_id: install.id,
          provider_id: install.provider_id,
          latency_ms: latencyMs,
          ttl_tier: ttlTier,
          fetched_at,
        };
      } catch (err) {
        await breaker.recordFailure();
        const message = (err as Error).message ?? String(err);
        attempts.push({ provider_id: install.provider_id, error: message });
        await this.audit.record({
          agency_id: ctx.agency_id, case_id: ctx.active_case_id, capability,
          provider_install_id: install.id,
          provider_id: install.provider_id,
          cache_hit: false, latency_ms: this.now() - startMs,
          error: message,
        });
        // Continue to next install
      }
    }

    /* ─── 4. all installs failed ─────────────────────────────────────── */
    throw new AllProvidersFailedError(
      `All providers failed for capability '${capability}': ${attempts.map((a) => `${a.provider_id}=${a.error}`).join(' | ')}`,
      capability,
      attempts,
    );
  }
}
