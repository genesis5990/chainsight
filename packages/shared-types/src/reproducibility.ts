/**
 * Reproducibility Pack wire types (v1.0 Backend §1.8).
 *
 * The manifest is the root object inside every pack ZIP. Two builds from
 * the same case state produce byte-identical manifests, which produces
 * byte-identical pack hashes — the determinism contract Phase 1 acceptance
 * tests against.
 *
 * All hashes are lowercase hex SHA-256 unless otherwise noted.
 */

/** Branded ids redeclared locally to avoid circular imports. */
type CaseIdLike = string & { readonly __brand: 'CaseId' };
type BeliefAtomIdLike = string & { readonly __brand: 'BeliefAtomId' };

/* ─── Manifest root ────────────────────────────────────────────────────── */

export const REPRO_PACK_VERSION = 'pack@v1';
export const REPRO_MANIFEST_FILENAME = 'manifest.json';
export const REPRO_REPLAY_SCRIPT_FILENAME = 'replay.sh';

export interface PackManifest {
  /** Schema version pin for the manifest format itself. */
  pack_version: typeof REPRO_PACK_VERSION;
  pack_id: string;
  case_id: CaseIdLike;
  agency_id: string;
  built_by_id: string;
  /** RFC3339 build timestamp — frozen at first build, never updated. */
  built_at: string;
  /** Highest event_seq seen across all atoms (hash-chain tip). */
  chain_tip_seq: number;
  chain_tip_hash: string;
  /** SHA-256 of the canonical-JSON-serialised manifest itself, excluding this field. */
  manifest_hash: string;
  /** Sections, each independently hashed for partial verification. */
  sections: ManifestSections;
  /** Optional Sigstore signature; null until signed. */
  signature: PackSignature | null;
  /** Stats — informational; verifier ignores these. */
  stats: PackStats;
}

export interface PackStats {
  total_atoms: number;
  total_events: number;
  total_traces: number;
  total_math_recipes: number;
  total_provider_responses: number;
}

export interface PackSignature {
  signer_id: string;
  signature: string;
  signed_at: string;
  algorithm: 'sigstore@v1' | 'manual@v1';
}

/* ─── Sections ─────────────────────────────────────────────────────────── */

export interface ManifestSections {
  atoms: ManifestAtomsSection;
  events: ManifestEventsSection;
  math_recipes: ManifestMathRecipesSection;
  provider_responses: ManifestProviderResponsesSection;
  traces: ManifestTracesSection;
  inspector_runs: ManifestInspectorRunsSection;
  agent_calls: ManifestAgentCallsSection;
  rule_versions: ManifestRuleVersionsSection;
  attribution_snapshot: ManifestAttributionSection;
  narrative_transcripts: ManifestNarrativesSection;
  replay_script: ManifestReplayScriptSection;
}

export interface ManifestAtomsSection {
  section_hash: string;
  count: number;
  /** Frozen atom rows. Order: ascending (case_id, event_seq). */
  atoms: FrozenAtom[];
}

export interface FrozenAtom {
  id: BeliefAtomIdLike;
  case_id: CaseIdLike;
  subject_ref: string;
  predicate: string;
  object_payload: Record<string, unknown>;
  basis: 'T0' | 'T1' | 'T2' | 'T3';
  basis_detail: string;
  emitted_at: string;
  emitted_by_id: string;
  emitted_by_kind: string;
  parent_atom_id?: BeliefAtomIdLike;
  event_seq: number;
  payload_hash: string;
  /** SHA-256 of (payload_hash + parent_atom_id.payload_hash || ''). Chain link. */
  chain_link_hash: string;
  status: string;
  reproducibility_inputs?: Record<string, unknown>;
}

export interface ManifestEventsSection {
  section_hash: string;
  count: number;
  events: FrozenEvent[];
}

export interface FrozenEvent {
  event_seq: number;
  event_kind: string;
  atom_id?: BeliefAtomIdLike;
  emitted_at: string;
  emitted_by_id: string;
  delta: Record<string, unknown>;
}

export interface ManifestMathRecipesSection {
  section_hash: string;
  count: number;
  recipes: FrozenMathRecipe[];
}

export interface FrozenMathRecipe {
  /** Unique recipe hash from the math service (BLAKE3 of formula + inputs + version). */
  recipe_hash: string;
  /** Which RPC produced this (e.g. 'ComputeValueAtBlock'). */
  rpc: string;
  /** Pinned input envelope — canonical JSON. */
  inputs: Record<string, unknown>;
  /** Frozen output — what the math service produced. */
  output: Record<string, unknown>;
  algo_version: string;
}

export interface ManifestProviderResponsesSection {
  section_hash: string;
  count: number;
  responses: FrozenProviderResponse[];
}

export interface FrozenProviderResponse {
  /** Hash of (provider, capability, args). */
  request_hash: string;
  provider_id: string;
  capability: string;
  /** Canonical-JSON request args. */
  args: Record<string, unknown>;
  /** Provider's raw response (post-normalization). */
  response: unknown;
  fetched_at: string;
}

export interface ManifestTracesSection {
  section_hash: string;
  count: number;
  traces: FrozenTrace[];
}

export interface FrozenTrace {
  job_id: string;
  case_id: CaseIdLike;
  mode: string;
  origin: string[];
  total_hops: number;
  total_atoms_emitted: number;
  total_budget_spent_usd: number;
  termination_reason: string;
  provider_response_hashes: string[];
  completed_at: string;
}

export interface ManifestInspectorRunsSection {
  section_hash: string;
  count: number;
  runs: FrozenInspectorRun[];
}

export interface FrozenInspectorRun {
  run_id: string;
  case_id: CaseIdLike;
  tx_ref: string;
  methodology: string;
  recipe_hash_bundle: Record<string, string>;
  emitted_atom_ids: BeliefAtomIdLike[];
  ran_at: string;
}

export interface ManifestAgentCallsSection {
  section_hash: string;
  count: number;
  /** Phase-1 sources LLM calls from inspector + tracer. */
  calls: FrozenAgentCall[];
}

export interface FrozenAgentCall {
  /** Hash of (model_id, prompt). */
  input_hash: string;
  model_id: string;
  prompt_hash: string;
  output_hash: string;
  token_count: { input: number; output: number };
  called_at: string;
}

export interface ManifestRuleVersionsSection {
  section_hash: string;
  versions: Record<string, string>;
}

export interface ManifestAttributionSection {
  section_hash: string;
  count: number;
  /** Frozen attribution rows referenced by any atom in the pack. */
  rows: FrozenAttributionRow[];
}

export interface FrozenAttributionRow {
  subject_ref: string;
  source_dataset: string;
  label: string;
  category: string;
  fetched_at: string;
  confidence: number;
}

export interface ManifestNarrativesSection {
  section_hash: string;
  count: number;
  transcripts: FrozenNarrative[];
}

export interface FrozenNarrative {
  context: 'inspector' | 'tracer' | 'report';
  ref_id: string;
  model_id: string;
  /** Final text — LLM outputs are non-deterministic, so pack preserves the output rather than re-running. */
  text: string;
  /** Citations parsed from the text (⟦atom:id⟧ markers). */
  cited_atom_ids: BeliefAtomIdLike[];
  generated_at: string;
}

export interface ManifestReplayScriptSection {
  section_hash: string;
  /** Filename inside the ZIP. */
  filename: typeof REPRO_REPLAY_SCRIPT_FILENAME;
  /** SHA-256 of the script bytes. */
  script_hash: string;
}

/* ─── Verification result ──────────────────────────────────────────────── */

export type PackVerdict = 'pass' | 'fail' | 'warn';

export interface SectionVerdict {
  section: keyof ManifestSections;
  verdict: PackVerdict;
  detail?: string;
  /** Recomputed section hash. */
  recomputed_hash?: string;
  /** Expected section hash from the manifest. */
  expected_hash?: string;
}

export interface VerificationResult {
  pack_id: string;
  /** Overall verdict (pass = every section pass). */
  overall: PackVerdict;
  /** Recomputed manifest hash. */
  recomputed_manifest_hash: string;
  /** Expected hash from the manifest. */
  expected_manifest_hash: string;
  manifest_hash_match: boolean;
  /** Per-section verdicts. */
  sections: SectionVerdict[];
  /** Hash-chain validity for the atoms section. */
  chain_valid: boolean;
  /** Errors (non-empty when overall != 'pass'). */
  errors: string[];
  verified_at: string;
}

/* ─── Build request ────────────────────────────────────────────────────── */

export interface PackBuildRequest {
  case_id: CaseIdLike;
  agency_id: string;
  built_by_id: string;
  /** Optional human-readable label that ends up in the manifest stats. */
  label?: string;
  /** When true, finalize + lock all unlocked atoms in the case. */
  finalize: boolean;
}

export interface PackBuildResult {
  pack_id: string;
  manifest_hash: string;
  storage_ref: string | null;
  atoms_locked: number;
  stats: PackStats;
  built_at: string;
}

/* ─── Storage backend contract ─────────────────────────────────────────── */

export interface PackStorageBackend {
  /** Write the pack zip bytes; returns the storage ref (e.g. `supabase://repro-packs/...`). */
  putPack(input: { agency_id: string; case_id: CaseIdLike; pack_id: string; bytes: Uint8Array }): Promise<string>;
  /** Fetch the pack zip bytes. */
  getPack(storage_ref: string): Promise<Uint8Array>;
  /** Generate a time-limited signed URL for the pack zip (for the API to hand to clients). */
  signedUrl(storage_ref: string, ttl_seconds: number): Promise<string>;
}

/* ─── Service contract ─────────────────────────────────────────────────── */

export interface ReproPackService {
  build(req: PackBuildRequest): Promise<PackBuildResult>;
  status(pack_id: string): Promise<PackStatusRow | null>;
  download(pack_id: string): Promise<{ signed_url: string; ttl_seconds: number } | null>;
  verify(pack_id: string): Promise<VerificationResult>;
  listForCase(case_id: CaseIdLike): Promise<PackStatusRow[]>;
}

export interface PackStatusRow {
  pack_id: string;
  case_id: CaseIdLike;
  status: 'building' | 'finalized' | 'failed';
  manifest_hash: string;
  storage_ref: string | null;
  built_at: string;
  finalized_at: string | null;
  total_atoms: number;
  total_traces: number;
  total_events: number;
  chain_tip_hash: string | null;
  error: string | null;
}

/* ─── BullMQ queue name ─────────────────────────────────────────────────── */

// BullMQ ≥5.x rejects ':' in queue names.
export const REPRO_PACK_BUILD_QUEUE = 'report-build-repro-pack';
