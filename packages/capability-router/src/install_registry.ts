/**
 * InstallRegistry — returns the ordered list of AgencyProviderInstall rows
 * for a (capability, agency, case) tuple.
 *
 * Phase 1 Week 4 ships an in-memory registry seeded at boot. A Supabase
 * implementation will follow once the agency-admin UI for installing
 * providers is built (F22 in v1.0). The interface here doesn't change.
 */

import type {
  AgencyProviderInstall,
  Capability,
} from './types';
import type { AgencyContext } from '@chainsight/shared-types';

export interface InstallRegistry {
  /**
   * Returns the ordered fallback chain for a capability, filtered to
   * `enabled = true` and the given agency / case.
   */
  installsFor(capability: Capability, ctx: AgencyContext): Promise<AgencyProviderInstall[]>;
}

export class InMemoryInstallRegistry implements InstallRegistry {
  private readonly rows: AgencyProviderInstall[] = [];

  add(install: AgencyProviderInstall): this {
    this.rows.push(install);
    return this;
  }

  /** Convenience: add a default install that applies to every agency. */
  addDefault(input: Omit<AgencyProviderInstall, 'id' | 'agency_id' | 'case_id'> & {
    id?: string;
  }): this {
    return this.add({
      id: input.id ?? `default:${input.provider_id}:${input.priority}`,
      agency_id: '*' as AgencyProviderInstall['agency_id'],
      case_id: null,
      ...input,
    });
  }

  async installsFor(capability: Capability, ctx: AgencyContext): Promise<AgencyProviderInstall[]> {
    return this.rows
      .filter((r) => r.enabled)
      .filter((r) => r.enabled_capabilities.includes(capability))
      .filter((r) => r.agency_id === ctx.agency_id || r.agency_id === '*')
      .filter((r) => r.case_id === null || r.case_id === ctx.active_case_id)
      .sort((a, b) => a.priority - b.priority);
  }
}
