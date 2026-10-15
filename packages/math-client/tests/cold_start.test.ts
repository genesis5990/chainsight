import { describe, it, expect } from 'vitest';
import { MathClient } from '../src/client';

const OK = {
  value: 0.5,
  inputs: { basis_tier: 'T0', provider_corroboration_count: 0, sanctions_match: false, obfuscation_penalty: 0, age_decay: 0 },
  recipe_hash: 'a'.repeat(64),
};

/** fetch that takes `delays[i]` ms on call i, honouring the abort signal. */
function slowFetch(delays: number[], statuses: number[] = []) {
  const calls: number[] = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    const i = calls.length;
    calls.push(i);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delays[i] ?? 0);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    });
    const status = statuses[i] ?? 200;
    return new Response(JSON.stringify(status === 200 ? OK : { code: 'invalid_input', message: 'bad' }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('MathClient cold-start retry', () => {
  it('retries once with a longer deadline when the first call times out (service waking)', async () => {
    const { impl, calls } = slowFetch([200, 10]);
    const c = new MathClient({ baseUrl: 'http://m', fetchImpl: impl, defaultDeadlineMs: 50, coldStartRetryMs: 1000 });
    const r = await c.computeConfidence({ basis_tier: 'T0' });
    expect(r.value).toBe(0.5);
    expect(calls).toHaveLength(2);
  });

  it('gives up after one retry', async () => {
    const { impl, calls } = slowFetch([200, 200]);
    const c = new MathClient({ baseUrl: 'http://m', fetchImpl: impl, defaultDeadlineMs: 20, coldStartRetryMs: 40 });
    await expect(c.computeConfidence({ basis_tier: 'T0' })).rejects.toThrow(/deadline exceeded \(40ms\)/);
    expect(calls).toHaveLength(2);
  });

  it('does not retry an error the service returned', async () => {
    const { impl, calls } = slowFetch([0], [400]);
    const c = new MathClient({ baseUrl: 'http://m', fetchImpl: impl, coldStartRetryMs: 1000 });
    await expect(c.computeConfidence({ basis_tier: 'T0' })).rejects.toThrow(/bad/);
    expect(calls).toHaveLength(1);
  });

  it('can be disabled', async () => {
    const { impl, calls } = slowFetch([200]);
    const c = new MathClient({ baseUrl: 'http://m', fetchImpl: impl, defaultDeadlineMs: 20, coldStartRetryMs: 0 });
    await expect(c.computeConfidence({ basis_tier: 'T0' })).rejects.toThrow(/deadline exceeded \(20ms\)/);
    expect(calls).toHaveLength(1);
  });
});
