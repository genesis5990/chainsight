/**
 * Inspector Pipeline (v1.1 §5) wire shapes.
 *
 * Coexists with `./inspector.ts` (the Phase-0 UI mockup types). The new
 * pipeline types are the canonical names for Phase-1 work.
 */

import type { BeliefAtomId, CaseId } from './index';
import type { BeliefChainId, IntegerAmount, SubjectRef, TxRef } from './belief';

// ─── 8-section identifiers ──────────────────────────────────────────────────

export type InspectorSectionId =
  | 'header'                 // 1
  | 'parties'                // 2
  | 'decoded_action'         // 3
  | 'value_fees'             // 4
  | 'methodology'            // 5
  | 'counterparty_attribution' // 6
  | 'narrative'              // 7
  | 'citations';             // 8

// ─── input ──────────────────────────────────────────────────────────────────

export interface InspectorRunRequest {
  /** Idempotency key per v1.1 §2.2. */
  idempotency_key: string;
  case_id: CaseId;
  tx_ref: TxRef;
  /** Methodology context — affects §5. */
  methodology?: 'fifo' | 'lifo' | 'proportional';
  /** Whether to run §7 narrative (LLM). Default true. */
  include_narrative?: boolean;
  /** Caller actor id for audit. */
  actor_id: string;
  agency_id: string;
}

// ─── section payloads ──────────────────────────────────────────────────────

export interface PipelineInspectorHeader {
  chain: BeliefChainId;
  tx_hash: string;
  block_hash: string;
  block_height: number;
  block_time_utc: string;
  index_in_block: number;
  status: 'success' | 'failed';
  fee_native_minor?: IntegerAmount;
}

export interface PipelineInspectorParty {
  role: 'from' | 'to' | 'token_from' | 'token_to' | 'contract';
  address_ref: SubjectRef;
  display_label?: string;
  known_attribution?: string;
}

export interface PipelineInspectorParties {
  parties: PipelineInspectorParty[];
}

export interface PipelineInspectorDecodedAction {
  selector?: string;
  signature?: string;
  action_kind: string;          // 'native_transfer' | 'token_transfer' | 'dex_swap' | …
  confidence: 'structured' | 'heuristic' | 'unknown';
  decoded: Record<string, unknown>;
  math_recipe_hash: string;
}

export interface PipelineInspectorValueFees {
  value_native_minor: IntegerAmount;
  value_native_major: string;
  value_fiat: string;
  fiat_currency: string;
  price_used: string;
  price_source: string;
  fee_native_minor: IntegerAmount;
  fee_fiat: string;
  math_recipe_hashes: {
    value: string;
    fee: string;
  };
}

export interface PipelineInspectorMethodologyHop {
  lot_id: string;
  amount_consumed_minor: IntegerAmount;
  taint_contributed_minor: IntegerAmount;
}

export interface PipelineInspectorMethodology {
  methodology: 'fifo' | 'lifo' | 'proportional';
  applied: boolean;             // false if no path through this tx
  selections: PipelineInspectorMethodologyHop[];
  total_attributed_minor: IntegerAmount;
  total_taint_minor: IntegerAmount;
  math_recipe_hash?: string;
  skip_reason?: string;
}

export interface PipelineInspectorCounterpartyAttribution {
  attributions: Array<{
    subject_ref: SubjectRef;
    label: string;
    category: string;
    confidence: number;
    atom_id?: BeliefAtomId;
    source: 'belief_state' | 'attribution_agent_stub' | 'none';
  }>;
}

export interface PipelineInspectorNarrative {
  /** The raw markdown text, possibly empty if include_narrative=false. */
  text: string;
  /** Streamed in token by token; final emission contains the full assembled text. */
  finalized: boolean;
  model_id: string;
  /** Estimated token count. 0 in stub mode. */
  token_count: number;
}

export interface PipelineInspectorCitationFinding {
  sentence_index: number;
  sentence_text: string;
  /** Atom IDs cited in this sentence (may be empty if uncited). */
  cited_atom_ids: BeliefAtomId[];
  status: 'verified' | 'uncited' | 'unknown_atom' | 'cross_case_atom';
  reason?: string;
}

export interface PipelineInspectorCitations {
  total_sentences: number;
  verified: number;
  uncited: number;
  unknown_atom: number;
  cross_case_atom: number;
  findings: PipelineInspectorCitationFinding[];
}

// ─── streaming events ───────────────────────────────────────────────────────

export type InspectorEvent =
  | { kind: 'run_started';        run_id: string; tx_ref: TxRef; cached: boolean }
  | { kind: 'section_ready';      run_id: string; section: 'header';                   payload: PipelineInspectorHeader }
  | { kind: 'section_ready';      run_id: string; section: 'parties';                  payload: PipelineInspectorParties }
  | { kind: 'section_ready';      run_id: string; section: 'decoded_action';           payload: PipelineInspectorDecodedAction }
  | { kind: 'section_ready';      run_id: string; section: 'value_fees';               payload: PipelineInspectorValueFees }
  | { kind: 'section_ready';      run_id: string; section: 'methodology';              payload: PipelineInspectorMethodology }
  | { kind: 'section_ready';      run_id: string; section: 'counterparty_attribution'; payload: PipelineInspectorCounterpartyAttribution }
  | { kind: 'narrative_token';    run_id: string; token: string }
  | { kind: 'section_ready';      run_id: string; section: 'narrative';                payload: PipelineInspectorNarrative }
  | { kind: 'section_ready';      run_id: string; section: 'citations';                payload: PipelineInspectorCitations }
  | { kind: 'atoms_emitted';      run_id: string; atom_ids: BeliefAtomId[] }
  | { kind: 'run_completed';      run_id: string; emitted_atom_ids: BeliefAtomId[]; recipe_hash_bundle: Record<InspectorSectionId, string> }
  | { kind: 'run_failed';         run_id: string; section?: InspectorSectionId; error: string };

// ─── persisted result ──────────────────────────────────────────────────────

export interface InspectorRunResult {
  run_id: string;
  case_id: CaseId;
  tx_ref: TxRef;
  methodology: 'fifo' | 'lifo' | 'proportional';
  ran_at: string;
  ran_by_id: string;
  cached: boolean;
  header?: PipelineInspectorHeader;
  parties?: PipelineInspectorParties;
  decoded_action?: PipelineInspectorDecodedAction;
  value_fees?: PipelineInspectorValueFees;
  methodology_result?: PipelineInspectorMethodology;
  counterparty_attribution?: PipelineInspectorCounterpartyAttribution;
  narrative?: PipelineInspectorNarrative;
  citations?: PipelineInspectorCitations;
  emitted_atom_ids: BeliefAtomId[];
  recipe_hash_bundle: Partial<Record<InspectorSectionId, string>>;
}
