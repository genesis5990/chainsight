/**
 * PackRepository — DB-side persistence for belief.reproducibility_packs.
 *
 * The PackService consults this for status / dedupe / list and writes a
 * `finalized` row after a successful build + storage upload.
 */

import type { CaseId, PackStatusRow } from '@chainsight/shared-types';

export interface PackRepository {
  insertBuilding(input: InsertBuildingInput): Promise<void>;
  finalize(input: FinalizeInput): Promise<{ atoms_locked: number }>;
  markFailed(pack_id: string, error: string): Promise<void>;
  byId(pack_id: string): Promise<PackStatusRow | null>;
  listForCase(case_id: CaseId, limit?: number): Promise<PackStatusRow[]>;
}

export interface InsertBuildingInput {
  pack_id: string;
  case_id: CaseId;
  agency_id: string;
  built_by_id: string;
  manifest_hash: string;
}

export interface FinalizeInput {
  pack_id: string;
  case_id: CaseId;
  storage_ref: string;
  total_atoms: number;
  total_traces: number;
  total_events: number;
  chain_tip_hash: string;
  manifest_size_bytes: number;
  finalize_atoms: boolean;
}

/* ─── Supabase impl ────────────────────────────────────────────────────── */

export interface SupabaseRepoClient {
  schema(name: string): {
    from(table: string): {
      insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
      update(row: Record<string, unknown>): {
        eq(col: string, val: unknown): Promise<{ error: { message: string } | null }>;
      };
      select(cols: string): {
        eq(col: string, val: unknown): {
          eq?(col: string, val: unknown): unknown;
          maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
          order(col: string, opts?: { ascending?: boolean }): {
            limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
          };
        };
      };
    };
  };
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: { message: string } | null }>;
}

export class SupabasePackRepository implements PackRepository {
  constructor(private readonly client: SupabaseRepoClient) {}

  async insertBuilding(input: InsertBuildingInput): Promise<void> {
    const { error } = await this.client.schema('belief').from('reproducibility_packs').insert({
      id: input.pack_id,
      case_id: input.case_id,
      agency_id: input.agency_id,
      built_by_id: input.built_by_id,
      manifest_hash: input.manifest_hash,
      status: 'building',
    });
    if (error) throw new Error(`reproducibility_packs insert failed: ${error.message}`);
  }

  async finalize(input: FinalizeInput): Promise<{ atoms_locked: number }> {
    const { error } = await this.client.schema('belief').from('reproducibility_packs').update({
      status: 'finalized',
      finalized_at: new Date().toISOString(),
      storage_ref: input.storage_ref,
      total_atoms: input.total_atoms,
      total_traces: input.total_traces,
      total_events: input.total_events,
      chain_tip_hash: input.chain_tip_hash,
      manifest_size_bytes: input.manifest_size_bytes,
    }).eq('id', input.pack_id);
    if (error) throw new Error(`reproducibility_packs finalize failed: ${error.message}`);

    let atoms_locked = 0;
    if (input.finalize_atoms) {
      const { data, error: lockErr } = await this.client.rpc<number>('lock_atoms_in_pack', {
        p_pack_id: input.pack_id, p_case_id: input.case_id,
      });
      if (lockErr) throw new Error(`lock_atoms_in_pack failed: ${lockErr.message}`);
      atoms_locked = data ?? 0;
    }
    return { atoms_locked };
  }

  async markFailed(pack_id: string, error: string): Promise<void> {
    await this.client.schema('belief').from('reproducibility_packs').update({
      status: 'failed', error,
    }).eq('id', pack_id);
  }

  async byId(pack_id: string): Promise<PackStatusRow | null> {
    try {
      const { data, error } = await this.client.schema('belief').from('reproducibility_packs')
        .select('id, case_id, status, manifest_hash, storage_ref, built_at, finalized_at, total_atoms, total_traces, total_events, chain_tip_hash, error')
        .eq('id', pack_id).maybeSingle();
      if (error || !data) return null;
      return mapRow(data);
    } catch { return null; }
  }

  async listForCase(case_id: CaseId, limit = 50): Promise<PackStatusRow[]> {
    try {
      const { data, error } = await this.client.schema('belief').from('reproducibility_packs')
        .select('id, case_id, status, manifest_hash, storage_ref, built_at, finalized_at, total_atoms, total_traces, total_events, chain_tip_hash, error')
        .eq('case_id', case_id)
        .order('built_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data.map(mapRow);
    } catch { return []; }
  }
}

function mapRow(r: Record<string, unknown>): PackStatusRow {
  return {
    pack_id: String(r.id),
    case_id: String(r.case_id) as PackStatusRow['case_id'],
    status: r.status as PackStatusRow['status'],
    manifest_hash: String(r.manifest_hash),
    storage_ref: (r.storage_ref as string | null) ?? null,
    built_at: String(r.built_at),
    finalized_at: (r.finalized_at as string | null) ?? null,
    total_atoms: Number(r.total_atoms ?? 0),
    total_traces: Number(r.total_traces ?? 0),
    total_events: Number(r.total_events ?? 0),
    chain_tip_hash: (r.chain_tip_hash as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}
