/**
 * RouterNeighborsProvider — Capability-Router-backed NeighborsProvider.
 *
 * Phase-2 swap target: replaces StubNeighborsProvider once the agency has an
 * Etherscan (or other 'get_address_neighbors'-capable) install configured.
 * The CachedNeighborsProvider wraps this so Redis caches by canonical key
 * before any router resolve() is attempted.
 *
 * Flow per fetch:
 *   1. Build CapabilityRouter args { chain, address, direction, block_window }
 *   2. router.resolve('get_address_neighbors', args, ctx) — router handles
 *      provider install lookup, credential resolution, retries, breaker, cache.
 *   3. Map normalized provider payload → TracerNeighborsResponse.
 *
 * Soft-degrade: any router error (no install, no credential, breaker open,
 * upstream 5xx) returns an empty neighbors response so the tracer can
 * gracefully terminate the branch instead of crashing the worker.
 */

import type {
  AgencyContext,
  GraphEdgeKind,
  IntegerAmount,
  SubjectRef,
  TerminationKind,
  TraceDirection,
  TracerNeighborEdge,
  TracerNeighborsResponse,
} from '@chainsight/shared-types';

import type { NeighborsCtx, NeighborsProvider, NeighborsQuery } from './neighbors_provider';

/* ─── Router contract (structural — keeps this package decoupled) ──────── */

export interface RouterLike {
  resolve<TPayload>(
    capability: string,
    args: Record<string, unknown>,
    ctx: AgencyContext,
    options?: { deadline_ms?: number; bypass_cache?: boolean },
  ): Promise<{ data: TPayload; cache_hit: boolean }>;
}

/* ─── Provider payload shape (matches EtherscanNeighborsResponse) ──────── */

interface NeighborsProviderEdge {
  chain: string;
  tx_hash: string;
  edge_index: number;
  block_height: number;
  block_hash?: string;
  block_time_utc: string;
  from_subject: string;
  to_subject: string;
  value_native_minor: string;
  edge_kind: GraphEdgeKind;
  cost_usd: number;
}

interface NeighborsProviderPayload {
  chain: string;
  address: string;
  direction: 'inflow' | 'outflow' | 'both';
  edges: NeighborsProviderEdge[];
  total_cost_usd: number;
  node_attribution_kind: string | null;
}

export interface RouterNeighborsProviderOptions {
  router: RouterLike;
  /** Build an AgencyContext from the per-job NeighborsCtx. Worker provides this. */
  contextFor: (ctx: NeighborsCtx) => AgencyContext;
  /** Optional deadline override per call. */
  deadline_ms?: number;
  /** Optional logger (worker passes a pino instance). */
  log?: { error: (obj: Record<string, unknown>, msg: string) => void };
}

export class RouterNeighborsProvider implements NeighborsProvider {
  constructor(private readonly opts: RouterNeighborsProviderOptions) {}

  async fetchNeighbors(query: NeighborsQuery, ctx: NeighborsCtx): Promise<TracerNeighborsResponse> {
    const parsed = parseSubject(query.node);
    if (!parsed) {
      return { edges: [], node_attribution_kind: null, total_cost_usd: 0 };
    }
    const args: Record<string, unknown> = {
      chain: parsed.chain,
      address: parsed.address,
      direction: query.direction,
    };
    if (query.block_window) args.block_window = query.block_window;

    try {
      const result = await this.opts.router.resolve<NeighborsProviderPayload>(
        'get_address_neighbors',
        args,
        this.opts.contextFor(ctx),
        { deadline_ms: this.opts.deadline_ms ?? 8_000 },
      );
      return mapPayload(result.data);
    } catch (err) {
      this.opts.log?.error(
        {
          err: (err as Error)?.message ?? String(err),
          case_id: ctx.case_id,
          node: query.node,
          direction: query.direction,
        },
        'router neighbors resolve failed — branch terminates empty',
      );
      return { edges: [], node_attribution_kind: null, total_cost_usd: 0 };
    }
  }
}

/* ─── helpers ──────────────────────────────────────────────────────────── */

function parseSubject(ref: SubjectRef): { chain: string; address: string } | null {
  // Expected shape: 'evm:1_addr:0xabc...' or 'btc_addr:bc1...'
  const m = ref.match(/^([a-z0-9:]+)_addr:(.+)$/i);
  if (!m) return null;
  return { chain: m[1]!, address: m[2]!.toLowerCase() };
}

function mapPayload(payload: NeighborsProviderPayload): TracerNeighborsResponse {
  const edges: TracerNeighborEdge[] = (payload.edges ?? []).map((e) => ({
    chain: e.chain as TracerNeighborEdge['chain'],
    tx_hash: e.tx_hash,
    edge_index: e.edge_index,
    block_height: e.block_height,
    ...(e.block_hash ? { block_hash: e.block_hash } : {}),
    block_time_utc: e.block_time_utc,
    from_subject: e.from_subject as SubjectRef,
    to_subject: e.to_subject as SubjectRef,
    value_native_minor: e.value_native_minor as IntegerAmount,
    edge_kind: e.edge_kind,
    cost_usd: e.cost_usd,
  }));
  const node_attribution_kind = (payload.node_attribution_kind ?? null) as TerminationKind | null;
  void (null as TraceDirection | null); // type-only reference to keep import alive
  return {
    edges,
    node_attribution_kind,
    total_cost_usd: payload.total_cost_usd ?? edges.reduce((a, b) => a + b.cost_usd, 0),
  };
}
