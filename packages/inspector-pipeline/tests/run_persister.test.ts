/**
 * Unit tests for SupabaseInspectorRunPersister + computeCacheKey.
 *
 * Uses an in-memory fake of the supabase-js shape we depend on so we don't
 * need a live database (the migration was applied separately and is verified
 * end-to-end by the live smoke test in /scripts).
 */

import { describe, it, expect } from 'vitest';
import type { InspectorRunResult } from '@chainsight/shared-types';
import {
  SupabaseInspectorRunPersister,
  computeCacheKey,
  type SupabaseLike,
} from '../src/run_persister';

function sampleResult(overrides: Partial<InspectorRunResult> = {}): InspectorRunResult {
  return {
    run_id: '00000000-0000-7000-8000-000000000001',
    case_id: '00000000-0000-0000-0000-000000000001' as InspectorRunResult['case_id'],
    tx_ref: 'evm:1_tx:0xabc',
    methodology: 'fifo',
    ran_at: '2026-06-21T00:00:00.000Z',
    ran_by_id: '00000000-0000-0000-0000-000000000002' as InspectorRunResult['ran_by_id'],
    cached: false,
    header: { chain: 'evm:1', tx_hash: '0xabc', block_height: 1 } as unknown as InspectorRunResult['header'],
    parties: { parties: [] } as unknown as InspectorRunResult['parties'],
    decoded_action: { action_kind: 'transfer', confidence: 1 } as unknown as InspectorRunResult['decoded_action'],
    value_fees: { fiat_currency: 'USD' } as unknown as InspectorRunResult['value_fees'],
    methodology_result: { methodology: 'fifo', applied: false } as unknown as InspectorRunResult['methodology_result'],
    counterparty_attribution: { attributions: [] } as unknown as InspectorRunResult['counterparty_attribution'],
    narrative: undefined,
    citations: undefined,
    emitted_atom_ids: ['00000000-0000-0000-0000-000000000010'] as unknown as InspectorRunResult['emitted_atom_ids'],
    recipe_hash_bundle: {
      decoded_action: 'aaaa',
      value_fees: 'bbbb',
      methodology: 'cccc',
      counterparty_attribution: 'dddd',
    },
    ...overrides,
  };
}

describe('computeCacheKey', () => {
  it('is deterministic for identical results', () => {
    const a = computeCacheKey(sampleResult());
    const b = computeCacheKey(sampleResult());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when math recipe hashes change', () => {
    const a = computeCacheKey(sampleResult());
    const b = computeCacheKey(sampleResult({
      recipe_hash_bundle: {
        decoded_action: 'AAAA-different',
        value_fees: 'bbbb',
        methodology: 'cccc',
        counterparty_attribution: 'dddd',
      },
    }));
    expect(a).not.toBe(b);
  });

  it('changes with methodology', () => {
    const a = computeCacheKey(sampleResult());
    const b = computeCacheKey(sampleResult({ methodology: 'lifo' }));
    expect(a).not.toBe(b);
  });
});

describe('SupabaseInspectorRunPersister', () => {
  function makeFakeClient(): { client: SupabaseLike; rows: Record<string, unknown>[]; lastSchema: { name?: string }; lastTable: { name?: string }; errorOnce?: { message: string } | null } {
    const rows: Record<string, unknown>[] = [];
    const lastSchema: { name?: string } = {};
    const lastTable: { name?: string } = {};
    const state: { errorOnce: { message: string } | null } = { errorOnce: null };

    const client: SupabaseLike = {
      schema(name) {
        lastSchema.name = name;
        return {
          from(table) {
            lastTable.name = table;
            return {
              async insert(row) {
                if (state.errorOnce) {
                  const e = state.errorOnce;
                  state.errorOnce = null;
                  return { error: e };
                }
                rows.push(row);
                return { error: null };
              },
            };
          },
        };
      },
    };
    return { client, rows, lastSchema, lastTable, ...state };
  }

  it('inserts into belief.inspector_runs with all 8 sections + cache_key', async () => {
    const fake = makeFakeClient();
    const persister = new SupabaseInspectorRunPersister(fake.client);
    await persister.persist(sampleResult());

    expect(fake.lastSchema.name).toBe('belief');
    expect(fake.lastTable.name).toBe('inspector_runs');
    expect(fake.rows).toHaveLength(1);
    const row = fake.rows[0]!;
    expect(row.section_header).toBeDefined();
    expect(row.section_parties).toBeDefined();
    expect(row.section_decoded).toBeDefined();
    expect(row.section_value_fees).toBeDefined();
    expect(row.section_methodology).toBeDefined();
    expect(row.section_attribution).toBeDefined();
    expect(row.section_narrative).toBeNull();
    expect(row.section_citations).toBeNull();
    expect(row.recipe_hash_bundle).toEqual(sampleResult().recipe_hash_bundle);
    expect(row.cache_key).toMatch(/^[0-9a-f]{64}$/);
    expect(row.emitted_atom_ids).toHaveLength(1);
  });

  it('throws when supabase returns an error so the worker marks the job failed', async () => {
    const fake = makeFakeClient();
    // Re-make with an error fixture
    const rows: Record<string, unknown>[] = [];
    const client: SupabaseLike = {
      schema() {
        return {
          from() {
            return {
              async insert() {
                return { error: { message: 'permission denied for table inspector_runs' } };
              },
            };
          },
        };
      },
    };
    const persister = new SupabaseInspectorRunPersister(client);
    await expect(persister.persist(sampleResult())).rejects.toThrow(/permission denied/);
    expect(rows).toHaveLength(0);
    expect(fake).toBeTruthy();
  });
});
