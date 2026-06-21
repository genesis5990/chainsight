/**
 * Path ranking (v1.1 §6.6).
 *
 * Lower score is better. Weights are pinned in pathfinder_rank@v1 and
 * included in the recipe_hash so Reproducibility Pack replays produce
 * the same ordering even when weights are tweaked in v2.
 */

import { blake3 } from '@noble/hashes/blake3';
import type {
  GraphEdge,
  PathRankInputs,
  PathfinderRankWeights,
  SubjectRef,
} from '@chainsight/shared-types';
import {
  PATHFINDER_RANK_VERSION,
  PATHFINDER_RANK_WEIGHTS,
} from '@chainsight/shared-types';

export function computeRankScore(inputs: PathRankInputs, weights: PathfinderRankWeights = PATHFINDER_RANK_WEIGHTS): number {
  return (
    inputs.hop_count * weights.hop_weight
    + inputs.obfuscation_penalty * weights.obfuscation_weight
    + inputs.bridge_penalty * weights.bridge_weight
    + (1 - clamp01(inputs.value_carried)) * weights.value_weight
    + clamp01(inputs.age_penalty) * weights.age_weight
  );
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/* ─── Deterministic ids ────────────────────────────────────────────────── */

/**
 * Deterministic path id — BLAKE3 of (case_id || node sequence). Stable
 * across processes for the same path.
 */
export function computePathId(case_id: string, nodes: readonly SubjectRef[]): string {
  const canonical = `${case_id}|${nodes.join('->')}`;
  return Buffer.from(blake3(new TextEncoder().encode(canonical))).toString('hex');
}

/**
 * Recipe hash — covers (algo, rank_version, request inputs). Two calls
 * with identical inputs collide on this key.
 */
export function computeRecipeHash(input: {
  algo: 'shortest' | 'kShortest' | 'through' | 'neighbors';
  case_id: string;
  from?: SubjectRef;
  to?: SubjectRef;
  waypoints?: SubjectRef[];
  max_hops?: number;
  k?: number;
  branching_cap?: number;
  temporal?: boolean;
  methodology?: string;
}): string {
  const envelope = { ...input, rank_version: PATHFINDER_RANK_VERSION };
  return Buffer.from(blake3(new TextEncoder().encode(stableStringify(envelope)))).toString('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/* ─── Path summarization helpers ───────────────────────────────────────── */

export interface PathSummary {
  total_value_minor: string;
  obfuscation_hops: number;
  bridges_crossed: number;
  earliest_block: number;
  latest_block: number;
  earliest_block_time: string;
  latest_block_time: string;
}

export function summarizePath(edges: GraphEdge[]): PathSummary {
  let total = 0n;
  let obfuscation_hops = 0;
  let bridges_crossed = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  let earliestTime = '';
  let latestTime = '';

  for (const e of edges) {
    try { total += BigInt(e.value_minor); } catch { /* malformed minor → 0 */ }
    if (e.obfuscation_marker) obfuscation_hops += 1;
    if (e.bridge_marker) bridges_crossed += 1;
    if (e.block_height < earliest) { earliest = e.block_height; earliestTime = e.block_time; }
    if (e.block_height > latest)   { latest = e.block_height; latestTime = e.block_time; }
  }
  if (earliest === Number.POSITIVE_INFINITY) earliest = 0;
  if (latest   === Number.NEGATIVE_INFINITY) latest   = 0;

  return {
    total_value_minor: total.toString(),
    obfuscation_hops,
    bridges_crossed,
    earliest_block: earliest,
    latest_block: latest,
    earliest_block_time: earliestTime || new Date(0).toISOString(),
    latest_block_time:   latestTime   || new Date(0).toISOString(),
  };
}
