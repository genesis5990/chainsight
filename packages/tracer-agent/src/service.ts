/**
 * TracerService — the public surface the API uses to enqueue jobs, cancel
 * them, and read status. Backed by BullMQ + TraceJobStore.
 */

import { Queue, type ConnectionOptions } from 'bullmq';
import type {
  AgencyContext,
  CaseId,
  TraceJob,
  TraceJobRequest,
  TraceJobStatus,
  TracerAgentService,
} from '@chainsight/shared-types';
import { TRACER_QUEUE_NAME, TRACER_CANCEL_QUEUE_NAME } from '@chainsight/shared-types';
import { traceIdempotencyKey, withTraceDefaults } from './idempotency';
import { buildTraceJob, deriveJobId, type TraceJobStore } from './job_store';

export interface TracerServiceOptions {
  store: TraceJobStore;
  connection: ConnectionOptions;
}

export class TracerService implements TracerAgentService {
  private readonly analyzeQueue: Queue<TraceJob>;
  private readonly cancelQueue: Queue<{ job_id: string }>;

  constructor(private readonly opts: TracerServiceOptions) {
    this.analyzeQueue = new Queue<TraceJob>(TRACER_QUEUE_NAME, { connection: opts.connection });
    this.cancelQueue = new Queue<{ job_id: string }>(TRACER_CANCEL_QUEUE_NAME, { connection: opts.connection });
  }

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
    });

    if (insert.deduplicated) {
      return { job_id: insert.job_id, idempotency_key, deduplicated: true };
    }

    const traceJob: TraceJob = buildTraceJob({
      job_id: insert.job_id,
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

    await this.analyzeQueue.add('trace', traceJob, {
      jobId: insert.job_id,
      removeOnComplete: { age: 24 * 60 * 60, count: 100 },
      removeOnFail: { age: 24 * 60 * 60 },
    });

    return { job_id: insert.job_id, idempotency_key, deduplicated: false };
  }

  async cancel(job_id: string, _ctx: AgencyContext): Promise<void> {
    await this.cancelQueue.add('cancel', { job_id }, { jobId: `cancel:${job_id}` });
  }

  async status(job_id: string, _ctx: AgencyContext): Promise<TraceJobStatus | null> {
    return this.opts.store.byId(job_id);
  }

  async listForCase(case_id: CaseId, _ctx: AgencyContext): Promise<TraceJobStatus[]> {
    return this.opts.store.listForCase(case_id);
  }

  async close(): Promise<void> {
    await Promise.allSettled([this.analyzeQueue.close(), this.cancelQueue.close()]);
  }
}
