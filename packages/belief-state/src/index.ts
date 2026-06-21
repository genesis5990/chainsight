/**
 * @chainsight/belief-state — v0.2 (Phase 1 §3 implementation)
 *
 * The case ledger. Every fact the system knows is a BeliefAtom; every read is
 * a query against this module. Both the API and Worker import this package.
 *
 * Spec: docs/chainsight_v1_1_technical_core_spec.md §3.
 *
 * The legacy v0.x `BeliefStateClient` interface is retained for callers that
 * have not migrated to the canonical v1.1 `BeliefStateService` yet. Both
 * share storage; v0.x clients are read-only against the new schema.
 */

export * from './errors';
export * from './hash';
export { computeConfidence, fillConfidenceInputs } from './math-stub';
export { L1Cache, RedisL2Cache } from './cache';
export { BeliefPubSub } from './pubsub';
export {
  PREDICATE_PAYLOAD_SCHEMAS,
  HUMAN_WRITABLE_PREDICATES,
  SYSTEM_ONLY_PREDICATES,
  SUPERVISOR_ONLY_PREDICATES,
} from './predicates';
export { SupabaseBeliefStateService } from './service';
export type { SupabaseBeliefStateOptions } from './service';

// Convenience: re-export the canonical service interface from shared-types so
// callers only need to depend on this package.
export type {
  BeliefStateService,
  BeliefStateEvent,
  BeliefAtom,
  BeliefAtomInput,
  BeliefAtomChallenge,
  BeliefAtomRetraction,
  AtomFilter,
  AtomPredicate,
  AtomStatus,
  AgencyContext,
  Confidence,
  ConfidenceInputs,
  SubjectRef,
  SupportingEvidence,
} from '@chainsight/shared-types';

// ─── legacy v0.x compatibility shim ─────────────────────────────────────────
import type { BeliefAtomLite, CaseId, Tier } from '@chainsight/shared-types';

export interface EmitBeliefAtomInput {
  case_id: CaseId;
  subject_type: string;
  subject_ref: string;
  predicate: string;
  object?: unknown;
  confidence: number;
  tier: Tier;
  provenance?: Record<string, unknown>;
  derivation?: Record<string, unknown>;
}

export interface BeliefStateClient {
  emit(input: EmitBeliefAtomInput): Promise<BeliefAtomLite>;
  getByCase(case_id: CaseId): Promise<BeliefAtomLite[]>;
}
