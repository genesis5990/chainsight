/**
 * Tracer Agent REST endpoints (v1.1 §7).
 *
 *   POST   /v1/tracer/start              — enqueue a trace job (idempotent)
 *   POST   /v1/tracer/:job_id/cancel     — cancel a running job
 *   GET    /v1/tracer/:job_id            — status of a single job
 *   GET    /v1/cases/:case_id/traces     — list traces for a case
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireAgency } from '../plugins/auth.js';
import { z } from 'zod';
import type {
  AgencyContext,
  CaseId,
  SubjectRef,
  TraceJobRequest,
} from '@chainsight/shared-types';
import type { TracerService } from '@chainsight/tracer-agent';

const subjectRef = z.string().min(3).max(256);
const caseId = z.string().uuid();
const jobId = z.string().min(8).max(64);

const startSchema = z.object({
  case_id: caseId,
  mode: z.enum(['single_hop', 'forward_n', 'backward_n', 'autonomous', 'boundary_walk', 'between']),
  origin: z.array(subjectRef).min(1).max(10),
  direction: z.enum(['forward', 'backward', 'both']).optional(),
  max_hops_per_path: z.number().int().min(1).max(50).optional(),
  max_total_hops: z.number().int().min(1).max(2000).optional(),
  branching_cap: z.number().int().min(1).max(500).optional(),
  budget_usd: z.number().min(0).max(1000).optional(),
  methodology: z.enum(['fifo', 'lifo', 'proportional']).optional(),
  taint_threshold: z.number().min(0).max(1).optional(),
  terminate_at_kinds: z.array(z.enum(['exchange', 'mixer', 'fiat_offramp', 'coinbase', 'bridge'])).optional(),
  terminate_at_subjects: z.array(subjectRef).optional(),
  emit_progress_every_n_hops: z.number().int().min(1).max(50).optional(),
});

export interface TracerRouteOptions {
  tracer: TracerService;
}

export async function tracerRoutes(fastify: FastifyInstance, opts: TracerRouteOptions) {
  fastify.addHook('preHandler', requireAgency);

  // requireAgency (preHandler below) guarantees auth and agencyId are set.
  const buildCtx = (request: FastifyRequest): AgencyContext => ({
    user_id: request.auth!.userId,
    agency_id: request.auth!.agencyId!,
    active_case_id: null,
    roles: [request.auth!.role as AgencyContext['roles'][number]],
    supervisory_scope_id: null,
    available_capabilities: [],
  });

  fastify.post('/tracer/start', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = startSchema.parse(request.body);
    const ctx = { ...buildCtx(request), active_case_id: body.case_id as CaseId };
    const req: TraceJobRequest = {
      ...body,
      case_id: body.case_id as CaseId,
      origin: body.origin as SubjectRef[],
      terminate_at_subjects: body.terminate_at_subjects as SubjectRef[] | undefined,
    };
    const result = await opts.tracer.start(req, ctx);
    return reply.code(result.deduplicated ? 200 : 201).send(result);
  });

  fastify.post<{ Params: { job_id: string } }>('/tracer/:job_id/cancel', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const job_id = jobId.parse(request.params.job_id);
    const ctx = buildCtx(request);
    await opts.tracer.cancel(job_id, ctx);
    return { cancelled: true };
  });

  fastify.get<{ Params: { job_id: string } }>('/tracer/:job_id', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const job_id = jobId.parse(request.params.job_id);
    const ctx = buildCtx(request);
    const status = await opts.tracer.status(job_id, ctx);
    if (!status) return reply.notFound();
    return status;
  });

  fastify.get<{ Params: { case_id: string } }>('/cases/:case_id/traces', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const case_id = caseId.parse(request.params.case_id);
    const ctx = { ...buildCtx(request), active_case_id: case_id as CaseId };
    const list = await opts.tracer.listForCase(case_id as CaseId, ctx);
    return { traces: list };
  });
}
