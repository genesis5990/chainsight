/**
 * Case CRUD endpoints (Phase 0 skeleton).
 *
 * Real implementation will use Supabase service-role client with RLS enforced
 * via app-layer assertion of agency_id from the auth token.
 *
 * See: backend_architecture.md §2, data_engineering.md §4–5.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const createCaseSchema = z.object({
  codename: z.string().min(1).max(200),
  classification: z
    .enum(['unclassified', 'LES', 'confidential', 'classified'])
    .default('unclassified'),
  summary_md: z.string().optional(),
});

export async function caseRoutes(fastify: FastifyInstance) {
  fastify.get('/cases', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    // TODO Phase 0 Week 2: query Supabase cases table with RLS enforced.
    return { cases: [], _placeholder: 'Phase 0 skeleton — full implementation in Week 2' };
  });

  fastify.post('/cases', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = createCaseSchema.parse(request.body);
    // TODO Phase 0 Week 2: insert into Supabase cases table.
    return reply.code(201).send({
      case: {
        id: crypto.randomUUID(),
        codename: body.codename,
        classification: body.classification,
        agency_id: request.auth.agencyId,
        created_by: request.auth.userId,
        created_at: new Date().toISOString(),
      },
      _placeholder: 'Phase 0 skeleton — full implementation in Week 2',
    });
  });
}
