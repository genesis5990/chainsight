/**
 * Circuit breaker unit tests using an in-memory Redis-shaped fake.
 */

import { describe, it, expect } from 'vitest';
import { ProviderCircuitBreaker } from '../src/circuit_breaker';

class FakeRedis {
  private hashes = new Map<string, Record<string, string>>();
  private expires = new Map<string, number>();
  async hmget(key: string, ...fields: string[]): Promise<(string | null)[]> {
    const h = this.hashes.get(key) ?? {};
    return fields.map((f) => h[f] ?? null);
  }
  async hset(key: string, update: Record<string, string | number>): Promise<number> {
    const h = this.hashes.get(key) ?? {};
    for (const [k, v] of Object.entries(update)) h[k] = String(v);
    this.hashes.set(key, h);
    return 0;
  }
  async expire(key: string, ttl: number): Promise<number> {
    this.expires.set(key, ttl);
    return 1;
  }
}

describe('ProviderCircuitBreaker', () => {
  it('stays closed below the failure threshold', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis();
    const cb = new ProviderCircuitBreaker('install-1', redis as unknown as import('@chainsight/shared-types').KvStore, {
      failure_threshold: 5, now: () => now,
    });
    for (let i = 0; i < 4; i++) await cb.recordFailure();
    expect(await cb.isOpen()).toBe(false);
  });

  it('trips open at the failure threshold', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis();
    const cb = new ProviderCircuitBreaker('install-2', redis as unknown as import('@chainsight/shared-types').KvStore, {
      failure_threshold: 5, now: () => now,
    });
    for (let i = 0; i < 5; i++) await cb.recordFailure();
    expect(await cb.isOpen()).toBe(true);
  });

  it('moves to half_open after the reset timeout and allows a call', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis();
    const cb = new ProviderCircuitBreaker('install-3', redis as unknown as import('@chainsight/shared-types').KvStore, {
      failure_threshold: 3, reset_timeout_ms: 1000, now: () => now,
    });
    for (let i = 0; i < 3; i++) await cb.recordFailure();
    expect(await cb.isOpen()).toBe(true);
    now += 1500;
    expect(await cb.isOpen()).toBe(false);
    const snap = await cb.snapshot();
    expect(snap.state).toBe('half_open');
  });

  it('returns to closed after a success in half_open', async () => {
    let now = 1_000_000;
    const redis = new FakeRedis();
    const cb = new ProviderCircuitBreaker('install-4', redis as unknown as import('@chainsight/shared-types').KvStore, {
      failure_threshold: 3, reset_timeout_ms: 100, now: () => now,
    });
    for (let i = 0; i < 3; i++) await cb.recordFailure();
    now += 200;
    await cb.isOpen(); // transitions to half_open
    await cb.recordSuccess();
    const snap = await cb.snapshot();
    expect(snap.state).toBe('closed');
    expect(snap.recent_failures).toBe(0);
  });

  it('degrades gracefully when Redis is unavailable', async () => {
    const cb = new ProviderCircuitBreaker('install-x', null);
    await cb.recordFailure(); // no-op
    expect(await cb.isOpen()).toBe(false);
  });
});
