/**
 * Loads a per-case graph from belief.case_subgraph_nodes + edges.
 *
 * Used on cache miss. The loader is intentionally small — the Pathfinder
 * holds the LRU cache; this module just turns Supabase rows into the
 * GraphNode/GraphEdge shapes that buildCaseGraph expects.
 */

import type {
  BeliefAtomId,
  CaseId,
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  IntegerAmount,
  SubjectRef,
} from '@chainsight/shared-types';

export interface GraphLoader {
  loadNodes(case_id: CaseId): Promise<GraphNode[]>;
  loadEdges(case_id: CaseId): Promise<GraphEdge[]>;
}

/* ─── supabase shape we depend on ──────────────────────────────────────── */

export interface SupabaseGraphClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        eq(col: string, val: unknown): {
          order?(col: string, opts?: { ascending?: boolean }): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
          then<T>(onfulfilled: (v: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => T): Promise<T>;
        };
      };
      upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string }): Promise<{ error: { message: string } | null }>;
    };
  };
}

export class SupabaseGraphLoader implements GraphLoader {
  constructor(private readonly client: SupabaseGraphClient) {}

  async loadNodes(case_id: CaseId): Promise<GraphNode[]> {
    try {
      const res = await this.client
        .schema('belief')
        .from('case_subgraph_nodes')
        .select('case_id, subject_ref, subject_kind, chain, first_seen_at, last_seen_at, in_edge_count, out_edge_count, total_in_minor, total_out_minor, attribution_count, sanctions_hit')
        .eq('case_id', case_id);
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => mapNode(r));
    } catch {
      return [];
    }
  }

  async loadEdges(case_id: CaseId): Promise<GraphEdge[]> {
    try {
      const res = await this.client
        .schema('belief')
        .from('case_subgraph_edges')
        .select('id, case_id, chain, from_subject, to_subject, edge_kind, tx_ref, edge_index, block_height, block_time, value_minor, obfuscation_marker, bridge_marker, source_atom_id')
        .eq('case_id', case_id);
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data.map((r) => mapEdge(r));
    } catch {
      return [];
    }
  }
}

function mapNode(row: Record<string, unknown>): GraphNode {
  return {
    case_id: String(row.case_id) as GraphNode['case_id'],
    subject_ref: String(row.subject_ref) as SubjectRef,
    subject_kind: String(row.subject_kind ?? 'address'),
    chain: String(row.chain) as GraphNode['chain'],
    first_seen_at: String(row.first_seen_at),
    last_seen_at: String(row.last_seen_at),
    in_edge_count: Number(row.in_edge_count ?? 0),
    out_edge_count: Number(row.out_edge_count ?? 0),
    total_in_minor: String(row.total_in_minor ?? '0') as IntegerAmount,
    total_out_minor: String(row.total_out_minor ?? '0') as IntegerAmount,
    attribution_count: Number(row.attribution_count ?? 0),
    sanctions_hit: Boolean(row.sanctions_hit ?? false),
  };
}

function mapEdge(row: Record<string, unknown>): GraphEdge {
  return {
    id: String(row.id),
    case_id: String(row.case_id) as GraphEdge['case_id'],
    chain: String(row.chain) as GraphEdge['chain'],
    from_subject: String(row.from_subject) as SubjectRef,
    to_subject: String(row.to_subject) as SubjectRef,
    edge_kind: String(row.edge_kind ?? 'tx_native') as GraphEdgeKind,
    tx_ref: String(row.tx_ref),
    edge_index: Number(row.edge_index ?? 0),
    block_height: Number(row.block_height ?? 0),
    block_time: String(row.block_time),
    value_minor: String(row.value_minor ?? '0') as IntegerAmount,
    obfuscation_marker: (row.obfuscation_marker as GraphEdge['obfuscation_marker']) ?? null,
    bridge_marker: (row.bridge_marker as GraphEdge['bridge_marker']) ?? null,
    source_atom_id: String(row.source_atom_id) as BeliefAtomId,
  };
}
