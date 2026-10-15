/**
 * Server-Sent Events bridge from belief.case_stream to authenticated clients.
 *
 * GET /v1/events/case/:case_id
 *
 * Streams live rows for the case with topic 'trace' (tracer progress),
 * 'graph-updated' (materializer commits) or 'inspector'. Postgres-backed
 * (migration 0014); no Redis.
 *
 * Frames are unnamed (`data:` only) so EventSource.onmessage receives them;
 * the topic is inside the JSON as `topic`. Each frame carries `id:` (the
 * case_stream row id), so a reconnecting EventSource sends Last-Event-ID and
 * resumes exactly where it stopped.
 *
 * Auth: authPlugin + requireAgency. The JWT may arrive as ?access_token=
 * because EventSource cannot set headers.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CaseStream } from '@chainsight/shared-types';
import { requireAgency } from '../plugins/auth.js';

export interface EventsRouteOptions {
  stream: CaseStream;
}

const TOPICS = ['trace', 'graph-updated', 'inspector'];

const paramsSchema = z.object({ case_id: z.string().uuid() });

export async function eventsRoutes(fastify: FastifyInstance, opts: EventsRouteOptions) {
  fastify.addHook('preHandler', requireAgency);

  fastify.get<{ Params: { case_id: string } }>(
    '/events/case/:case_id',
    async (request: FastifyRequest<{ Params: { case_id: string } }>, reply: FastifyReply) => {
      if (!request.auth) return reply.unauthorized();
      const { case_id } = paramsSchema.parse(request.params);

      // Resume point: Last-Event-ID from a reconnecting EventSource.
      const lastEventId = Number(request.headers['last-event-id']);
      const afterId = Number.isFinite(lastEventId) && lastEventId > 0 ? lastEventId : undefined;

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
      reply.raw.flushHeaders?.();

      const write = (frame: string) => {
        try {
          reply.raw.write(frame);
        } catch {
          /* client gone; cleanup runs on close */
        }
      };
      const send = (data: unknown, id?: number) => {
        let frame = id !== undefined ? `id: ${id}\n` : '';
        for (const line of JSON.stringify(data).split('\n')) frame += `data: ${line}\n`;
        write(frame + '\n');
      };

      // Clients can backfill durable history from belief.events after this.
      send({
        kind: 'snapshot_marker',
        topic: 'control',
        case_id,
        resumed_after: afterId ?? null,
        ts: new Date().toISOString(),
      });

      const abort = new AbortController();
      const heartbeat = setInterval(() => write(': ping\n\n'), 25_000);
      heartbeat.unref?.();

      const cleanup = () => {
        clearInterval(heartbeat);
        abort.abort();
      };
      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      void (async () => {
        for await (const row of opts.stream.tail({
          case_id,
          topics: TOPICS,
          afterId,
          signal: abort.signal,
        })) {
          const payload = (
            row.payload && typeof row.payload === 'object' ? row.payload : { value: row.payload }
          ) as Record<string, unknown>;
          send(
            { ...payload, topic: row.topic, topic_key: row.topic_key, at: row.created_at },
            row.id,
          );
        }
      })().catch((err) =>
        request.log.warn({ err: (err as Error).message, case_id }, 'sse tail ended'),
      );

      return reply;
    },
  );
}
