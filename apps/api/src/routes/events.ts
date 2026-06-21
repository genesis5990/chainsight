/**
 * Server-Sent Events bridge from Redis pub/sub → authenticated clients.
 *
 * GET /v1/events/case/:case_id
 *
 * Subscribes to two pattern channels:
 *   - case:{case_id}:inspector:*:{ns}    (inspector pipeline progress)
 *   - case:{case_id}:trace:*:{ns}        (tracer agent progress)
 *   - case:{case_id}:graph-updated:{ns}  (materializer graph commits)
 *
 * Re-broadcasts every message as an SSE `event:` frame so the Web client
 * sees one unified stream per case. Authentication via the existing
 * authPlugin; access is gated by membership (Phase-1 keeps the check at the
 * auth layer; Phase-2 will add case_acl enforcement).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import IORedis from 'ioredis';

export interface EventsRouteOptions {
  redis_url: string;
  namespace: string;
}

const paramsSchema = z.object({ case_id: z.string().uuid() });

export async function eventsRoutes(fastify: FastifyInstance, opts: EventsRouteOptions) {
  fastify.get<{ Params: { case_id: string } }>('/events/case/:case_id', async (request: FastifyRequest<{ Params: { case_id: string } }>, reply: FastifyReply) => {
    if (!request.auth) return reply.unauthorized();
    const { case_id } = paramsSchema.parse(request.params);

    // Hijack Fastify's reply so we can stream chunks directly.
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.flushHeaders?.();

    // Dedicated subscriber connection per stream — ioredis subscribers cannot
    // be shared with the publisher and don't accept other commands.
    const sub = new IORedis(opts.redis_url, { maxRetriesPerRequest: null });

    const patterns = [
      `case:${case_id}:inspector:*:${opts.namespace}`,
      `case:${case_id}:trace:*:${opts.namespace}`,
      `case:${case_id}:graph-updated:${opts.namespace}`,
    ];
    try { await sub.psubscribe(...patterns); } catch (e) {
      request.log.warn({ e }, 'sse psubscribe failed');
    }

    const send = (eventName: string, data: string) => {
      reply.raw.write(`event: ${eventName}\n`);
      // Split data on newlines per SSE spec (one `data:` line per line).
      for (const line of data.split('\n')) reply.raw.write(`data: ${line}\n`);
      reply.raw.write('\n');
    };

    // Initial snapshot marker so clients can backfill if they missed events
    // during the (re)connect window.
    send('snapshot_marker', JSON.stringify({ case_id, namespace: opts.namespace, ts: new Date().toISOString() }));

    sub.on('pmessage', (_pattern, channel, message) => {
      // Derive the event name from the channel suffix between case_id and namespace.
      // Examples:
      //   case:<id>:inspector:<tx>:<ns>  → 'inspector'
      //   case:<id>:trace:<job>:<ns>     → 'trace'
      //   case:<id>:graph-updated:<ns>   → 'graph-updated'
      const parts = channel.split(':');
      const eventName = parts.length >= 3 ? parts[2]! : 'message';
      send(eventName, message);
    });

    // Heartbeat every 25 s so reverse proxies don't close the idle connection.
    const heartbeat = setInterval(() => {
      try { reply.raw.write(': ping\n\n'); } catch { /* */ }
    }, 25_000);
    heartbeat.unref?.();

    const cleanup = () => {
      clearInterval(heartbeat);
      sub.removeAllListeners('pmessage');
      // punsubscribe + quit; ignore errors during teardown
      sub.punsubscribe(...patterns).catch(() => { /* */ });
      sub.quit().catch(() => { /* */ });
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);

    // Tell Fastify we've taken over the response.
    return reply;
  });
}
