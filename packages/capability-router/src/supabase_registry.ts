/**
 * Supabase-backed InstallRegistry + ResolutionAudit.
 *
 * Reads from belief.agency_provider_installs and writes to
 * belief.provider_resolutions. Mirrors the in-memory versions structurally;
 * the worker swaps these in when SUPABASE_URL + SERVICE_ROLE_KEY are set.
 */

import type { AgencyContext } from '@chainsight/shared-types';
import type { AgencyProviderInstall, Capability } from './types';
import type { InstallRegistry } from './install_registry';
import type { ResolutionAudit } from './router';

/** Minimal supabase-js shape we depend on. */
export interface SupabaseRouterClient {
  schema(name: string): {
    from(table: string): SupabaseTable;
  };
}

interface SupabaseTable {
  select(cols: string): SupabaseQuery;
  insert(row: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
}

interface SupabaseQuery {
  eq(col: string, val: unknown): SupabaseQuery;
  in(col: string, vals: unknown[]): SupabaseQuery;
  or(filter: string): SupabaseQuery;
  contains(col: string, vals: unknown[]): SupabaseQuery;
  order(col: string, opts?: { ascending?: boolean }): SupabaseQuery;
  limit?(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
  then<T>(onfulfilled: (v: { data: Array<Record<string, unknown>> | null; error: { message: string } | null }) => T): Promise<T>;
}

export class SupabaseInstallRegistry implements InstallRegistry {
  constructor(private readonly client: SupabaseRouterClient) {}

  async installsFor(capability: Capability, ctx: AgencyContext): Promise<AgencyProviderInstall[]> {
    try {
      const res = await this.client
        .schema('belief')
        .from('agency_provider_installs')
        .select('id, agency_id, provider_id, enabled_capabilities, priority, credential_ref, enabled, case_id, budget_usd_per_month')
        .eq('enabled', true)
        .contains('enabled_capabilities', [capability])
        .or(`agency_id.eq.${ctx.agency_id},agency_id.eq.*`)
        .order('priority', { ascending: true });
      const { data, error } = res as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
      if (error || !data) return [];
      return data
        .map((r) => mapRow(r))
        .filter((r) => r.case_id === null || r.case_id === ctx.active_case_id);
    } catch {
      return [];
    }
  }
}

export class SupabaseResolutionAudit implements ResolutionAudit {
  constructor(private readonly client: SupabaseRouterClient) {}

  async record(input: {
    agency_id: string;
    case_id: string | null;
    capability: Capability;
    provider_install_id: string | null;
    provider_id: string | null;
    cache_hit: boolean;
    latency_ms: number | null;
    error?: string;
  }): Promise<void> {
    try {
      await this.client.schema('belief').from('provider_resolutions').insert({
        agency_id: input.agency_id,
        case_id: input.case_id,
        capability: input.capability,
        provider_install_id: input.provider_install_id,
        provider_id: input.provider_id,
        cache_hit: input.cache_hit,
        latency_ms: input.latency_ms,
        error: input.error ?? null,
      });
    } catch { /* best-effort */ }
  }
}

function mapRow(row: Record<string, unknown>): AgencyProviderInstall {
  return {
    id: String(row.id),
    agency_id: String(row.agency_id) as AgencyProviderInstall['agency_id'],
    provider_id: String(row.provider_id),
    enabled_capabilities: ((row.enabled_capabilities as string[]) ?? []) as readonly Capability[],
    priority: Number(row.priority ?? 100),
    credential_ref: (row.credential_ref as string | null) ?? null,
    enabled: Boolean(row.enabled),
    case_id: (row.case_id as AgencyProviderInstall['case_id']) ?? null,
    budget_usd_per_month: (row.budget_usd_per_month as number | null) ?? null,
  };
}
