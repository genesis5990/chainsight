import { describe, it, expect } from 'vitest';
import { CACHE_KEY_VERSION, computeCacheKey, deriveTtlTier, ttlSeconds } from '../src/cache';

describe('cache policy', () => {
  it('does not keep open-ended address neighbor lookups for long', () => {
    expect(deriveTtlTier('get_address_neighbors', { address: '0xabc' })).toBe('short_5m');
    expect(deriveTtlTier('get_address_neighbors', { block_window: { from: 1 } })).toBe('short_5m');
    expect(ttlSeconds(deriveTtlTier('get_address_neighbors', {}))).toBe(300);
  });

  it('keeps neighbor lookups pinned to a closed block range', () => {
    expect(deriveTtlTier('get_address_neighbors', { block_window: { from: 1, to: 18_000_000 } })).toBe('permanent');
  });

  it('still treats a confirmed tx lookup as permanent', () => {
    expect(deriveTtlTier('get_tx_by_hash', { tx_hash: '0x1' })).toBe('permanent');
  });

  it('versions cache keys so old payload shapes are never served', () => {
    const k = computeCacheKey('get_address_neighbors', { a: 1 }, { scope: 'global_chain_data', scope_ref: null });
    expect(k.startsWith(`cap:${CACHE_KEY_VERSION}:get_address_neighbors:`)).toBe(true);
    expect(CACHE_KEY_VERSION).not.toBe('v1');
  });
});
