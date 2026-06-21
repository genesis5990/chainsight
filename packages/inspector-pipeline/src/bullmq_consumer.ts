/**
 * BullMQ consumer wiring for the Inspector pipeline.
 *
 * The worker process imports `makeBullMQConsumer` to start handling
 * `inspector:analyze` jobs. Each job's progress events are published to
 * Redis pub/sub on `case:{case_id}:inspector:{tx_ref}:{namespace}` per
 * v1.1 §5.3 / §3.10.
 */

import type Redis from 'ioredis';
import { Worker, type ConnectionOptions } from 'bullmq';
import type {
  InspectorEvent,
  InspectorRunRequest,
  InspectorRunResult,
} from '@chainsight/shared-types';
import { InspectorRunner, type InspectorRunnerOptions } from './runner';
import type { InspectorRunPersister } from './run_persister';

export const INSPECTOR_QUEUE_NAME = 'inspector:analyze';

export interface BullMQConsumerOptions extends InspectorRunnerOptions {
  /** Same connection as the worker's other queues (Upstash). */
  connection: ConnectionOptions;
  /** Redis client for pub/sub publish — separate from the BullMQ connection. */
  publisher: Redis;
  /** Deployment namespace, e.g. 'dev'/'prod'. */
  namespace?: string;
  /** Max parallel inspector jobs on this machine. Spec §5.7 default = 4. */
  concurrency?: number;
  /** Optional persister — writes the completed run to belief.inspector_runs. */
  persister?: InspectorRunPersister;
}

export function makeBullMQConsumer(opts: BullMQConsumerOptions): Worker<InspectorRunRequest, InspectorRunResult> {
  const namespace = opts.namespace ?? 'dev';

  const worker = new Worker<InspectorRunRequest, InspectorRunResult>(
    INSPECTOR_QUEUE_NAME,
    async (job) => {
      const req = job.data;
      const channel = `case:${req.case_id}:inspector:${req.tx_ref}:${namespace}`;

      const emit = async (event: InspectorEvent) => {
        try {
          await opts.publisher.publish(channel, JSON.stringify(event));
        } catch (e) {
          // Best-effort — never abort the run on pub/sub failure.
           
          console.warn('[inspector] pubsub publish failed', { channel, e });
        }
      };

      const runner = new InspectorRunner({ ...opts, emit });
      try {
        const result = await runner.run(req);
        if (opts.persister) {
          try {
            await opts.persister.persist(result);
          } catch (e) {
             
            console.warn('[inspector] persister failed', { run_id: result.run_id, e });
          }
        }
        return result;
      } catch (err) {
        await emit({
          kind: 'run_failed',
          run_id: 'unknown',
          error: (err as Error).message,
        });
        throw err;
      }
    },
    {
      connection: opts.connection,
      concurrency: opts.concurrency ?? 4,
    },
  );

  return worker;
}
