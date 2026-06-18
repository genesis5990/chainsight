/**
 * @chainsight/belief-state
 *
 * Pillar 1. Every claim the AI makes is a first-class object with provenance,
 * derivation, confidence, tier, and challenge history. No agent has private
 * knowledge; every agent reads from and writes to this shared store.
 *
 * Phase 0 Week 1 skeleton. The full event-sourced implementation lands Week 2.
 */

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

// Phase 0 Week 1: placeholder export. Real Supabase-backed implementation in Week 2.
export const phase0Placeholder = true;
