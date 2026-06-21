/**
 * CaseSource — abstract data collector for the Pack builder.
 *
 * The PackBuilder is a pure function of (inputs from CaseSource) → manifest.
 * In tests we plug an in-memory CaseSource; in the worker we plug a
 * Supabase-backed one. The interface is intentionally narrow so determinism
 * tests have a single mocking surface.
 */

import type {
  CaseId,
  FrozenAgentCall,
  FrozenAtom,
  FrozenAttributionRow,
  FrozenEvent,
  FrozenInspectorRun,
  FrozenMathRecipe,
  FrozenNarrative,
  FrozenProviderResponse,
  FrozenTrace,
} from '@chainsight/shared-types';

export interface CaseSource {
  /** Atoms ordered ascending by event_seq. */
  loadAtoms(case_id: CaseId): Promise<FrozenAtom[]>;
  /** Events ordered ascending by event_seq. */
  loadEvents(case_id: CaseId): Promise<FrozenEvent[]>;
  /** Math recipes referenced by any atom in the case. */
  loadMathRecipes(case_id: CaseId): Promise<FrozenMathRecipe[]>;
  /** Provider responses referenced by any atom or trace in the case. */
  loadProviderResponses(case_id: CaseId): Promise<FrozenProviderResponse[]>;
  /** Trace jobs (completed or terminated). */
  loadTraces(case_id: CaseId): Promise<FrozenTrace[]>;
  /** Inspector runs persisted to belief.inspector_runs. */
  loadInspectorRuns(case_id: CaseId): Promise<FrozenInspectorRun[]>;
  /** Agent calls (LLM / decoder / etc) that fed into any atom. */
  loadAgentCalls(case_id: CaseId): Promise<FrozenAgentCall[]>;
  /** Frozen attribution rows referenced by any atom in the case. */
  loadAttributions(case_id: CaseId): Promise<FrozenAttributionRow[]>;
  /** Narrative transcripts (final LLM text) for the case. */
  loadNarratives(case_id: CaseId): Promise<FrozenNarrative[]>;
  /** Rule version map (pinned heuristic + decoder versions). */
  loadRuleVersions(case_id: CaseId): Promise<Record<string, string>>;
}
