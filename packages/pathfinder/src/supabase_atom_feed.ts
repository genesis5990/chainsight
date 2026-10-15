/**
 * SupabaseAtomFeed: pulls structural belief atoms (tx_exists, address_sent,
 * address_received) from belief.atoms for the GraphMaterializer.
 *
 * Cursor: keyset on (emitted_at, id). belief.atoms has no global sequence
 * column (the old event_seq cursor queried a column that does not exist, so
 * every fetch errored, the error was swallowed, and nothing was ever
 * materialized). emitted_at is kept as the exact string Postgres returns, so
 * microsecond precision survives. Re-reading an atom is harmless: the sink's
 * upsert is idempotent on (case_id, tx_ref, edge_index).
 *
 * On process restart the cursor starts from the beginning and re-materializes
 * idempotently. Persist the cursor before atom volume makes that slow.
 */

import type { BeliefAtom } from '@chainsight/shared-types';
import type { AtomFeed } from './materializer';

type Result = Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;

interface FeedQuery {
  in(col: string, vals: unknown[]): FeedQuery;
  or(filter: string): FeedQuery;
  order(col: string, opts?: { ascending?: boolean }): FeedQuery;
  limit(n: number): Result;
}

export interface SupabaseFeedClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): FeedQuery;
    };
  };
}

const STRUCTURAL_PREDICATES = ['tx_exists', 'address_sent', 'address_received'];

export interface SupabaseAtomFeedOptions {
  /** Called when a fetch fails. Default: console.error. Errors are never silent. */
  onError?: (message: string) => void;
}

export class SupabaseAtomFeed implements AtomFeed {
  private lastEmittedAt: string | null = null;
  private lastId: string | null = null;
  private seen = 0;
  private readonly onError: (message: string) => void;

  constructor(
    private readonly client: SupabaseFeedClient,
    opts: SupabaseAtomFeedOptions = {},
  ) {
    this.onError = opts.onError ?? ((m) => console.error(`[atom-feed] ${m}`));
  }

  /** `sinceSeq` is ignored: the feed keeps its own (emitted_at, id) cursor. */
  async fetchSince(_sinceSeq: number, limit: number): Promise<BeliefAtom[]> {
    try {
      let q = this.client
        .schema('belief')
        .from('atoms')
        .select('id, case_id, subject_ref, subject_kind, predicate, object_payload, basis, basis_detail, emitted_at, emitted_by_id, emitted_by_kind, parent_atom_id, reproducibility_inputs, confidence, status, payload_hash')
        .in('predicate', STRUCTURAL_PREDICATES);
      if (this.lastEmittedAt && this.lastId) {
        const ts = `"${this.lastEmittedAt}"`;
        q = q.or(`emitted_at.gt.${ts},and(emitted_at.eq.${ts},id.gt.${this.lastId})`);
      }
      const { data, error } = await q
        .order('emitted_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) {
        this.onError(`fetch failed: ${error.message}`);
        return [];
      }
      const rows = data ?? [];
      const last = rows[rows.length - 1];
      if (last) {
        this.lastEmittedAt = String(last.emitted_at);
        this.lastId = String(last.id);
        this.seen += rows.length;
      }
      return rows.map(mapAtom);
    } catch (e) {
      this.onError(`fetch threw: ${(e as Error).message}`);
      return [];
    }
  }

  /** Monotonic count of atoms read (the materializer only needs it to move). */
  highWaterMark(): number {
    return this.seen;
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
