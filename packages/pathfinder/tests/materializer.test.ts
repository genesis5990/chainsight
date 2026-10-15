/**
 * GraphMaterializer unit tests.
 *
 * Strategy: in-memory atom feed + in-memory sink. Verifies:
 *   - idempotency: re-emitting the same atom doesn't double-insert
 *   - per-case batching: edges + nodes are grouped by case_id
 *   - pub/sub: a publish event fires once per (case_id, tick) when edges land
 */

import { describe, it, expect } from 'vitest';
import {
  GraphMaterializer,
  buildFromAtom,
  type AtomFeed,
  type MaterializedEdge,
  type MaterializedNode,
  type MaterializerSink,
} from '../src/materializer';
import type { BeliefAtom, BeliefAtomId, CaseId, SubjectRef } from '@chainsight/shared-types';
import { CASE_ID, VICTIM, BRIDGE } from './fixtures';

function atom(
  predicate: BeliefAtom['predicate'],
  subject_ref: SubjectRef,
  object_payload: Record<string, unknown>,
  id: number,
): BeliefAtom {
  return {
    id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}` as BeliefAtomId,
    case_id: CASE_ID,
    subject_ref,
    predicate,
    object_payload,
    basis: 'T0',
    basis_detail: 'test',
    emitted_at: new Date(1_700_000_000_000 + id).toISOString(),
    emitted_by_id: 'sys',
    emitted_by_kind: 'system',
    confidence: { value: 1, inputs: { basis_tier: 'T0', provider_corroboration_count: 0, sanctions_match: false, obfuscation_penalty: 0, age_decay: 0 }, recipe_hash: '' },
    status: 'asserted',
    challenges: [],
    payload_hash: '',
  } as BeliefAtom;
}

class FakeFeed implements AtomFeed {
  private hw = 0;
  constructor(private readonly batches: BeliefAtom[][]) {}
  async fetchSince(_since: number, _limit: number): Promise<BeliefAtom[]> {
    const next = this.batches.shift() ?? [];
    if (next.length > 0) this.hw += next.length;
    return next;
  }
  highWaterMark(): number { return this.hw; }
}

class FakeSink implements MaterializerSink {
  edges = new Map<string, MaterializedEdge>(); // keyed by (case_id, tx_ref, edge_index)
  nodes = new Map<string, MaterializedNode>(); // keyed by (case_id, subject_ref)
  edgeUpserts = 0;
  nodeUpserts = 0;

  async upsertEdges(rows: MaterializedEdge[]): Promise<{ inserted: number; ignored: number }> {
    let inserted = 0, ignored = 0;
    for (const r of rows) {
      const key = `${r.case_id}|${r.tx_ref}|${r.edge_index}`;
      if (this.edges.has(key)) ignored += 1;
      else { this.edges.set(key, r); inserted += 1; }
    }
    this.edgeUpserts += 1;
    return { inserted, ignored };
  }
  async upsertNodes(rows: MaterializedNode[]): Promise<{ touched: number }> {
    for (const r of rows) {
      this.nodes.set(`${r.case_id}|${r.subject_ref}`, r);
    }
    this.nodeUpserts += 1;
    return { touched: rows.length };
  }
}

describe('buildFromAtom', () => {
  it('produces an edge + 2 nodes for address_sent', () => {
    const a = atom('address_sent', VICTIM, {
      tx_hash: '0xVB1', counterparty: BRIDGE, value_native_minor: '1000', block_height: 100,
      block_time_utc: '2026-01-01T00:00:00.000Z', edge_index: 0,
    }, 1);
    const out = buildFromAtom(a);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]!.from_subject).toBe(VICTIM);
    expect(out.edges[0]!.to_subject).toBe(BRIDGE);
    expect(out.nodes.map((n) => n.subject_ref).sort()).toEqual([VICTIM, BRIDGE].sort());
  });

  it('produces nothing-but-node for tx_exists', () => {
    const a = atom('tx_exists', 'evm:1_tx:0xabc' as SubjectRef, { tx_hash: '0xabc' }, 2);
    const out = buildFromAtom(a);
    expect(out.edges).toHaveLength(0);
    expect(out.nodes).toHaveLength(1);
  });
});

describe('GraphMaterializer.tick', () => {
  it('is idempotent — second tick with same atoms inserts 0 new edges', async () => {
    const a1 = atom('address_sent', VICTIM, {
      tx_hash: '0xVB1', counterparty: BRIDGE, value_native_minor: '1000', block_height: 100, edge_index: 0,
    }, 1);
    const sink = new FakeSink();
    const mat = new GraphMaterializer({
      feed: new FakeFeed([[a1], [a1]]), // same atom twice
      sink,
    });

    const first = await mat.tick();
    expect(first.size).toBe(1);
    const ev1 = first.get(CASE_ID as CaseId)!;
    expect(ev1.edges_added).toBe(1);
    expect(sink.edges.size).toBe(1);

    const second = await mat.tick();
    // Second tick: feed returned the same atom, but our FakeSink dedupes by key
    // so inserted=0 → no event emitted.
    expect(second.size).toBe(0);
    expect(sink.edges.size).toBe(1);
  });

  it('does nothing on an empty feed', async () => {
    const sink = new FakeSink();
    const mat = new GraphMaterializer({ feed: new FakeFeed([]), sink });
    const r = await mat.tick();
    expect(r.size).toBe(0);
    expect(sink.edgeUpserts).toBe(0);
  });

  it('publishes a graph-updated message when configured', async () => {
    const sink = new FakeSink();
    const published: Array<{ channel: string; payload: string }> = [];
    const publisher = {
      publish: async (channel: string, payload: string) => {
        published.push({ channel, payload });
        return 1;
      },
    };
    const a1 = atom('address_sent', VICTIM, {
      tx_hash: '0xVB1', counterparty: BRIDGE, value_native_minor: '1000', block_height: 100, edge_index: 0,
    }, 1);
    const mat = new GraphMaterializer({
      feed: new FakeFeed([[a1]]),
      sink,
      publisher: publisher as unknown as Parameters<typeof GraphMaterializer.prototype['tick']>[0] extends never ? never : import('@chainsight/shared-types').EventPublisher,
      namespace: 'test',
    });
    await mat.tick();
    expect(published).toHaveLength(1);
    expect(published[0]!.channel).toBe(`case:${CASE_ID}:graph-updated:test`);
  });
});
