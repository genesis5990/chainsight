/**
 * Belief State Service — canonical v1.1 shapes.
 *
 * Spec: docs/chainsight_v1_1_technical_core_spec.md §3.
 *
 * Coexists with the legacy BeliefAtomLite in `./index.ts` during Phase-1
 * migration. New code MUST use these types.
 */

import type { BeliefAtomId, CaseId } from './index';
import type { SupportingEvidence } from './personal_attribution';

// ---------- subject + edge refs ----------

export type BeliefChainId =
  | 'eth' | 'btc' | 'sol' | 'tron' | 'polygon' | 'arbitrum' | 'base';

// Chain-qualified subject refs. Distinct from inspector.AddressRef which is a
// plain alias used in the Phase-0 mockups; v1.1 callers MUST use these.
export type ChainAddressRef = `${BeliefChainId}:${string}`;
export type TxRef      = `${BeliefChainId}_tx:${string}`;
export type ClusterRef = `cluster:${BeliefChainId}:${string}`;
export type SubjectRef = ChainAddressRef | TxRef | ClusterRef;
export type SubjectKind = 'address' | 'tx' | 'cluster';

// Re-export SupportingEvidence under its canonical name — same shape as
// personal_attribution.SupportingEvidence, kept singular to avoid drift.
export type { SupportingEvidence };

/** Integer minor units of native chain currency, BigInt as decimal string. */
export type IntegerAmount = string;

export interface EdgeRef {
  chain: BeliefChainId;
  tx_hash: string;        // canonical lower-case
  edge_index: number;     // 0-indexed within the tx
}

// ---------- confidence ----------

export interface ConfidenceInputs {
  basis_tier: 'T0' | 'T2' | 'T3';
  provider_corroboration_count: number;
  sanctions_match: boolean;
  obfuscation_penalty: number;   // 0..1
  age_decay: number;             // 0..1
}

export interface Confidence {
  value: number;                 // 0..1
  inputs: ConfidenceInputs;
  recipe_hash: string;           // BLAKE3 fingerprint of (formula_version || inputs)
}

// ---------- predicates ----------

export type AtomPredicate =
  // structural (asserted by chain data)
  | 'tx_exists'
  | 'address_received'
  | 'address_sent'
  | 'contract_called'
  | 'token_transferred'
  | 'block_includes_tx'
  // analytic (asserted by agents or math)
  | 'has_cluster_membership'
  | 'has_attribution'
  | 'has_obfuscation_marker'
  | 'has_taint_share'
  | 'has_confidence_score'
  | 'has_value_at_block'
  // investigator
  | 'investigator_marked'
  | 'investigator_attributed'
  | 'investigator_commented'
  | 'case_opened'
  | 'case_closed'
  | 'ioc_added'
  | 'path_promoted'
  // supervisor (write-restricted)
  | 'supervisor_deconfliction_decision'
  | 'supervisor_review_approved'
  | 'supervisor_review_sent_back'
  // system
  | 'inspector_run_completed'
  | 'provider_error';

export type EmittedByKind = 'human' | 'agent' | 'system';

export type AtomStatus = 'asserted' | 'challenged' | 'superseded' | 'retracted';

// ---------- atom shapes ----------

export interface BeliefAtomInput {
  case_id: CaseId;
  subject_ref: SubjectRef;
  predicate: AtomPredicate;
  object_payload: Record<string, unknown>;
  basis: 'T0' | 'T2' | 'T3';
  basis_detail: string;
  confidence_input?: Partial<ConfidenceInputs>;
  supporting_evidence?: SupportingEvidence[];
  emitted_by_kind: EmittedByKind;
  emitted_by_id: string;
  parent_atom_id?: BeliefAtomId;
  reproducibility_inputs?: Record<string, unknown>;
}

export interface BeliefAtomChallenge {
  id: string;
  atom_id: BeliefAtomId;
  case_id: CaseId;
  reason: string;
  challenged_by: string;
  challenged_at: string;
  resolution?: 'upheld' | 'superseded' | 'withdrawn';
  resolution_note?: string;
  resolved_by?: string;
  resolved_at?: string;
}

export interface BeliefAtomRetraction {
  id: string;
  atom_id: BeliefAtomId;
  case_id: CaseId;
  reason: string;
  retracted_by: string;
  retracted_at: string;
}

export interface BeliefAtom extends BeliefAtomInput {
  id: BeliefAtomId;
  emitted_at: string;
  confidence: Confidence;
  status: AtomStatus;
  superseded_by?: BeliefAtomId;
  superseded_at?: string;
  challenges: BeliefAtomChallenge[];
  payload_hash: string;
  locked_at?: string;
  locked_in_pack_id?: string;
}

// ---------- event log ----------

export type BeliefStateEvent =
  | { kind: 'snapshot_marker';   case_seq: number; case_id: CaseId }
  | { kind: 'atom_emitted';      case_seq: number; atom: BeliefAtom }
  | { kind: 'atom_challenged';   case_seq: number; challenge: BeliefAtomChallenge }
  | { kind: 'atom_resolved';     case_seq: number; challenge: BeliefAtomChallenge }
  | { kind: 'atom_superseded';   case_seq: number; old_atom_id: BeliefAtomId; new_atom: BeliefAtom }
  | { kind: 'atom_retracted';    case_seq: number; retraction: BeliefAtomRetraction }
  | { kind: 'evidence_linked';   case_seq: number; atom_id: BeliefAtomId; evidence: SupportingEvidence };

// ---------- query filters ----------

export interface AtomFilter {
  case_id: CaseId;
  subject_ref?: SubjectRef;
  subject_kind?: SubjectKind;
  predicate?: AtomPredicate | AtomPredicate[];
  status?: AtomStatus | AtomStatus[];
  emitted_by_kind?: EmittedByKind;
  emitted_since?: string;
  limit?: number;       // default 100, max 500
  offset?: number;
}

export interface ChallengeResolutionInput {
  resolution: 'upheld' | 'superseded' | 'withdrawn';
  note: string;
  superseding_atom?: BeliefAtomInput;
}

// ---------- context ----------

export interface AgencyContext {
  user_id: string;
  agency_id: string;
  active_case_id: CaseId | null;
  roles: ('investigator' | 'supervisor' | 'admin')[];
  supervisory_scope_id: string | null;
  available_capabilities: string[];
}

// ---------- service interface ----------

export interface BeliefStateService {
  emit(atom: BeliefAtomInput, ctx: AgencyContext): Promise<BeliefAtom>;
  challenge(atomId: BeliefAtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomChallenge>;
  resolveChallenge(challengeId: string, resolution: ChallengeResolutionInput, ctx: AgencyContext): Promise<BeliefAtomChallenge>;
  supersede(oldAtomId: BeliefAtomId, newAtom: BeliefAtomInput, ctx: AgencyContext): Promise<BeliefAtom>;
  retract(atomId: BeliefAtomId, reason: string, ctx: AgencyContext): Promise<BeliefAtomRetraction>;
  linkEvidence(atomId: BeliefAtomId, evidence: SupportingEvidence, ctx: AgencyContext): Promise<BeliefAtom>;

  getAtom(atomId: BeliefAtomId, ctx: AgencyContext): Promise<BeliefAtom | null>;
  queryAtoms(filter: AtomFilter, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getAtomsBySubject(subjectRef: SubjectRef, caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getAtomsByCase(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtom[]>;
  getOpenChallenges(caseId: CaseId, ctx: AgencyContext): Promise<BeliefAtomChallenge[]>;
  getEventsSince(caseId: CaseId, sinceSeq: number, ctx: AgencyContext): Promise<BeliefStateEvent[]>;

  /** Async iterator of events. Caller is responsible for stopping iteration. */
  subscribe(caseId: CaseId, ctx: AgencyContext): AsyncIterable<BeliefStateEvent>;
}
