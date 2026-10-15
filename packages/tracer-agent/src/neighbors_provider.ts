/**
 * Neighbors provider — abstracts how the Tracer fetches hop neighbors.
 *
 * Phase-1: a deterministic fixture provider for the Op Lemon subgraph so
 * demos work without an Etherscan key. The Capability-Router-backed
 * implementation lands in Week 7 once the EtherscanConnector exposes a
 * neighbors capability (only get_tx_by_hash today).
 *
 * Result cache: Redis key `tracer:neighbors:{chain}:{addr}:{dir}:{block_window}`
 * with 5-minute TTL (spec §8.2).
 */

import { createHash } from 'node:crypto';
import type { KvStore } from '@chainsight/shared-types';
import type {
  BeliefChainId,
  GraphEdgeKind,
  IntegerAmount,
  SubjectRef,
  TerminationKind,
  TraceDirection,
  TracerNeighborEdge,
  TracerNeighborsResponse,
} from '@chainsight/shared-types';
import { blake3 } from '@noble/hashes/blake3';

const NEIGHBORS_CACHE_TTL_S = 5 * 60;

export interface NeighborsQuery {
  node: SubjectRef;
  direction: TraceDirection;
  /** Block window — optional; null means whole-chain. */
  block_window?: { from: number; to: number };
}

export interface NeighborsProvider {
  /** Returns the next hop's edges from `node` in `direction`. */
  fetchNeighbors(query: NeighborsQuery, ctx: NeighborsCtx): Promise<TracerNeighborsResponse>;
}

export interface NeighborsCtx {
  case_id: string;
  agency_id: string;
  /** Provider-side trace_id for observability. */
  trace_id?: string;
}

/* ─── Cache wrapper ────────────────────────────────────────────────────── */

export class CachedNeighborsProvider implements NeighborsProvider {
  constructor(
    private readonly inner: NeighborsProvider,
    private readonly redis: KvStore | null,
    private readonly ttl_seconds: number = NEIGHBORS_CACHE_TTL_S,
  ) {}

  async fetchNeighbors(query: NeighborsQuery, ctx: NeighborsCtx): Promise<TracerNeighborsResponse> {
    const key = cacheKey(query);
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw) {
          const cached = JSON.parse(raw) as TracerNeighborsResponse;
          // Cache hits incur zero provider cost.
          return { ...cached, total_cost_usd: 0 };
        }
      } catch { /* fall through */ }
    }
    const result = await this.inner.fetchNeighbors(query, ctx);
    if (this.redis) {
      try {
        await this.redis.set(key, JSON.stringify(result), 'EX', this.ttl_seconds);
      } catch { /* best-effort */ }
    }
    return result;
  }
}

function cacheKey(q: NeighborsQuery): string {
  const window = q.block_window ? `${q.block_window.from}-${q.block_window.to}` : 'all';
  // Derive chain prefix from the subject ref for grouping.
  const chainMatch = q.node.match(/^([a-z]+(?::[0-9a-z-]+)?)_(?:addr|tx|cluster):/i);
  const chain = chainMatch ? chainMatch[1]!.toLowerCase() : 'unknown';
  return `tracer:neighbors:${chain}:${q.node.toLowerCase()}:${q.direction}:${window}`;
}

/* ─── Deterministic stub provider for Phase-1 demos ────────────────────── */

export interface StubNeighborsFixture {
  node: SubjectRef;
  direction: TraceDirection;
  edges: TracerNeighborEdge[];
  node_attribution_kind?: TerminationKind | null;
}

export class StubNeighborsProvider implements NeighborsProvider {
  private readonly index = new Map<string, StubNeighborsFixture>();
  private callCount = 0;

  constructor(fixtures: StubNeighborsFixture[] = []) {
    for (const f of fixtures) this.add(f);
  }

  add(fixture: StubNeighborsFixture): this {
    this.index.set(`${fixture.node.toLowerCase()}:${fixture.direction}`, fixture);
    return this;
  }

  /** Test/observability hook. */
  get calls(): number { return this.callCount; }

  async fetchNeighbors(query: NeighborsQuery, _ctx: NeighborsCtx): Promise<TracerNeighborsResponse> {
    this.callCount += 1;
    const f = this.index.get(`${query.node.toLowerCase()}:${query.direction}`);
    if (!f) {
      return { edges: [], node_attribution_kind: null, total_cost_usd: 0.001 };
    }
    const total_cost = f.edges.reduce((acc, e) => acc + e.cost_usd, 0);
    return {
      edges: f.edges.slice(),
      node_attribution_kind: f.node_attribution_kind ?? null,
      total_cost_usd: total_cost,
    };
  }
}

/* ─── Helpers for fixture authors ──────────────────────────────────────── */

export function mkEdge(input: {
  chain: BeliefChainId;
  tx_hash: string;
  edge_index?: number;
  block_height: number;
  block_hash?: string;
  block_time_utc?: string;
  from: SubjectRef;
  to: SubjectRef;
  value: IntegerAmount;
  edge_kind?: GraphEdgeKind;
  cost_usd?: number;
}): TracerNeighborEdge {
  return {
    chain: input.chain,
    tx_hash: input.tx_hash,
    edge_index: input.edge_index ?? 0,
    block_height: input.block_height,
    // Fixture-only helper: synthesize a stable block hash when none is given.
    block_hash: input.block_hash ?? fixtureBlockHash(input.chain, input.block_height),
    block_time_utc: input.block_time_utc ?? new Date(1_700_000_000_000 + input.block_height * 12_000).toISOString(),
    from_subject: input.from,
    to_subject: input.to,
    value_native_minor: input.value,
    edge_kind: input.edge_kind ?? 'tx_native',
    cost_usd: input.cost_usd ?? 0.002,
  };
}

function fixtureBlockHash(chain: string, height: number): string {
  return '0x' + createHash('sha256').update(`fixture-block:${chain}:${height}`).digest('hex');
}

/** Stable hash of a neighbors response (for provider_response_hashes audit). */
export function hashNeighborsResponse(query: NeighborsQuery, response: TracerNeighborsResponse): string {
  const canonical = JSON.stringify({
    node: query.node, dir: query.direction, window: query.block_window,
    edges: response.edges.map((e) => `${e.tx_hash}:${e.edge_index}`).sort(),
  });
  return Buffer.from(blake3(new TextEncoder().encode(canonical))).toString('hex');
}
