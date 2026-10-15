/**
 * GET /v1/cases/:case_id/graph
 *
 * The case's materialized transaction graph (belief.case_subgraph_edges),
 * shaped for the canvas (CanvasCaseGraph). Transaction-centric per the
 * canvas architecture: address ──> transaction ──> address.
 *
 * Only observed data is returned: tx hash, block, time, from, to and the
 * provider-reported amount. Attribution, taint coloring and paths are left
 * empty here; they come from their own atoms and the math service.
 *
 * Access: the caller's agency must own a trace on this case (cases are not
 * persisted as their own rows yet, so trace ownership is the scope).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAgency } from '../plugins/auth.js';
import { toCanvasGraph, type EdgeRow } from '../lib/graph_shape.js';

const params = z.object({ case_id: z.string().uuid() });
const query = z.object({ limit: z.coerce.number().int().min(1).max(5000).default(2000) });


export interface GraphRouteOptions {
  supabase: SupabaseClient;
}

export async function graphRoutes(fastify: FastifyInstance, opts: GraphRouteOptions) {
  fastify.addHook('preHandler', requireAgency);

  fastify.get<{ Params: { case_id: string } }>('/cases/:case_id/graph', async (request, reply) => {
    const { case_id } = params.parse(request.params);
    const { limit } = query.parse(request.query);
    const agencyId = request.auth!.agencyId!;
    const db = opts.supabase.schema('belief');

    // Scope check: some trace on this case belongs to the caller's agency.
    const { data: owned, error: ownErr } = await db
      .from('trace_jobs')
      .select('id')
      .eq('case_id', case_id)
      .eq('job_payload->>agency_id', agencyId)
      .limit(1);
    if (ownErr) throw new Error(`graph scope check failed: ${ownErr.message}`);
    if (!owned?.length) return reply.notFound('No traces for this case in your agency');

    const { data, error } = await db
      .from('case_subgraph_edges')
      .select('id, chain, from_subject, to_subject, edge_kind, tx_ref, edge_index, block_height, block_time, value_minor')
      .eq('case_id', case_id)
      .order('block_height', { ascending: true })
      .limit(limit + 1);
    if (error) throw new Error(`graph read failed: ${error.message}`);
    const rows = (data ?? []) as EdgeRow[];
    const truncated = rows.length > limit;
    return toCanvasGraph(case_id, truncated ? rows.slice(0, limit) : rows, truncated);
  });
}
