/**
 * Live cross-service parity check. Only runs when MATH_LIVE_URL is set so
 * CI default `vitest run` stays fast and offline-friendly.
 *
 * Usage: MATH_LIVE_URL=https://chainsight-math-dev.fly.dev pnpm test
 */

import { describe, it, expect } from 'vitest';
import { MathClient, asConfidence } from '../src/index';
import { computeConfidence as localConfidence, fillConfidenceInputs }
  from '../../belief-state/src/math-stub';

const LIVE = process.env.MATH_LIVE_URL;

describe.skipIf(!LIVE)('live math parity', () => {
  it('confidence: live recipe_hash matches local stub', async () => {
    const client = new MathClient({ baseUrl: LIVE! });
    const live = await client.computeConfidence({
      basis_tier: 'T0',
      provider_corroboration_count: 2,
      sanctions_match: true,
    });
    const local = localConfidence(fillConfidenceInputs('T0', {
      provider_corroboration_count: 2,
      sanctions_match: true,
    }));
    expect(live.recipe_hash).toBe(local.recipe_hash);
    expect(Math.abs(live.value - local.value)).toBeLessThan(1e-9);
    expect(asConfidence(live).value).toBe(live.value);
  });

  it('value_at_block: live recipe is stable across calls', async () => {
    const client = new MathClient({ baseUrl: LIVE! });
    const a = await client.computeValueAtBlock({
      chain: 'eth',
      amount_minor: '1000000000000000000',
      block_height: 21_000_000,
    });
    const b = await client.computeValueAtBlock({
      chain: 'eth',
      amount_minor: '1000000000000000000',
      block_height: 21_000_000,
    });
    expect(a.recipe_hash).toBe(b.recipe_hash);
    expect(a.value_fiat).toBe('3500.00');
  });

  it('fifo: live selection vector matches local expectation', async () => {
    const client = new MathClient({ baseUrl: LIVE! });
    const r = await client.applyFifoToHop({
      chain: 'eth',
      subject_address: 'eth:0xabc',
      block_height_at: 100,
      existing_lots: [
        { lot_id: 'a', acquired_minor: '100', acquired_at_block: 10, source_tx_hash: '0xa', taint_fraction: '0' },
        { lot_id: 'b', acquired_minor: '200', acquired_at_block: 20, source_tx_hash: '0xb', taint_fraction: '0.5' },
      ],
      outflow_minor: '150',
    });
    expect(r.selections.map((s) => s.lot_id)).toEqual(['a', 'b']);
    expect(r.selections[1]?.taint_contributed_minor).toBe('25');
    expect(r.total_taint_minor).toBe('25');
  });
});
