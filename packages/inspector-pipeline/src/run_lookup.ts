/**
 * InspectorRunLookup — reads a previously-persisted inspector_run by
 * tx_ref + methodology + case. Lets the BullMQ consumer short-circuit
 * when an identical run is already in the table and still within TTL.
 *
 * The check is intentionally tx-key-based (not recipe-hash-based) so we
 * can avoid running the full pipeline. If the math service has rolled a
 * new HASH_ALGO_VERSION since the cached run, we invalidate at the
 * application layer by namespacing the cache_key column. For now, any
 * persisted row younger than 30 days is considered fresh.
 *
 * Read scope is restricted by RLS in Supabase; service-role bypasses RLS.
 */

import type { InspectorRunResult } from '@chainsight/shared-types';

export interface InspectorRunLookup {
  /** Returns a fresh result for the given (case, tx_ref, methodology), or null. */
  byTxAndMethodology(case_id: string, tx_ref: string, methodology: string): Promise<InspectorRunResult | null>;
}

/** Minimal supabase-js shape we depend on for inspector_runs reads. */
export interface SupabaseLookupClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        eq(col: string, val: unknown): {
          eq(col: string, val: unknown): {
            eq(col: string, val: unknown): {
              gte(col: string, val: unknown): {
                order(col: string, opts?: { ascending?: boolean }): {
                  limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
                };
              };
            };
          };
        };
      };
    };
  };
}

export class SupabaseInspectorRunLookup implements InspectorRunLookup {
  constructor(private readonly client: SupabaseLookupClient) {}

  async byTxAndMethodology(case_id: string, tx_ref: string, methodology: string): Promise<InspectorRunResult | null> {
    try {
      const nowIso = new Date().toISOString();
      const res = await this.client
        .schema('belief')
        .from('inspector_runs')
        .select('id, case_id, tx_ref, methodology, ran_at, ran_by_id, section_header, section_parties, section_decoded, section_value_fees, section_methodology, section_attribution, section_narrative, section_citations, recipe_hash_bundle, emitted_atom_ids, cache_key')
        .eq('case_id', case_id)
        .eq('tx_ref', tx_ref)
        .eq('methodology', methodology)
        .gte('expires_at', nowIso)
        .order('ran_at', { ascending: false })
        .limit(1);
      const { data, error } = res;
      if (error || !data || data.length === 0) return null;
      const row = data[0]!;
      return mapRow(row);
    } catch {
      return null;
    }
  }
}

function mapRow(row: Record<string, unknown>): InspectorRunResult {
  return {
    run_id: String(row.id),
    case_id: row.case_id as InspectorRunResult['case_id'],
    tx_ref: row.tx_ref as InspectorRunResult['tx_ref'],
    methodology: row.methodology as InspectorRunResult['methodology'],
    ran_at: row.ran_at as string,
    ran_by_id: row.ran_by_id as InspectorRunResult['ran_by_id'],
    cached: true,
    header: row.section_header as InspectorRunResult['header'],
    parties: row.section_parties as InspectorRunResult['parties'],
    decoded_action: row.section_decoded as InspectorRunResult['decoded_action'],
    value_fees: row.section_value_fees as InspectorRunResult['value_fees'],
    methodology_result: row.section_methodology as InspectorRunResult['methodology_result'],
    counterparty_attribution: row.section_attribution as InspectorRunResult['counterparty_attribution'],
    narrative: row.section_narrative as InspectorRunResult['narrative'],
    citations: row.section_citations as InspectorRunResult['citations'],
    emitted_atom_ids: (row.emitted_atom_ids as InspectorRunResult['emitted_atom_ids']) ?? [],
    recipe_hash_bundle: (row.recipe_hash_bundle as InspectorRunResult['recipe_hash_bundle']) ?? {},
  };
}
