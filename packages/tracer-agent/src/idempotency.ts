/**
 * Trace job idempotency key (v1.1 §7.10).
 *
 *   key = BLAKE3(case_id || origin || mode || methodology || max_hops || budget)
 *
 * Re-issuing the same trace within 24h returns the existing job. Stored on
 * belief.trace_jobs with UNIQUE (case_id, idempotency_key).
 */

import { blake3 } from '@noble/hashes/blake3';
import type { SubjectRef, TraceJobRequest } from '@chainsight/shared-types';

export function traceIdempotencyKey(input: {
  case_id: string;
  origin: SubjectRef[];
  mode: string;
  methodology: string;
  direction: string;
  max_hops_per_path: number;
  max_total_hops: number;
  branching_cap: number;
  budget_usd: number;
}): string {
  const canonical = [
    input.case_id,
    input.origin.slice().sort().join(','),
    input.mode,
    input.methodology,
    input.direction,
    input.max_hops_per_path,
    input.max_total_hops,
    input.branching_cap,
    input.budget_usd,
  ].join('|');
  return Buffer.from(blake3(new TextEncoder().encode(canonical))).toString('hex');
}

/** Apply Phase-1 defaults to a partial request before hashing. */
export function withTraceDefaults(req: TraceJobRequest): Required<Omit<TraceJobRequest, 'terminate_at_subjects'>> & { terminate_at_subjects?: SubjectRef[] } {
  return {
    case_id: req.case_id,
    mode: req.mode,
    origin: req.origin,
    direction: req.direction ?? 'forward',
    max_hops_per_path: req.max_hops_per_path ?? 12,
    max_total_hops: req.max_total_hops ?? 200,
    branching_cap: req.branching_cap ?? 30,
    budget_usd: req.budget_usd ?? 5,
    methodology: req.methodology ?? 'fifo',
    taint_threshold: req.taint_threshold ?? 0.01,
    terminate_at_kinds: req.terminate_at_kinds ?? ['exchange', 'fiat_offramp', 'coinbase'],
    terminate_at_subjects: req.terminate_at_subjects,
    emit_progress_every_n_hops: req.emit_progress_every_n_hops ?? 1,
  };
}
