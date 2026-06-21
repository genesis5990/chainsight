/**
 * CapabilityRouter unit tests — exercise the full resolve() state machine
 * with fake connectors / cache / breaker / audit.
 */

import { describe, it, expect } from 'vitest';
import type {
  AgencyContext,
  Capability,
  ConnectorCallOptions,
  ConnectorResponse,
  ProviderConnector,
  ResolvedCredential,
} from '../src/types';
import { AllProvidersFailedError, CapabilityUnavailableError } from '../src/types';
import {
  CapabilityRouter,
  type ResolutionAudit,
} from '../src/router';
import { InMemoryCredentialStore } from '../src/credential_store';
import { InMemoryInstallRegistry } from '../src/install_registry';
import type { CacheBackend, CacheEntry } from '../src/cache';
import { computeCacheKey, deriveScope } from '../src/cache';

/* ─── fakes ─────────────────────────────────────────────────────────────── */

function makeCtx(): AgencyContext {
  return {
    user_id: 'u-1',
    agency_id: 'agency-A',
    active_case_id: 'case-1',
    roles: ['investigator'],
    supervisory_scope_id: null,
    available_capabilities: [],
  };
}

class StubConnector implements ProviderConnector {
  calls = 0;
  constructor(
    readonly provider_id: string,
    readonly capabilities: readonly Capability[],
    private readonly behaviour: 'ok' | 'throw' | 'slow' = 'ok',
    private readonly payload: unknown = { ok: true },
  ) {}

  async call<TPayload>(
    _capability: Capability,
    _args: Record<string, unknown>,
    _credential: ResolvedCredential | null,
    _options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    this.calls += 1;
    if (this.behaviour === 'throw') throw new Error(`stub ${this.provider_id} fail`);
    if (this.behaviour === 'slow') await new Promise((r) => setTimeout(r, 50));
    return { data: this.payload as TPayload, metadata: { request_id: `${this.provider_id}:${this.calls}` } };
  }
}

class MemoryCache implements CacheBackend {
  readonly store = new Map<string, CacheEntry<unknown>>();
  async get<TPayload>(key: string): Promise<CacheEntry<TPayload> | null> {
    return (this.store.get(key) as CacheEntry<TPayload> | undefined) ?? null;
  }
  async set<TPayload>(key: string, _scope: unknown, entry: CacheEntry<TPayload>): Promise<void> {
    this.store.set(key, entry as CacheEntry<unknown>);
  }
}

class RecordingAudit implements ResolutionAudit {
  readonly records: Array<Record<string, unknown>> = [];
  async record(input: Record<string, unknown>): Promise<void> {
    this.records.push(input);
  }
}

/* ─── tests ─────────────────────────────────────────────────────────────── */

describe('CapabilityRouter.resolve', () => {
  it('resolves via the highest-priority provider when no cache exists', async () => {
    const fast = new StubConnector('etherscan', ['get_tx_by_hash'], 'ok', { hash: '0xabc' });
    const slow = new StubConnector('alchemy',   ['get_tx_by_hash'], 'ok', { hash: '0xabc' });
    const installs = new InMemoryInstallRegistry()
      .addDefault({ provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: 'ES_KEY', enabled: true, budget_usd_per_month: null })
      .addDefault({ provider_id: 'alchemy',   enabled_capabilities: ['get_tx_by_hash'], priority: 2, credential_ref: 'AL_KEY', enabled: true, budget_usd_per_month: null });
    const creds = new InMemoryCredentialStore();
    creds.set('ES_KEY', 'k1');
    creds.set('AL_KEY', 'k2');
    const audit = new RecordingAudit();
    const l1 = new MemoryCache();

    const router = new CapabilityRouter({
      connectors: [fast, slow],
      installs, credentials: creds,
      caches: { l1 }, audit,
    });

    const result = await router.resolve('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, makeCtx());
    expect(result.cache_hit).toBe(false);
    expect(result.source).toBe('provider:etherscan');
    expect(result.data).toEqual({ hash: '0xabc' });
    expect(fast.calls).toBe(1);
    expect(slow.calls).toBe(0);
    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]?.cache_hit).toBe(false);
  });

  it('falls back to the next provider when the first throws', async () => {
    const broken = new StubConnector('etherscan', ['get_tx_by_hash'], 'throw');
    const ok     = new StubConnector('alchemy',   ['get_tx_by_hash'], 'ok', { hash: '0xabc' });
    const installs = new InMemoryInstallRegistry()
      .addDefault({ provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: 'ES', enabled: true, budget_usd_per_month: null })
      .addDefault({ provider_id: 'alchemy',   enabled_capabilities: ['get_tx_by_hash'], priority: 2, credential_ref: 'AL', enabled: true, budget_usd_per_month: null });
    const creds = new InMemoryCredentialStore();
    creds.set('ES', 'x'); creds.set('AL', 'y');

    const router = new CapabilityRouter({
      connectors: [broken, ok], installs, credentials: creds, caches: {},
    });
    const res = await router.resolve('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, makeCtx());
    expect(res.source).toBe('provider:alchemy');
    expect(broken.calls).toBe(1);
    expect(ok.calls).toBe(1);
  });

  it('returns L1 cache hit and skips provider', async () => {
    const conn = new StubConnector('etherscan', ['get_tx_by_hash']);
    const installs = new InMemoryInstallRegistry().addDefault({
      provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: null, enabled: true, budget_usd_per_month: null,
    });
    const l1 = new MemoryCache();
    const ctx = makeCtx();
    const args = { chain: 'evm:1', tx_hash: '0xdeadbeef' };
    const scope = deriveScope('get_tx_by_hash', { agency_id: ctx.agency_id, active_case_id: ctx.active_case_id });
    const key = computeCacheKey('get_tx_by_hash', args, scope);
    await l1.set(key, scope, {
      data: { from_cache: true } as unknown,
      provider_install_id: 'cached-install',
      provider_id: 'etherscan',
      fetched_at: '2026-01-01T00:00:00.000Z',
      ttl_tier: 'permanent',
    });

    const router = new CapabilityRouter({
      connectors: [conn], installs,
      credentials: new InMemoryCredentialStore(),
      caches: { l1 },
    });
    const res = await router.resolve('get_tx_by_hash', args, ctx);
    expect(res.cache_hit).toBe(true);
    expect(res.source).toBe('cache_l1_redis');
    expect((res.data as { from_cache: boolean }).from_cache).toBe(true);
    expect(conn.calls).toBe(0);
  });

  it('persists into both L1 and L2 on provider success', async () => {
    const conn = new StubConnector('etherscan', ['get_tx_by_hash'], 'ok', { hash: '0xabc' });
    const installs = new InMemoryInstallRegistry().addDefault({
      provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: null, enabled: true, budget_usd_per_month: null,
    });
    const l1 = new MemoryCache();
    const l2 = new MemoryCache();
    const router = new CapabilityRouter({
      connectors: [conn], installs,
      credentials: new InMemoryCredentialStore(),
      caches: { l1, l2 },
    });
    await router.resolve('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, makeCtx());
    expect(l1.store.size).toBe(1);
    expect(l2.store.size).toBe(1);

    // Second call hits L1
    conn.calls = 0;
    const res2 = await router.resolve('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, makeCtx());
    expect(res2.cache_hit).toBe(true);
    expect(res2.source).toBe('cache_l1_redis');
    expect(conn.calls).toBe(0);
  });

  it('skips installs whose credential is not configured', async () => {
    const conn = new StubConnector('etherscan', ['get_tx_by_hash']);
    const installs = new InMemoryInstallRegistry().addDefault({
      provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: 'MISSING', enabled: true, budget_usd_per_month: null,
    });
    const router = new CapabilityRouter({
      connectors: [conn], installs,
      credentials: new InMemoryCredentialStore(),
      caches: {},
    });
    await expect(router.resolve('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, makeCtx()))
      .rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(conn.calls).toBe(0);
  });

  it('throws CapabilityUnavailableError when no install matches', async () => {
    const router = new CapabilityRouter({
      connectors: [],
      installs: new InMemoryInstallRegistry(),
      credentials: new InMemoryCredentialStore(),
      caches: {},
    });
    await expect(router.resolve('get_tx_by_hash', {}, makeCtx()))
      .rejects.toBeInstanceOf(CapabilityUnavailableError);
  });

  it('honours bypass_cache option', async () => {
    const conn = new StubConnector('etherscan', ['get_tx_by_hash'], 'ok', { fresh: true });
    const installs = new InMemoryInstallRegistry().addDefault({
      provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1, credential_ref: null, enabled: true, budget_usd_per_month: null,
    });
    const l1 = new MemoryCache();
    const ctx = makeCtx();
    const args = { chain: 'evm:1', tx_hash: '0xabc' };
    const scope = deriveScope('get_tx_by_hash', { agency_id: ctx.agency_id, active_case_id: ctx.active_case_id });
    const key = computeCacheKey('get_tx_by_hash', args, scope);
    await l1.set(key, scope, {
      data: { stale: true } as unknown,
      provider_install_id: null, provider_id: null,
      fetched_at: '2026-01-01T00:00:00.000Z',
      ttl_tier: 'permanent',
    });
    const router = new CapabilityRouter({
      connectors: [conn], installs,
      credentials: new InMemoryCredentialStore(),
      caches: { l1 },
    });
    const res = await router.resolve('get_tx_by_hash', args, ctx, { bypass_cache: true });
    expect(res.cache_hit).toBe(false);
    expect((res.data as { fresh: boolean }).fresh).toBe(true);
    expect(conn.calls).toBe(1);
  });
});
