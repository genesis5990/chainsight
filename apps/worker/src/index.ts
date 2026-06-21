/**
 * ChainSight worker — BullMQ-based job processor.
 *
 * Phase 0 Week 1: empty skeleton with a hello-world job for end-to-end smoke testing.
 * Phase 0 Week 3+: Tracer Agent jobs, document extraction, wallet analysis kickoff.
 */
import { Worker, Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import {
  BeliefPubSub,
  RedisL2Cache,
  SupabaseBeliefStateService,
} from '@chainsight/belief-state';
import { MathClient } from '@chainsight/math-client';
import {
  FixtureChainProvider,
  RouterChainProvider,
  RouterLlmClient,
  StubLlmClient,
  SupabaseInspectorRunLookup,
  SupabaseInspectorRunPersister,
  makeBullMQConsumer as makeInspectorConsumer,
  INSPECTOR_QUEUE_NAME,
} from '@chainsight/inspector-pipeline';
import {
  AnthropicConnector,
  CapabilityRouter,
  EnvCredentialStore,
  EtherscanConnector,
  OpenSanctionsConnector,
  RedisL1Cache,
  SupabaseInstallRegistry,
  SupabaseL2Cache,
  SupabaseResolutionAudit,
} from '@chainsight/capability-router';
import type { AgencyContext } from '@chainsight/shared-types';

const log = pino({ name: 'chainsight-worker', level: process.env.LOG_LEVEL ?? 'info' });
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// BullMQ accepts an IORedis instance as `connection`, but its type expects
// a ConnectionOptions union. Casting via unknown is the documented pattern.
const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;

const HELLO_QUEUE = 'hello-world';

// Outbound producer (other apps can import this pattern)
export const helloQueue = new Queue(HELLO_QUEUE, { connection });

// Inbound consumer
const worker = new Worker(
  HELLO_QUEUE,
  async (job) => {
    log.info({ id: job.id, name: job.name, data: job.data }, 'processing job');
    return { processedAt: new Date().toISOString() };
  },
  { connection },
);

worker.on('completed', (job, result) => {
  log.info({ id: job.id, result }, 'job completed');
});

worker.on('failed', (job, err) => {
  log.error({ id: job?.id, err }, 'job failed');
});

// ─── Inspector pipeline consumer (gated on full env presence) ──────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MATH_URL = process.env.MATH_URL ?? 'https://chainsight-math-dev.fly.dev';
const NAMESPACE = process.env.CHAINSIGHT_NAMESPACE ?? 'dev';

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pubsubConn = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const l2 = new RedisL2Cache({ redis: pubsubConn, namespace: NAMESPACE });
  const pubsub = new BeliefPubSub({ publisher: pubsubConn, namespace: NAMESPACE });
  const math = new MathClient({ baseUrl: MATH_URL });
  const belief = new SupabaseBeliefStateService({
    serviceClient: supabase,
    l2Cache: l2,
    pubsub,
    mathClient: math,
  });

  // ── Capability Router wiring ─────────────────────────────────────────
  // Connectors are stateless; Router resolves install + credential per call.
  const router = new CapabilityRouter({
    connectors: [
      new EtherscanConnector(),
      new OpenSanctionsConnector(),
      new AnthropicConnector(),
    ],
    installs: new SupabaseInstallRegistry(
      supabase as unknown as ConstructorParameters<typeof SupabaseInstallRegistry>[0],
    ),
    credentials: new EnvCredentialStore(),
    caches: {
      l1: new RedisL1Cache(pubsubConn),
      l2: new SupabaseL2Cache(
        supabase as unknown as ConstructorParameters<typeof SupabaseL2Cache>[0],
      ),
    },
    redis: pubsubConn,
    audit: new SupabaseResolutionAudit(
      supabase as unknown as ConstructorParameters<typeof SupabaseResolutionAudit>[0],
    ),
  });

  // Worker-level AgencyContext used by router-backed providers. Real per-job
  // context comes from the inspector request; this is the boot-time identity.
  const workerCtx: AgencyContext = {
    user_id: process.env.WORKER_USER_ID ?? '00000000-0000-0000-0000-000000000000',
    agency_id: process.env.WORKER_AGENCY_ID ?? '*',
    active_case_id: null,
    roles: ['investigator'],
    supervisory_scope_id: null,
    available_capabilities: ['get_tx_by_hash', 'get_address_attribution', 'llm_narrative'],
  };

  // supabase-js client exposes the schema().from().insert() shape the
  // persister depends on; cast for the structural interface check.
  const persister = new SupabaseInspectorRunPersister(
    supabase as unknown as ConstructorParameters<typeof SupabaseInspectorRunPersister>[0],
  );
  const lookup = new SupabaseInspectorRunLookup(
    supabase as unknown as ConstructorParameters<typeof SupabaseInspectorRunLookup>[0],
  );

  const inspectorWorker = makeInspectorConsumer({
    belief,
    math,
    // RouterChainProvider falls back to FixtureChainProvider for the seeded
    // Op Lemon + USDT test fixtures, so demos still work without an Etherscan key.
    chain: new RouterChainProvider({
      router,
      ctx: workerCtx,
      fallback: new FixtureChainProvider(),
    }),
    // RouterLlmClient falls back to StubLlmClient when no Anthropic install
    // is configured for the agency — keeps the pipeline explainable end-to-end.
    llm: new RouterLlmClient({
      router,
      ctx: workerCtx,
      fallback: new StubLlmClient(),
    }),
    connection,
    publisher: pubsubConn,
    namespace: NAMESPACE,
    persister,
    lookup,
  });
  inspectorWorker.on('completed', (job, result) => {
    log.info({ id: job.id, run_id: result.run_id, emitted: result.emitted_atom_ids.length }, 'inspector job completed');
  });
  inspectorWorker.on('failed', (job, err) => {
    log.error({ id: job?.id, err }, 'inspector job failed');
  });
  log.info({ queue: INSPECTOR_QUEUE_NAME }, 'inspector pipeline consumer started');
} else {
  log.warn('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — inspector pipeline disabled');
}

// Eagerly verify the broker is reachable so a misconfigured REDIS_URL
// fails fast at boot instead of on the first job enqueue.
(async () => {
  try {
    const pingClient = new IORedis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
    });
    await pingClient.connect();
    const pong = await pingClient.ping();
    const host = (() => {
      try { return new URL(REDIS_URL).host; } catch { return 'unknown'; }
    })();
    log.info({ host, pong }, 'redis broker reachable');
    await pingClient.quit();
  } catch (err) {
    log.error({ err }, 'redis broker unreachable — worker will not process jobs');
  }
})();

log.info('ChainSight worker started');
