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
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: {
      userId: string;
      agencyId: string;
      role: 'investigator' | 'supervisor' | 'admin' | 'service';
    };
  }
}

export const authPlugin = fp(async (fastify) => {
  // Resolve JWKS URL — prefer explicit env var, else derive from Supabase URL.
  const jwksUrl =
    env.SUPABASE_JWKS_URL ?? new URL('/auth/v1/jwks', env.SUPABASE_URL).toString();

  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  fastify.decorateRequest('auth', null);

  fastify.addHook('onRequest', async (request) => {
    // Skip auth for public health endpoints
    if (request.url.startsWith('/v1/health')) return;

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      // Unauth requests are allowed to pass; route handlers enforce as needed.
      // (Health endpoint already returned. Other public routes can be allowlisted here.)
      return;
    }

    const token = header.slice('Bearer '.length);

    try {
      const { payload } = await jwtVerify(token, jwks, {
        // Supabase Auth tokens have audience "authenticated" and issuer derived from the project URL.
        // We're permissive here in Phase 0; will tighten with explicit aud/iss validation later.
      });

      const userId = payload.sub;
      if (!userId) throw new Error('Token missing sub claim');

      // Supabase puts custom claims in app_metadata; some providers put them at top level.
      const appMetadata = (payload.app_metadata ?? {}) as Record<string, unknown>;
      const agencyId =
        (appMetadata.agency_id as string | undefined) ??
        (payload.agency_id as string | undefined);
      const role =
        ((appMetadata.role as string | undefined) ??
          (payload.role as string | undefined) ??
          'investigator') as 'investigator' | 'supervisor' | 'admin' | 'service';

      if (!agencyId) {
        request.log.warn({ userId }, 'Authenticated user has no agency_id claim');
        return;
      }

      request.auth = { userId, agencyId, role };
    } catch (err) {
      request.log.debug({ err }, 'JWT verification failed; treating as anonymous');
    }
  });
});
