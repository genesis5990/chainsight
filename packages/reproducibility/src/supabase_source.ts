/**
 * Supabase-backed CaseSource — the production data collector.
 *
 * Reads from belief.atoms, belief.events, belief.inspector_runs,
 * belief.trace_jobs, belief.cache_entries, belief.provider_resolutions.
 * For Phase-1 we read directly with the service-role key; verifier
 * replays use only the frozen bytes already inside the pack.
 */

import type {
  CaseId,
  FrozenAgentCall,
  FrozenAtom,
  FrozenAttributionRow,
  FrozenEvent,
  FrozenInspectorRun,
  FrozenMathRecipe,
  FrozenNarrative,
  FrozenProviderResponse,
  FrozenTrace,
} from '@chainsight/shared-types';
import type { CaseSource } from './case_source';
import { canonicalJson, sha256Hex } from './canonical';

/* ─── Supabase shape ───────────────────────────────────────────────────── */

export interface SupabaseSourceClient {
  schema(name: string): {
    from(table: string): SupabaseTable;
  };
}

interface SupabaseTable {
  select(cols: string): SupabaseQuery;
}

interface SupabaseQuery {
  eq(col: string, val: unknown): SupabaseQuery;
  in?(col: string, vals: unknown[]): SupabaseQuery;
  order(col: string, opts?: { ascending?: boolean }): SupabaseQuery;
  limit?(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
  then<T>(onfulfilled: (v: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => T): Promise<T>;
}

/* ─── Implementation ───────────────────────────────────────────────────── */

export class SupabaseCaseSource implements CaseSource {
  constructor(private readonly client: SupabaseSourceClient) {}

  async loadAtoms(case_id: CaseId): Promise<FrozenAtom[]> {
    try {
      const res = await this.client.schema('belief').from('atoms')
        .select('id, case_id, subject_ref, predicate, object_payload, basis, basis_detail, emitted_at, emitted_by_id, emitted_by_kind, parent_atom_id, event_seq, payload_hash, status, reproducibility_inputs')
        .eq('case_id', case_id)
        .order('event_seq', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => ({
        id: String(r.id) as FrozenAtom['id'],
        case_id: String(r.case_id) as FrozenAtom['case_id'],
        subject_ref: String(r.subject_ref),
        predicate: String(r.predicate),
        object_payload: (r.object_payload as Record<string, unknown>) ?? {},
        basis: (r.basis as FrozenAtom['basis']) ?? 'T0',
        basis_detail: String(r.basis_detail ?? ''),
        emitted_at: String(r.emitted_at),
        emitted_by_id: String(r.emitted_by_id ?? ''),
        emitted_by_kind: String(r.emitted_by_kind ?? 'system'),
        parent_atom_id: (r.parent_atom_id as FrozenAtom['parent_atom_id']) ?? undefined,
        event_seq: Number(r.event_seq ?? 0),
        payload_hash: bytesToHex(r.payload_hash),
        chain_link_hash: '',   // filled in by the builder
        status: String(r.status ?? 'asserted'),
        reproducibility_inputs: (r.reproducibility_inputs as Record<string, unknown> | undefined),
      }));
    } catch { return []; }
  }

  async loadEvents(case_id: CaseId): Promise<FrozenEvent[]> {
    try {
      // Real schema (migration 0001): id, case_id, kind, payload, emitted_at, case_seq.
      // payload carries { atom_id?, emitted_by_id?, delta? } populated by the
      // append_atom path. Map them back into the FrozenEvent shape.
      const res = await this.client.schema('belief').from('events')
        .select('case_seq, kind, payload, emitted_at')
        .eq('case_id', case_id)
        .order('case_seq', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => {
        const payload = (r.payload as Record<string, unknown> | null) ?? {};
        const atomIdRaw = payload.atom_id;
        const emittedById = payload.emitted_by_id;
        const delta = (payload.delta as Record<string, unknown> | undefined) ?? payload;
        return {
          event_seq: Number(r.case_seq ?? 0),
          event_kind: String(r.kind ?? ''),
          atom_id: (typeof atomIdRaw === 'string' ? atomIdRaw : undefined) as FrozenEvent['atom_id'],
          emitted_at: String(r.emitted_at ?? ''),
          emitted_by_id: String(emittedById ?? ''),
          delta: (delta as Record<string, unknown>) ?? {},
        };
      });
    } catch { return []; }
  }

  async loadMathRecipes(case_id: CaseId): Promise<FrozenMathRecipe[]> {
    // Phase-2: read from the dedicated belief.math_recipes table (migration 0009).
    // Workers persist a row every time an atom emits with reproducibility_inputs.recipe_hash.
    try {
      const res = await this.client.schema('belief').from('math_recipes')
        .select('recipe_hash, rpc, algo_version, inputs, output')
        .eq('case_id', case_id)
        .order('recipe_hash', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => ({
        recipe_hash: String(r.recipe_hash),
        rpc: String(r.rpc ?? ''),
        inputs: (r.inputs as Record<string, unknown>) ?? {},
        output: (r.output as Record<string, unknown>) ?? {},
        algo_version: String(r.algo_version ?? 'math@v0.2.0'),
      }));
    } catch { return []; }
  }

  async loadProviderResponses(case_id: CaseId): Promise<FrozenProviderResponse[]> {
    try {
      const res = await this.client.schema('belief').from('cache_entries')
        .select('cache_key, payload, provider_id, fetched_at, scope, scope_ref')
        .eq('scope', 'case')
        .eq('scope_ref', case_id)
        .order('cache_key', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => ({
        request_hash: String(r.cache_key),
        provider_id: String(r.provider_id ?? 'unknown'),
        capability: 'unknown',
        args: {},
        response: r.payload,
        fetched_at: String(r.fetched_at ?? ''),
      }));
    } catch { return []; }
  }

  async loadTraces(case_id: CaseId): Promise<FrozenTrace[]> {
    try {
      const res = await this.client.schema('belief').from('trace_jobs')
        .select('id, case_id, mode, origin, total_hops, total_atoms_emitted, total_budget_spent_usd, termination_reason, provider_response_hashes, completed_at')
        .eq('case_id', case_id)
        .order('queued_at', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => ({
        job_id: String(r.id),
        case_id: String(r.case_id) as FrozenTrace['case_id'],
        mode: String(r.mode),
        origin: ((r.origin as string[]) ?? []).slice().sort(),
        total_hops: Number(r.total_hops ?? 0),
        total_atoms_emitted: Number(r.total_atoms_emitted ?? 0),
        total_budget_spent_usd: Number(r.total_budget_spent_usd ?? 0),
        termination_reason: String(r.termination_reason ?? ''),
        provider_response_hashes: ((r.provider_response_hashes as string[]) ?? []).slice().sort(),
        completed_at: String(r.completed_at ?? ''),
      }));
    } catch { return []; }
  }

  async loadInspectorRuns(case_id: CaseId): Promise<FrozenInspectorRun[]> {
    try {
      const res = await this.client.schema('belief').from('inspector_runs')
        .select('id, case_id, tx_ref, methodology, recipe_hash_bundle, emitted_atom_ids, ran_at')
        .eq('case_id', case_id)
        .order('ran_at', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => ({
        run_id: String(r.id),
        case_id: String(r.case_id) as FrozenInspectorRun['case_id'],
        tx_ref: String(r.tx_ref),
        methodology: String(r.methodology ?? 'fifo'),
        recipe_hash_bundle: (r.recipe_hash_bundle as Record<string, string>) ?? {},
        emitted_atom_ids: ((r.emitted_atom_ids as string[]) ?? []).map((s) => s as FrozenInspectorRun['emitted_atom_ids'][number]),
        ran_at: String(r.ran_at ?? ''),
      }));
    } catch { return []; }
  }

  async loadAgentCalls(_case_id: CaseId): Promise<FrozenAgentCall[]> {
    // Phase-1: agent calls are not persisted as a separate table.
    return [];
  }

  async loadAttributions(case_id: CaseId): Promise<FrozenAttributionRow[]> {
    // Phase-1: attribution snapshots are referenced via has_attribution atoms.
    // We collect their object_payload from atoms. The collector here returns
    // an empty list; the section is non-empty via the atoms section already.
    void case_id;
    return [];
  }

  async loadNarratives(_case_id: CaseId): Promise<FrozenNarrative[]> {
    // Phase-1: narrative is stored inside inspector_runs.section_narrative.
    // We don't duplicate it into the narrative section; this returns [].
    return [];
  }

  async loadRuleVersions(_case_id: CaseId): Promise<Record<string, string>> {
    // Phase-1: pin the versions known at build time. A real registry comes in Phase-2.
    return {
      math_service: 'math@v0.2.0',
      hash_algo: 'blake3-256@v1',
      pathfinder_rank: 'pathfinder_rank@v1',
      inspector_pipeline: 'inspector@v0.1.0',
      tracer_agent: 'tracer@v0.1.0',
    };
  }
}

/* ─── helpers ──────────────────────────────────────────────────────────── */

function bytesToHex(value: unknown): string {
  if (typeof value === 'string') {
    // bytea in Supabase REST is base64-encoded by default; if it looks hex
    // already (\x prefix), strip the prefix.
    if (value.startsWith('\\x')) return value.slice(2).toLowerCase();
    try {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length > 0) return bytes.toString('hex');
    } catch { /* fall through */ }
    return value;
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return Buffer.from(value as number[]).toString('hex');
  // Last resort: hash the canonical JSON of whatever this is so we don't
  // produce an empty payload_hash.
  return sha256Hex(canonicalJson(value));
}
