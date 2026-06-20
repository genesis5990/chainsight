/**
 * @chainsight/shared-types
 *
 * Types shared across web, api, worker, and packages. Phase 0 Week 1 skeleton —
 * the canonical types fill in as the schema migrations land.
 *
 * Supabase-generated types live in src/supabase.ts (regenerated via
 * `pnpm supabase:gen-types` from the root).
 */

export type AgencyId = string & { readonly __brand: 'AgencyId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type CaseId = string & { readonly __brand: 'CaseId' };
export type BeliefAtomId = string & { readonly __brand: 'BeliefAtomId' };

export type Classification = 'unclassified' | 'LES' | 'confidential' | 'classified';
export type Role = 'investigator' | 'supervisor' | 'admin' | 'service';

// Tiered determinism from v0.2 B2.
export type Tier = 'T0' | 'T1' | 'T2' | 'T3';

// Surface 1 — Transaction Inspector data shapes.
export * from './inspector';

// Surface 2 — Canvas data shapes.
export * from './canvas';

// Belief Atom — the foundational unit. Full type fills in Week 2.
export interface BeliefAtomLite {
  id: BeliefAtomId;
  case_id: CaseId;
  subject_type: string;
  subject_ref: string;
  predicate: string;
  confidence: number;
  tier: Tier;
  status: 'asserted' | 'challenged' | 'retracted' | 'court_grade';
  created_at: string;
}
