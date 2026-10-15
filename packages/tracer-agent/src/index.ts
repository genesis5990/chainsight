/**
 * @chainsight/tracer-agent v0.1.0 (Phase-1 Week-6 implementation of v1.1 §7).
 *
 * Autonomous and human-guided multi-hop tracing. Runs inside the worker;
 * the API enqueues jobs via TracerService.
 */

export { TracerRunner, StaticCancellationToken } from './runner';
export type { CancellationToken, TracerRunnerOptions, TracerRunResult } from './runner';

export { FrontierQueue, frontierPriority } from './priority_queue';

export {
  CachedNeighborsProvider,
  StubNeighborsProvider,
  hashNeighborsResponse,
  mkEdge,
  type NeighborsCtx,
  type NeighborsProvider,
  type NeighborsQuery,
  type StubNeighborsFixture,
} from './neighbors_provider';

export {
  RouterNeighborsProvider,
  type RouterNeighborsProviderOptions,
  type RouterLike,
} from './router_neighbors_provider';

export { traceIdempotencyKey, withTraceDefaults } from './idempotency';

export {
  SupabaseTraceJobStore,
  buildTraceJob,
  deriveJobId,
  type SupabaseTraceJobClient,
  type TraceJobCompletion,
  type TraceJobInsertInput,
  type TraceJobInsertResult,
  type TraceJobStore,
} from './job_store';

export {
  startPgTraceConsumer,
  processTraceJob,
  type PgTraceConsumer,
  type PgTraceConsumerOptions,
} from './pg_consumer';

export { TracerService, type TracerServiceOptions } from './service';
