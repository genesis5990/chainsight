/**
 * BullMQ consumers for trace:analyze and trace:cancel (v1.1 §7.9).
 *
 * The worker process imports `makeTraceConsumers` to start handling jobs.
 * Each `trace:analyze` job runs the TracerRunner; each `trace:cancel` job
 * sets the cancelled flag on the trace_jobs row so the running worker
 * terminates gracefully at the next hop boundary.
 */

import type Redis from 'ioredis';
import { Worker, type ConnectionOptions } from 'bullmq';
import type {
  AgencyContext,
  BeliefStateService,
  TraceJob,
  TraceProgressEvent,
} from '@chainsight/shared-types';
import { TRACER_QUEUE_NAME, TRACER_CANCEL_QUEUE_NAME } from '@chainsight/shared-types';
import { TracerRunner, type CancellationToken, type TracerRunResult } from './runner';
import type { NeighborsProvider } from './neighbors_provider';
import type { TraceJobStore } from './job_store';

export interface TraceConsumerOptions {
  belief: BeliefStateService;
  neighbors: NeighborsProvider;
  store: TraceJobStore;
  connection: ConnectionOptions;
  publisher: Redis;
  namespace?: string;
  concurrency?: number;
}

export interface TraceConsumers {
  trace: Worker<TraceJob, TracerRunResult>;
  cancel: Worker<{ job_id: string }, { cancelled: boolean }>;
  close: () => Promise<void>;
}

export function makeTraceConsumers(opts: TraceConsumerOptions): TraceConsumers {
  const namespace = opts.namespace ?? 'dev';

  /* ─── analyze worker ────────────────────────────────────────────────── */
  const trace = new Worker<TraceJob, TracerRunResult>(
    TRACER_QUEUE_NAME,
    async (job) => {
      const data = job.data;
      const channel = `case:${data.case_id}:trace:${data.job_id}:${namespace}`;

      const emit = async (event: TraceProgressEvent) => {
        try { await opts.publisher.publish(channel, JSON.stringify(event)); }
        catch (e) {  
           
          console.warn('[tracer] pubsub publish failed', { channel, e });
        }
      };

      // Cancellation token reads the store flag every hop.
      const cancellation: CancellationToken = {
        isCancelled: () => opts.store.isCancelled(data.job_id),
      };

      const ctx: AgencyContext = {
        user_id: data.initiated_by_id,
        agency_id: data.agency_id,
        active_case_id: data.case_id,
        roles: ['investigator'],
        supervisory_scope_id: null,
        available_capabilities: ['get_tx_by_hash', 'get_address_attribution'],
      };

      await opts.store.markRunning(data.job_id);

      const runner = new TracerRunner({
        belief: opts.belief,
        neighbors: opts.neighbors,
        emit, cancellation,
      });

      try {
        const result = await runner.run(data, ctx);
        if (result.summary.termination_reason === 'cancelled_by_user') {
          await opts.store.markCancelled(data.job_id);
        } else {
          await opts.store.markCompleted(data.job_id, {
            total_hops: result.summary.total_hops,
            total_atoms_emitted: result.summary.total_atoms_emitted,
            total_budget_spent_usd: result.summary.total_budget_spent_usd,
            provider_response_hashes: result.provider_response_hashes,
            termination_reason: result.summary.termination_reason,
            completed_at: result.summary.completed_at,
          });
        }
        return result;
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        await emit({ kind: 'failed', job_id: data.job_id, error: message });
        await opts.store.markFailed(data.job_id, message);
        throw err;
      }
    },
    { connection: opts.connection, concurrency: opts.concurrency ?? 4 },
  );

  /* ─── cancel worker ─────────────────────────────────────────────────── */
  const cancel = new Worker<{ job_id: string }, { cancelled: boolean }>(
    TRACER_CANCEL_QUEUE_NAME,
    async (job) => {
      await opts.store.markCancelled(job.data.job_id);
      return { cancelled: true };
    },
    { connection: opts.connection, concurrency: 4 },
  );

  const close = async () => {
    await Promise.allSettled([trace.close(), cancel.close()]);
  };

  return { trace, cancel, close };
}
