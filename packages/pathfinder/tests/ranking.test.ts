/**
 * Ranking + recipe hash determinism.
 */

import { describe, it, expect } from 'vitest';
import { computePathId, computeRankScore, computeRecipeHash, summarizePath } from '../src/ranking';
import { buildOpLemon, VICTIM, EXCHANGE } from './fixtures';

describe('computeRankScore', () => {
  it('punishes obfuscation hops more than extra-hop length', () => {
    const noMixer  = computeRankScore({ hop_count: 5, value_carried: 0.5, obfuscation_penalty: 0, bridge_penalty: 0, age_penalty: 0 });
    const withMixer = computeRankScore({ hop_count: 4, value_carried: 0.5, obfuscation_penalty: 1, bridge_penalty: 0, age_penalty: 0 });
    expect(withMixer).toBeGreaterThan(noMixer);
  });

  it('rewards higher value_carried', () => {
    const lowVal  = computeRankScore({ hop_count: 3, value_carried: 0.1, obfuscation_penalty: 0, bridge_penalty: 0, age_penalty: 0 });
    const highVal = computeRankScore({ hop_count: 3, value_carried: 0.9, obfuscation_penalty: 0, bridge_penalty: 0, age_penalty: 0 });
    expect(highVal).toBeLessThan(lowVal);
  });
});

describe('computePathId', () => {
  it('is deterministic and changes when node order changes', () => {
    const a = computePathId('case-1', [VICTIM, EXCHANGE]);
    const b = computePathId('case-1', [VICTIM, EXCHANGE]);
    const c = computePathId('case-1', [EXCHANGE, VICTIM]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeRecipeHash', () => {
  it('produces the same hash for identical inputs regardless of key order', () => {
    const a = computeRecipeHash({ algo: 'kShortest', case_id: 'c', from: VICTIM, to: EXCHANGE, k: 3, max_hops: 20, temporal: true });
    const b = computeRecipeHash({ to: EXCHANGE, from: VICTIM, max_hops: 20, k: 3, temporal: true, algo: 'kShortest', case_id: 'c' });
    expect(a).toBe(b);
  });

  it('changes when k changes', () => {
    const a = computeRecipeHash({ algo: 'kShortest', case_id: 'c', from: VICTIM, to: EXCHANGE, k: 3 });
    const b = computeRecipeHash({ algo: 'kShortest', case_id: 'c', from: VICTIM, to: EXCHANGE, k: 5 });
    expect(a).not.toBe(b);
  });
});

describe('summarizePath', () => {
  it('aggregates totals + counts for the Op Lemon main route', () => {
    const fx = buildOpLemon();
    const mainRouteEdges = fx.edges.filter((e) =>
      ['evm:1_tx:0xVB1', 'evm:1_tx:0xBR1', 'evm:1_tx:0xRH1', 'evm:1_tx:0xHE1'].includes(e.tx_ref),
    );
    const sum = summarizePath(mainRouteEdges);
    expect(sum.obfuscation_hops).toBe(0);
    expect(sum.bridges_crossed).toBe(0);
    expect(sum.earliest_block).toBe(100);
    expect(sum.latest_block).toBe(135);
    // 10e18 + 10e18 + 5e18 + 5e18 = 30e18
    expect(sum.total_value_minor).toBe('30000000000000000000');
  });
});
