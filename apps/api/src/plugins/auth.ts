/**
 * JWKS-generic auth plugin.
 *
 * Works with any OIDC-compatible auth provider:
 *   - SaaS Blind v1: Supabase Auth (JWKS at https://<project>.supabase.co/auth/v1/jwks)
 *   - On-Prem: Ory Kratos / Hydra (or any compliant provider)
 *
 * See: backend_architecture.md §0.4
 *
 * Decodes JWT, extracts:
 *   - sub (user id)
 *   - agency_id (from app_metadata.agency_id claim)
 *   - role (from app_metadata.role claim)
 *
 * Attaches { userId, agencyId, role } to request.auth for downstream handlers.
 */

import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

export type AuthRole = 'investigator' | 'supervisor' | 'admin' | 'service';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      /**
       * The caller's agency. From the token's app_metadata.agency_id claim if
       * present, else resolved from belief.agency_members when the user
       * belongs to exactly one agency. Null for a signed-in user who has not
       * created or joined an agency yet (they can still call /v1/agency).
       */
      agencyId: string | null;
      role: AuthRole;
    };
  }
}

const ROLES: readonly AuthRole[] = ['investigator', 'supervisor', 'admin', 'service'];

function asRole(v: unknown): AuthRole | undefined {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v)
    ? (v as AuthRole)
    : undefined;
}

/**
 * preHandler for routes that act inside an agency (cases, tracer, pathfinder,
 * packs, events). 401 if not signed in, 403 if the user has no agency yet.
 * Replaces the old `agency_id: '*'` fallback, which meant "every agency".
 */
export async function requireAgency(request: FastifyRequest, reply: FastifyReply) {
  if (!request.auth) return reply.unauthorized();
  if (!request.auth.agencyId) {
    return reply.forbidden('Create or join an agency before using this endpoint');
  }
}

export const authPlugin = fp(async (fastify) => {
  // Resolve JWKS URL: prefer explicit env var, else derive from Supabase URL.
  const jwksUrl = env.SUPABASE_JWKS_URL ?? new URL('/auth/v1/jwks', env.SUPABASE_URL).toString();
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  // Supabase Auth issues tokens with iss "<project>/auth/v1" and aud "authenticated".
  const issuer = new URL('/auth/v1', env.SUPABASE_URL).toString();
  const audience = 'authenticated';

  // Service client for membership lookups (bypasses RLS; read-only use here).
  const membership = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  fastify.decorateRequest('auth', undefined as never);

  fastify.addHook('onRequest', async (request) => {
    // Skip auth for public health endpoints
    if (request.url.startsWith('/v1/health')) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      // Unauthenticated requests pass through; every non-health route rejects
      // them with 401 (agency routes inline, the rest via requireAgency).
      return;
    }

    const token = header.slice('Bearer '.length);

    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer, audience }));
    } catch (err) {
      request.log.info(
        { err: (err as Error).message },
        'JWT verification failed; treating as anonymous',
      );
      return;
    }

    const userId = payload.sub;
    if (!userId) return;

    // Roles and agency come only from server-controlled app_metadata (users
    // cannot edit it) or from the membership table. The top-level `role`
    // claim is Supabase's Postgres role ("authenticated"), not a ChainSight role.
    const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
    let agencyId = typeof appMetadata.agency_id === 'string' ? appMetadata.agency_id : null;
    let role = asRole(appMetadata.role);

    if (!agencyId) {
      const { data, error } = await membership
        .schema('belief')
        .from('agency_members')
        .select('agency_id, role')
        .eq('user_id', userId)
        .limit(2);
      if (error) {
        request.log.error({ err: error.message, userId }, 'agency membership lookup failed');
      } else if (data && data.length === 1) {
        const row = data[0] as { agency_id: string; role: string };
        agencyId = row.agency_id;
        role = role ?? asRole(row.role);
      } else if (data && data.length > 1) {
        request.log.warn(
          { userId },
          'user belongs to multiple agencies and token has no agency_id claim',
        );
      }
    }

    request.auth = { userId, agencyId, role: role ?? 'investigator' };
  });
});
