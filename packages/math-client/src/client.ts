/**
 * Typed HTTP client for the ChainSight Math Service.
 *
 * Spec: docs/chainsight_v1_1_technical_core_spec.md §4.6.
 *
 * Phase-1 Week-2 transport is HTTP/1.1 JSON over fetch. The contract is
 * recipe_hash-based, so a Week-3 gRPC swap is a transport replacement only.
 *
 * Conventions:
 *   * Every RPC takes a CallContext with trace metadata + optional deadline.
 *   * Default deadline is 2 s per spec §4.6.
 *   * Responses are cached per-process in an LRU keyed on recipe_hash for
 *     methods whose response carries one (i.e. all of them).
 */

import { RecipeLru } from './lru';
import type {
  ApplyMethodologyRequest, ApplyMethodologyResponse,
  BatchPriceRequest, BatchPriceResponse,
  ComputeConfidenceRequest, ComputeConfidenceResponse,
  ComputeFeeRequest, ComputeFeeResponse,
  ComputeValueAtBlockRequest, ComputeValueAtBlockResponse,
  DecodeActionRequest, DecodeActionResponse,
  MathErrorBody,
} from './types';
import { MathClientError } from './types';

export interface CallContext {
  trace_id?: string;
  actor_id?: string;
  agency_id?: string;
  /** Per-call deadline in milliseconds. Default 2000. */
  deadline_ms?: number;
}

export interface MathClientOptions {
  /** Base URL of the Math Service. e.g. https://chainsight-math-dev.fly.dev */
  baseUrl: string;
  /** Default deadline for any call that doesn't specify one. */
  defaultDeadlineMs?: number;
  /** Override fetch (test harness). */
  fetchImpl?: typeof fetch;
  /** LRU capacity. Default 10_000. */
  cacheCapacity?: number;
  /**
   * Deadline for the single retry after a timeout or connection failure.
   * The Math Service scales to zero on Fly; the first request after idle
   * waits for the machine to boot, which takes longer than the 2 s budget.
   * Math RPCs are pure and idempotent, so one longer retry is safe.
   * Default 15_000. Set 0 to disable the retry.
   */
  coldStartRetryMs?: number;
}

interface CachedEntry<R> {
  request_fingerprint: string;
  response: R;
}

export class MathClient {
  private readonly baseUrl: string;
  private readonly defaultDeadlineMs: number;
  private readonly coldStartRetryMs: number;
  private readonly fetchImpl: typeof fetch;

  // One LRU per RPC keeps fingerprint collisions impossible across method
  // families (extra defense even though recipe_hash is already domain-separated).
  private readonly cacheByRpc: Map<string, RecipeLru<CachedEntry<unknown>>>;

  constructor(opts: MathClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.defaultDeadlineMs = opts.defaultDeadlineMs ?? 2_000;
    this.coldStartRetryMs = opts.coldStartRetryMs ?? 15_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cacheByRpc = new Map();
    const capacity = opts.cacheCapacity ?? 10_000;
    for (const rpc of [
      'compute_value_at_block',
      'compute_fee_in_fiat',
      'batch_price_lookup',
      'apply_fifo_to_hop',
      'apply_lifo_to_hop',
      'apply_proportional_to_hop',
      'compute_confidence',
      'decode_action',
    ]) {
      this.cacheByRpc.set(rpc, new RecipeLru(capacity));
    }
  }

  // ───── public RPCs ────────────────────────────────────────────────────

  computeValueAtBlock(req: ComputeValueAtBlockRequest, ctx?: CallContext): Promise<ComputeValueAtBlockResponse> {
    return this.post('compute_value_at_block', req, ctx);
  }

  computeFeeInFiat(req: ComputeFeeRequest, ctx?: CallContext): Promise<ComputeFeeResponse> {
    return this.post('compute_fee_in_fiat', req, ctx);
  }

  batchPriceLookup(req: BatchPriceRequest, ctx?: CallContext): Promise<BatchPriceResponse> {
    // batch_price_lookup currently does not return a recipe_hash; cache is bypassed.
    return this.post('batch_price_lookup', req, ctx, /*useCache*/ false);
  }

  applyFifoToHop(req: ApplyMethodologyRequest, ctx?: CallContext): Promise<ApplyMethodologyResponse> {
    return this.post('apply_fifo_to_hop', req, ctx);
  }

  applyLifoToHop(req: ApplyMethodologyRequest, ctx?: CallContext): Promise<ApplyMethodologyResponse> {
    return this.post('apply_lifo_to_hop', req, ctx);
  }

  applyProportionalToHop(req: ApplyMethodologyRequest, ctx?: CallContext): Promise<ApplyMethodologyResponse> {
    return this.post('apply_proportional_to_hop', req, ctx);
  }

  computeConfidence(req: ComputeConfidenceRequest, ctx?: CallContext): Promise<ComputeConfidenceResponse> {
    return this.post('compute_confidence', req, ctx);
  }

  decodeAction(req: DecodeActionRequest, ctx?: CallContext): Promise<DecodeActionResponse> {
    return this.post('decode_action', req, ctx);
  }

  // ───── infra ──────────────────────────────────────────────────────────

  private async post<R>(rpc: string, body: unknown, ctx?: CallContext, useCache = true): Promise<R> {
    const fingerprint = useCache ? canonicalFingerprint(body) : null;
    const cache = useCache ? this.cacheByRpc.get(rpc) : undefined;
    if (cache && fingerprint) {
      const hit = cache.get(fingerprint);
      if (hit && hit.request_fingerprint === fingerprint) {
        return hit.response as R;
      }
    }

    const deadline = ctx?.deadline_ms ?? this.defaultDeadlineMs;
    let res: Response;
    try {
      res = await this.attempt(rpc, body, ctx, deadline);
    } catch (first) {
      // Timeout or connection failure: most often the Math Service waking
      // from scale-to-zero. Retry once with a longer deadline.
      if (!(first instanceof MathClientError) || first.code !== 'provider_unavailable' || this.coldStartRetryMs <= 0) {
        throw first;
      }
      res = await this.attempt(rpc, body, ctx, Math.max(this.coldStartRetryMs, deadline));
    }

    if (!res.ok) {
      let err: MathErrorBody = { code: 'internal', message: `HTTP ${res.status}` };
      try { err = (await res.json()) as MathErrorBody; } catch { /* keep default */ }
      throw new MathClientError(err.message, res.status, err.code, res.headers.get('x-trace-id') ?? undefined);
    }

    const parsed = (await res.json()) as R;
    if (cache && fingerprint) {
      cache.set(fingerprint, { request_fingerprint: fingerprint, response: parsed });
    }
    return parsed;
  }

  /** One HTTP attempt with its own deadline. Throws MathClientError('provider_unavailable') on timeout or network failure. */
  private async attempt(rpc: string, body: unknown, ctx: CallContext | undefined, deadline: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadline);
    try {
      return await this.fetchImpl(`${this.baseUrl}/v1/${rpc}`, {
        method: 'POST',
        body: JSON.stringify(body),
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-trace-id': ctx?.trace_id ?? '',
          'x-actor-id': ctx?.actor_id ?? '',
          'x-agency-id': ctx?.agency_id ?? '',
        },
      });
    } catch (e) {
      const msg = (e instanceof Error && e.name === 'AbortError')
        ? `math.${rpc} deadline exceeded (${deadline}ms)`
        : `math.${rpc} fetch failed`;
      throw new MathClientError(msg, 0, 'provider_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  /** For metrics + tests. */
  cacheStats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.cacheByRpc.entries()) out[k] = v.size;
    return out;
  }
}

// ─── canonical fingerprint helper ───────────────────────────────────────────

/**
 * Canonical JSON fingerprint of the request payload. We use it as a request
 * fingerprint (not the recipe_hash, which we don't know until after the call).
 * Keys sorted, undefined dropped. Same shape as the Python canonical JSON.
 */
export function canonicalFingerprint(value: unknown): string {
  return stringify(value);
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('non-finite numbers not allowed');
    return String(v);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stringify).join(',') + ']';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return '{' + keys.map((k) => `${JSON.stringify(k)}:${stringify(obj[k])}`).join(',') + '}';
  }
  throw new TypeError(`unsupported type: ${typeof v}`);
}
