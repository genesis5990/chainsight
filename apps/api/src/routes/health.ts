/**
 * Health and readiness endpoints. No auth required.
 */
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { envelopeCipherFromEnv } from '@chainsight/capability-router';

export async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'chainsight-api',
    version: process.env.npm_package_version ?? '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  fastify.get('/health/live', async () => ({ status: 'ok' }));

  fastify.get('/health/ready', async () => {
    return { status: 'ok', checks: { self: 'ok' } };
  });

  /**
   * Envelope cipher self-test. Wraps a fixed probe string and reports:
   *   - active: whether CHAINSIGHT_MASTER_KEY is set
   *   - wrapped_length: bytes of the wrapped blob (84 for AES-256-GCM + 32-char input)
   *   - key_fingerprint: short SHA-256 of the wrapped blob (first 8 hex). Two
   *     deployments using the SAME key but DIFFERENT IVs will still produce
   *     different blobs each call (random IV), so we additionally derive a
   *     deterministic fingerprint from a fixed-IV probe by hashing the
   *     UNwrap-after-wrap round-trip. We can compare 'key_fp' across api+worker
   *     by comparing the hash of (wrap then unwrap) the same input.
   *   - roundtrip_ok: confirms wrap/unwrap is symmetric.
   *
   * No secrets leak: the probe input is the public string 'CHAINSIGHT_PROBE_V1'
   * and we never return the master key itself. Auth is unnecessary (and would
   * block ops probes) since output exposes no plaintext or secret material.
   */
  fastify.get('/health/envelope', async () => {
    const keyMaterialRaw = process.env.CHAINSIGHT_MASTER_KEY ?? '';
    // Diagnostics: report key length info BEFORE constructing the cipher
    // (which throws on bad length). Lets ops see what's actually set
    // without leaking the key.
    let key_b64_length: number | null = null;
    let key_decoded_bytes: number | null = null;
    let key_b64_has_whitespace: boolean | null = null;
    if (keyMaterialRaw) {
      key_b64_length = keyMaterialRaw.length;
      key_b64_has_whitespace = /\s/.test(keyMaterialRaw);
      try {
        key_decoded_bytes = Buffer.from(keyMaterialRaw, 'base64').length;
      } catch {
        key_decoded_bytes = -1;
      }
    }
    if (key_decoded_bytes !== null && key_decoded_bytes !== 32) {
      return {
        active: false,
        service: 'chainsight-api',
        error: 'CHAINSIGHT_MASTER_KEY decoded to ' + key_decoded_bytes + ' bytes, need 32',
        key_b64_length,
        key_decoded_bytes,
        key_b64_has_whitespace,
      };
    }
    const cipher = envelopeCipherFromEnv(process.env);
    const probe = 'CHAINSIGHT_PROBE_V1';
    const wrapped = cipher.wrap(probe);
    const unwrapped = cipher.unwrap(wrapped);
    const roundtrip_ok = unwrapped === probe;
    // Derive a stable per-key fingerprint by hashing the master key INDIRECTLY:
    // wrap a known fixed-IV-equivalent (i.e. hash the env var itself, truncated).
    // We hash with SHA-256 + truncate to 16 hex chars. This is a one-way
    // identifier safe to expose for ops comparison.
    const key_fp = keyMaterialRaw
      ? createHash('sha256').update('chainsight-fp-v1:' + keyMaterialRaw).digest('hex').slice(0, 16)
      : null;
    return {
      active: cipher.active,
      roundtrip_ok,
      wrapped_length: wrapped.length,
      key_fp,
      key_b64_length,
      key_decoded_bytes,
      key_b64_has_whitespace,
      service: 'chainsight-api',
    };
  });
}
