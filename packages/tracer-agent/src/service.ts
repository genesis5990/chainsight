/**
 * TracerService: the API's surface for starting, cancelling and reading
 * trace jobs. Backed by Postgres only: belief.trace_jobs is both the job
 * record and the queue (see migration 0014). No Redis.
 */

import type {
  AgencyContext,
  CaseId,
  TraceJob,
  TraceJobRequest,
  TraceJobStatus,
  TracerAgentService,
} from '@chainsight/shared-types';
import { traceIdempotencyKey, withTraceDefaults } from './idempotency';
import { buildTraceJob, deriveJobId, type TraceJobStore } from './job_store';

export interface TracerServiceOptions {
  store: TraceJobStore;
}

export class TracerService implements TracerAgentService {
  constructor(private readonly opts: TracerServiceOptions) {}

  async start(req: TraceJobRequest, ctx: AgencyContext): Promise<{ job_id: string; idempotency_key: string; deduplicated: boolean }> {
    const resolved = withTraceDefaults(req);
    const idempotency_key = traceIdempotencyKey({
      case_id: resolved.case_id,
      origin: resolved.origin,
      mode: resolved.mode,
      methodology: resolved.methodology,
      direction: resolved.direction,
      max_hops_per_path: resolved.max_hops_per_path,
      max_total_hops: resolved.max_total_hops,
      branching_cap: resolved.branching_cap,
      budget_usd: resolved.budget_usd,
    });
    const job_id = deriveJobId(idempotency_key);

    const traceJob: TraceJob = buildTraceJob({
      job_id,
      case_id: resolved.case_id,
      initiated_by_id: ctx.user_id,
      agency_id: ctx.agency_id,
      idempotency_key,
      mode: resolved.mode,
      origin: resolved.origin as string[],
      direction: resolved.direction,
      max_hops_per_path: resolved.max_hops_per_path,
      max_total_hops: resolved.max_total_hops,
      branching_cap: resolved.branching_cap,
      budget_usd: resolved.budget_usd,
      methodology: resolved.methodology,
      taint_threshold: resolved.taint_threshold,
      terminate_at_kinds: resolved.terminate_at_kinds,
      terminate_at_subjects: resolved.terminate_at_subjects,
      emit_progress_every_n_hops: resolved.emit_progress_every_n_hops,
    });

    const insert = await this.opts.store.insertQueued({
      job_id,
      case_id: resolved.case_id,
      initiated_by_id: ctx.user_id,
      mode: resolved.mode,
      origin: resolved.origin as string[],
      direction: resolved.direction,
      methodology: resolved.methodology,
      params: {
        max_hops_per_path: resolved.max_hops_per_path,
        max_total_hops: resolved.max_total_hops,
        branching_cap: resolved.branching_cap,
        budget_usd: resolved.budget_usd,
        taint_threshold: resolved.taint_threshold,
        terminate_at_kinds: resolved.terminate_at_kinds,
        terminate_at_subjects: resolved.terminate_at_subjects ?? [],
        emit_progress_every_n_hops: resolved.emit_progress_every_n_hops,
      },
      idempotency_key,
      job_payload: traceJob,
    });

    if (!insert.deduplicated) {
      return { job_id: insert.job_id, idempotency_key, deduplicated: false };
    }

    // Same settings as an earlier job. If that job failed or was cancelled,
    // run it again instead of handing back the dead job.
    const requeued = await this.opts.store.requeue(insert.job_id, { ...traceJob, job_id: insert.job_id });
    return { job_id: insert.job_id, idempotency_key, deduplicated: !requeued };
  }

  async cancel(job_id: string, _ctx: AgencyContext): Promise<void> {
    // The runner checks the row's status at every hop and stops cleanly.
    await this.opts.store.markCancelled(job_id);
  }

  async status(job_id: string, _ctx: AgencyContext): Promise<TraceJobStatus | null> {
    return this.opts.store.byId(job_id);
  }

  async listForCase(case_id: CaseId, _ctx: AgencyContext): Promise<TraceJobStatus[]> {
    return this.opts.store.listForCase(case_id);
  }

  async close(): Promise<void> {
    // Nothing to close: no queue connections.
  }
}
