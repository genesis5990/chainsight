/**
 * Canonical payload hashing for BeliefAtoms.
 *
 * The payload_hash is BLAKE3 over a deterministic canonical JSON
 * serialization of the atom's content fields. Two atoms with identical
 * content (regardless of insertion order of object keys) must produce
 * identical hashes — this powers the Reproducibility Pack replay contract.
 */

import { blake3 } from '@noble/hashes/blake3';
import type { BeliefAtomInput } from '@chainsight/shared-types';

/**
 * Stable JSON stringify: sorts keys at every level. Arrays preserve order
 * (semantic). Numbers are emitted via `Number.prototype.toString` (no
 * locale-dependent formatting). Null is preserved.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJsonStringify(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    if (obj[k] === undefined) continue;
    parts.push(JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Compute the canonical payload hash for a BeliefAtom.
 *
 * The hash covers only the fields that define *what is claimed* — never the
 * server-assigned id, emitted_at, status, or any mutable lifecycle column.
 */
export function computePayloadHash(input: BeliefAtomInput): Buffer {
  const canon = {
    case_id: input.case_id,
    subject_ref: input.subject_ref,
    predicate: input.predicate,
    object_payload: input.object_payload,
    basis: input.basis,
    basis_detail: input.basis_detail,
    emitted_by_kind: input.emitted_by_kind,
    emitted_by_id: input.emitted_by_id,
    parent_atom_id: input.parent_atom_id ?? null,
    reproducibility_inputs: input.reproducibility_inputs ?? null,
  };
  const canonicalString = canonicalJsonStringify(canon);
  return Buffer.from(blake3(canonicalString));
}

/** Hex-encoded form for log lines + cache keys. */
export function payloadHashHex(input: BeliefAtomInput): string {
  return computePayloadHash(input).toString('hex');
}
