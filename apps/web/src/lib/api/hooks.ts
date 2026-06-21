/**
 * React Query hooks for the live API. Each hook is a thin wrapper that:
 *   - keys the cache by (resource, ...args)
 *   - calls apiFetch (auth-aware)
 *   - surfaces ApiError consistently
 */

'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { apiFetch } from './fetch';

export interface PathfinderPathRequest {
  case_id: string;
  /** Single origin subject — the API accepts an array but we use [0] for k-shortest. */
  origin: string[];
  destination: string[];
  k?: number;
  max_hops?: number;
}

export function usePaths(req: PathfinderPathRequest | null, opts?: Partial<UseQueryOptions<unknown>>) {
  return useQuery({
    queryKey: ['pathfinder', 'paths', req],
    enabled: !!req,
    queryFn: async () => {
      if (!req) return { paths: [] };
      const body = {
        case_id: req.case_id,
        from: req.origin[0],
        to: req.destination[0],
        k: req.k ?? 3,
        max_hops: req.max_hops ?? 8,
      };
      return apiFetch(`/v1/pathfinder/k-shortest`, { method: 'POST', body: JSON.stringify(body) });
    },
    staleTime: 30_000,
    ...opts,
  });
}

export function useStartTrace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { case_id: string; origin: string[]; mode?: 'autonomous' | 'guided'; max_hops?: number }) =>
      apiFetch(`/v1/tracer/start`, { method: 'POST', body: JSON.stringify(req) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tracer', 'list', vars.case_id] });
    },
  });
}

export function useTraceJobs(case_id: string | null) {
  return useQuery({
    queryKey: ['tracer', 'list', case_id],
    enabled: !!case_id,
    queryFn: async () => apiFetch(`/v1/cases/${case_id}/traces`),
    staleTime: 10_000,
  });
}

export function usePackList(case_id: string | null) {
  return useQuery({
    queryKey: ['packs', case_id],
    enabled: !!case_id,
    queryFn: async () => apiFetch<{ packs: PackStatusRowDto[] }>(`/v1/cases/${case_id}/repro-pack`),
    staleTime: 10_000,
  });
}

export function useBuildPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { case_id: string; finalize?: boolean }) =>
      apiFetch<PackBuildResultDto>(`/v1/cases/${req.case_id}/repro-pack`, { method: 'POST', body: JSON.stringify({ finalize: req.finalize ?? true }) }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['packs', vars.case_id] });
    },
  });
}

export function useVerifyPack() {
  return useMutation({
    mutationFn: (pack_id: string) => apiFetch<VerificationResultDto>(`/v1/repro-pack/${pack_id}/verify`, { method: 'POST' }),
  });
}

export function useDownloadPack() {
  return useMutation({
    mutationFn: (pack_id: string) =>
      apiFetch<{ signed_url: string; ttl_seconds: number }>(`/v1/repro-pack/${pack_id}/download`),
  });
}

/* ── Agency admin hooks ──────────────────────────────────────────────── */

export function useMyAgencies() {
  return useQuery({
    queryKey: ['agency', 'mine'],
    queryFn: async () => apiFetch<{ agencies: AgencyDto[] }>(`/v1/agency`),
    staleTime: 30_000,
  });
}

export function useAgency(agency_id: string | null) {
  return useQuery({
    queryKey: ['agency', agency_id],
    enabled: !!agency_id,
    queryFn: async () => apiFetch<{ agency: AgencyDto; members: AgencyMemberDto[] }>(`/v1/agency/${agency_id}`),
  });
}

export function useCreateAgency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; slug: string; tier?: 'investigator' | 'team' | 'enterprise' }) =>
      apiFetch<{ agency_id: string }>(`/v1/agency`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agency', 'mine'] }),
  });
}

export function useInvite(agency_id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: 'admin' | 'supervisor' | 'investigator' }) =>
      apiFetch<{ invitation: InvitationDto }>(`/v1/agency/${agency_id}/invitations`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agency', agency_id] }),
  });
}

export function useInvitations(agency_id: string | null) {
  return useQuery({
    queryKey: ['agency', agency_id, 'invitations'],
    enabled: !!agency_id,
    queryFn: async () => apiFetch<{ invitations: InvitationDto[] }>(`/v1/agency/${agency_id}/invitations`),
  });
}

export function useInstalls(agency_id: string | null) {
  return useQuery({
    queryKey: ['agency', agency_id, 'installs'],
    enabled: !!agency_id,
    queryFn: async () => apiFetch<{ installs: ProviderInstallDto[] }>(`/v1/agency/${agency_id}/installs`),
  });
}

export function useUpsertInstall(agency_id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProviderInstallCreateDto) =>
      apiFetch(`/v1/agency/${agency_id}/installs`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agency', agency_id, 'installs'] }),
  });
}

export function useStoreCredential(agency_id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { provider_id: string; label?: string; secret: string }) =>
      apiFetch<{ credential: CredentialDto }>(`/v1/agency/${agency_id}/credentials`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agency', agency_id, 'installs'] }),
  });
}

/* ── DTOs (mirror server shapes; live-only fields) ───────────────────── */

export interface PackStatusRowDto {
  pack_id: string;
  case_id: string;
  status: 'building' | 'finalized' | 'failed';
  manifest_hash: string;
  storage_ref: string | null;
  signature: string | null;
  signer_id: string | null;
  signed_at: string | null;
  built_at: string;
  finalized_at: string | null;
  total_atoms: number;
  total_traces: number;
  total_events: number;
  chain_tip_hash: string | null;
  error: string | null;
}

export interface PackBuildResultDto {
  pack_id: string;
  manifest_hash: string;
  storage_ref: string;
  atoms_locked: number;
  built_at: string;
}

export interface VerificationResultDto {
  pack_id: string;
  overall: 'pass' | 'fail' | 'warn';
  manifest_hash_match: boolean;
  chain_valid: boolean;
  errors: string[];
  signature_valid?: boolean;
  signer_id?: string | null;
  signature_reason?: string | null;
  verified_at: string;
}

export interface AgencyDto {
  id: string;
  name: string;
  slug: string;
  tier: 'investigator' | 'team' | 'enterprise';
  created_at: string;
  role?: 'admin' | 'supervisor' | 'investigator';
}

export interface AgencyMemberDto {
  user_id: string;
  role: 'admin' | 'supervisor' | 'investigator';
  added_at: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: 'admin' | 'supervisor' | 'investigator';
  invited_at: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  token?: string;
}

export interface ProviderInstallDto {
  id: string;
  provider_id: string;
  enabled_capabilities: string[];
  priority: number;
  credential_ref: string | null;
  enabled: boolean;
  case_id: string | null;
  budget_usd_per_month: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderInstallCreateDto {
  provider_id: string;
  enabled_capabilities: string[];
  priority?: number;
  credential_ref?: string | null;
  enabled?: boolean;
  budget_usd_per_month?: number | null;
}

export interface CredentialDto {
  id: string;
  agency_id: string;
  provider_id: string;
  label: string;
  cipher_algo: 'pgsodium' | 'plain_b64';
  created_at: string;
}
