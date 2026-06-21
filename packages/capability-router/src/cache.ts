/**
 * Capability Router cache — L1 Redis + L2 Supabase (`belief.cache_entries`).
 *
 * Cache key:
 *   `cap:{capability}:{argsHash}:{scope}:{scopeRef}`
 *
 * L1 (Redis) holds 5-minute hot entries regardless of L2 tier. L2 is the
 * authoritative store with TTL tiers from `CacheTtlTier`.
 *
 * Phase 1 Week 4 stores L2 payloads as plain JSON. Phase 2 will encrypt
 * with a per-agency DEK; the surface here doesn't change.
 */

import type Redis from 'ioredis';
import { blake3 } from '@noble/hashes/blake3';
import type {
  CacheScope,
  CacheTtlTier,
  Capability,
} from './types';

const REDIS_L1_TTL_SECONDS = 300;

export interface CacheEntry<TPayload = unknown> {
  data: TPayload;
  provider_install_id: string | null;
  provider_id: string | null;
  fetched_at: string;
  ttl_tier: CacheTtlTier;
}

export interface CacheBackend {
  get<TPayload>(key: string, scope: CacheScope): Promise<CacheEntry<TPayload> | null>;
  set<TPayload>(key: string, scope: CacheScope, entry: CacheEntry<TPayload>): Promise<void>;
}

/* ─── helpers ──────────────────────────────────────────────────────────── */

export function computeArgsHash(args: Record<string, unknown>): string {
  const canonical = stableStringify(args);
  return Buffer.from(blake3(new TextEncoder().encode(canonical))).toString('hex');
}

export function computeCacheKey(
  capability: Capability,
  args: Record<string, unknown>,
  scope: CacheScope,
): string {
  return `cap:${capability}:${computeArgsHash(args)}:${scope.scope}:${scope.scope_ref ?? '_'}`;
}

export function ttlSeconds(tier: CacheTtlTier): number {
  switch (tier) {
    case 'permanent': return 60 * 60 * 24 * 365; // 1 year; permanent rows are upserted
    case 'long_24h':  return 60 * 60 * 24;
    case 'medium_1h': return 60 * 60;
    case 'short_5m':  return 5 * 60;
    case 'no_cache':  return 0;
  }
}

/**
 * Scope derivation per v1.0 Backend §8.2 + §8.5.
 *  - confirmed chain reads      → global_chain_data (shared across agencies)
 *  - attribution / sanctions    → agency-scoped
 *  - LLM narratives             → case-scoped
 */
export function deriveScope(capability: Capability, ctx: { agency_id: string; active_case_id: string | null }): CacheScope {
  switch (capability) {
    case 'get_tx_by_hash':
    case 'get_address_balance':
    case 'decode_router_swap':
    case 'get_price_at_timestamp':
      return { scope: 'global_chain_data', scope_ref: null };
    case 'get_address_attribution':
    case 'get_sanctions_status':
      return { scope: 'agency', scope_ref: ctx.agency_id };
    case 'llm_narrative':
      return { scope: 'case', scope_ref: ctx.active_case_id ?? ctx.agency_id };
  }
}

export function deriveTtlTier(capability: Capability): CacheTtlTier {
  switch (capability) {
    case 'get_tx_by_hash':
    case 'decode_router_swap':
    case 'get_price_at_timestamp':
      return 'permanent';
    case 'get_address_balance':
      return 'short_5m';
    case 'get_address_attribution':
    case 'get_sanctions_status':
      return 'medium_1h';
    case 'llm_narrative':
      return 'short_5m';
  }
}

/* ─── L1 (Redis) backend ───────────────────────────────────────────────── */

export class RedisL1Cache implements CacheBackend {
  constructor(private readonly redis: Redis | null) {}

  async get<TPayload>(key: string): Promise<CacheEntry<TPayload> | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as CacheEntry<TPayload>;
    } catch {
      return null;
    }
  }

  async set<TPayload>(key: string, _scope: CacheScope, entry: CacheEntry<TPayload>): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(key, JSON.stringify(entry), 'EX', REDIS_L1_TTL_SECONDS);
    } catch { /* ignore */ }
  }
}

/* ─── L2 (Supabase belief.cache_entries) backend ───────────────────────── */

export interface SupabaseCacheClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        eq(col: string, val: unknown): {
          eq(col: string, val: unknown): {
            eq(col: string, val: unknown): {
              gte(col: string, val: unknown): {
                limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
              };
            };
          };
        };
      };
      upsert(row: Record<string, unknown>, options?: { onConflict?: string }): Promise<{ error: { message: string } | null }>;
    };
  };
}

export class SupabaseL2Cache implements CacheBackend {
  constructor(private readonly client: SupabaseCacheClient) {}

  async get<TPayload>(key: string, scope: CacheScope): Promise<CacheEntry<TPayload> | null> {
    try {
      const nowIso = new Date().toISOString();
      const { data, error } = await this.client
        .schema('belief')
        .from('cache_entries')
        .select('payload, provider_install_id, provider_id, fetched_at, ttl_tier')
        .eq('cache_key', key)
        .eq('scope', scope.scope)
        .eq('scope_ref', scope.scope_ref ?? '_')
        .gte('expires_at', nowIso)
        .limit(1);
      if (error || !data || data.length === 0) return null;
      const row = data[0]!;
      return {
        data: row.payload as TPayload,
        provider_install_id: (row.provider_install_id as string | null) ?? null,
        provider_id: (row.provider_id as string | null) ?? null,
        fetched_at: row.fetched_at as string,
        ttl_tier: row.ttl_tier as CacheTtlTier,
      };
    } catch {
      return null;
    }
  }

  async set<TPayload>(key: string, scope: CacheScope, entry: CacheEntry<TPayload>): Promise<void> {
    try {
      const expiresAt = new Date(Date.now() + ttlSeconds(entry.ttl_tier) * 1000).toISOString();
      await this.client.schema('belief').from('cache_entries').upsert(
        {
          cache_key: key,
          scope: scope.scope,
          scope_ref: scope.scope_ref ?? '_',
          payload: entry.data,
          provider_install_id: entry.provider_install_id,
          provider_id: entry.provider_id,
          fetched_at: entry.fetched_at,
          expires_at: expiresAt,
          ttl_tier: entry.ttl_tier,
        },
        { onConflict: 'cache_key,scope,scope_ref' },
      );
    } catch { /* ignore */ }
  }
}

/* ─── canonical JSON (matches belief-state.hash) ───────────────────────── */

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}
