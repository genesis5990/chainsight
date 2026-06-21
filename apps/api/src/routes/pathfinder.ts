/**
 * Pathfinder REST endpoints (v1.1 §6).
 *
 * POST /v1/pathfinder/shortest    — single shortest path
 * POST /v1/pathfinder/k-shortest  — up to K paths ranked by rank_score
 * POST /v1/pathfinder/through     — path through ordered waypoints
 * POST /v1/pathfinder/neighbors   — direct adjacency lookup
 * POST /v1/pathfinder/nl-query    — natural-language query
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgencyContext, CaseId, SubjectRef } from '@chainsight/shared-types';
import type { Pathfinder } from '@chainsight/pathfinder';

const subjectRef = z.string().min(3).max(256);
const caseId = z.string().uuid();
const methodology = z.enum(['fifo', 'lifo', 'proportional']).optional();

const shortestSchema = z.object({
  case_id: caseId,
  from: subjectRef, to: subjectRef,
  max_hops: z.number().int().min(1).max(50).optional(),
  temporal: z.boolean().optional(),
  methodology,
});

const kShortestSchema = z.object({
  case_id: caseId,
  from: subjectRef, to: subjectRef,
  k: z.number().int().min(1).max(20).optional(),
  max_hops: z.number().int().min(1).max(50).optional(),
  branching_cap: z.number().int().min(1).max(500).optional(),
  temporal: z.boolean().optional(),
  methodology,
  deadline_ms: z.number().int().min(100).max(60_000).optional(),
});

const throughSchema = z.object({
  case_id: caseId,
  waypoints: z.array(subjectRef).min(2).max(20),
  max_hops_per_leg: z.number().int().min(1).max(50).optional(),
  temporal: z.boolean().optional(),
  methodology,
});

const neighborsSchema = z.object({
  case_id: caseId,
  subject: subjectRef,
  direction: z.enum(['in', 'out', 'both']).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  edge_kinds: z.array(z.enum(['tx_native', 'tx_token', 'internal', 'bridge_hop'])).optional(),
  min_value_minor: z.string().regex(/^[0-9]+$/).optional(),
  since_block: z.number().int().min(0).optional(),
  until_block: z.number().int().min(0).optional(),
});

const nlQuerySchema = z.object({
  case_id: caseId,
  prompt: z.string().min(2).max(2000),
  from_hint: subjectRef.optional(),
  methodology,
});

export interface PathfinderRouteOptions {
  pathfinder: Pathfinder;
}

export async function pathfinderRoutes(fastify: FastifyInstance, opts: PathfinderRouteOptions) {
  const buildCtx = (request: { auth?: { userId: string; agencyId: string; role: string } }): AgencyContext => ({
    user_id: request.auth?.userId ?? '00000000-0000-0000-0000-000000000000',
    agency_id: request.auth?.agencyId ?? '*',
    active_case_id: null,
    roles: [(request.auth?.role ?? 'investigator') as AgencyContext['roles'][number]],
    supervisory_scope_id: null,
    available_capabilities: [],
  });

  fastify.post('/pathfinder/shortest', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = shortestSchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const result = await opts.pathfinder.shortest({
      ...body,
      case_id: body.case_id as CaseId,
      from: body.from as SubjectRef,
      to: body.to as SubjectRef,
    }, ctx);
    return { path: result };
  });

  fastify.post('/pathfinder/k-shortest', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = kShortestSchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const result = await opts.pathfinder.kShortest({
      ...body,
      case_id: body.case_id as CaseId,
      from: body.from as SubjectRef,
      to: body.to as SubjectRef,
    }, ctx);
    return result;
  });

  fastify.post('/pathfinder/through', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = throughSchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const result = await opts.pathfinder.through({
      ...body,
      case_id: body.case_id as CaseId,
      waypoints: body.waypoints as SubjectRef[],
    }, ctx);
    return { paths: result };
  });

  fastify.post('/pathfinder/neighbors', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = neighborsSchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const result = await opts.pathfinder.neighbors({
      ...body,
      case_id: body.case_id as CaseId,
      subject: body.subject as SubjectRef,
      min_value_minor: body.min_value_minor as never,
    }, ctx);
    return { neighbors: result };
  });

  fastify.post('/pathfinder/nl-query', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = nlQuerySchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const result = await opts.pathfinder.nlQuery({
      ...body,
      case_id: body.case_id as CaseId,
      from_hint: body.from_hint as SubjectRef | undefined,
    }, ctx);
    return result;
  });
}
