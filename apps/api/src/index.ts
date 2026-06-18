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
import { env } from './env.js';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { caseRoutes } from './routes/cases.js';

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
