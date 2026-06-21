/**
 * SupabaseAtomFeed — pulls structural belief atoms from belief.atoms by
 * event_seq cursor for the GraphMaterializer.
 */

import type { BeliefAtom } from '@chainsight/shared-types';
import type { AtomFeed } from './materializer';

export interface SupabaseFeedClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        in(col: string, vals: unknown[]): {
          gt(col: string, val: unknown): {
            order(col: string, opts?: { ascending?: boolean }): {
              limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
            };
          };
        };
      };
    };
  };
}

const STRUCTURAL_PREDICATES = ['tx_exists', 'address_sent', 'address_received'];

export class SupabaseAtomFeed implements AtomFeed {
  private highWater = 0;

  constructor(private readonly client: SupabaseFeedClient) {}

  async fetchSince(sinceSeq: number, limit: number): Promise<BeliefAtom[]> {
    try {
      const res = await this.client
        .schema('belief')
        .from('atoms')
        .select('id, case_id, subject_ref, subject_kind, predicate, object_payload, basis, basis_detail, emitted_at, emitted_by_id, emitted_by_kind, event_seq, parent_atom_id, reproducibility_inputs, confidence')
        .in('predicate', STRUCTURAL_PREDICATES)
        .gt('event_seq', sinceSeq)
        .order('event_seq', { ascending: true })
        .limit(limit);
      const { data, error } = res;
      if (error || !data) return [];
      const atoms: BeliefAtom[] = [];
      for (const row of data) {
        const seq = Number(row.event_seq ?? 0);
        if (seq > this.highWater) this.highWater = seq;
        atoms.push(mapAtom(row));
      }
      return atoms;
    } catch {
      return [];
    }
  }

  highWaterMark(): number {
    return this.highWater;
  }
}

function mapAtom(row: Record<string, unknown>): BeliefAtom {
  return {
    id: String(row.id) as BeliefAtom['id'],
    case_id: String(row.case_id) as BeliefAtom['case_id'],
    subject_ref: String(row.subject_ref) as BeliefAtom['subject_ref'],
    predicate: row.predicate as BeliefAtom['predicate'],
    object_payload: (row.object_payload as Record<string, unknown>) ?? {},
    basis: (row.basis as BeliefAtom['basis']) ?? 'T0',
    basis_detail: String(row.basis_detail ?? ''),
    emitted_at: String(row.emitted_at),
    emitted_by_id: String(row.emitted_by_id ?? ''),
    emitted_by_kind: (row.emitted_by_kind as BeliefAtom['emitted_by_kind']) ?? 'system',
    parent_atom_id: (row.parent_atom_id as BeliefAtom['parent_atom_id']) ?? undefined,
    reproducibility_inputs: (row.reproducibility_inputs as Record<string, unknown> | undefined),
    confidence: (row.confidence as BeliefAtom['confidence']) ?? {
      value: 0,
      inputs: { basis_tier: 'T0', provider_corroboration_count: 0, sanctions_match: false, obfuscation_penalty: 0, age_decay: 0 },
      recipe_hash: '',
    },
    status: (row.status as BeliefAtom['status']) ?? 'asserted',
    challenges: [],
    payload_hash: String(row.payload_hash ?? ''),
  } as BeliefAtom;
}
