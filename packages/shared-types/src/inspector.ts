/**
 * Transaction Inspector data shapes (Surface 1).
 *
 * Spec: docs/chainsight_v0_5_addendum_3.md §8.4
 *
 * The Inspector is the platform's primary inspection primitive for
 * TransactionNodes on the canvas. A single click on a tx diamond opens
 * a non-modal popup whose eight sections stream in as agents complete.
 */

import type { BeliefAtomId, CaseId, Tier, UserId } from './index';

// ---------- core IDs ----------

export type TransactionAnalysisId = string & { readonly __brand: 'TransactionAnalysisId' };
export type TransactionNodeRef = string & { readonly __brand: 'TransactionNodeRef' };
export type AddressRef = string; // chain-prefixed: "eth:0x...", "btc:bc1q..."

// ---------- status / streaming ----------

export type AnalysisStatus = 'pending' | 'streaming' | 'complete' | 'partial' | 'failed';

/** Per-section streaming state — each section lands independently. */
export type SectionStatus = 'pending' | 'loading' | 'ready' | 'failed' | 'empty';

export interface SectionMeta {
  status: SectionStatus;
  /** ms since analysis start when this section's data landed. */
  landed_at_ms?: number;
  /** Human-readable error if status === 'failed'. */
  error?: string;
}

// ---------- header strip ----------

export interface InspectorHeader {
  tx_hash: string;
  chain: 'ethereum' | 'bitcoin' | 'solana' | 'polygon' | 'arbitrum' | 'base' | string;
  block_height: number;
  block_timestamp: string; // ISO 8601
  confirmation_depth: number;
  finality: 'unconfirmed' | 'probable' | 'final';
  explorer_url: string; // resolved per agency's installed explorer provider
}

// ---------- Section 1: plain-language summary ----------

export interface PlainLanguageSummary {
  paragraph: string;
  verifier_passed: boolean;
  /** Every claim in the paragraph cites at least one BeliefAtom. */
  belief_atoms_referenced: BeliefAtomId[];
}

// ---------- Section 2: structured facts ----------

export interface KeyValueRow {
  field: string;
  value: string;
  /** If set, value is an address — clicking pivots the canvas. */
  pivot_to_address?: AddressRef;
  /** If set, value is copyable as the full original (not the display truncation). */
  copyable_full?: string;
  /** Inline annotation rendered in muted text after the value. */
  note?: string;
}

// ---------- Section 3: decoded action (discriminated union) ----------

export type DecodedAction =
  | DecodedSwap
  | DecodedBridge
  | DecodedTransfer
  | DecodedContractCall
  | DecodedUtxoSpend
  | DecodedNftOp
  | DecodedMintBurn
  | DecodedApprove
  | DecodedOther;

export interface DecodedSwap {
  kind: 'swap';
  protocol: string; // "Uniswap V3", "Curve", "1inch", etc.
  router_function: string;
  command?: string;
  token_in: TokenAmount;
  token_out: TokenAmount;
  recipient: AddressRef;
  path: SwapHop[];
  effective_rate: string;
  spot_rate_at_block?: string;
  slippage_pct?: number;
  fee_breakdown: FeeBreakdown;
}

export interface SwapHop {
  from_symbol: string;
  to_symbol: string;
  pool_label: string; // "USDT/WETH 0.05% fee pool"
  pool_address: AddressRef;
}

export interface FeeBreakdown {
  lp_fee?: TokenAmount;
  protocol_fee?: TokenAmount;
  gas_fee: TokenAmount;
  gas_fee_fiat?: string;
}

export interface TokenAmount {
  symbol: string;
  amount: string; // human-decimal-formatted
  amount_raw?: string; // bigint stringified, optional
  contract?: AddressRef;
  fiat_value?: string;
}

export interface DecodedBridge {
  kind: 'bridge';
  protocol: string;
  source_chain: string;
  destination_chain: string;
  message_id?: string;
  status: 'pending' | 'attested' | 'finalized' | 'failed';
  token: TokenAmount;
  recipient: AddressRef;
}

export interface DecodedTransfer {
  kind: 'transfer';
  asset: TokenAmount;
  from: AddressRef;
  to: AddressRef;
}

export interface DecodedContractCall {
  kind: 'contract_call';
  contract: AddressRef;
  contract_label?: string;
  function_signature: string;
  decoded_args: Array<{ name: string; type: string; value: string }>;
  value: TokenAmount;
}

export interface DecodedUtxoSpend {
  kind: 'utxo_spend';
  tx_type: string; // "P2WPKH (Native SegWit) spend"
  inputs: UtxoInput[];
  outputs: UtxoOutput[];
  fee: TokenAmount;
  fee_rate_sat_vb: number;
  vbytes: number;
  rbf_enabled: boolean;
  confirmations: number;
}

export interface UtxoInput {
  address: AddressRef;
  amount: TokenAmount;
  source_txid: string;
  source_vout: number;
}

export interface UtxoOutput {
  address: AddressRef;
  amount: TokenAmount;
  classification?: 'main_spend' | 'likely_change' | 'op_return' | 'unknown';
  classification_reason?: string;
}

export interface DecodedNftOp {
  kind: 'nft_op';
  operation: 'transfer' | 'mint' | 'burn' | 'sale' | 'approve';
  collection: string;
  token_id: string;
  from?: AddressRef;
  to?: AddressRef;
  marketplace?: string;
  price?: TokenAmount;
}

export interface DecodedMintBurn {
  kind: 'mint' | 'burn';
  token: TokenAmount;
  authority: AddressRef;
}

export interface DecodedApprove {
  kind: 'approve';
  owner: AddressRef;
  spender: AddressRef;
  token: TokenAmount;
  is_unlimited: boolean;
}

export interface DecodedOther {
  kind: 'other';
  raw_input: string;
  reason: string;
}

// ---------- Section 4: counterparty intelligence ----------

export interface CounterpartyEntry {
  address: AddressRef;
  attribution: string; // "Uniswap Universal Router v1.2" | "Unattributed EOA"
  /** Each provider that contributed to this attribution. */
  sources: AttributionSource[];
  risk: RiskLevel;
  risk_reason?: string;
  /** Disagreement flag when sources contradict. */
  has_provider_disagreement?: boolean;
}

export interface AttributionSource {
  provider: string; // "Chainalysis", "TRM", "Arkham", "Internal"
  label: string;
  confidence: number; // 0..1
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | 'unknown';

// ---------- Section 5: case context ----------

export interface CaseContextEntry {
  /** Free-text statement, e.g. "This transaction is hop 7 of Path A". */
  text: string;
  /** If clicking should pivot the canvas, the target ref. */
  pivot_target?: { kind: 'path' | 'address' | 'tx' | 'memo' | 'wallet'; id: string };
  /** Tier of the underlying claim. */
  tier?: Tier;
  /** Whether the investigator marked this important. */
  is_important_marker?: boolean;
}

// ---------- Section 6: obfuscation findings ----------

export interface ObfuscationFinding {
  id: string;
  detector: string; // "peel_chain" | "low_liquidity_pool" | "mixer_proximity" | ...
  severity: 'info' | 'warning' | 'alert';
  confidence: number; // 0..1
  headline: string;
  detail: string;
  navigate_to?: string;
}

// ---------- Section 7: Critic notes ----------

export interface CriticNote {
  id: string;
  kind: 'challenge' | 'observation' | 'caveat';
  text: string;
  /** Which BeliefAtom or claim the Critic is challenging. */
  target_belief_atom?: BeliefAtomId;
  tier_concern?: Tier;
}

// ---------- Section 8: suggested actions ----------

export type ActionKind =
  | 'mark_important'
  | 'attach_memo'
  | 'add_to_active_path'
  | 'trace_forward'
  | 'trace_backward'
  | 'draft_subpoena'
  | 'add_freeze_opportunity'
  | 'export_pdf_exhibit';

export interface ActionSuggestion {
  kind: ActionKind;
  label: string;
  icon: string; // emoji or icon name
  /** Some actions are conditional (e.g. freeze only if recipient is a deposit address). */
  enabled: boolean;
  disabled_reason?: string;
  /** Optional extra parameters baked in by the AI (e.g. hop count for trace). */
  params?: Record<string, unknown>;
}

// ---------- top-level analysis envelope ----------

export interface TransactionAnalysis {
  id: TransactionAnalysisId;
  case_id: CaseId;
  transaction_node_id: TransactionNodeRef;
  requested_by: UserId;
  requested_at: string;
  completed_at: string | null;
  status: AnalysisStatus;

  header: InspectorHeader;

  // Section payloads (any may be null while still streaming).
  summary: PlainLanguageSummary | null;
  structured_facts: KeyValueRow[] | null;
  decoded_action: DecodedAction | null;
  counterparty_intel: CounterpartyEntry[] | null;
  case_context: CaseContextEntry[] | null;
  obfuscation_findings: ObfuscationFinding[] | null;
  critic_notes: CriticNote[] | null;
  suggested_actions: ActionSuggestion[] | null;

  // Per-section streaming meta.
  sections: {
    summary: SectionMeta;
    structured_facts: SectionMeta;
    decoded_action: SectionMeta;
    counterparty_intel: SectionMeta;
    case_context: SectionMeta;
    obfuscation_findings: SectionMeta;
    critic_notes: SectionMeta;
    suggested_actions: SectionMeta;
  };

  // Provenance (filled as the analysis completes).
  belief_atoms_emitted: BeliefAtomId[];
  content_hash?: string;
  inspection_persisted: boolean;
}

/** Empty analysis envelope used when opening the inspector before any section lands. */
export function createPendingAnalysis(
  args: Pick<
    TransactionAnalysis,
    'id' | 'case_id' | 'transaction_node_id' | 'requested_by' | 'header'
  >,
): TransactionAnalysis {
  const pending: SectionMeta = { status: 'pending' };
  return {
    ...args,
    requested_at: new Date().toISOString(),
    completed_at: null,
    status: 'pending',
    summary: null,
    structured_facts: null,
    decoded_action: null,
    counterparty_intel: null,
    case_context: null,
    obfuscation_findings: null,
    critic_notes: null,
    suggested_actions: null,
    sections: {
      summary: pending,
      structured_facts: pending,
      decoded_action: pending,
      counterparty_intel: pending,
      case_context: pending,
      obfuscation_findings: pending,
      critic_notes: pending,
      suggested_actions: pending,
    },
    belief_atoms_emitted: [],
    inspection_persisted: false,
  };
}
