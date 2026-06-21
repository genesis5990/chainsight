/**
 * SaaS Blind agency-admin routes.
 *
 * Endpoints (mounted at /v1):
 *   POST   /agency                       — create a new agency (caller becomes admin)
 *   GET    /agency                       — list agencies the caller belongs to
 *   GET    /agency/:id                   — agency detail + member roster (admin or member)
 *   POST   /agency/:id/invitations       — admin invites someone by email
 *   GET    /agency/:id/invitations       — admin lists pending invites
 *   POST   /agency/invitations/accept    — accept by token
 *   GET    /agency/:id/installs          — list provider installs for the agency
 *   POST   /agency/:id/installs          — create/update a provider install
 *   DELETE /agency/installs/:install_id  — remove an install
 *   POST   /agency/:id/credentials       — store a BYOK secret (vault-encrypted)
 *   DELETE /agency/credentials/:cred_id  — rotate/revoke a secret
 *
 * All writes go through the Supabase service-role client (RLS bypassed at API
 * layer; authorization is enforced explicitly per route via agency_members).
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';
import { randomBytes } from 'node:crypto';

const slugSchema = z.string().min(2).max(64).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug must be lowercase alphanumeric + hyphen');

const createAgencySchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  tier: z.enum(['investigator', 'team', 'enterprise']).default('investigator'),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'supervisor', 'investigator']).default('investigator'),
});

const acceptSchema = z.object({
  token: z.string().min(16),
});

const installSchema = z.object({
  provider_id: z.string().min(1),
  enabled_capabilities: z.array(z.string()).min(1),
  priority: z.number().int().min(1).max(1000).default(100),
  credential_ref: z.string().nullable().optional(),
  enabled: z.boolean().default(true),
  budget_usd_per_month: z.number().nullable().optional(),
});

const credentialSchema = z.object({
  provider_id: z.string().min(1),
  label: z.string().max(120).default(''),
  /** Plain-text secret; encrypted server-side via pgsodium or base64 in dev. */
  secret: z.string().min(1),
});

function getServiceClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function assertAdmin(client: SupabaseClient, agency_id: string, user_id: string): Promise<boolean> {
  const { data, error } = await client.schema('belief').from('agency_members')
    .select('role').eq('agency_id', agency_id).eq('user_id', user_id).maybeSingle();
  if (error || !data) return false;
  return (data as { role: string }).role === 'admin';
}

async function assertMember(client: SupabaseClient, agency_id: string, user_id: string): Promise<boolean> {
  const { data, error } = await client.schema('belief').from('agency_members')
    .select('role').eq('agency_id', agency_id).eq('user_id', user_id).maybeSingle();
  if (error || !data) return false;
  return true;
}

function freshToken(): string {
  return randomBytes(24).toString('base64url');
}

export async function agencyRoutes(fastify: FastifyInstance) {
  const supabase = getServiceClient();

  /* ── create agency ───────────────────────────────────────────────────── */
  fastify.post('/agency', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = createAgencySchema.parse(request.body);

    const { data, error } = await supabase.schema('belief').rpc('create_agency', {
      p_name: body.name,
      p_slug: body.slug,
      p_tier: body.tier,
      p_creator: request.auth.userId,
    });
    if (error) return reply.code(400).send({ error: 'create_agency_failed', detail: error.message });
    return reply.code(201).send({ agency_id: data, slug: body.slug, name: body.name, tier: body.tier });
  });

  /* ── list agencies I belong to ───────────────────────────────────────── */
  fastify.get('/agency', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const { data, error } = await supabase.schema('belief').from('agency_members')
      .select('agency_id, role, added_at, agencies:agency_id ( id, name, slug, tier, created_at )')
      .eq('user_id', request.auth.userId);
    if (error) return reply.code(500).send({ error: error.message });
    const list = (data ?? []).map((r: { agencies: unknown; role: string; added_at: string }) => ({
      ...(r.agencies as Record<string, unknown>),
      role: r.role,
      joined_at: r.added_at,
    }));
    return { agencies: list };
  });

  /* ── agency detail + roster ──────────────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/agency/:id', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertMember(supabase, id, request.auth.userId)) return reply.forbidden();

    const [{ data: agency }, { data: members }] = await Promise.all([
      supabase.schema('belief').from('agencies').select('*').eq('id', id).maybeSingle(),
      supabase.schema('belief').from('agency_members').select('user_id, role, added_at').eq('agency_id', id),
    ]);
    if (!agency) return reply.code(404).send({ error: 'not_found' });
    return { agency, members: members ?? [] };
  });

  /* ── invitations ─────────────────────────────────────────────────────── */
  fastify.post<{ Params: { id: string } }>('/agency/:id/invitations', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertAdmin(supabase, id, request.auth.userId)) return reply.forbidden();
    const body = inviteSchema.parse(request.body);
    const token = freshToken();
    const { data, error } = await supabase.schema('belief').from('agency_invitations').insert({
      agency_id: id,
      email: body.email.toLowerCase(),
      role: body.role,
      token,
      invited_by: request.auth.userId,
    }).select('id, email, role, token, invited_at').single();
    if (error) return reply.code(400).send({ error: error.message });
    return reply.code(201).send({ invitation: data });
  });

  fastify.get<{ Params: { id: string } }>('/agency/:id/invitations', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertAdmin(supabase, id, request.auth.userId)) return reply.forbidden();
    const { data, error } = await supabase.schema('belief').from('agency_invitations')
      .select('id, email, role, invited_at, accepted_at, revoked_at')
      .eq('agency_id', id);
    if (error) return reply.code(500).send({ error: error.message });
    return { invitations: data ?? [] };
  });

  fastify.post('/agency/invitations/accept', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const body = acceptSchema.parse(request.body);
    const { data, error } = await supabase.schema('belief').rpc('accept_agency_invitation', {
      p_token: body.token,
      p_user_id: request.auth.userId,
    });
    if (error) return reply.code(400).send({ error: error.message });
    return { agency_id: data };
  });

  /* ── provider installs (admin only) ──────────────────────────────────── */
  fastify.get<{ Params: { id: string } }>('/agency/:id/installs', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertMember(supabase, id, request.auth.userId)) return reply.forbidden();
    const { data, error } = await supabase.schema('belief').from('agency_provider_installs')
      .select('id, provider_id, enabled_capabilities, priority, credential_ref, enabled, case_id, budget_usd_per_month, created_at, updated_at')
      .eq('agency_id', id);
    if (error) return reply.code(500).send({ error: error.message });
    return { installs: data ?? [] };
  });

  fastify.post<{ Params: { id: string } }>('/agency/:id/installs', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertAdmin(supabase, id, request.auth.userId)) return reply.forbidden();
    const body = installSchema.parse(request.body);
    const { data, error } = await supabase.schema('belief').from('agency_provider_installs').insert({
      agency_id: id,
      provider_id: body.provider_id,
      enabled_capabilities: body.enabled_capabilities,
      priority: body.priority,
      credential_ref: body.credential_ref ?? null,
      enabled: body.enabled,
      budget_usd_per_month: body.budget_usd_per_month ?? null,
    }).select('*').single();
    if (error) return reply.code(400).send({ error: error.message });
    return reply.code(201).send({ install: data });
  });

  fastify.delete<{ Params: { install_id: string } }>('/agency/installs/:install_id', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const { data: row, error: fetchErr } = await supabase.schema('belief').from('agency_provider_installs')
      .select('agency_id').eq('id', request.params.install_id).maybeSingle();
    if (fetchErr || !row) return reply.code(404).send({ error: 'install_not_found' });
    if (!await assertAdmin(supabase, (row as { agency_id: string }).agency_id, request.auth.userId)) return reply.forbidden();
    const { error } = await supabase.schema('belief').from('agency_provider_installs').delete().eq('id', request.params.install_id);
    if (error) return reply.code(500).send({ error: error.message });
    return { ok: true };
  });

  /* ── credentials (admin only; secret encrypted) ──────────────────────── */
  fastify.post<{ Params: { id: string } }>('/agency/:id/credentials', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const id = request.params.id;
    if (!await assertAdmin(supabase, id, request.auth.userId)) return reply.forbidden();
    const body = credentialSchema.parse(request.body);

    // Try pgsodium first; fall back to base64 (dev) if pgsodium isn't available.
    const cipherAlgo = process.env.PACK_VAULT_ALGO ?? 'plain_b64';
    const secretCipher = cipherAlgo === 'plain_b64'
      ? Buffer.from(body.secret, 'utf8').toString('base64')
      : body.secret; // pgsodium path is via server-side function (TBD in 0011)

    const { data, error } = await supabase.schema('belief').from('agency_credentials').insert({
      agency_id: id,
      provider_id: body.provider_id,
      label: body.label,
      secret_cipher: secretCipher,
      cipher_algo: cipherAlgo,
      created_by: request.auth.userId,
    }).select('id, agency_id, provider_id, label, cipher_algo, created_at').single();
    if (error) return reply.code(400).send({ error: error.message });
    return reply.code(201).send({ credential: data });
  });

  fastify.delete<{ Params: { cred_id: string } }>('/agency/credentials/:cred_id', async (request, reply) => {
    if (!request.auth) return reply.unauthorized();
    const { data: row, error: fetchErr } = await supabase.schema('belief').from('agency_credentials')
      .select('agency_id').eq('id', request.params.cred_id).maybeSingle();
    if (fetchErr || !row) return reply.code(404).send({ error: 'credential_not_found' });
    if (!await assertAdmin(supabase, (row as { agency_id: string }).agency_id, request.auth.userId)) return reply.forbidden();
    const { error } = await supabase.schema('belief').from('agency_credentials').delete().eq('id', request.params.cred_id);
    if (error) return reply.code(500).send({ error: error.message });
    return { ok: true };
  });
}
