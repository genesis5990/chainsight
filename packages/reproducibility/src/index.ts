/**
 * @chainsight/reproducibility v0.2.0 (Phase-1 Week-7 implementation of
 * v1.0 Backend §1.8).
 *
 * Pillar 2 — every report ships with a frozen snapshot. Two builds from
 * the same case state produce byte-identical pack bytes; the verifier
 * confirms the manifest hash + section hashes + hash chain offline.
 */

export {
  canonicalJson,
  chainLinkHash,
  hashValue,
  sha256Bytes,
  sha256Hex,
} from './canonical';

export {
  PackBuilder,
  type PackBuilderOptions,
  type PackBuildOutput,
} from './builder';

export {
  PackVerifier,
  type PackVerifierOptions,
} from './verifier';

export {
  ReproPackService,
  defaultPackIdProvider,
  type ReproPackServiceOptions,
  type PackManifest,
} from './service';

export type { CaseSource } from './case_source';
export {
  SupabaseCaseSource,
  type SupabaseSourceClient,
} from './supabase_source';

export {
  InMemoryStorageBackend,
  SupabaseStorageBackend,
  type SupabaseStorageClient,
} from './storage';

export {
  SupabasePackRepository,
  type FinalizeInput,
  type InsertBuildingInput,
  type PackRepository,
  type SupabaseRepoClient,
} from './pack_repository';

export {
  renderReplayScript,
  renderOfflineVerifier,
} from './replay_script';

// Phase-0 placeholder kept for backward compat; will be removed in Phase-2.
export const phase0Placeholder = true;
