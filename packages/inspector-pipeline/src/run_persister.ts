/**
 * Inspector Run persister — writes a completed InspectorRunResult to
 * belief.inspector_runs (v1.1 §5.8). Used by the BullMQ consumer.
 *
 * The interface is intentionally minimal so tests can supply an in-memory
 * fake without pulling in Supabase, and production can wire a Supabase
 * service-role client.
 */

import type { InspectorRunResult } from '@chainsight/shared-types';
import { blake3 } from '@noble/hashes/blake3';

export interface InspectorRunPersister {
  persist(result: InspectorRunResult): Promise<void>;
}

/**
 * Compute the deterministic cache_key for an InspectorRunResult.
 *
 * Inputs: tx_ref, methodology, and the canonical math recipe hashes from the
 * recipe bundle. Two runs of the same tx with the same math recipe versions
 * will collide on cache_key and the upserter can short-circuit a re-run.
 */
export function computeCacheKey(result: InspectorRunResult): string {
  const bundle = result.recipe_hash_bundle ?? {};
  const mathParts = [
    bundle.decoded_action ?? '',
    bundle.value_fees ?? '',
    bundle.methodology ?? '',
    bundle.counterparty_attribution ?? '',
  ].join('|');
  const canonical = `${result.tx_ref}|${result.methodology}|${mathParts}`;
  const bytes = blake3(new TextEncoder().encode(canonical));
  return Buffer.from(bytes).toString('hex');
}

// ─── Supabase implementation ───────────────────────────────────────────────

/**
 * Minimal supabase-js shape we depend on (avoids importing the package in
 * test contexts that don't need it).
 */
export interface SupabaseLike {
  schema(name: string): {
    from(table: string): {
      insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
}

export class SupabaseInspectorRunPersister implements InspectorRunPersister {
  constructor(private readonly client: SupabaseLike) {}

  async persist(result: InspectorRunResult): Promise<void> {
    const cache_key = computeCacheKey(result);
    const row = {
      id: result.run_id,
      case_id: result.case_id,
      tx_ref: result.tx_ref,
      methodology: result.methodology,
      ran_at: result.ran_at,
      ran_by_id: result.ran_by_id,
      section_header:      result.header                  ?? null,
      section_parties:     result.parties                 ?? null,
      section_decoded:     result.decoded_action          ?? null,
      section_value_fees:  result.value_fees              ?? null,
      section_methodology: result.methodology_result      ?? null,
      section_attribution: result.counterparty_attribution ?? null,
      section_narrative:   result.narrative               ?? null,
      section_citations:   result.citations               ?? null,
      recipe_hash_bundle:  result.recipe_hash_bundle      ?? {},
      cache_key,
      emitted_atom_ids:    result.emitted_atom_ids        ?? [],
    };
    const { error } = await this.client.schema('belief').from('inspector_runs').insert(row);
    if (error) {
      // Caller decides whether to abort the run — for now we log via throw so
      // BullMQ marks the job failed and we get a clean stack in the worker.
      throw new Error(`inspector_runs insert failed: ${error.message}`);
    }
  }
}
