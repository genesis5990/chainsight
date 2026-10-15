/**
 * SupabaseAtomFeed keyset cursor + materialization of tracer-shaped atoms.
 *
 * The previous feed ordered and filtered by belief.atoms.event_seq, a column
 * that does not exist. Every fetch errored, the error was swallowed, and no
 * edge was ever materialized. These tests pin the replacement behaviour.
 */
import { describe, it, expect } from 'vitest';
import type { BeliefAtom } from '@chainsight/shared-types';
import { SupabaseAtomFeed } from '../src/supabase_atom_feed';
import { buildFromAtom } from '../src/materializer';

type Row = Record<string, unknown>;

/** PostgREST-shaped fake supporting the filters the feed uses. */
function fakeClient(rows: Row[], fail = false) {
  const calls: string[] = [];
  const client = {
    schema: () => ({
      from: () => ({
        select: () => {
          let filtered = [...rows];
          const q = {
            in: (col: string, vals: unknown[]) => { filtered = filtered.filter((r) => vals.includes(r[col])); return q; },
            or: (f: string) => {
              calls.push(f);
              const m = /^emitted_at\.gt\."([^"]+)",and\(emitted_at\.eq\."([^"]+)",id\.gt\.([^)]+)\)$/.exec(f)!;
              const [ts, id] = [m[1]!, m[3]!];
              filtered = filtered.filter((r) => String(r.emitted_at) > ts || (String(r.emitted_at) === ts && String(r.id) > id));
              return q;
            },
            order: () => q,
            limit: async (n: number) => {
              if (fail) return { data: null, error: { message: 'column atoms.event_seq does not exist' } };
              const sorted = filtered.sort((a, b) => String(a.emitted_at).localeCompare(String(b.emitted_at)) || String(a.id).localeCompare(String(b.id)));
              return { data: sorted.slice(0, n), error: null };
            },
          };
          return q;
        },
      }),
    }),
  };
  return { client, calls };
}

const atom = (id: string, at: string, predicate = 'address_sent'): Row => ({
  id, case_id: 'c1', subject_ref: 'evm:1_addr:0xaaa', predicate, emitted_at: at,
  object_payload: {}, basis: 'T0', basis_detail: '', status: 'asserted', payload_hash: '',
});

describe('SupabaseAtomFeed', () => {
  it('pages through atoms in (emitted_at, id) order without repeats or gaps, including same-timestamp ties', async () => {
    const T = '2026-10-15T01:21:26.334123+00:00';
    const rows = [
      atom('a1', '2026-10-15T01:21:26.100000+00:00'),
      atom('b1', T), atom('b2', T), atom('b3', T), // three atoms share one timestamp
      atom('c1', '2026-10-15T01:21:27.000000+00:00'),
      atom('x', '2026-10-15T01:21:26.200000+00:00', 'has_taint_share'), // not structural
    ];
    const { client } = fakeClient(rows);
    const feed = new SupabaseAtomFeed(client as never);
    const got: string[] = [];
    for (let i = 0; i < 6; i++) {
      const batch = await feed.fetchSince(0, 2);
      got.push(...batch.map((a) => String(a.id)));
      if (!batch.length) break;
    }
    expect(got).toEqual(['a1', 'b1', 'b2', 'b3', 'c1']);
    expect(feed.highWaterMark()).toBe(5);
  });

  it('reports fetch errors instead of silently returning nothing', async () => {
    const errors: string[] = [];
    const { client } = fakeClient([], true);
    const feed = new SupabaseAtomFeed(client as never, { onError: (m) => errors.push(m) });
    expect(await feed.fetchSince(0, 10)).toEqual([]);
    expect(errors).toEqual(['fetch failed: column atoms.event_seq does not exist']);
  });
});

describe('materializing tracer-shaped atoms', () => {
  it('keeps the provider timestamp and edge kind (not 1970, not always native)', () => {
    const a = {
      id: 'atom-1', case_id: 'c1', subject_ref: 'evm:1_addr:0xaaa', predicate: 'address_sent',
      emitted_at: '2026-10-15T01:21:26Z',
      object_payload: {
        tx_hash: '0x' + 'ab'.repeat(32), counterparty: 'evm:1_addr:0xbbb',
        value_native_minor: '2500', block_height: 20628653, block_time_utc: '2024-08-28T17:43:35.000Z',
        edge_index: 0, edge_kind: 'token_transfer', trace_job_id: 'j1',
      },
    } as unknown as BeliefAtom;
    const { edges } = buildFromAtom(a);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from_subject: 'evm:1_addr:0xaaa', to_subject: 'evm:1_addr:0xbbb',
      tx_ref: 'evm:1_tx:0x' + 'ab'.repeat(32), block_height: 20628653,
      block_time: '2024-08-28T17:43:35.000Z', edge_kind: 'token_transfer', value_minor: '2500',
    });
  });
});
