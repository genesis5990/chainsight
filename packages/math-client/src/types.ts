/**
 * Wire-shape types mirroring apps/math/src/chainsight_math/main.py.
 *
 * Spec: docs/chainsight_v1_1_technical_core_spec.md §4.
 */

import type { BeliefChainId, Confidence, IntegerAmount } from '@chainsight/shared-types';

// ─── shared ─────────────────────────────────────────────────────────────────

export interface PriceSnapshot {
  source: string;
  price_usd: string;           // decimal string
  snapshot_time: string;       // ISO 8601 UTC
  provider_request_id: string;
}

// ─── /v1/compute_value_at_block ────────────────────────────────────────────

export interface ComputeValueAtBlockRequest {
  chain: BeliefChainId;
  amount_minor: IntegerAmount;
  block_height: number;
  fiat?: string;               // default "USD"
  price_hint?: PriceSnapshot;
}

export interface ComputeValueAtBlockResponse {
  value_native_minor: IntegerAmount;
  value_native_major: string;
  value_fiat: string;
  fiat_currency: string;
  price_used: string;
  price_source: string;
  snapshot_time: string;
  provider_request_id: string;
  recipe_hash: string;
}

// ─── /v1/compute_fee_in_fiat ───────────────────────────────────────────────

export interface ComputeFeeRequest {
  chain: BeliefChainId;
  block_height: number;
  gas_used?: number;
  gas_price_minor?: IntegerAmount;
  fee_native_minor?: IntegerAmount;
  fiat?: string;
  price_hint?: PriceSnapshot;
}

export interface ComputeFeeResponse {
  fee_native_minor: IntegerAmount;
  fee_native_major: string;
  fee_fiat: string;
  fiat_currency: string;
  recipe_hash: string;
}

// ─── /v1/batch_price_lookup ─────────────────────────────────────────────────

export interface BatchPriceRequest {
  chains: BeliefChainId[];
}

export interface BatchPriceResponse {
  snapshots: Record<string, PriceSnapshot>;
}

// ─── /v1/apply_{fifo,lifo,proportional}_to_hop ─────────────────────────────

export interface Lot {
  lot_id: string;
  acquired_minor: IntegerAmount;
  acquired_at_block: number;
  source_tx_hash: string;
  taint_fraction?: string;     // default "0"
}

export interface ApplyMethodologyRequest {
  chain: BeliefChainId;
  subject_address: string;
  block_height_at: number;
  existing_lots: Lot[];
  incoming_lots?: Lot[];
  outflow_minor: IntegerAmount;
}

export interface MethodologySelection {
  lot_id: string;
  amount_consumed_minor: IntegerAmount;
  taint_contributed_minor: IntegerAmount;
}

export interface ApplyMethodologyResponse {
  selections: MethodologySelection[];
  total_attributed_minor: IntegerAmount;
  total_taint_minor: IntegerAmount;
  remaining_outflow_minor: IntegerAmount;
  recipe_hash: string;
}

// ─── /v1/compute_confidence ────────────────────────────────────────────────

export interface ComputeConfidenceRequest {
  basis_tier: 'T0' | 'T2' | 'T3';
  provider_corroboration_count?: number;
  sanctions_match?: boolean;
  obfuscation_penalty?: number;
  age_decay?: number;
}

export interface ComputeConfidenceResponse {
  value: number;
  inputs: Required<ComputeConfidenceRequest>;
  recipe_hash: string;
}

// Convenience: convert ComputeConfidenceResponse to the canonical Confidence
// shape that BeliefAtom stores.
export function asConfidence(r: ComputeConfidenceResponse): Confidence {
  return {
    value: r.value,
    inputs: {
      basis_tier: r.inputs.basis_tier,
      provider_corroboration_count: r.inputs.provider_corroboration_count,
      sanctions_match: r.inputs.sanctions_match,
      obfuscation_penalty: r.inputs.obfuscation_penalty,
      age_decay: r.inputs.age_decay,
    },
    recipe_hash: r.recipe_hash,
  };
}

// ─── /v1/decode_action ─────────────────────────────────────────────────────

export interface DecodeActionRequest {
  chain: BeliefChainId;
  tx_hash: string;
  selector?: string;
  contract?: string;
  raw_input?: string;
}

export interface DecodeActionResponse {
  chain: BeliefChainId;
  tx_hash: string;
  selector: string | null;
  signature: string | null;
  action_kind: string;
  confidence: 'structured' | 'heuristic' | 'unknown';
  decoded: Record<string, unknown>;
  recipe_hash: string;
}

// ─── errors ─────────────────────────────────────────────────────────────────

export interface MathErrorBody {
  code: string;
  message: string;
}

export class MathClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly trace_id?: string;
  constructor(message: string, status: number, code: string, trace_id?: string) {
    super(message);
    this.name = 'MathClientError';
    this.code = code;
    this.status = status;
    this.trace_id = trace_id;
  }
}
