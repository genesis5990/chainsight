/**
 * Predicate-specific validation. Each predicate has an object_payload schema
 * the emit() flow MUST validate against — guarantees that downstream consumers
 * (Inspector, Pathfinder, Reproducibility Pack) can rely on shape.
 *
 * Schemas are intentionally loose for v1.1 week 1 — they capture required
 * fields without over-constraining. Tightening lands as agents come online.
 */

import { z } from 'zod';
import type { AtomPredicate } from '@chainsight/shared-types';

// ─── shared schemas ─────────────────────────────────────────────────────────
const IntegerAmount = z.string().regex(/^\d+$/, 'must be a non-negative integer string');
const TxHash        = z.string().regex(/^0x[a-f0-9]{64}$|^[a-f0-9]{64}$/, 'invalid tx hash');
const BlockHeight   = z.number().int().nonnegative();
const FiatAmount    = z.string().regex(/^-?\d+(\.\d+)?$/);

// ─── structural ─────────────────────────────────────────────────────────────
const TxExistsPayload = z.object({
  tx_hash: z.string(),
  block_height: BlockHeight,
  block_hash: z.string(),
  block_time_utc: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
}).passthrough();

const AddressFlowPayload = z.object({
  tx_hash: z.string(),
  counterparty: z.string(),
  value_native_minor: IntegerAmount,
  block_height: BlockHeight,
  edge_index: z.number().int().nonnegative(),
}).passthrough();

const ContractCalledPayload = z.object({
  tx_hash: z.string(),
  contract: z.string(),
  selector: z.string().optional(),
  decoded_action: z.unknown().optional(),
  block_height: BlockHeight,
}).passthrough();

const TokenTransferredPayload = z.object({
  tx_hash: z.string(),
  token_contract: z.string(),
  token_id: z.string().optional(),
  amount_minor: IntegerAmount,
  from: z.string(),
  to: z.string(),
  block_height: BlockHeight,
}).passthrough();

const BlockIncludesTxPayload = z.object({
  block_hash: z.string(),
  block_height: BlockHeight,
  tx_hash: z.string(),
  tx_index: z.number().int().nonnegative(),
}).passthrough();

// ─── analytic ───────────────────────────────────────────────────────────────
const ClusterMembershipPayload = z.object({
  cluster_ref: z.string(),
  heuristic: z.string(),  // 'common_input' | 'change_output' | 'behavioral'
}).passthrough();

const AttributionPayload = z.object({
  attribution_id: z.string().optional(),
  label: z.string(),
  attribution_kind: z.string(),  // 'exchange_deposit' | 'suspect_eoa' | ...
}).passthrough();

const ObfuscationMarkerPayload = z.object({
  kind: z.enum(['mixer', 'peel', 'bridge', 'coin_join', 'cross_chain']),
  detail: z.string(),
}).passthrough();

const TaintSharePayload = z.object({
  methodology: z.enum(['fifo', 'lifo', 'proportional']),
  tainted_minor: IntegerAmount,
  total_minor: IntegerAmount,
  fraction: z.number().min(0).max(1),
}).passthrough();

const ConfidenceScorePayload = z.object({
  target_atom_id: z.string().optional(),
  recipe_hash: z.string(),
  value: z.number().min(0).max(1),
}).passthrough();

const ValueAtBlockPayload = z.object({
  value_native_minor: IntegerAmount,
  value_fiat: FiatAmount,
  fiat_currency: z.string(),
  price_used: FiatAmount,
  price_source: z.string(),
  block_height: BlockHeight,
}).passthrough();

// ─── investigator ───────────────────────────────────────────────────────────
const MarkedPayload = z.object({
  mark_kind: z.string(),
  note: z.string().optional(),
}).passthrough();

const AttributedPayload = z.object({
  attribution_id: z.string(),
  label: z.string(),
}).passthrough();

const CommentedPayload = z.object({
  body: z.string().min(1),
}).passthrough();

const CaseLifecyclePayload = z.object({
  case_code: z.string().optional(),
  reason: z.string().optional(),
}).passthrough();

const IocAddedPayload = z.object({
  ioc_kind: z.string(),
  value: z.string(),
  source: z.string().optional(),
}).passthrough();

const PathPromotedPayload = z.object({
  path_id: z.string(),
  display_name: z.string(),
  status_to: z.literal('under_review').or(z.literal('finalized')),
}).passthrough();

// ─── supervisor (write-restricted) ──────────────────────────────────────────
const SupervisorDeconflictionPayload = z.object({
  alert_id: z.string(),
  decision: z.enum(['separate_investigations', 'joint_task_force', 'one_agency_leads', 'both_close', 'escalate_to_doj']),
  rationale: z.string().min(40),
}).passthrough();

const SupervisorReviewDecisionPayload = z.object({
  checkpoint_id: z.string(),
  rationale: z.string().min(1),
}).passthrough();

// ─── system ─────────────────────────────────────────────────────────────────
const InspectorRunPayload = z.object({
  tx_ref: z.string(),
  methodology: z.string(),
  section_hashes: z.record(z.string(), z.string()),
  emitted_atom_ids: z.array(z.string()),
}).passthrough();

const ProviderErrorPayload = z.object({
  provider: z.string(),
  request_hash: z.string(),
  status: z.union([z.number(), z.string()]),
  detail: z.string().optional(),
}).passthrough();

// ─── registry ───────────────────────────────────────────────────────────────
export const PREDICATE_PAYLOAD_SCHEMAS: Record<AtomPredicate, z.ZodTypeAny> = {
  // structural
  tx_exists:                TxExistsPayload,
  address_received:         AddressFlowPayload,
  address_sent:             AddressFlowPayload,
  contract_called:          ContractCalledPayload,
  token_transferred:        TokenTransferredPayload,
  block_includes_tx:        BlockIncludesTxPayload,
  // analytic
  has_cluster_membership:   ClusterMembershipPayload,
  has_attribution:          AttributionPayload,
  has_obfuscation_marker:   ObfuscationMarkerPayload,
  has_taint_share:          TaintSharePayload,
  has_confidence_score:     ConfidenceScorePayload,
  has_value_at_block:       ValueAtBlockPayload,
  // investigator
  investigator_marked:      MarkedPayload,
  investigator_attributed:  AttributedPayload,
  investigator_commented:   CommentedPayload,
  case_opened:              CaseLifecyclePayload,
  case_closed:              CaseLifecyclePayload,
  ioc_added:                IocAddedPayload,
  path_promoted:            PathPromotedPayload,
  // supervisor
  supervisor_deconfliction_decision: SupervisorDeconflictionPayload,
  supervisor_review_approved:        SupervisorReviewDecisionPayload,
  supervisor_review_sent_back:       SupervisorReviewDecisionPayload,
  // system
  inspector_run_completed:  InspectorRunPayload,
  provider_error:           ProviderErrorPayload,
};

/** Which predicates may be written by `emitted_by_kind = 'human'`? */
export const HUMAN_WRITABLE_PREDICATES = new Set<AtomPredicate>([
  'investigator_marked',
  'investigator_attributed',
  'investigator_commented',
  'case_opened',
  'case_closed',
  'ioc_added',
  'path_promoted',
  'supervisor_deconfliction_decision',
  'supervisor_review_approved',
  'supervisor_review_sent_back',
]);

/** Predicates reserved for `emitted_by_kind = 'system'`. */
export const SYSTEM_ONLY_PREDICATES = new Set<AtomPredicate>([
  'inspector_run_completed',
  'provider_error',
]);

/** Predicates reserved for supervisor role (in addition to write-restrict). */
export const SUPERVISOR_ONLY_PREDICATES = new Set<AtomPredicate>([
  'supervisor_deconfliction_decision',
  'supervisor_review_approved',
  'supervisor_review_sent_back',
]);
