/**
 * ChainSight worker: trace jobs and graph materialization.
 *
 * Postgres only. Trace jobs are claimed from belief.trace_jobs (migration
 * 0014), live events go to belief.case_stream, and caches are in-process
 * (MemoryKv). There is no Redis dependency.
 */
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import { BeliefPubSub, RedisL2Cache, SupabaseBeliefStateService } from '@chainsight/belief-state';
import { MathClient } from '@chainsight/math-client';
import {
  AnthropicConnector,
  CapabilityRouter,
  EnvCredentialStore,
  VaultCredentialStore,
  FallbackCredentialStore,
  envelopeCipherFromEnv,
  BlockchairConnector,
  EtherscanConnector,
  OpenSanctionsConnector,
  RedisL1Cache,
  SupabaseInstallRegistry,
  SupabaseL2Cache,
  SupabaseResolutionAudit,
} from '@chainsight/capability-router';
import { CaseStream, MemoryKv, type AgencyContext } from '@chainsight/shared-types';
import {
  GraphMaterializer,
  SupabaseAtomFeed,
  SupabaseMaterializerSink,
} from '@chainsight/pathfinder';
import {
  StubNeighborsProvider,
  CachedNeighborsProvider,
  RouterNeighborsProvider,
  type NeighborsCtx,
  SupabaseTraceJobStore,
  startPgTraceConsumer,
} from '@chainsight/tracer-agent';

const log = pino({ name: 'chainsight-worker', level: process.env.LOG_LEVEL ?? 'info' });

// ─── Wiring (requires Supabase service credentials) ─────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MATH_URL = process.env.MATH_URL ?? 'https://chainsight-math-dev.fly.dev';
const NAMESPACE = process.env.CHAINSIGHT_NAMESPACE ?? 'dev';

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // In-process cache (replaces Redis) and Postgres event stream (replaces pub/sub).
  const kv = new MemoryKv();
  const caseStream = new CaseStream(
    supabase as unknown as ConstructorParameters<typeof CaseStream>[0],
    { warn: (msg, ctx) => log.warn(ctx ?? {}, msg) },
  );
  const l2 = new RedisL2Cache({ redis: kv, namespace: NAMESPACE });
  const pubsub = new BeliefPubSub({ stream: caseStream });
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
      new BlockchairConnector(),
      new OpenSanctionsConnector(),
      new AnthropicConnector(),
    ],
    installs: new SupabaseInstallRegistry(
      supabase as unknown as ConstructorParameters<typeof SupabaseInstallRegistry>[0],
    ),
    // Phase-2 SaaS Blind: try Vault (encrypted agency_credentials), fall
    // back to env (legacy installs configured with literal env-var refs).
    credentials: new FallbackCredentialStore([
      new VaultCredentialStore(
        supabase as unknown as ConstructorParameters<typeof VaultCredentialStore>[0],
        envelopeCipherFromEnv(process.env, {
          onInvalid: 'fallback',
          log: (msg, ctx) =>
            log.error(ctx, 'envelope cipher init: ' + msg + ' — falling back to PassThrough'),
        }),
      ),
      new EnvCredentialStore(),
    ]),
    caches: {
      l1: new RedisL1Cache(kv),
      l2: new SupabaseL2Cache(
        supabase as unknown as ConstructorParameters<typeof SupabaseL2Cache>[0],
      ),
    },
    redis: kv,
    audit: new SupabaseResolutionAudit(
      supabase as unknown as ConstructorParameters<typeof SupabaseResolutionAudit>[0],
    ),
  });

  // Boot-time identity for router-backed providers. Per-job agency comes
  // from the trace job itself.
  const workerCtx: AgencyContext = {
    user_id: process.env.WORKER_USER_ID ?? '00000000-0000-0000-0000-000000000000',
    agency_id: '',
    active_case_id: null,
    roles: ['investigator'],
    supervisory_scope_id: null,
    available_capabilities: ['get_tx_by_hash', 'get_address_attribution', 'llm_narrative'],
  };

  // The inspector pipeline has no producer yet (no API route enqueues
  // inspector jobs), so no consumer runs. Add a Postgres-claimed consumer
  // alongside the tracer one when an inspector route exists.

  // ── Graph materializer (v1.1 §6.3) ────────────────────────────────────────────
  const materializer = new GraphMaterializer({
    feed: new SupabaseAtomFeed(
      supabase as unknown as ConstructorParameters<typeof SupabaseAtomFeed>[0],
      { onError: (m) => log.error({ component: 'atom-feed' }, m) },
    ),
    sink: new SupabaseMaterializerSink(
      supabase as unknown as ConstructorParameters<typeof SupabaseMaterializerSink>[0],
    ),
    publisher: caseStream,
    namespace: NAMESPACE,
  });
  materializer.start();
  log.info('graph materializer started');

  // ── Tracer Agent (v1.1 §7) ────────────────────────────────────────────────────────────
  // Phase-2: Router-backed neighbors with a deterministic stub fallback for
  // dev / no-key environments. The router internally resolves the agency's
  // 'get_address_neighbors' install (Etherscan default) → credential →
  // cache → provider. If no install is configured, the resolve() call throws
  // and FallbackNeighborsProvider yields to the seeded stub fixtures so
  // demos keep working. CachedNeighborsProvider wraps both so Redis caches
  // by canonical key on top of the router's own cache layers.
  const stubNeighbors = new StubNeighborsProvider();
  const routerNeighbors = new RouterNeighborsProvider({
    router,
    contextFor: (nctx: NeighborsCtx): AgencyContext => ({
      user_id: workerCtx.user_id,
      // Every trace job carries its agency. Never fall back to "all agencies".
      agency_id: nctx.agency_id,
      active_case_id: nctx.case_id as AgencyContext['active_case_id'],
      roles: workerCtx.roles,
      supervisory_scope_id: workerCtx.supervisory_scope_id,
      available_capabilities: workerCtx.available_capabilities,
    }),
    log: { error: (obj, msg) => log.error(obj, msg) },
  });
  // Stub fixtures are demo data. They must never be mixed into a real
  // agency's trace: an empty or failed provider lookup has to stay empty, or
  // fabricated edges end up in the evidence graph. Only enable the fallback
  // explicitly (TRACER_STUB_FALLBACK=true) for local demos with no keys.
  const stubFallback = process.env.TRACER_STUB_FALLBACK === 'true';
  if (stubFallback) {
    log.warn(
      'TRACER_STUB_FALLBACK=true: empty provider results will be replaced with DEMO fixture data',
    );
  }
  const fallbackNeighbors = {
    async fetchNeighbors(
      query: Parameters<typeof routerNeighbors.fetchNeighbors>[0],
      ctx: NeighborsCtx,
    ) {
      const r = await routerNeighbors.fetchNeighbors(query, ctx);
      if (r.edges.length > 0 || !stubFallback) return r;
      return stubNeighbors.fetchNeighbors(query, ctx);
    },
  };
  const tracerNeighbors = new CachedNeighborsProvider(fallbackNeighbors, kv);
  const traceJobStore = new SupabaseTraceJobStore(
    supabase as unknown as ConstructorParameters<typeof SupabaseTraceJobStore>[0],
  );
  const traceConsumer = startPgTraceConsumer({
    belief,
    neighbors: tracerNeighbors,
    store: traceJobStore,
    publisher: caseStream,
    namespace: NAMESPACE,
    concurrency: Number(process.env.TRACE_CONCURRENCY ?? 4),
    pollMs: Number(process.env.TRACE_POLL_MS ?? 2000),
    log: { info: (o, m) => log.info(o, m), error: (o, m) => log.error(o, m) },
  });

  // Prune live-event rows older than 24h (durable history is belief.events).
  const prune = setInterval(
    () => {
      caseStream.prune('24 hours').then(
        (n) => n > 0 && log.info({ rows: n }, 'case_stream pruned'),
        (err) => log.error({ err: (err as Error).message }, 'case_stream prune failed'),
      );
    },
    60 * 60 * 1000,
  );
  prune.unref();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down: finishing in-flight trace jobs');
    clearInterval(prune);
    await traceConsumer.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // ── Envelope cipher boot probe ─────────────────────────────────────────────────────
  // Record envelope cipher status in belief.envelope_health_probe so ops can
  // verify api + worker share the same CHAINSIGHT_MASTER_KEY (key_fp match).
  (async () => {
    try {
      const { createHash } = await import('node:crypto');
      const { envelopeCipherFromEnv } = await import('@chainsight/capability-router');
      const cipher = envelopeCipherFromEnv(process.env, {
        onInvalid: 'fallback',
        log: (msg, ctx) => log.error(ctx, 'envelope cipher probe: ' + msg),
      });
      const probe = 'CHAINSIGHT_PROBE_V1';
      const wrapped = cipher.wrap(probe);
      const roundtrip_ok = cipher.unwrap(wrapped) === probe;
      const keyMaterial = process.env.CHAINSIGHT_MASTER_KEY ?? '';
      const key_fp = keyMaterial
        ? createHash('sha256')
            .update('chainsight-fp-v1:' + keyMaterial)
            .digest('hex')
            .slice(0, 16)
        : null;
      log.info({ active: cipher.active, key_fp, roundtrip_ok }, 'envelope cipher status');
      await supabase.schema('belief').from('envelope_health_probe').upsert(
        {
          service: 'chainsight-worker',
          active: cipher.active,
          key_fp,
          roundtrip_ok,
          recorded_at: new Date().toISOString(),
        },
        { onConflict: 'service' },
      );
    } catch (err) {
      log.error({ err }, 'envelope health probe write failed');
    }
  })();
} else {
  log.warn(
    'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing: tracer consumer and materializer disabled',
  );
}
