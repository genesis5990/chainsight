/**
 * ChainSight API — Fastify server entry point.
 *
 * Phase 0 Week 1 skeleton. Health endpoint, basic case CRUD wiring point,
 * Supabase Auth integration via JWKS-generic plugin.
 *
 * See: /docs/chainsight_v1_0_backend_architecture.md §0.4 (auth) and §1 (services).
 */

import { ZodError } from 'zod';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import { createClient } from '@supabase/supabase-js';
import { MemoryPathResultCache, Pathfinder, SupabaseGraphLoader } from '@chainsight/pathfinder';
import { CaseStream } from '@chainsight/shared-types';
import { SupabaseTraceJobStore, TracerService } from '@chainsight/tracer-agent';
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
    // The SSE route takes the JWT as ?access_token= (EventSource cannot send
    // headers). Never write it to logs.
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url.replace(/([?&]access_token=)[^&]*/g, '$1[redacted]'),
          host: req.host,
          remoteAddress: req.ip,
        };
      },
    },
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

// Validation errors are client errors. Zod's .parse() throws, and without
// this handler Fastify reported every bad request body as a 500.
fastify.setErrorHandler((err, request, reply) => {
  if (err instanceof ZodError) {
    const message = err.issues
      .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      .join('; ');
    return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  if (status >= 500) request.log.error({ err }, 'unhandled error');
  return reply.send(err);
});
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
// Live events (replaces Redis pub/sub): the worker writes to
// belief.case_stream; SSE clients and the pathfinder's cache invalidator read it.
const caseStream = new CaseStream(
  pfSupabase as unknown as ConstructorParameters<typeof CaseStream>[0],
  { warn: (msg, ctx) => fastify.log.warn(ctx ?? {}, msg) },
);

const pathfinder = new Pathfinder({
  loader: new SupabaseGraphLoader(
    pfSupabase as unknown as ConstructorParameters<typeof SupabaseGraphLoader>[0],
  ),
  resultCache: new MemoryPathResultCache(),
  graphUpdates: caseStream,
  namespace: process.env.CHAINSIGHT_NAMESPACE ?? 'dev',
});

await fastify.register(pathfinderRoutes, { prefix: '/v1', pathfinder });

// ─── Tracer Agent ─────────────────────────────────────────────────────────────────────────────────────
const tracerStore = new SupabaseTraceJobStore(
  pfSupabase as unknown as ConstructorParameters<typeof SupabaseTraceJobStore>[0],
);
const tracer = new TracerService({ store: tracerStore });
await fastify.register(tracerRoutes, { prefix: '/v1', tracer });

// ─── SSE events bridge ────────────────────────────────────────────────────────────────────────
await fastify.register(eventsRoutes, { prefix: '/v1', stream: caseStream });

// ─── Reproducibility Pack ───────────────────────────────────────────────────────────────────────────────────
const packSigner =
  env.PACK_SIGNER_ID && env.PACK_SIGNER_PRIVATE_KEY_B64 && env.PACK_SIGNER_PUBLIC_KEY_B64
    ? new Ed25519PackSigner(
        env.PACK_SIGNER_ID,
        env.PACK_SIGNER_PRIVATE_KEY_B64,
        env.PACK_SIGNER_PUBLIC_KEY_B64,
      )
    : null;
if (packSigner) {
  fastify.log.info({ signer_id: packSigner.signer_id }, 'pack signer configured (ed25519)');
} else {
  fastify.log.warn('PACK_SIGNER_* env vars unset — packs will be persisted unsigned');
}
const verifierKeys = packSigner
  ? {
      byId: {
        [packSigner.signer_id]: {
          algo: 'ed25519' as const,
          public_key_b64: packSigner.public_key_b64,
        },
      },
    }
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
