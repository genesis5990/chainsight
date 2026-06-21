/**
 * SupabaseInspectorRunLookup unit tests.
 */

import { describe, it, expect } from 'vitest';
import { SupabaseInspectorRunLookup, type SupabaseLookupClient } from '../src/run_lookup';

function makeClient(rows: Array<Record<string, unknown>>): SupabaseLookupClient {
  return {
    schema() {
      return {
        from() {
          return {
            select() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        eq() {
                          return {
                            gte() {
                              return {
                                order() {
                                  return {
                                    limit: async () => ({ data: rows, error: null }),
                                  };
                                },
                              };
                            },
                          };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe('SupabaseInspectorRunLookup', () => {
  it('returns null when no rows match', async () => {
    const lookup = new SupabaseInspectorRunLookup(makeClient([]));
    const r = await lookup.byTxAndMethodology('case-1', 'evm:1_tx:0xabc', 'fifo');
    expect(r).toBeNull();
  });

  it('maps a row into an InspectorRunResult with cached=true', async () => {
    const lookup = new SupabaseInspectorRunLookup(makeClient([
      {
        id: '00000000-0000-7000-8000-000000000001',
        case_id: 'case-1',
        tx_ref: 'evm:1_tx:0xabc',
        methodology: 'fifo',
        ran_at: '2026-06-21T00:00:00.000Z',
        ran_by_id: '00000000-0000-0000-0000-000000000002',
        section_header: { chain: 'evm:1' },
        section_parties: { parties: [] },
        section_decoded: { action_kind: 'transfer' },
        section_value_fees: { fiat_currency: 'USD' },
        section_methodology: { methodology: 'fifo' },
        section_attribution: { attributions: [] },
        section_narrative: null,
        section_citations: null,
        recipe_hash_bundle: { decoded_action: 'h1' },
        emitted_atom_ids: ['atom-1'],
        cache_key: 'deadbeef',
      },
    ]));
    const r = await lookup.byTxAndMethodology('case-1', 'evm:1_tx:0xabc', 'fifo');
    expect(r).not.toBeNull();
    expect(r?.cached).toBe(true);
    expect(r?.run_id).toBe('00000000-0000-7000-8000-000000000001');
    expect(r?.emitted_atom_ids).toEqual(['atom-1']);
  });
});
