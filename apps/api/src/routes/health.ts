/**
 * Health and readiness endpoints. No auth required.
 */
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'chainsight-api',
    version: process.env.npm_package_version ?? '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/health/live', async () => ({ status: 'ok' }));

  fastify.get('/health/ready', async () => {
    // Phase 0: just confirm we can answer. Phase 1: check Supabase reachability,
    // Redis ping, Math Service gRPC, Memgraph connection.
    return { status: 'ok', checks: { self: 'ok' } };
  });
}
