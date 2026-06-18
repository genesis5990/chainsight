/**
 * @chainsight/capability-router
 *
 * Pillar 3. Every external data source is a capability, not a vendor name.
 * Calling code never says `etherscan.getTx()` — it says
 * `router.resolve("get_tx_by_hash", args)`. Provider selection, fallback,
 * budget enforcement, and cache integration all happen here.
 *
 * Phase 0 Week 1 skeleton. Real implementation lands Week 3 with the first
 * Etherscan provider wired in.
 */

import type { AgencyId, CaseId } from '@chainsight/shared-types';

export type Capability =
  | 'get_tx_by_hash'
  | 'get_address_balance'
  | 'get_address_attribution'
  | 'get_price_at_timestamp'
  | 'decode_router_swap'
  | 'get_sanctions_status';

export interface ResolveInput<TArgs = Record<string, unknown>> {
  capability: Capability;
  args: TArgs;
  case_id: CaseId;
  agency_id: AgencyId;
}

export interface ResolveOutput<TPayload = unknown> {
  payload: TPayload;
  provider_id: string;
  cached: boolean;
  fetched_at: string;
}

// Phase 0 Week 1: placeholder.
export const phase0Placeholder = true;
