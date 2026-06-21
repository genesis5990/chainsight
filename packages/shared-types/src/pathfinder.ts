/**
 * Pathfinder wire types (v1.1 §6).
 *
 * Service interface + request/response shapes for the multi-hop graph search
 * service that powers PSR selection modes and Court Mode hop navigation.
 */

import type {
  AgencyContext,
  BeliefChainId,
  EdgeRef,
  IntegerAmount,
  SubjectRef,
} from './belief';

/** Branded ids from the package root — redeclared locally to avoid circular import. */
type CaseId = string & { readonly __brand: 'CaseId' };
type BeliefAtomId = string & { readonly __brand: 'BeliefAtomId' };

/* ─── Block ref ─────────────────────────────────────────────────────────── */

export interface BlockRef {
  chain: BeliefChainId;
  block_height: number;
  block_time_utc: string;
}

/* ─── Methodology (matches math service & inspector) ───────────────────── */

export type PathfinderMethodology = 'fifo' | 'lifo' | 'proportional';

/* ─── Edge kinds (denormalized graph edges) ─────────────────────────────── */

export type GraphEdgeKind = 'tx_native' | 'tx_token' | 'internal' | 'bridge_hop';
export type ObfuscationMarker = 'mixer' | 'peel';
export type BridgeMarker = 'native' | 'wrapped';

/* ─── Node/edge data (in-memory + wire) ─────────────────────────────────── */

export interface GraphNode {
  case_id: CaseId;
  subject_ref: SubjectRef;
  subject_kind: string;
  chain: BeliefChainId;
  first_seen_at: string;
  last_seen_at: string;
  in_edge_count: number;
  out_edge_count: number;
  total_in_minor: IntegerAmount;
  total_out_minor: IntegerAmount;
  attribution_count: number;
  sanctions_hit: boolean;
}

export interface GraphEdge {
  id: string;
  case_id: CaseId;
  chain: BeliefChainId;
  from_subject: SubjectRef;
  to_subject: SubjectRef;
  edge_kind: GraphEdgeKind;
  tx_ref: string;
  edge_index: number;
  block_height: number;
  block_time: string;
  value_minor: IntegerAmount;
  obfuscation_marker: ObfuscationMarker | null;
  bridge_marker: BridgeMarker | null;
  source_atom_id: BeliefAtomId;
}

/* ─── Path result envelope ──────────────────────────────────────────────── */

export interface PathRankInputs {
  hop_count: number;
  value_carried: number;          // normalized 0..1
  obfuscation_penalty: number;    // count of mixer/peel hops
  bridge_penalty: number;         // count of bridge hops
  age_penalty: number;            // normalized 0..1
}

export interface PathResult {
  /** Deterministic hash of (case_id, node sequence). */
  path_id: string;
  nodes: SubjectRef[];
  edges: EdgeRef[];
  total_value_minor: IntegerAmount;
  total_value_fiat: string;
  obfuscation_hops: number;
  bridges_crossed: number;
  earliest_block: BlockRef;
  latest_block: BlockRef;
  /** Lower = better rank. */
  rank_score: number;
  rank_inputs: PathRankInputs;
  /** BLAKE3 of (algo, request inputs, rank_version). */
  recipe_hash: string;
}

/* ─── Requests ──────────────────────────────────────────────────────────── */

export interface ShortestPathRequest {
  case_id: CaseId;
  from: SubjectRef;
  to: SubjectRef;
  max_hops?: number;
  /** If true, edges must respect block-height ordering. Default true. */
  temporal?: boolean;
  methodology?: PathfinderMethodology;
}

export interface KShortestRequest {
  case_id: CaseId;
  from: SubjectRef;
  to: SubjectRef;
  k?: number;                     // default 5
  max_hops?: number;              // default 20
  branching_cap?: number;         // default 50
  temporal?: boolean;
  methodology?: PathfinderMethodology;
  /** Hard cap before truncating. Default 30_000 ms. */
  deadline_ms?: number;
}

export interface ThroughRequest {
  case_id: CaseId;
  /** Ordered sequence of nodes the path must visit. */
  waypoints: SubjectRef[];
  max_hops_per_leg?: number;
  temporal?: boolean;
  methodology?: PathfinderMethodology;
}

export interface NeighborsRequest {
  case_id: CaseId;
  subject: SubjectRef;
  /** 'out' = outgoing edges only; 'in' = incoming; 'both' = both. Default 'both'. */
  direction?: 'in' | 'out' | 'both';
  limit?: number;                 // default 100, max 1000
  edge_kinds?: GraphEdgeKind[];
  min_value_minor?: IntegerAmount;
  since_block?: number;
  until_block?: number;
}

export interface Neighbor {
  edge: GraphEdge;
  /** Counterparty (the OTHER side of the edge from `subject`). */
  counterparty: SubjectRef;
  /** Direction of the edge w.r.t. the query subject. */
  direction: 'in' | 'out';
}

/* ─── NL query ──────────────────────────────────────────────────────────── */

export type NlIntent =
  | { kind: 'forward_trace'; from: SubjectRef; until_kind?: 'exchange' | 'mixer' | 'fiat_offramp' }
  | { kind: 'backward_trace'; to: SubjectRef; since_block?: number }
  | { kind: 'between'; from: SubjectRef; to: SubjectRef }
  | { kind: 'cluster_share'; cluster_ref: SubjectRef; threshold_pct: number };

export interface NlQueryRequest {
  case_id: CaseId;
  prompt: string;
  from_hint?: SubjectRef;
  methodology?: PathfinderMethodology;
}

export interface NlQueryResult {
  parsed_intent: NlIntent;
  paths: PathResult[];
  /** Entity references the parser couldn't resolve (the UI surfaces them as chips). */
  unresolved_terms: string[];
  /** The parser's own confidence in its parse (0..1). */
  parser_confidence: number;
}

/* ─── Service contract ──────────────────────────────────────────────────── */

export interface PathfinderService {
  shortest(req: ShortestPathRequest, ctx: AgencyContext): Promise<PathResult | null>;
  kShortest(req: KShortestRequest, ctx: AgencyContext): Promise<{ paths: PathResult[]; truncated: boolean }>;
  through(req: ThroughRequest, ctx: AgencyContext): Promise<PathResult[]>;
  neighbors(req: NeighborsRequest, ctx: AgencyContext): Promise<Neighbor[]>;
  nlQuery(req: NlQueryRequest, ctx: AgencyContext): Promise<NlQueryResult>;
}

/* ─── Ranking ───────────────────────────────────────────────────────────── */

export const PATHFINDER_RANK_VERSION = 'pathfinder_rank@v1';

export interface PathfinderRankWeights {
  hop_weight: number;
  obfuscation_weight: number;
  bridge_weight: number;
  value_weight: number;
  age_weight: number;
}

export const PATHFINDER_RANK_WEIGHTS: PathfinderRankWeights = {
  hop_weight: 1.0,
  obfuscation_weight: 5.0,
  bridge_weight: 3.0,
  value_weight: 2.0,
  age_weight: 1.5,
};

/* ─── Materializer pub/sub ──────────────────────────────────────────────── */

export interface GraphUpdatedEvent {
  case_id: CaseId;
  /** Number of new edges committed in this batch. */
  edges_added: number;
  /** Number of nodes touched (insert + update). */
  nodes_touched: number;
  /** ISO timestamp. */
  committed_at: string;
}
