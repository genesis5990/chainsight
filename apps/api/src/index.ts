/**
 * ChainSight API — Fastify server entry point.
 *
 * Phase 0 Week 1 skeleton. Health endpoint, basic case CRUD wiring point,
 * Supabase Auth integration via JWKS-generic plugin.
 *
 * See: /docs/chainsight_v1_0_backend_architecture.md §0.4 (auth) and §1 (services).
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import IORedis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import {
  Pathfinder,
  RedisPathResultCache,
  SupabaseGraphLoader,
} from '@chainsight/pathfinder';
import {
  SupabaseTraceJobStore,
  TracerService,
} from '@chainsight/tracer-agent';
import {
  Ed25519PackSigner,
  ReproPackService,
  SupabaseCaseSource,
  SupabasePackRepository,
  SupabaseStorageBackend,
} from '@chainsight/reproducibility';
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { caseRoutes } from './routes/cases.js';
import { pathfinderRoutes } from './routes/pathfinder.js';
import { tracerRoutes } from './routes/tracer.js';
import { eventsRoutes } from './routes/events.js';
import { reproPackRoutes } from './routes/repro_pack.js';
import { agencyRoutes } from './routes/agency.js';

const fastify = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
  trustProxy: true,
});

// Security and ergonomics
await fastify.register(helmet, { contentSecurityPolicy: false });
await fastify.register(cors, {
  origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
  credentials: true,
});
await fastify.register(sensible);
await fastify.register(rateLimit, {
  max: 1000,
  timeWindow: '1 minute',
});

// Auth (JWKS-generic; works for Supabase Auth in v1, Ory Kratos for On-Prem)
await fastify.register(authPlugin);

// Routes
await fastify.register(healthRoutes, { prefix: '/v1' });
await fastify.register(caseRoutes, { prefix: '/v1' });

// ─── Pathfinder ───────────────────────────────────────────────────────────────────────────────────────────────────────
const pfSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pfRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
const pfRedisSubscriber = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
await pfRedis.connect().catch((e) => fastify.log.warn({ e }, 'pathfinder redis L1 unavailable'));
await pfRedisSubscriber.connect().catch((e) => fastify.log.warn({ e }, 'pathfinder redis subscriber unavailable'));

const pathfinder = new Pathfinder({
  loader: new SupabaseGraphLoader(
    pfSupabase as unknown as ConstructorParameters<typeof SupabaseGraphLoader>[0],
  ),
  resultCache: new RedisPathResultCache(pfRedis),
  invalidatorSubscriber: pfRedisSubscriber,
  namespace: process.env.CHAINSIGHT_NAMESPACE ?? 'dev',
});

await fastify.register(pathfinderRoutes, { prefix: '/v1', pathfinder });

// ─── Tracer Agent ─────────────────────────────────────────────────────────────────────────────────────
const tracerStore = new SupabaseTraceJobStore(
  pfSupabase as unknown as ConstructorParameters<typeof SupabaseTraceJobStore>[0],
);
const tracerQueueRedis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const tracer = new TracerService({
  store: tracerStore,
  connection: tracerQueueRedis as unknown as ConstructorParameters<typeof TracerService>[0]['connection'],
});
await fastify.register(tracerRoutes, { prefix: '/v1', tracer });

// ─── SSE events bridge ────────────────────────────────────────────────────────────────────────
await fastify.register(eventsRoutes, {
  prefix: '/v1',
  redis_url: env.REDIS_URL,
  namespace: process.env.CHAINSIGHT_NAMESPACE ?? 'dev',
});

// ─── Reproducibility Pack ───────────────────────────────────────────────────────────────────────────────────
const packSigner = env.PACK_SIGNER_ID && env.PACK_SIGNER_PRIVATE_KEY_B64 && env.PACK_SIGNER_PUBLIC_KEY_B64
  ? new Ed25519PackSigner(env.PACK_SIGNER_ID, env.PACK_SIGNER_PRIVATE_KEY_B64, env.PACK_SIGNER_PUBLIC_KEY_B64)
  : null;
if (packSigner) {
  fastify.log.info({ signer_id: packSigner.signer_id }, 'pack signer configured (ed25519)');
} else {
  fastify.log.warn('PACK_SIGNER_* env vars unset — packs will be persisted unsigned');
}
const verifierKeys = packSigner
  ? { byId: { [packSigner.signer_id]: { algo: 'ed25519' as const, public_key_b64: packSigner.public_key_b64 } } }
  : null;

const reproService = new ReproPackService({
  source: new SupabaseCaseSource(
    pfSupabase as unknown as ConstructorParameters<typeof SupabaseCaseSource>[0],
  ),
  repo: new SupabasePackRepository(
    pfSupabase as unknown as ConstructorParameters<typeof SupabasePackRepository>[0],
  ),
  storage: new SupabaseStorageBackend(
    pfSupabase as unknown as ConstructorParameters<typeof SupabaseStorageBackend>[0],
  ),
  signer: packSigner,
  verifierKeys,
});
await fastify.register(reproPackRoutes, { prefix: '/v1', service: reproService });

// ─── SaaS Blind agency-admin ───────────────────────────────────────────────────────────────────
await fastify.register(agencyRoutes, { prefix: '/v1' });

// Boot
const port = env.PORT;
const host = '0.0.0.0';

try {
  await fastify.listen({ port, host });
  fastify.log.info(`ChainSight API listening on http://${host}:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
