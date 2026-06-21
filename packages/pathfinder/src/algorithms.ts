/**
 * Pathfinder graph algorithms (v1.1 §6.5).
 *
 *   shortest    — temporal BFS; first path found from `from` to `to`.
 *   kShortest   — Yen's algorithm; up to K paths ranked by rank_score.
 *   through     — iterated shortest between consecutive waypoints.
 *   neighbors   — direct adjacency lookup with filters.
 *
 * All long-running loops yield to the event loop every YIELD_EVERY
 * expansions via setImmediate so a single expensive call cannot block
 * other requests in the API process.
 */

import type {
  GraphEdge,
  GraphEdgeKind,
  IntegerAmount,
  Neighbor,
  PathRankInputs,
  SubjectRef,
} from '@chainsight/shared-types';
import type { CaseGraph } from './graph_store';
import { computeRankScore } from './ranking';

const YIELD_EVERY = 1000;

export interface PathSteps {
  /** Node sequence (length = edges.length + 1). */
  nodes: SubjectRef[];
  edges: GraphEdge[];
}

export interface ShortestOptions {
  max_hops: number;
  temporal: boolean;
  /** Optional: stop if traversal exceeds this many expansions. */
  expansion_cap?: number;
}

/* ─── shortest (temporal BFS) ──────────────────────────────────────────── */

export async function shortest(
  graph: CaseGraph,
  from: SubjectRef,
  to: SubjectRef,
  opts: ShortestOptions,
): Promise<PathSteps | null> {
  if (from === to) return { nodes: [from], edges: [] };

  type Frame = { node: SubjectRef; path: SubjectRef[]; edges: GraphEdge[]; max_block: number };
  const queue: Frame[] = [{ node: from, path: [from], edges: [], max_block: 0 }];
  const visited = new Set<string>([visitKey(from, 0)]);
  let expansions = 0;
  const cap = opts.expansion_cap ?? Number.POSITIVE_INFINITY;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.edges.length >= opts.max_hops) continue;

    const out = graph.outgoing.get(cur.node) ?? [];
    for (const e of out) {
      if (opts.temporal && e.block_height < cur.max_block) continue;

      // Yen avoidance handled by the caller via removed-edge sets; pure BFS
      // visits each (node, hop_count) at most once.
      const nextKey = visitKey(e.to_subject, cur.edges.length + 1);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);

      const nextEdges = [...cur.edges, e];
      const nextPath = [...cur.path, e.to_subject];
      if (e.to_subject === to) return { nodes: nextPath, edges: nextEdges };

      queue.push({
        node: e.to_subject,
        path: nextPath,
        edges: nextEdges,
        max_block: Math.max(cur.max_block, e.block_height),
      });

      expansions += 1;
      if (expansions >= cap) return null;
      if (expansions % YIELD_EVERY === 0) await yieldToLoop();
    }
  }
  return null;
}

function visitKey(node: SubjectRef, hop: number): string {
  return `${node}@${hop}`;
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/* ─── kShortest (Yen's algorithm) ──────────────────────────────────────── */

export interface KShortestOptions {
  k: number;
  max_hops: number;
  branching_cap: number;
  temporal: boolean;
  deadline_ms: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

export interface KShortestOutput {
  paths: PathSteps[];
  truncated: boolean;
}

export async function kShortest(
  graph: CaseGraph,
  from: SubjectRef,
  to: SubjectRef,
  opts: KShortestOptions,
): Promise<KShortestOutput> {
  const now = opts.now ?? (() => Date.now());
  const startMs = now();

  const first = await shortest(graph, from, to, { max_hops: opts.max_hops, temporal: opts.temporal });
  if (!first) return { paths: [], truncated: false };

  const accepted: PathSteps[] = [first];
  // Candidates ranked by (rank_score, lexicographic edge ids) for determinism.
  const candidates: Array<{ path: PathSteps; score: number; tieBreaker: string }> = [];

  for (let kIdx = 1; kIdx < opts.k; kIdx++) {
    const prev = accepted[accepted.length - 1]!;

    let spurCount = 0;
    for (let i = 0; i < prev.nodes.length - 1; i++) {
      const spurNode = prev.nodes[i]!;
      const rootPathNodes = prev.nodes.slice(0, i + 1);
      const rootPathEdges = prev.edges.slice(0, i);

      // Edges we must remove on this spur attempt: any edge that, starting
      // from `spurNode`, would replay an existing root path in `accepted`.
      const removedEdges = new Set<string>();
      for (const a of accepted) {
        if (sameSequence(a.nodes.slice(0, i + 1), rootPathNodes) && a.edges.length > i) {
          const e = a.edges[i]!;
          removedEdges.add(`${e.tx_ref}:${e.edge_index}`);
        }
      }

      const spur = await shortestWithRemovedEdges(graph, spurNode, to, {
        max_hops: opts.max_hops - i,
        temporal: opts.temporal,
        removed_edges: removedEdges,
        expansion_cap: opts.branching_cap * 20,
      });
      if (!spur) continue;

      const fullNodes = [...rootPathNodes, ...spur.nodes.slice(1)];
      const fullEdges = [...rootPathEdges, ...spur.edges];

      // Skip if duplicate
      const candidateKey = fullEdges.map((e) => `${e.tx_ref}:${e.edge_index}`).join(',');
      const dup = accepted.some((a) => a.edges.map((e) => `${e.tx_ref}:${e.edge_index}`).join(',') === candidateKey)
               || candidates.some((c) => c.tieBreaker === candidateKey);
      if (dup) continue;

      const rankInputs = inputsFor(fullEdges);
      const score = computeRankScore(rankInputs);
      candidates.push({ path: { nodes: fullNodes, edges: fullEdges }, score, tieBreaker: candidateKey });

      spurCount += 1;
      if (spurCount >= opts.branching_cap) break;
      if (now() - startMs >= opts.deadline_ms) {
        return { paths: accepted, truncated: true };
      }
      if (spurCount % YIELD_EVERY === 0) await yieldToLoop();
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => (a.score - b.score) || a.tieBreaker.localeCompare(b.tieBreaker));
    const best = candidates.shift()!;
    accepted.push(best.path);

    if (now() - startMs >= opts.deadline_ms) return { paths: accepted, truncated: true };
  }

  return { paths: accepted, truncated: false };
}

function sameSequence(a: SubjectRef[], b: SubjectRef[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function shortestWithRemovedEdges(
  graph: CaseGraph,
  from: SubjectRef,
  to: SubjectRef,
  opts: ShortestOptions & { removed_edges: Set<string> },
): Promise<PathSteps | null> {
  if (from === to) return { nodes: [from], edges: [] };
  type Frame = { node: SubjectRef; path: SubjectRef[]; edges: GraphEdge[]; max_block: number };
  const queue: Frame[] = [{ node: from, path: [from], edges: [], max_block: 0 }];
  const visited = new Set<string>([visitKey(from, 0)]);
  let expansions = 0;
  const cap = opts.expansion_cap ?? Number.POSITIVE_INFINITY;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.edges.length >= opts.max_hops) continue;
    const out = graph.outgoing.get(cur.node) ?? [];
    for (const e of out) {
      const edgeKey = `${e.tx_ref}:${e.edge_index}`;
      if (opts.removed_edges.has(edgeKey)) continue;
      if (opts.temporal && e.block_height < cur.max_block) continue;
      const nextKey = visitKey(e.to_subject, cur.edges.length + 1);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      const nextEdges = [...cur.edges, e];
      const nextPath = [...cur.path, e.to_subject];
      if (e.to_subject === to) return { nodes: nextPath, edges: nextEdges };
      queue.push({ node: e.to_subject, path: nextPath, edges: nextEdges, max_block: Math.max(cur.max_block, e.block_height) });
      expansions += 1;
      if (expansions >= cap) return null;
      if (expansions % YIELD_EVERY === 0) await yieldToLoop();
    }
  }
  return null;
}

function inputsFor(edges: GraphEdge[]): PathRankInputs {
  const hop_count = edges.length;
  const obfuscation_penalty = edges.filter((e) => e.obfuscation_marker).length;
  const bridge_penalty = edges.filter((e) => e.bridge_marker).length;
  // Normalize value: log-scale so a 100 ETH path doesn't dominate a 0.01 BTC path
  // by raw minor units. We treat anything >= 10^21 minor (~1000 ETH) as full value.
  let totalMinor = 0n;
  for (const e of edges) { try { totalMinor += BigInt(e.value_minor); } catch { /* */ } }
  const valueLog = totalMinor > 0n ? Math.log10(Number(totalMinor)) : 0;
  const value_carried = Math.min(1, Math.max(0, valueLog / 21));
  // Age penalty: stub for Phase 1 — leave 0. Tx age requires a fresh block context.
  return { hop_count, value_carried, obfuscation_penalty, bridge_penalty, age_penalty: 0 };
}

export function rankInputsFor(edges: GraphEdge[]): PathRankInputs {
  return inputsFor(edges);
}

/* ─── neighbors ────────────────────────────────────────────────────────── */

export interface NeighborsOptions {
  direction: 'in' | 'out' | 'both';
  limit: number;
  edge_kinds?: GraphEdgeKind[];
  min_value_minor?: IntegerAmount;
  since_block?: number;
  until_block?: number;
}

export function neighbors(graph: CaseGraph, subject: SubjectRef, opts: NeighborsOptions): Neighbor[] {
  const out: Neighbor[] = [];

  const consider = (edge: GraphEdge, direction: 'in' | 'out', counterparty: SubjectRef) => {
    if (out.length >= opts.limit) return;
    if (opts.edge_kinds && opts.edge_kinds.length > 0 && !opts.edge_kinds.includes(edge.edge_kind)) return;
    if (opts.since_block !== undefined && edge.block_height < opts.since_block) return;
    if (opts.until_block !== undefined && edge.block_height > opts.until_block) return;
    if (opts.min_value_minor !== undefined) {
      try {
        if (BigInt(edge.value_minor) < BigInt(opts.min_value_minor)) return;
      } catch { /* */ }
    }
    out.push({ edge, direction, counterparty });
  };

  if (opts.direction === 'out' || opts.direction === 'both') {
    for (const e of graph.outgoing.get(subject) ?? []) {
      consider(e, 'out', e.to_subject);
      if (out.length >= opts.limit) break;
    }
  }
  if (opts.direction === 'in' || opts.direction === 'both') {
    for (const e of graph.incoming.get(subject) ?? []) {
      if (out.length >= opts.limit) break;
      consider(e, 'in', e.from_subject);
    }
  }
  return out;
}
