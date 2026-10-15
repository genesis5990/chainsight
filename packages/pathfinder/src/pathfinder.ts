/**
 * Pathfinder service (v1.1 §6).
 *
 * Composes the graph store, loader, algorithms, NL parser and result cache.
 * The service is intentionally library-shaped — it does NOT have its own
 * process; the API embeds it.
 */

import type { CaseStream } from '@chainsight/shared-types';
import type {
  AgencyContext,
  GraphEdge,
  KShortestRequest,
  NeighborsRequest,
  NlIntent,
  NlQueryRequest,
  NlQueryResult,
  PathfinderService,
  PathResult,
  ShortestPathRequest,
  SubjectRef,
  ThroughRequest,
  Neighbor,
} from '@chainsight/shared-types';
import { CaseGraphStore, type CaseGraph } from './graph_store';
import type { GraphLoader } from './graph_loader';
import {
  kShortest as runKShortest,
  neighbors as runNeighbors,
  shortest as runShortest,
  rankInputsFor,
  type PathSteps,
} from './algorithms';
import {
  computePathId,
  computeRankScore,
  computeRecipeHash,
  summarizePath,
} from './ranking';
import { parseHeuristic } from './nl_parser';
import { MemoryPathResultCache, type PathResultCache } from './result_cache';

export interface PathfinderOptions {
  loader: GraphLoader;
  store?: CaseGraphStore;
  resultCache?: PathResultCache;
  /**
   * Stream of `graph-updated` events from the worker's materializer
   * (belief.case_stream). When set, the adjacency cache and result cache
   * for a case are cleared as soon as its graph changes.
   */
  graphUpdates?: CaseStream | null;
  /** Deployment namespace, e.g. 'dev'/'prod'. */
  namespace?: string;
}

export class Pathfinder implements PathfinderService {
  private readonly store: CaseGraphStore;
  private readonly cache: PathResultCache;
  readonly namespace: string;
  private readonly stop = new AbortController();

  constructor(private readonly opts: PathfinderOptions) {
    this.store = opts.store ?? new CaseGraphStore();
    this.cache = opts.resultCache ?? new MemoryPathResultCache();
    this.namespace = opts.namespace ?? 'dev';

    // Wire invalidator (optional).
    if (opts.graphUpdates) {
      const stream = opts.graphUpdates;
      const store = this.store;
      const cache = this.cache;
      const signal = this.stop.signal;
      void (async () => {
        for await (const row of stream.tail({ topics: ['graph-updated'], signal })) {
          const case_id = row.case_id as CaseGraph['case_id'];
          store.invalidate(case_id);
          await cache.invalidateCase?.(case_id);
        }
      })().catch(() => { /* tail() retries internally; only exits on abort */ });
    }
  }

  /** Stop listening for graph updates. */
  close(): void {
    this.stop.abort();
  }

  /* ─── public API ────────────────────────────────────────────────────── */

  async shortest(req: ShortestPathRequest, _ctx: AgencyContext): Promise<PathResult | null> {
    const recipe_hash = computeRecipeHash({
      algo: 'shortest', case_id: req.case_id,
      from: req.from, to: req.to,
      max_hops: req.max_hops, temporal: req.temporal ?? true,
      methodology: req.methodology,
    });
    const cached = await this.cache.get(req.case_id, recipe_hash);
    if (cached) return cached[0] ?? null;

    const graph = await this.loadGraph(req.case_id);
    const steps = await runShortest(graph, req.from, req.to, {
      max_hops: req.max_hops ?? 10,
      temporal: req.temporal ?? true,
    });
    if (!steps) {
      await this.cache.set(req.case_id, recipe_hash, []);
      return null;
    }
    const path = toPathResult(req.case_id, steps, recipe_hash);
    await this.cache.set(req.case_id, recipe_hash, [path]);
    return path;
  }

  async kShortest(req: KShortestRequest, _ctx: AgencyContext): Promise<{ paths: PathResult[]; truncated: boolean }> {
    const recipe_hash = computeRecipeHash({
      algo: 'kShortest', case_id: req.case_id,
      from: req.from, to: req.to,
      k: req.k, max_hops: req.max_hops, branching_cap: req.branching_cap,
      temporal: req.temporal ?? true,
      methodology: req.methodology,
    });
    const cached = await this.cache.get(req.case_id, recipe_hash);
    if (cached) return { paths: cached, truncated: false };

    const graph = await this.loadGraph(req.case_id);
    const result = await runKShortest(graph, req.from, req.to, {
      k: req.k ?? 5,
      max_hops: req.max_hops ?? 20,
      branching_cap: req.branching_cap ?? 50,
      temporal: req.temporal ?? true,
      deadline_ms: req.deadline_ms ?? 30_000,
    });
    const paths = result.paths.map((p) => toPathResult(req.case_id, p, recipe_hash));
    paths.sort((a, b) => a.rank_score - b.rank_score);
    if (!result.truncated) await this.cache.set(req.case_id, recipe_hash, paths);
    return { paths, truncated: result.truncated };
  }

  async through(req: ThroughRequest, _ctx: AgencyContext): Promise<PathResult[]> {
    if (req.waypoints.length < 2) return [];

    const recipe_hash = computeRecipeHash({
      algo: 'through', case_id: req.case_id,
      waypoints: req.waypoints, max_hops: req.max_hops_per_leg,
      temporal: req.temporal ?? true, methodology: req.methodology,
    });
    const cached = await this.cache.get(req.case_id, recipe_hash);
    if (cached) return cached;

    const graph = await this.loadGraph(req.case_id);
    const merged: PathSteps = { nodes: [req.waypoints[0]!], edges: [] };

    for (let i = 0; i < req.waypoints.length - 1; i++) {
      const from = req.waypoints[i]!;
      const to = req.waypoints[i + 1]!;
      const leg = await runShortest(graph, from, to, {
        max_hops: req.max_hops_per_leg ?? 10,
        temporal: req.temporal ?? true,
      });
      if (!leg) return [];
      // Append leg.nodes[1..] and all edges so we don't duplicate the connector node.
      merged.nodes.push(...leg.nodes.slice(1));
      merged.edges.push(...leg.edges);
    }
    const result = [toPathResult(req.case_id, merged, recipe_hash)];
    await this.cache.set(req.case_id, recipe_hash, result);
    return result;
  }

  async neighbors(req: NeighborsRequest, _ctx: AgencyContext): Promise<Neighbor[]> {
    const graph = await this.loadGraph(req.case_id);
    return runNeighbors(graph, req.subject, {
      direction: req.direction ?? 'both',
      limit: Math.min(req.limit ?? 100, 1000),
      edge_kinds: req.edge_kinds,
      min_value_minor: req.min_value_minor,
      since_block: req.since_block,
      until_block: req.until_block,
    });
  }

  async nlQuery(req: NlQueryRequest, ctx: AgencyContext): Promise<NlQueryResult> {
    const parse = parseHeuristic(req.prompt, req.from_hint);
    if (!parse.intent) {
      return {
        parsed_intent: { kind: 'forward_trace', from: req.from_hint ?? ('' as SubjectRef) },
        paths: [],
        unresolved_terms: parse.unresolved_terms,
        parser_confidence: parse.parser_confidence,
      };
    }
    const paths = await this.dispatchIntent(req.case_id, parse.intent, ctx, req.methodology);
    return {
      parsed_intent: parse.intent,
      paths,
      unresolved_terms: parse.unresolved_terms,
      parser_confidence: parse.parser_confidence,
    };
  }

  /* ─── helpers ───────────────────────────────────────────────────────── */

  private async loadGraph(case_id: string): Promise<CaseGraph> {
    const cached = this.store.get(case_id as CaseGraph['case_id']);
    if (cached) return cached;
    const [nodes, edges] = await Promise.all([
      this.opts.loader.loadNodes(case_id as CaseGraph['case_id']),
      this.opts.loader.loadEdges(case_id as CaseGraph['case_id']),
    ]);
    return this.store.ingest(case_id as CaseGraph['case_id'], nodes, edges);
  }

  private async dispatchIntent(
    case_id: string,
    intent: NlIntent,
    ctx: AgencyContext,
    methodology?: KShortestRequest['methodology'],
  ): Promise<PathResult[]> {
    if (intent.kind === 'forward_trace') {
      // Forward trace = neighbors-style enumeration; return up to 5 short paths from `from`
      // to any sink-like node (no further outgoing). Phase-1 keeps it simple: report neighbors
      // as 1-hop paths so the UI has something to render.
      const out = await this.neighbors({ case_id: case_id as KShortestRequest['case_id'], subject: intent.from, direction: 'out', limit: 5 }, ctx);
      return out.map((n) => toPathResult(case_id, { nodes: [intent.from, n.counterparty], edges: [n.edge] }, 'nl:forward_trace'));
    }
    if (intent.kind === 'backward_trace') {
      const inc = await this.neighbors({ case_id: case_id as KShortestRequest['case_id'], subject: intent.to, direction: 'in', limit: 5 }, ctx);
      return inc.map((n) => toPathResult(case_id, { nodes: [n.counterparty, intent.to], edges: [n.edge] }, 'nl:backward_trace'));
    }
    if (intent.kind === 'between') {
      const r = await this.kShortest({
        case_id: case_id as KShortestRequest['case_id'],
        from: intent.from, to: intent.to,
        k: 3, methodology,
      }, ctx);
      return r.paths;
    }
    // cluster_share — out of scope for the heuristic dispatcher; return [].
    return [];
  }
}

/* ─── steps → PathResult ───────────────────────────────────────────────── */

function toPathResult(case_id: string, steps: PathSteps, recipe_hash: string): PathResult {
  const summary = summarizePath(steps.edges);
  const rank_inputs = rankInputsFor(steps.edges);
  const rank_score = computeRankScore(rank_inputs);
  const path_id = computePathId(case_id, steps.nodes);
  const chain = steps.edges[0]?.chain ?? ('evm:1' as GraphEdge['chain']);
  return {
    path_id,
    nodes: steps.nodes,
    edges: steps.edges.map((e) => ({
      chain: e.chain,
      tx_hash: e.tx_ref.includes(':') ? e.tx_ref.split(':').pop() ?? e.tx_ref : e.tx_ref,
      edge_index: e.edge_index,
    })),
    total_value_minor: summary.total_value_minor as PathResult['total_value_minor'],
    total_value_fiat: '0',
    obfuscation_hops: summary.obfuscation_hops,
    bridges_crossed: summary.bridges_crossed,
    earliest_block: { chain, block_height: summary.earliest_block, block_time_utc: summary.earliest_block_time },
    latest_block:   { chain, block_height: summary.latest_block,   block_time_utc: summary.latest_block_time },
    rank_score,
    rank_inputs,
    recipe_hash,
  };
}
