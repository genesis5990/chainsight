/**
 * In-process per-case adjacency cache (v1.1 §6.4).
 *
 * Loaded graphs are immutable — a new commit from the materializer
 * triggers a full reload via Redis pub/sub rather than mutating in place.
 * Reads are lock-free; writes go through `set()` / `invalidate()`.
 */

import type {
  CaseId,
  GraphEdge,
  GraphNode,
  SubjectRef,
} from '@chainsight/shared-types';

export interface CaseGraph {
  case_id: CaseId;
  loaded_at: number;
  nodes: Map<SubjectRef, GraphNode>;
  outgoing: Map<SubjectRef, GraphEdge[]>;
  incoming: Map<SubjectRef, GraphEdge[]>;
  /** Keyed by `${tx_ref}:${edge_index}` for direct edge lookup. */
  edge_index: Map<string, GraphEdge>;
}

/**
 * Build an immutable CaseGraph from raw rows. Edges within each adjacency
 * list are sorted by (block_height, edge_index) so temporal traversal
 * doesn't need to sort on each query.
 */
export function buildCaseGraph(case_id: CaseId, nodeRows: GraphNode[], edgeRows: GraphEdge[]): CaseGraph {
  const nodes = new Map<SubjectRef, GraphNode>();
  const outgoing = new Map<SubjectRef, GraphEdge[]>();
  const incoming = new Map<SubjectRef, GraphEdge[]>();
  const edge_index = new Map<string, GraphEdge>();

  for (const n of nodeRows) nodes.set(n.subject_ref, n);

  // Sort by (block_height, edge_index) so per-node lists are pre-ordered.
  const sortedEdges = edgeRows.slice().sort((a, b) => {
    if (a.block_height !== b.block_height) return a.block_height - b.block_height;
    return a.edge_index - b.edge_index;
  });

  for (const e of sortedEdges) {
    edge_index.set(`${e.tx_ref}:${e.edge_index}`, e);
    pushInto(outgoing, e.from_subject, e);
    pushInto(incoming, e.to_subject, e);
    // Make sure node rows exist for endpoints (subjects that only appear in
    // edges and not the node table — defensive default).
    if (!nodes.has(e.from_subject)) nodes.set(e.from_subject, nodeFromEdge(case_id, e, 'from'));
    if (!nodes.has(e.to_subject))   nodes.set(e.to_subject,   nodeFromEdge(case_id, e, 'to'));
  }

  return { case_id, loaded_at: Date.now(), nodes, outgoing, incoming, edge_index };
}

function pushInto<K, V>(m: Map<K, V[]>, key: K, value: V): void {
  const arr = m.get(key);
  if (arr) arr.push(value);
  else m.set(key, [value]);
}

function nodeFromEdge(case_id: CaseId, e: GraphEdge, side: 'from' | 'to'): GraphNode {
  const subject_ref = side === 'from' ? e.from_subject : e.to_subject;
  return {
    case_id,
    subject_ref,
    subject_kind: 'address',
    chain: e.chain,
    first_seen_at: e.block_time,
    last_seen_at: e.block_time,
    in_edge_count: 0,
    out_edge_count: 0,
    total_in_minor: '0',
    total_out_minor: '0',
    attribution_count: 0,
    sanctions_hit: false,
  };
}

/* ─── LRU cache (capacity = 64 cases per process by default) ─────────── */

export interface GraphStoreOptions {
  capacity?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

export class CaseGraphStore {
  private readonly capacity: number;
  private readonly map = new Map<CaseId, CaseGraph>();
  private readonly nowFn: () => number;

  constructor(opts: GraphStoreOptions = {}) {
    this.capacity = opts.capacity ?? 64;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  get(case_id: CaseId): CaseGraph | null {
    const g = this.map.get(case_id);
    if (!g) return null;
    // touch for LRU
    this.map.delete(case_id);
    this.map.set(case_id, g);
    return g;
  }

  set(case_id: CaseId, graph: CaseGraph): void {
    if (this.map.has(case_id)) this.map.delete(case_id);
    this.map.set(case_id, graph);
    // Evict oldest if over capacity
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  invalidate(case_id: CaseId): void {
    this.map.delete(case_id);
  }

  size(): number {
    return this.map.size;
  }

  /** Build + insert in one step (loaders use this). */
  ingest(case_id: CaseId, nodes: GraphNode[], edges: GraphEdge[]): CaseGraph {
    const g = buildCaseGraph(case_id, nodes, edges);
    g.loaded_at = this.nowFn();
    this.set(case_id, g);
    return g;
  }
}
