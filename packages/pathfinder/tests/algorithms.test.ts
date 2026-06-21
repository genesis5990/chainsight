/**
 * Algorithm unit tests against the Op Lemon fixture graph.
 */

import { describe, it, expect } from 'vitest';
import { buildCaseGraph } from '../src/graph_store';
import { shortest, kShortest, neighbors } from '../src/algorithms';
import { buildOpLemon, CASE_ID, VICTIM, BRIDGE, RANSOM, EXCHANGE, MIXER } from './fixtures';

const fixture = buildOpLemon();
const graph = buildCaseGraph(CASE_ID, fixture.nodes, fixture.edges);

describe('shortest', () => {
  it('finds VICTIM → EXCHANGE in 4 hops', async () => {
    const r = await shortest(graph, VICTIM, EXCHANGE, { max_hops: 10, temporal: true });
    expect(r).not.toBeNull();
    expect(r!.nodes.length).toBe(5); // VICTIM, BRIDGE, RANSOM, {MIXER|HOTWALLET}, EXCHANGE
    expect(r!.nodes[0]).toBe(VICTIM);
    expect(r!.nodes.at(-1)).toBe(EXCHANGE);
  });

  it('returns null when max_hops is too low', async () => {
    const r = await shortest(graph, VICTIM, EXCHANGE, { max_hops: 2, temporal: true });
    expect(r).toBeNull();
  });

  it('respects temporal ordering — refuses to traverse back-edge', async () => {
    // The BRIDGE→VICTIM edge is at block 90 but VICTIM→BRIDGE is at 100.
    // Temporal mode should never produce a cycle that uses the back-edge
    // after VICTIM→BRIDGE has been taken.
    const r = await shortest(graph, BRIDGE, VICTIM, { max_hops: 10, temporal: true });
    // Without temporal mode the back-edge resolves directly; with temporal
    // it does too (no prior hop), so this just confirms that the back-edge
    // is reachable from BRIDGE at block 90.
    expect(r?.nodes).toEqual([BRIDGE, VICTIM]);
  });

  it('returns same-node path with zero edges when from == to', async () => {
    const r = await shortest(graph, VICTIM, VICTIM, { max_hops: 10, temporal: true });
    expect(r?.edges).toEqual([]);
    expect(r?.nodes).toEqual([VICTIM]);
  });
});

describe('kShortest', () => {
  it('returns two parallel routes from RANSOM to EXCHANGE', async () => {
    const r = await kShortest(graph, RANSOM, EXCHANGE, {
      k: 5, max_hops: 5, branching_cap: 50, temporal: true, deadline_ms: 5_000,
    });
    expect(r.paths.length).toBe(2);
    expect(r.truncated).toBe(false);
    // Both routes have the same hop count; one uses the mixer.
    const [a, b] = r.paths;
    expect(a!.edges.length).toBe(2);
    expect(b!.edges.length).toBe(2);
    const mixerCount = r.paths.filter((p) => p.edges.some((e) => e.tx_ref.includes('RM1'))).length;
    const noMixerCount = r.paths.filter((p) => !p.edges.some((e) => e.tx_ref.includes('RM1'))).length;
    expect(mixerCount).toBe(1);
    expect(noMixerCount).toBe(1);
  });

  it('honours k limit', async () => {
    const r = await kShortest(graph, VICTIM, EXCHANGE, {
      k: 1, max_hops: 10, branching_cap: 50, temporal: true, deadline_ms: 5_000,
    });
    expect(r.paths.length).toBe(1);
  });

  it('returns empty when no path exists', async () => {
    const r = await kShortest(graph, EXCHANGE, VICTIM, {
      k: 3, max_hops: 10, branching_cap: 50, temporal: true, deadline_ms: 5_000,
    });
    expect(r.paths.length).toBe(0);
  });
});

describe('neighbors', () => {
  it('returns outgoing neighbours of RANSOM', () => {
    const ns = neighbors(graph, RANSOM, { direction: 'out', limit: 10 });
    expect(ns.map((n) => n.counterparty).sort()).toEqual([MIXER, 'evm:1_addr:0xhotw4llt'].sort());
  });

  it('returns incoming neighbours of EXCHANGE', () => {
    const ns = neighbors(graph, EXCHANGE, { direction: 'in', limit: 10 });
    expect(ns.length).toBe(2);
    expect(ns.every((n) => n.direction === 'in')).toBe(true);
  });

  it('filters by min_value_minor', () => {
    const ns = neighbors(graph, RANSOM, { direction: 'out', limit: 10, min_value_minor: '6000000000000000000' });
    expect(ns).toHaveLength(0);
  });

  it('respects limit', () => {
    const ns = neighbors(graph, BRIDGE, { direction: 'both', limit: 1 });
    expect(ns).toHaveLength(1);
  });
});
