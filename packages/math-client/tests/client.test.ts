/**
 * Tests for MathClient — fingerprinting, caching, deadline, error envelope.
 *
 * Uses fetch-mock to avoid needing the live Math service.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  MathClient,
  canonicalFingerprint,
  RecipeLru,
  MathClientError,
  type ComputeConfidenceResponse,
} from '../src/index';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    return handler(url.toString(), init ?? {});
  }) as typeof fetch;
}

describe('canonicalFingerprint', () => {
  it('sorts object keys', () => {
    expect(canonicalFingerprint({ b: 1, a: 2 })).toBe(canonicalFingerprint({ a: 2, b: 1 }));
  });

  it('drops undefined keys', () => {
    expect(canonicalFingerprint({ a: 1, b: undefined })).toBe(canonicalFingerprint({ a: 1 }));
  });

  it('preserves array order', () => {
    expect(canonicalFingerprint([1, 2, 3])).not.toBe(canonicalFingerprint([3, 2, 1]));
  });

  it('rejects non-finite numbers', () => {
    expect(() => canonicalFingerprint({ a: NaN })).toThrow();
    expect(() => canonicalFingerprint({ a: Infinity })).toThrow();
  });
});

describe('RecipeLru', () => {
  it('evicts oldest entry past capacity', () => {
    const lru = new RecipeLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');
    lru.set('c', '3'); // evicts a
    expect(lru.get('a')).toBeUndefined();
    expect(lru.get('b')).toBe('2');
    expect(lru.get('c')).toBe('3');
  });

  it('refreshes recency on get', () => {
    const lru = new RecipeLru<string>(2);
    lru.set('a', '1');
    lru.set('b', '2');
    lru.get('a');     // refresh a
    lru.set('c', '3'); // should evict b, not a
    expect(lru.get('a')).toBe('1');
    expect(lru.get('b')).toBeUndefined();
  });
});

describe('MathClient', () => {
  it('caches identical requests by fingerprint', async () => {
    let calls = 0;
    const client = new MathClient({
      baseUrl: 'http://math.example',
      fetchImpl: fakeFetch(async () => {
        calls += 1;
        const body: ComputeConfidenceResponse = {
          value: 0.5,
          inputs: {
            basis_tier: 'T0',
            provider_corroboration_count: 0,
            sanctions_match: false,
            obfuscation_penalty: 0,
            age_decay: 0,
          },
          recipe_hash: 'a'.repeat(64),
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    });
    const req = { basis_tier: 'T0' as const };
    const a = await client.computeConfidence(req);
    const b = await client.computeConfidence(req);
    expect(a.recipe_hash).toBe(b.recipe_hash);
    expect(calls).toBe(1);
  });

  it('different inputs cause different requests', async () => {
    let calls = 0;
    const client = new MathClient({
      baseUrl: 'http://math.example',
      fetchImpl: fakeFetch(async () => {
        calls += 1;
        const body: ComputeConfidenceResponse = {
          value: calls === 1 ? 0.5 : 0.3,
          inputs: {
            basis_tier: calls === 1 ? 'T0' : 'T2',
            provider_corroboration_count: 0,
            sanctions_match: false,
            obfuscation_penalty: 0,
            age_decay: 0,
          },
          recipe_hash: calls === 1 ? 'a'.repeat(64) : 'b'.repeat(64),
        };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    });
    await client.computeConfidence({ basis_tier: 'T0' });
    await client.computeConfidence({ basis_tier: 'T2' });
    expect(calls).toBe(2);
  });

  it('surfaces 4xx error envelope', async () => {
    const client = new MathClient({
      baseUrl: 'http://math.example',
      fetchImpl: fakeFetch(async () => new Response(
        JSON.stringify({ code: 'invalid_input', message: 'bad amount' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )),
    });
    await expect(
      client.computeValueAtBlock({ chain: 'eth', amount_minor: 'not-a-number', block_height: 1 }),
    ).rejects.toBeInstanceOf(MathClientError);
  });

  it('aborts on deadline', async () => {
    const client = new MathClient({
      baseUrl: 'http://math.example',
      fetchImpl: ((_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })) as typeof fetch,
      coldStartRetryMs: 0, // plain deadline behaviour; the retry has its own tests
    });
    await expect(
      client.computeConfidence({ basis_tier: 'T0' }, { deadline_ms: 30 }),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
  });
});
