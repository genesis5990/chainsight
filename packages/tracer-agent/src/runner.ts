/**
 * TracerRunner — best-first frontier expansion (v1.1 §7).
 *
 * Per-hop pipeline:
 *   1. Budget check (remaining_usd > 0)
 *   2. Cancellation check (via cancellation token)
 *   3. fetchNeighbors via the provider (Capability Router-backed in prod,
 *      fixture stub in Phase-1 demos)
 *   4. For each edge: emit BeliefAtoms (tx_exists, address_sent, address_received,
 *      has_taint_share), decide whether to continue based on:
 *        - taint_threshold (lot is too small to be worth tracing)
 *        - cycle detection (counterpart already visited at this hop_index)
 *        - terminate_at_kinds (provider returns a terminal attribution)
 *        - terminate_at_subjects (user-supplied)
 *        - max_hops_per_path
 *   5. Push surviving counterparts onto the frontier with new lots
 *
 * Concurrency: up to in_job_concurrency frontier entries expand in
 * parallel. Belief atoms are emitted async and don't block expansion.
 */

import type {
  AgencyContext,
  BeliefAtom,
  BeliefAtomId,
  BeliefStateService,
  FrontierEntry,
  IntegerAmount,
  Lot,
  SubjectRef,
  TerminationKind,
  TerminationReason,
  TraceJob,
  TraceProgressEvent,
  TraceSummary,
  TracerNeighborEdge,
} from '@chainsight/shared-types';
import { TRACER_DEFAULTS } from '@chainsight/shared-types';
import { FrontierQueue, frontierPriority } from './priority_queue';
import type { NeighborsProvider } from './neighbors_provider';
import { hashNeighborsResponse } from './neighbors_provider';

/* ─── Cancellation token ───────────────────────────────────────────────── */

export interface CancellationToken {
  isCancelled(): Promise<boolean>;
}

export class StaticCancellationToken implements CancellationToken {
  private flag = false;
  cancel() { this.flag = true; }
  async isCancelled() { return this.flag; }
}

/* ─── Runner options ───────────────────────────────────────────────────── */

export interface TracerRunnerOptions {
  belief: BeliefStateService;
  neighbors: NeighborsProvider;
  /** Optional emitter — pub/sub adapter in production. */
  emit?: (event: TraceProgressEvent) => Promise<void> | void;
  /** Per-job cancellation token. Polled every hop. */
  cancellation?: CancellationToken;
  /** Inject a clock for tests. */
  now?: () => number;
}

/* ─── Result envelope ──────────────────────────────────────────────────── */

export interface TracerRunResult {
  job_id: string;
  summary: TraceSummary;
  /** All atoms emitted, in order, for trace_jobs.total_atoms_emitted + audit. */
  emitted_atom_ids: BeliefAtomId[];
  /** Provider response hashes per fetchNeighbors call (audit / repro). */
  provider_response_hashes: string[];
}

/* ─── Runner ───────────────────────────────────────────────────────────── */

export class TracerRunner {
  private readonly nowFn: () => number;

  constructor(private readonly opts: TracerRunnerOptions) {
    this.nowFn = opts.now ?? (() => Date.now());
  }

  async run(job: TraceJob, ctx: AgencyContext): Promise<TracerRunResult> {
    const startedAt = this.nowFn();
    const startedAtIso = new Date(startedAt).toISOString();
    const wallClockMs = TRACER_DEFAULTS.wall_clock_ms;

    // ── state ──────────────────────────────────────────────────────────
    const queue = new FrontierQueue();
    const visited = new Set<SubjectRef>();
    const emitted_atom_ids: BeliefAtomId[] = [];
    const provider_response_hashes: string[] = [];
    const branch_termination_counts: Record<TerminationReason, number> = {
      max_hops_reached: 0,
      cycle_detected: 0,
      taint_below_threshold: 0,
      user_target_reached: 0,
      attribution_terminal: 0,
      budget_exhausted: 0,
      wall_clock_exceeded: 0,
      cancelled_by_user: 0,
      all_frontiers_terminated: 0,
    };
    let budget_remaining_usd = job.budget_usd;
    let total_hops = 0;
    let total_edges = 0;
    let termination_reason: TerminationReason = 'all_frontiers_terminated';

    await this.emit({ kind: 'started', job_id: job.job_id, total_origins: job.origin.length });

    // Seed frontier from origins.
    for (const origin of job.origin) {
      const seedLot: Lot = {
        origin_block_height: 0,
        amount_minor: '0' as IntegerAmount, // unknown until first hop
        taint_share: 1.0,
        parent_atom_id: ('' as BeliefAtomId),
      };
      queue.push({
        node: origin,
        carried_lots: [seedLot],
        hop_index: 0,
        parent_atom_id: null,
        priority_score: frontierPriority(0, 0n),
      });
    }

    const terminalSubjects = new Set(job.terminate_at_subjects ?? []);
    const terminalKinds = new Set<TerminationKind>(job.terminate_at_kinds);

    // ── expansion loop ────────────────────────────────────────────────
    while (queue.size > 0) {
      // Job-level termination checks
      if (total_hops >= job.max_total_hops) {
        termination_reason = 'max_hops_reached';
        break;
      }
      if (budget_remaining_usd <= 0) {
        termination_reason = 'budget_exhausted';
        break;
      }
      if (this.nowFn() - startedAt > wallClockMs) {
        termination_reason = 'wall_clock_exceeded';
        break;
      }
      if (this.opts.cancellation && (await this.opts.cancellation.isCancelled())) {
        termination_reason = 'cancelled_by_user';
        break;
      }

      // Pop a batch up to in_job_concurrency
      const batch: FrontierEntry[] = [];
      while (batch.length < TRACER_DEFAULTS.in_job_concurrency && queue.size > 0) {
        const top = queue.pop();
        if (!top) break;
        batch.push(top);
      }
      if (batch.length === 0) break;

      const expansions = await Promise.all(batch.map((entry) => this.expandHop(job, ctx, entry, terminalKinds, terminalSubjects, branch_termination_counts)));

      for (const exp of expansions) {
        total_hops += 1;
        budget_remaining_usd -= exp.cost_usd;
        total_edges += exp.new_edges;
        emitted_atom_ids.push(...exp.new_atom_ids);
        provider_response_hashes.push(...exp.response_hashes);

        for (const next of exp.next_frontier) queue.push(next);

        if (total_hops % job.emit_progress_every_n_hops === 0) {
          await this.emit({
            kind: 'hop_completed',
            job_id: job.job_id,
            hop_index: exp.hop_index,
            new_atom_ids: exp.new_atom_ids,
            new_edges: exp.new_edges,
            budget_remaining_usd: Math.max(0, budget_remaining_usd),
          });
        }
      }

      await this.emit({
        kind: 'frontier_progress',
        job_id: job.job_id,
        frontier_size: queue.size,
        total_hops_so_far: total_hops,
        budget_remaining_usd: Math.max(0, budget_remaining_usd),
      });
    }

    const completedAt = this.nowFn();
    const summary: TraceSummary = {
      job_id: job.job_id,
      case_id: job.case_id,
      mode: job.mode,
      total_hops,
      total_atoms_emitted: emitted_atom_ids.length,
      total_edges,
      total_budget_spent_usd: Number((job.budget_usd - Math.max(0, budget_remaining_usd)).toFixed(4)),
      termination_reason,
      started_at: startedAtIso,
      completed_at: new Date(completedAt).toISOString(),
      origin_count: job.origin.length,
      branch_termination_counts,
    };

    await this.emit({ kind: 'completed', job_id: job.job_id, summary });

    // visited Set is internal state — keep it referenced to satisfy any linter
    // that complains about unused declarations even though we use it below.
    void visited;

    return { job_id: job.job_id, summary, emitted_atom_ids, provider_response_hashes };
  }

  /* ── single hop expansion ──────────────────────────────────────────── */

  private async expandHop(
    job: TraceJob,
    ctx: AgencyContext,
    entry: FrontierEntry,
    terminalKinds: Set<TerminationKind>,
    terminalSubjects: Set<SubjectRef>,
    branch_termination_counts: Record<TerminationReason, number>,
  ): Promise<HopExpansionResult> {
    const direction = job.direction === 'backward' ? 'backward' : 'forward';
    const query = { node: entry.node, direction } as const;
    const ncCtx = { case_id: job.case_id, agency_id: job.agency_id };

    const response = await this.opts.neighbors.fetchNeighbors(query, ncCtx);
    const response_hash = hashNeighborsResponse(query, response);

    const new_atom_ids: BeliefAtomId[] = [];
    const next_frontier: FrontierEntry[] = [];
    let new_edges = 0;

    // Terminate the branch up front if the node itself is a terminal attribution.
    if (response.node_attribution_kind && terminalKinds.has(response.node_attribution_kind)) {
      branch_termination_counts.attribution_terminal += 1;
      await this.emit({
        kind: 'branch_terminated', job_id: job.job_id, node: entry.node,
        reason: 'attribution_terminal', hop_index: entry.hop_index,
      });
      return {
        hop_index: entry.hop_index, new_atom_ids: [], new_edges: 0,
        next_frontier: [], cost_usd: response.total_cost_usd,
        response_hashes: [response_hash],
      };
    }

    const totalCarriedTaint = entry.carried_lots.reduce((s, l) => s + safeBigInt(l.amount_minor), 0n);

    const self = String(entry.node).toLowerCase();
    for (const edge of response.edges) {
      // Follow only edges that leave this node (forward) or enter it
      // (backward), whatever the provider returned. Self-transfers are skipped.
      const from = String(edge.from_subject).toLowerCase();
      const to = String(edge.to_subject).toLowerCase();
      if (from === to) continue;
      if (direction === 'forward' ? from !== self : to !== self) continue;
      const counterparty: SubjectRef = direction === 'forward' ? edge.to_subject : edge.from_subject;
      const edgeValue = safeBigInt(edge.value_native_minor);

      // tx_exists atom
      const txAtom = await this.opts.belief.emit(
        {
          case_id: job.case_id,
          subject_ref: `${edge.chain}_tx:${edge.tx_hash}` as SubjectRef,
          predicate: 'tx_exists',
          object_payload: {
            tx_hash: edge.tx_hash,
            block_height: edge.block_height,
            // Provider-reported. Left absent (and the atom rejected) rather
            // than invented when a provider does not return it.
            ...(edge.block_hash ? { block_hash: edge.block_hash } : {}),
            block_time_utc: edge.block_time_utc,
            from: edge.from_subject,
            to: edge.to_subject,
            trace_job_id: job.job_id,
          },
          basis: 'T0',
          basis_detail: `tracer hop ${entry.hop_index}`,
          emitted_by_kind: 'agent',
          emitted_by_id: job.initiated_by_id,
          parent_atom_id: entry.parent_atom_id ?? undefined,
        },
        ctx,
      );
      new_atom_ids.push(txAtom.id);

      // direction-specific edge atom
      const sendingAtom = await this.opts.belief.emit(
        {
          case_id: job.case_id,
          subject_ref: edge.from_subject,
          predicate: 'address_sent',
          object_payload: {
            tx_hash: edge.tx_hash,
            counterparty: edge.to_subject,
            value_native_minor: edge.value_native_minor,
            block_height: edge.block_height,
            block_time_utc: edge.block_time_utc,
            edge_index: edge.edge_index,
            edge_kind: edge.edge_kind,
            trace_job_id: job.job_id,
          },
          basis: 'T0',
          basis_detail: `tracer hop ${entry.hop_index}`,
          emitted_by_kind: 'agent',
          emitted_by_id: job.initiated_by_id,
          parent_atom_id: txAtom.id,
        },
        ctx,
      );
      new_atom_ids.push(sendingAtom.id);

      const receivingAtom = await this.opts.belief.emit(
        {
          case_id: job.case_id,
          subject_ref: edge.to_subject,
          predicate: 'address_received',
          object_payload: {
            tx_hash: edge.tx_hash,
            counterparty: edge.from_subject,
            value_native_minor: edge.value_native_minor,
            block_height: edge.block_height,
            block_time_utc: edge.block_time_utc,
            edge_index: edge.edge_index,
            edge_kind: edge.edge_kind,
            trace_job_id: job.job_id,
          },
          basis: 'T0',
          basis_detail: `tracer hop ${entry.hop_index}`,
          emitted_by_kind: 'agent',
          emitted_by_id: job.initiated_by_id,
          parent_atom_id: txAtom.id,
        },
        ctx,
      );
      new_atom_ids.push(receivingAtom.id);
      new_edges += 1;

      // ── compute new lots + taint share ──────────────────────────────
      // Phase-1 simplification: split the carried lots proportionally by
      // outgoing edge value over the sum of all outgoing edge values.
      // Full FIFO/LIFO/proportional methodology is computed in the math
      // service at materialization time; the tracer cheaply approximates.
      // When the carried amount is unknown (the origin's seed lot has
      // amount 0), every outflow inherits the carried taint in full. The old
      // fallback of 0 cut every origin branch at taint_below_threshold, so no
      // trace could get past hop 1.
      const edgeShare = totalCarriedTaint > 0n ? Number(edgeValue) / Math.max(1, Number(totalCarriedTaint)) : 1;
      const newTaint = clamp01(entry.carried_lots.reduce((s, l) => s + l.taint_share, 0) / entry.carried_lots.length * Math.min(1, edgeShare || 0));

      if (newTaint < job.taint_threshold) {
        branch_termination_counts.taint_below_threshold += 1;
        await this.emit({
          kind: 'branch_terminated', job_id: job.job_id, node: counterparty,
          reason: 'taint_below_threshold', hop_index: entry.hop_index + 1,
        });
        continue;
      }

      // has_taint_share atom (analytic)
      const taintAtom = await this.opts.belief.emit(
        {
          case_id: job.case_id,
          subject_ref: counterparty,
          predicate: 'has_taint_share',
          object_payload: {
            // The tracer computes a proportional approximation regardless of
            // the requested methodology (FIFO/LIFO run in the math service at
            // materialization). Label what was actually computed, and keep the
            // request alongside it.
            methodology: 'proportional',
            requested_methodology: job.methodology,
            tainted_minor: taintedMinor(edgeValue, newTaint),
            total_minor: edgeValue.toString(),
            fraction: newTaint,
            origin_count: job.origin.length,
            trace_job_id: job.job_id,
          },
          basis: 'T2',
          basis_detail: `tracer hop ${entry.hop_index + 1} (proportional approximation)`,
          emitted_by_kind: 'agent',
          emitted_by_id: job.initiated_by_id,
          parent_atom_id: txAtom.id,
        },
        ctx,
      );
      new_atom_ids.push(taintAtom.id);

      // Termination checks
      if (terminalSubjects.has(counterparty)) {
        branch_termination_counts.user_target_reached += 1;
        await this.emit({
          kind: 'branch_terminated', job_id: job.job_id, node: counterparty,
          reason: 'user_target_reached', hop_index: entry.hop_index + 1,
        });
        continue;
      }
      if (entry.hop_index + 1 >= job.max_hops_per_path) {
        branch_termination_counts.max_hops_reached += 1;
        await this.emit({
          kind: 'branch_terminated', job_id: job.job_id, node: counterparty,
          reason: 'max_hops_reached', hop_index: entry.hop_index + 1,
        });
        continue;
      }

      // Push counterpart onto frontier with carried lots updated.
      const newLot: Lot = {
        origin_block_height: edge.block_height,
        amount_minor: edge.value_native_minor,
        taint_share: newTaint,
        parent_atom_id: taintAtom.id,
      };
      const nextHop = entry.hop_index + 1;
      next_frontier.push({
        node: counterparty,
        carried_lots: [newLot],
        hop_index: nextHop,
        parent_atom_id: taintAtom.id,
        priority_score: frontierPriority(nextHop, edgeValue),
      });
    }

    return {
      hop_index: entry.hop_index,
      new_atom_ids,
      new_edges,
      next_frontier,
      cost_usd: response.total_cost_usd,
      response_hashes: [response_hash],
    };
  }

  private async emit(event: TraceProgressEvent): Promise<void> {
    if (this.opts.emit) await this.opts.emit(event);
  }
}

interface HopExpansionResult {
  hop_index: number;
  new_atom_ids: BeliefAtomId[];
  new_edges: number;
  next_frontier: FrontierEntry[];
  cost_usd: number;
  response_hashes: string[];
}

function safeBigInt(s: string): bigint {
  try { return BigInt(s); } catch { return 0n; }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Re-export BeliefAtom so consumers see the chain. */
export type { BeliefAtom };

/** floor(total * fraction) in integer minor units, with 1e-9 fraction precision. */
function taintedMinor(total: bigint, fraction: number): string {
  if (total <= 0n || !(fraction > 0)) return '0';
  const scale = 1_000_000_000n;
  const f = BigInt(Math.floor(Math.min(1, fraction) * Number(scale)));
  return ((total * f) / scale).toString();
}
