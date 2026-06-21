/**
 * Reproducibility Pack REST endpoints (v1.0 Backend §1.8).
 *
 *   POST /v1/cases/:case_id/repro-pack            — build a pack (sync)
 *   GET  /v1/cases/:case_id/repro-pack            — list packs for the case
 *   GET  /v1/repro-pack/:pack_id                  — pack status row
 *   GET  /v1/repro-pack/:pack_id/download         — signed URL for the zip
 *   POST /v1/repro-pack/:pack_id/verify           — rerun the verifier
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CaseId } from '@chainsight/shared-types';
import type { ReproPackService } from '@chainsight/reproducibility';

const caseId = z.string().uuid();
const packId = z.string().uuid();

const buildSchema = z.object({
  finalize: z.boolean().default(true),
  label: z.string().max(120).optional(),
});

export interface ReproPackRouteOptions {
  service: ReproPackService;
}

export async function reproPackRoutes(fastify: FastifyInstance, opts: ReproPackRouteOptions) {
  fastify.post<{ Params: { case_id: string } }>('/cases/:case_id/repro-pack', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const case_id = caseId.parse(request.params.case_id);
    const body = buildSchema.parse(request.body ?? {});
    const result = await opts.service.build({
      case_id: case_id as CaseId,
      agency_id: request.auth.agencyId,
      built_by_id: request.auth.userId,
      finalize: body.finalize,
      label: body.label,
    });
    return reply.code(201).send(result);
  });

  fastify.get<{ Params: { case_id: string } }>('/cases/:case_id/repro-pack', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const case_id = caseId.parse(request.params.case_id);
    const list = await opts.service.listForCase(case_id as CaseId);
    return { packs: list };
  });

  fastify.get<{ Params: { pack_id: string } }>('/repro-pack/:pack_id', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const pack_id = packId.parse(request.params.pack_id);
    const status = await opts.service.status(pack_id);
    if (!status) return reply.notFound();
    return status;
  });

  fastify.get<{ Params: { pack_id: string } }>('/repro-pack/:pack_id/download', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const pack_id = packId.parse(request.params.pack_id);
    const link = await opts.service.download(pack_id);
    if (!link) return reply.notFound();
    return link;
  });

  fastify.post<{ Params: { pack_id: string } }>('/repro-pack/:pack_id/verify', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const pack_id = packId.parse(request.params.pack_id);
    const verdict = await opts.service.verify(pack_id);
    return verdict;
  });
}
