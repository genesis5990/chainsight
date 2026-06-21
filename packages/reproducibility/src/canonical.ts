/**
 * Canonical-JSON serialization + SHA-256 helpers (v1.0 Backend §1.8).
 *
 * The Pack determinism contract: identical inputs produce byte-identical
 * manifest bytes. To get there we (a) sort object keys, (b) drop undefined,
 * (c) leave null in place, (d) hash with SHA-256.
 */

import { sha256 } from '@noble/hashes/sha256';

/**
 * Stable stringify — keys sorted alphabetically, undefined dropped,
 * arrays preserved. Matches the canonical form used by the belief-state
 * service and the math service.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

export function sha256Hex(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return Buffer.from(sha256(bytes)).toString('hex');
}

export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return sha256(bytes);
}

/** Hash the canonical-JSON form of any value. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * Chain-link hash for hash-chain validation:
 *   chain_link_hash = sha256(payload_hash + (parent_payload_hash || ''))
 *
 * The chain root has an empty parent. Tampering with any prior atom
 * invalidates every subsequent chain_link_hash.
 */
export function chainLinkHash(payload_hash: string, parent_payload_hash: string | null): string {
  return sha256Hex(payload_hash + (parent_payload_hash ?? ''));
}
