/**
 * Graph materializer (v1.1 §6.3).
 *
 * Consumes structural BeliefAtoms (`tx_exists`, `address_sent`,
 * `address_received`) and upserts rows into belief.case_subgraph_{nodes,edges}.
 * Idempotent — the UNIQUE constraint on (case_id, tx_ref, edge_index) makes
 * duplicate emissions no-ops.
 *
 * On a successful batch commit, publishes `case:{id}:graph-updated:{ns}`
 * to belief.case_stream so API processes can invalidate their adjacency caches.
 *
 * Phase 1 design: pull-based on a 5-second tick that scans for new atoms.
 * A push-based subscriber will follow in Week 6 once the belief-state
 * service emits a `belief-atom-emitted` channel that includes case_id and
 * the predicate so we can filter cheaply.
 */

import type { EventPublisher } from '@chainsight/shared-types';
import type {
  BeliefAtom,
  CaseId,
  GraphEdgeKind,
  GraphUpdatedEvent,
  IntegerAmount,
  SubjectRef,
} from '@chainsight/shared-types';

/* ─── Atom feed contract ───────────────────────────────────────────────── */

export interface AtomFeed {
  /**
   * Return atoms with structural predicates emitted since `sinceSeq` per case.
   * Implementations may bucket by case_id internally; the materializer iterates.
   */
  fetchSince(sinceSeq: number, limit: number): Promise<BeliefAtom[]>;
  /** Highest event_seq observed in the last fetch — used for cursor tracking. */
  highWaterMark(): number;
}

/* ─── Materializer sink ────────────────────────────────────────────────── */

export interface MaterializerSink {
  upsertEdges(rows: MaterializedEdge[]): Promise<{ inserted: number; ignored: number }>;
  upsertNodes(rows: MaterializedNode[]): Promise<{ touched: number }>;
}

export interface MaterializedEdge {
  case_id: CaseId;
  chain: string;
  from_subject: string;
  to_subject: string;
  edge_kind: GraphEdgeKind;
  tx_ref: string;
  edge_index: number;
  block_height: number;
  block_time: string;
  value_minor: IntegerAmount;
  obfuscation_marker: 'mixer' | 'peel' | null;
  bridge_marker: 'native' | 'wrapped' | null;
  source_atom_id: string;
}

export interface MaterializedNode {
  case_id: CaseId;
  subject_ref: string;
  subject_kind: string;
  chain: string;
  observed_at: string;
}

/* ─── Materializer ─────────────────────────────────────────────────────── */

export interface MaterializerOptions {
  feed: AtomFeed;
  sink: MaterializerSink;
  /** Live event sink (CaseStream). Emits `graph-updated` per changed case. */
  publisher?: EventPublisher | null;
  namespace?: string;
  tick_interval_ms?: number;
  batch_size?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

const DEFAULT_TICK_MS = 5_000;
const DEFAULT_BATCH = 500;

export class GraphMaterializer {
  private cursor = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly ns: string;
  private readonly tickMs: number;
  private readonly batchSize: number;
  private readonly nowFn: () => number;

  constructor(private readonly opts: MaterializerOptions) {
    this.ns = opts.namespace ?? 'dev';
    this.tickMs = opts.tick_interval_ms ?? DEFAULT_TICK_MS;
    this.batchSize = opts.batch_size ?? DEFAULT_BATCH;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(() => { /* swallow */ }); }, this.tickMs);
    // Don't keep the event loop alive on shutdown.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Run one cycle. Returns the per-case summary of what changed. */
  async tick(): Promise<Map<CaseId, GraphUpdatedEvent>> {
    const atoms = await this.opts.feed.fetchSince(this.cursor, this.batchSize);
    if (atoms.length === 0) return new Map();
    this.cursor = this.opts.feed.highWaterMark();

    const byCase = new Map<CaseId, { edges: MaterializedEdge[]; nodes: Map<string, MaterializedNode> }>();
    for (const atom of atoms) {
      const buckets = byCase.get(atom.case_id) ?? { edges: [], nodes: new Map<string, MaterializedNode>() };
      const built = buildFromAtom(atom);
      for (const e of built.edges) buckets.edges.push(e);
      for (const n of built.nodes) buckets.nodes.set(n.subject_ref, n);
      byCase.set(atom.case_id, buckets);
    }

    const updates = new Map<CaseId, GraphUpdatedEvent>();
    for (const [case_id, payload] of byCase.entries()) {
      const edgeResult = await this.opts.sink.upsertEdges(payload.edges);
      const nodeResult = await this.opts.sink.upsertNodes(Array.from(payload.nodes.values()));
      // Publish only when at least one NEW edge landed. Node-only touches are
      // re-observations of existing subjects and don't change the adjacency.
      if (edgeResult.inserted > 0) {
        const event: GraphUpdatedEvent = {
          case_id,
          edges_added: edgeResult.inserted,
          nodes_touched: nodeResult.touched,
          committed_at: new Date(this.nowFn()).toISOString(),
        };
        updates.set(case_id, event);
        if (this.opts.publisher) {
          await this.opts.publisher
            .publish(`case:${case_id}:graph-updated:${this.ns}`, JSON.stringify(event))
            .catch(() => { /* */ });
        }
      }
    }
    return updates;
  }
}

/* ─── atom → (edges, nodes) ────────────────────────────────────────────── */

export function buildFromAtom(atom: BeliefAtom): { edges: MaterializedEdge[]; nodes: MaterializedNode[] } {
  const obj = (atom.object_payload ?? {}) as Record<string, unknown>;
  const nodes: MaterializedNode[] = [];
  const edges: MaterializedEdge[] = [];

  if (atom.predicate !== 'address_sent') {
    // Materialize the subject as a node so subjects-with-no-edges still appear.
    nodes.push({
      case_id: atom.case_id,
      subject_ref: String(atom.subject_ref),
      subject_kind: 'address',
      chain: deriveChain(String(atom.subject_ref)),
      observed_at: atom.emitted_at,
    });
  }

  if (atom.predicate === 'address_sent') {
    const tx_hash   = String(obj.tx_hash ?? '');
    const txRef     = tx_hash ? `${deriveChain(String(atom.subject_ref))}_tx:${tx_hash}` : '';
    const counterparty = String(obj.counterparty ?? '');
    const value_minor  = String(obj.value_native_minor ?? '0');
    const blockHeight  = Number(obj.block_height ?? 0);
    const edgeIndex    = Number(obj.edge_index ?? 0);
    const blockTime    = String(obj.block_time_utc ?? new Date(0).toISOString());

    if (txRef && counterparty) {
      edges.push({
        case_id: atom.case_id,
        chain: deriveChain(String(atom.subject_ref)),
        from_subject: String(atom.subject_ref),
        to_subject: counterparty,
        // Provider-reported kind (tx_native | token_transfer); default native.
        edge_kind: (typeof obj.edge_kind === 'string' ? obj.edge_kind : 'tx_native') as GraphEdgeKind,
        tx_ref: txRef,
        edge_index: edgeIndex,
        block_height: blockHeight,
        block_time: blockTime,
        value_minor: value_minor as IntegerAmount,
        obfuscation_marker: null,
        bridge_marker: null,
        source_atom_id: atom.id,
      });
      nodes.push(
        {
          case_id: atom.case_id, subject_ref: String(atom.subject_ref),
          subject_kind: 'address', chain: deriveChain(String(atom.subject_ref)),
          observed_at: atom.emitted_at,
        },
        {
          case_id: atom.case_id, subject_ref: counterparty,
          subject_kind: 'address', chain: deriveChain(counterparty),
          observed_at: atom.emitted_at,
        },
      );
    }
  }

  return { edges, nodes };
}

function deriveChain(subjectRef: string): string {
  // 'evm:1_addr:0x…' → 'evm:1'; 'eth:0x…' → 'eth'; otherwise unknown.
  const m = subjectRef.match(/^([a-z]+:[0-9a-z-]+)_(addr|tx|cluster):/i);
  if (m) return m[1]!.toLowerCase();
  const legacy = subjectRef.match(/^([a-z]+):/i);
  if (legacy) return legacy[1]!.toLowerCase();
  return 'unknown';
}

/* ─── Supabase sink ────────────────────────────────────────────────────── */

export interface SupabaseMaterializerClient {
  schema(name: string): {
    from(table: string): {
      upsert(rows: Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<{ error: { message: string } | null; count?: number | null }>;
    };
  };
}

export class SupabaseMaterializerSink implements MaterializerSink {
  constructor(private readonly client: SupabaseMaterializerClient) {}

  async upsertEdges(rows: MaterializedEdge[]): Promise<{ inserted: number; ignored: number }> {
    if (rows.length === 0) return { inserted: 0, ignored: 0 };
    const payload = rows.map((r) => ({
      case_id: r.case_id,
      chain: r.chain,
      from_subject: r.from_subject,
      to_subject: r.to_subject,
      edge_kind: r.edge_kind,
      tx_ref: r.tx_ref,
      edge_index: r.edge_index,
      block_height: r.block_height,
      block_time: r.block_time,
      value_minor: r.value_minor,
      obfuscation_marker: r.obfuscation_marker,
      bridge_marker: r.bridge_marker,
      source_atom_id: r.source_atom_id,
    }));
    const { error } = await this.client
      .schema('belief')
      .from('case_subgraph_edges')
      .upsert(payload, { onConflict: 'case_id,tx_ref,edge_index', ignoreDuplicates: true });
    if (error) return { inserted: 0, ignored: 0 };
    return { inserted: payload.length, ignored: 0 };
  }

  async upsertNodes(rows: MaterializedNode[]): Promise<{ touched: number }> {
    if (rows.length === 0) return { touched: 0 };
    const payload = rows.map((r) => ({
      case_id: r.case_id,
      subject_ref: r.subject_ref,
      subject_kind: r.subject_kind,
      chain: r.chain,
      first_seen_at: r.observed_at,
      last_seen_at: r.observed_at,
    }));
    const { error } = await this.client
      .schema('belief')
      .from('case_subgraph_nodes')
      .upsert(payload, { onConflict: 'case_id,subject_ref' });
    if (error) return { touched: 0 };
    return { touched: payload.length };
  }
}
