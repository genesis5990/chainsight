/**
 * EnvelopeCipher — app-layer AES-256-GCM that wraps secrets BEFORE they
 * enter the data store.
 *
 * Why: Supabase Hosted grants service_role SELECT on vault.decrypted_secrets
 * by default, and that grant is owned by supabase_admin so customers can't
 * REVOKE it. To preserve the SaaS Blind promise, we encrypt every BYOK
 * secret with a key the database does NOT hold (set via the API/worker
 * Fly secret CHAINSIGHT_MASTER_KEY). Vault then holds the wrapped blob.
 *
 * Threat coverage:
 *   - Attacker with service_role key (incl. Supabase support):
 *       Can read vault.decrypted_secrets → sees the wrapped blob only.
 *       Without CHAINSIGHT_MASTER_KEY (in Fly secrets, never in DB),
 *       cannot recover plaintext.
 *   - Attacker with API/worker host RCE:
 *       Can read the master key from process env → full compromise.
 *       This is the irreducible app-layer trust boundary; mitigated by
 *       Fly secret rotation and process isolation.
 *
 * Format on disk (base64-encoded):
 *   1 byte  version (0x01)
 *   12 bytes IV (random per encrypt)
 *   16 bytes AES-GCM tag
 *   N bytes ciphertext
 *
 * Key handling:
 *   - 32-byte raw key, base64-encoded in env var CHAINSIGHT_MASTER_KEY.
 *   - generateMasterKey() helper for first-run setup.
 *   - If the env var is unset, the cipher is a no-op pass-through; callers
 *     log a 'unprotected' warning so SREs notice in dev.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;

export interface EnvelopeCipher {
  /** Wrap plaintext. Returns base64. */
  wrap(plaintext: string): string;
  /** Unwrap base64. Returns plaintext, or null if the blob is malformed. */
  unwrap(wrapped: string): string | null;
  /** True if a real key is configured (cipher is active). */
  readonly active: boolean;
}

export class Aes256GcmEnvelopeCipher implements EnvelopeCipher {
  readonly active = true;
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('CHAINSIGHT_MASTER_KEY must be 32 bytes (256 bits) after base64 decode');
  }

  wrap(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([Buffer.from([VERSION]), iv, tag, ct]);
    return blob.toString('base64');
  }

  unwrap(wrapped: string): string | null {
    try {
      const blob = Buffer.from(wrapped, 'base64');
      if (blob.length < 1 + IV_LEN + TAG_LEN + 1) return null;
      if (blob[0] !== VERSION) return null;
      const iv = blob.subarray(1, 1 + IV_LEN);
      const tag = blob.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
      const ct = blob.subarray(1 + IV_LEN + TAG_LEN);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      return null;
    }
  }
}

/**
 * No-op cipher for dev / when CHAINSIGHT_MASTER_KEY is unset. Callers should
 * log a warning when this is selected so SREs notice.
 */
export class PassThroughEnvelopeCipher implements EnvelopeCipher {
  readonly active = false;
  wrap(plaintext: string): string { return plaintext; }
  unwrap(wrapped: string): string | null { return wrapped; }
}

/**
 * Envelope-cipher factory.
 *
 * Hard rules:
 *   - CHAINSIGHT_MASTER_KEY unset → PassThrough (dev mode). Logs nothing
 *     special; callers decide whether to warn.
 *   - CHAINSIGHT_MASTER_KEY set + valid 32-byte base64 → Aes256Gcm.
 *   - CHAINSIGHT_MASTER_KEY set but malformed (wrong length, non-base64) →
 *     by default we throw, which crashes the boot. Pass
 *     { onInvalid: 'fallback' } to log + fall back to PassThrough so the
 *     service keeps running for ops diagnosis (the API /health/envelope
 *     endpoint uses this).
 */
export interface EnvelopeCipherFromEnvOptions {
  /** What to do if the env var is set but invalid. */
  onInvalid?: 'throw' | 'fallback';
  /** Optional logger for the fallback path. */
  log?: (msg: string, ctx: Record<string, unknown>) => void;
}

export function envelopeCipherFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: EnvelopeCipherFromEnvOptions = {},
): EnvelopeCipher {
  const raw = env.CHAINSIGHT_MASTER_KEY;
  if (!raw) return new PassThroughEnvelopeCipher();
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    const msg = `CHAINSIGHT_MASTER_KEY decoded to ${key.length} bytes, need 32`;
    if (opts.onInvalid === 'fallback') {
      opts.log?.(msg, { decoded_bytes: key.length, raw_length: raw.length });
      return new PassThroughEnvelopeCipher();
    }
    throw new Error(msg);
  }
  return new Aes256GcmEnvelopeCipher(key);
}

/** Generate a fresh 32-byte master key, base64-encoded. */
export function generateMasterKey(): string {
  return randomBytes(32).toString('base64');
}
