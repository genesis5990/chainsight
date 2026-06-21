/**
 * Tracer Agent wire types (v1.1 §7).
 *
 * Trace jobs, modes, progress events, and the lot/frontier shapes the
 * worker uses internally.
 */

import type {
  AgencyContext,
  BeliefAtomId,
  BeliefChainId,
  GraphEdgeKind,
  IntegerAmount,
  PathfinderMethodology,
  SubjectRef,
} from './index';

/* ─── Local branded ids (avoid circular import with belief.ts) ─────────── */

type CaseId = string & { readonly __brand: 'CaseId' };

/* ─── Modes ────────────────────────────────────────────────────────────── */

export type TraceMode =
  | 'single_hop'
  | 'forward_n'
  | 'backward_n'
  | 'autonomous'
  | 'boundary_walk'
  | 'between';

export type TraceDirection = 'forward' | 'backward' | 'both';

export type TerminationKind =
  | 'exchange'
  | 'mixer'
  | 'fiat_offramp'
  | 'coinbase'
  | 'bridge';

export type TerminationReason =
  | 'max_hops_reached'
  | 'cycle_detected'
  | 'taint_below_threshold'
  | 'user_target_reached'
  | 'attribution_terminal'
  | 'budget_exhausted'
  | 'wall_clock_exceeded'
  | 'cancelled_by_user'
  | 'all_frontiers_terminated';

/* ─── Job shape ────────────────────────────────────────────────────────── */

export interface TraceJob {
  job_id: string;
  case_id: CaseId;
  initiated_by_id: string;
  agency_id: string;
  idempotency_key: string;

  mode: TraceMode;
  origin: SubjectRef[];
  direction: TraceDirection;

  // Caps
  max_hops_per_path: number;
  max_total_hops: number;
  branching_cap: number;
  budget_usd: number;

  // Methodology
  methodology: PathfinderMethodology;
  taint_threshold: number;

  // Stop conditions
  terminate_at_kinds: TerminationKind[];
  terminate_at_subjects?: SubjectRef[];

  // Progress
  emit_progress_every_n_hops: number;
}

export interface TraceJobRequest {
  case_id: CaseId;
  mode: TraceMode;
  origin: SubjectRef[];
  direction?: TraceDirection;
  max_hops_per_path?: number;
  max_total_hops?: number;
  branching_cap?: number;
  budget_usd?: number;
  methodology?: PathfinderMethodology;
  taint_threshold?: number;
  terminate_at_kinds?: TerminationKind[];
  terminate_at_subjects?: SubjectRef[];
  emit_progress_every_n_hops?: number;
}

/* ─── Lot (carried through a frontier branch) ──────────────────────────── */

export interface Lot {
  /** Block height where this lot entered the trace. */
  origin_block_height: number;
  /** Value carried in native chain minor units. */
  amount_minor: IntegerAmount;
  /** Taint share at this point in the trace (0..1). */
  taint_share: number;
  /** Atom id of the parent emission for this lot (for chaining). */
  parent_atom_id: BeliefAtomId;
}

/* ─── Frontier entry ───────────────────────────────────────────────────── */

export interface FrontierEntry {
  node: SubjectRef;
  carried_lots: Lot[];
  hop_index: number;
  parent_atom_id: BeliefAtomId | null;
  priority_score: number;
}

/* ─── Progress events (Redis pub/sub) ──────────────────────────────────── */

export type TraceProgressEvent =
  | { kind: 'started'; job_id: string; total_origins: number }
  | {
      kind: 'hop_completed';
      job_id: string;
      hop_index: number;
      new_atom_ids: BeliefAtomId[];
      new_edges: number;
      budget_remaining_usd: number;
    }
  | {
      kind: 'branch_terminated';
      job_id: string;
      node: SubjectRef;
      reason: TerminationReason;
      hop_index: number;
    }
  | {
      kind: 'frontier_progress';
      job_id: string;
      frontier_size: number;
      total_hops_so_far: number;
      budget_remaining_usd: number;
    }
  | {
      kind: 'completed';
      job_id: string;
      summary: TraceSummary;
    }
  | {
      kind: 'failed';
      job_id: string;
      error: string;
    };

export interface TraceSummary {
  job_id: string;
  case_id: CaseId;
  mode: TraceMode;
  total_hops: number;
  total_atoms_emitted: number;
  total_edges: number;
  total_budget_spent_usd: number;
  termination_reason: TerminationReason;
  started_at: string;
  completed_at: string;
  origin_count: number;
  /** Counts of branch terminations by reason. */
  branch_termination_counts: Record<TerminationReason, number>;
}

/* ─── Provider neighbors capability shape (Tracer-side) ────────────────── */

export interface TracerNeighborEdge {
  chain: BeliefChainId;
  tx_hash: string;
  edge_index: number;
  block_height: number;
  block_time_utc: string;
  from_subject: SubjectRef;
  to_subject: SubjectRef;
  value_native_minor: IntegerAmount;
  edge_kind: GraphEdgeKind;
  /** Provider-side cost estimate for accounting. */
  cost_usd: number;
}

export interface TracerNeighborsResponse {
  edges: TracerNeighborEdge[];
  /** Provider-supplied attribution category for the queried node, if any. */
  node_attribution_kind?: TerminationKind | null;
  /** Sum of all per-edge cost_usd. */
  total_cost_usd: number;
}

/* ─── Job service contract (worker-side) ───────────────────────────────── */

export interface TracerAgentService {
  start(req: TraceJobRequest, ctx: AgencyContext): Promise<{ job_id: string; idempotency_key: string; deduplicated: boolean }>;
  cancel(job_id: string, ctx: AgencyContext): Promise<void>;
  status(job_id: string, ctx: AgencyContext): Promise<TraceJobStatus | null>;
  listForCase(case_id: CaseId, ctx: AgencyContext): Promise<TraceJobStatus[]>;
}

export interface TraceJobStatus {
  job_id: string;
  case_id: CaseId;
  mode: TraceMode;
  status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed';
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  total_hops: number;
  total_atoms_emitted: number;
  total_budget_spent_usd: number;
  termination_reason: TerminationReason | null;
  error: string | null;
}

/* ─── BullMQ queue names ───────────────────────────────────────────────── */

export const TRACER_QUEUE_NAME = 'trace:analyze';
export const TRACER_CANCEL_QUEUE_NAME = 'trace:cancel';

/* ─── Defaults ─────────────────────────────────────────────────────────── */

export const TRACER_DEFAULTS = {
  max_hops_per_path: 12,
  max_total_hops: 200,
  branching_cap: 30,
  budget_usd: 5,
  taint_threshold: 0.01,
  emit_progress_every_n_hops: 1,
  terminate_at_kinds: ['exchange', 'fiat_offramp', 'coinbase'] as TerminationKind[],
  methodology: 'fifo' as PathfinderMethodology,
  direction: 'forward' as TraceDirection,
  /** Max wall-clock per job. */
  wall_clock_ms: 30 * 60 * 1000,
  /** Frontier expansion parallelism within a job. */
  in_job_concurrency: 8,
};
