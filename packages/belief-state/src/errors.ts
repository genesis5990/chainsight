/**
 * Typed error envelope. Surface to API layer as v1.1 §2.4 `ApiError`.
 */

export type BeliefErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'invalid_input'
  | 'evidence_immutable'
  | 'idempotency_conflict'
  | 'internal';

export class BeliefError extends Error {
  readonly code: BeliefErrorCode;
  readonly detail?: unknown;
  constructor(code: BeliefErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'BeliefError';
    this.code = code;
    this.detail = detail;
  }
}

export function isBeliefError(e: unknown): e is BeliefError {
  return e instanceof BeliefError;
}
