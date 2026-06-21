/**
 * @chainsight/pathfinder v0.1.0 (Phase-1 Week-5 implementation of v1.1 §6).
 *
 * Multi-hop graph search service that powers PSR's four selection modes
 * (click / lasso / auto / NL) plus Court Mode hop navigation. Library
 * shape — embedded in the API, not its own process.
 */

export { Pathfinder } from './pathfinder';
export type { PathfinderOptions } from './pathfinder';

export {
  CaseGraphStore,
  buildCaseGraph,
  type CaseGraph,
  type GraphStoreOptions,
} from './graph_store';

export {
  SupabaseGraphLoader,
  type GraphLoader,
  type SupabaseGraphClient,
} from './graph_loader';

export {
  shortest,
  kShortest,
  neighbors,
  rankInputsFor,
  type ShortestOptions,
  type KShortestOptions,
  type KShortestOutput,
  type NeighborsOptions,
  type PathSteps,
} from './algorithms';

export {
  computePathId,
  computeRankScore,
  computeRecipeHash,
  summarizePath,
  type PathSummary,
} from './ranking';

export {
  parseHeuristic,
  extractAddresses,
  type NlParseOutput,
  type ExtractedAddress,
} from './nl_parser';

export {
  RedisPathResultCache,
  MemoryPathResultCache,
  type PathResultCache,
} from './result_cache';

export {
  GraphMaterializer,
  SupabaseMaterializerSink,
  buildFromAtom,
  type AtomFeed,
  type MaterializerOptions,
  type MaterializerSink,
  type MaterializedEdge,
  type MaterializedNode,
  type SupabaseMaterializerClient,
} from './materializer';

export {
  SupabaseAtomFeed,
  type SupabaseFeedClient,
} from './supabase_atom_feed';
