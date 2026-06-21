/**
 * @chainsight/math-client v0.2.0 — typed HTTP client for the Math Service.
 *
 * Phase-1 Week-2: HTTP/1.1 transport. Spec calls for gRPC; the swap is a
 * Week-3 task. All RPCs already produce recipe_hash so the migration is
 * transport-only.
 */

export type { CallContext, MathClientOptions } from './client';
export { MathClient, canonicalFingerprint } from './client';
export { RecipeLru } from './lru';
export {
  MathClientError,
  asConfidence,
} from './types';
export type {
  ApplyMethodologyRequest, ApplyMethodologyResponse,
  BatchPriceRequest, BatchPriceResponse,
  ComputeConfidenceRequest, ComputeConfidenceResponse,
  ComputeFeeRequest, ComputeFeeResponse,
  ComputeValueAtBlockRequest, ComputeValueAtBlockResponse,
  DecodeActionRequest, DecodeActionResponse,
  Lot, MathErrorBody, MethodologySelection, PriceSnapshot,
} from './types';
