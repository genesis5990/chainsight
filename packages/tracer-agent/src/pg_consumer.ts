/**
 * Postgres trace consumer (replaces the BullMQ trace:analyze / trace:cancel
 * workers).
 *
 * Each slot loops: claim the oldest queued job with
 * belief.claim_trace_job() (FOR UPDATE SKIP LOCKED, so several workers or
 * slots never take the same job), run it, record the outcome, repeat. When
 * the queue is empty a slot sleeps for pollMs. While a job runs, its
 * heartbeat is refreshed so a crashed worker's job is re-queued by the next
 * claim instead of sitting in 'running' forever.
 *
 * Cancellation needs no queue: the API sets status='cancelled' and the
 * runner checks it at every hop.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgencyContext,
  BeliefStateService,
  EventPublisher,
  TraceJob,
  TraceProgressEvent,
} from '@chainsight/shared-types';
import { TracerRunner, type CancellationToken, type TracerRunResult } from './runner';
import type { NeighborsProvider } from './neighbors_provider';
import type { TraceJobStore } from './job_store';

export interface PgTraceConsumerOptions {
  belief: BeliefStateService;
  neighbors: NeighborsProvider;
  store: TraceJobStore;
  /** Live progress events (CaseStream). */
  publisher: EventPublisher;
  namespace?: string;
  /** Jobs run in parallel by this process. Default 4. */
  concurrency?: number;
  /** Sleep between empty polls. Default 2000 ms. */
  pollMs?: number;
  /** Heartbeat interval while a job runs. Default 30 s (stale after 5 min). */
  heartbeatMs?: number;
  /** Stable id for this process. Default `worker-<uuid>`. */
  workerId?: string;
  log?: {
    info(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
}

export interface PgTraceConsumer {
  readonly workerId: string;
  /** Resolves once in-flight jobs finish; no new jobs are claimed. */
  close(): Promise<void>;
}

const consoleLog = {
  info: (obj: Record<string, unknown>, msg: string) => console.log(msg, obj),
  error: (obj: Record<string, unknown>, msg: string) => console.error(msg, obj),
};

/** Run one claimed job to completion and record the outcome. Never throws. */
export async function processTraceJob(
  data: TraceJob,
  opts: Pick<PgTraceConsumerOptions, 'belief' | 'neighbors' | 'store' | 'publisher' | 'namespace'>,
): Promise<TracerRunResult | null> {
  const namespace = opts.namespace ?? 'dev';
  const channel = `case:${data.case_id}:trace:${data.job_id}:${namespace}`;
  const emit = async (event: TraceProgressEvent) => {
    try {
      await opts.publisher.publish(channel, JSON.stringify(event));
    } catch (e) {
      console.warn('[tracer] progress publish failed', { channel, e });
    }
  };

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

  const runner = new TracerRunner({
    belief: opts.belief,
    neighbors: opts.neighbors,
    emit,
    cancellation,
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
    await opts.store.markFailed(data.job_id, message).catch(() => undefined);
    return null;
  }
}

export function startPgTraceConsumer(opts: PgTraceConsumerOptions): PgTraceConsumer {
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;
  const concurrency = opts.concurrency ?? 4;
  const pollMs = opts.pollMs ?? 2000;
  const heartbeatMs = opts.heartbeatMs ?? 30_000;
  const log = opts.log ?? consoleLog;
  const stop = new AbortController();

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stop.signal.aborted) return resolve();
      const t = setTimeout(resolve, ms);
      stop.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });

  async function slot(n: number): Promise<void> {
    while (!stop.signal.aborted) {
      let job: TraceJob | null = null;
      try {
        job = await opts.store.claim(workerId);
      } catch (e) {
        log.error({ slot: n, err: (e as Error).message }, 'trace claim failed');
        await sleep(pollMs);
        continue;
      }
      if (!job) {
        await sleep(pollMs);
        continue;
      }

      const claimed = job;
      log.info({ slot: n, job_id: claimed.job_id, case_id: claimed.case_id }, 'trace job claimed');
      const beat = setInterval(() => {
        opts.store
          .heartbeat(claimed.job_id, workerId)
          .catch((e) =>
            log.error(
              { job_id: claimed.job_id, err: (e as Error).message },
              'trace heartbeat failed',
            ),
          );
      }, heartbeatMs);
      beat.unref?.();
      try {
        const result = await processTraceJob(claimed, opts);
        if (result) {
          log.info(
            {
              job_id: claimed.job_id,
              hops: result.summary.total_hops,
              atoms: result.emitted_atom_ids.length,
              reason: result.summary.termination_reason,
            },
            'trace job completed',
          );
        } else {
          log.error({ job_id: claimed.job_id }, 'trace job failed');
        }
      } finally {
        clearInterval(beat);
      }
    }
  }

  const slots = Array.from({ length: concurrency }, (_, i) => slot(i));
  log.info(
    { worker_id: workerId, concurrency, poll_ms: pollMs },
    'postgres trace consumer started',
  );

  return {
    workerId,
    async close() {
      stop.abort();
      await Promise.allSettled(slots);
    },
  };
}
