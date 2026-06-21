/**
 * Sigstore-style detached pack signing.
 *
 * Why detached?
 *   The pack ZIP is byte-identical for a given case state (determinism
 *   contract). Embedding a signature inside the ZIP would either:
 *     - break determinism (different keys produce different bytes), or
 *     - require a fixed key (defeats per-agency key rotation).
 *
 *   Sigstore solves this by storing the signature OUTSIDE the artifact and
 *   over the artifact's content-address. Our content-address is
 *   manifest_hash — exactly what we sign. The signature lands in
 *   belief.reproducibility_packs.signature (with signer_id + signed_at).
 *
 * Algorithm: Ed25519 (RFC 8032). 64-byte signatures, no key-encoding ambiguity.
 *   - Signer key:   32-byte seed (Node accepts seed via createPrivateKey)
 *   - Verifier key: 32-byte public key (DER- or raw-encoded — we use raw)
 *   - We sign the UTF-8 bytes of the lowercase hex manifest_hash so the
 *     signature can be verified offline without re-computing the hash.
 */

import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export interface PackSigner {
  /** Stable signer id (uuid recommended; matches reproducibility_packs.signer_id). */
  readonly signer_id: string;
  /** Public key encoding (base64 raw 32-byte for ed25519). */
  readonly public_key_b64: string;
  /** Algorithm marker for the signature blob. */
  readonly algo: 'ed25519';
  /** Returns base64-encoded signature of manifest_hash. */
  sign(manifest_hash: string): Promise<string>;
}

export interface PackVerifierKeys {
  /** Public keys trusted to sign packs, keyed by signer_id. */
  byId: Record<string, { algo: 'ed25519'; public_key_b64: string }>;
}

/**
 * Verify a detached signature against a manifest_hash + signer_id.
 * Returns { valid, reason? } so callers can include verdicts in pack status.
 */
export function verifyDetachedSignature(
  manifest_hash: string,
  signature_b64: string | null | undefined,
  signer_id: string | null | undefined,
  keys: PackVerifierKeys,
): { valid: boolean; reason?: string } {
  if (!signature_b64 || !signer_id) {
    return { valid: false, reason: 'unsigned' };
  }
  const entry = keys.byId[signer_id];
  if (!entry) return { valid: false, reason: `unknown signer ${signer_id}` };
  if (entry.algo !== 'ed25519') return { valid: false, reason: `unsupported algo ${entry.algo}` };
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(entry.public_key_b64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const ok = cryptoVerify(
      null,
      Buffer.from(manifest_hash, 'utf8'),
      publicKey,
      Buffer.from(signature_b64, 'base64'),
    );
    return ok ? { valid: true } : { valid: false, reason: 'bad signature' };
  } catch (e) {
    return { valid: false, reason: (e as Error).message };
  }
}

/**
 * Ed25519 signer backed by a Node KeyObject. Production should load the
 * private key from a secure store (Supabase Vault / pgsodium / KMS); for
 * dev/CI we accept a base64-encoded SPKI DER private key directly.
 */
export class Ed25519PackSigner implements PackSigner {
  readonly algo = 'ed25519' as const;
  readonly signer_id: string;
  readonly public_key_b64: string;
  private readonly privateKey: ReturnType<typeof createPrivateKey>;

  /**
   * @param signer_id              Stable UUID for this signing identity.
   * @param private_key_pkcs8_b64  Base64 of PKCS#8-DER ed25519 private key.
   * @param public_key_spki_b64    Base64 of SPKI-DER ed25519 public key.
   */
  constructor(signer_id: string, private_key_pkcs8_b64: string, public_key_spki_b64: string) {
    this.signer_id = signer_id;
    this.public_key_b64 = public_key_spki_b64;
    this.privateKey = createPrivateKey({
      key: Buffer.from(private_key_pkcs8_b64, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  }

  async sign(manifest_hash: string): Promise<string> {
    const sig = cryptoSign(null, Buffer.from(manifest_hash, 'utf8'), this.privateKey);
    return sig.toString('base64');
  }
}

/**
 * Convenience: generate a fresh ed25519 keypair for tests + first-run setup.
 * Returns base64-encoded PKCS#8 (private) and SPKI (public) DER blobs.
 */
export async function generateEd25519Keypair(): Promise<{ private_key_pkcs8_b64: string; public_key_spki_b64: string }> {
  const { generateKeyPair } = await import('node:crypto');
  return await new Promise((resolve, reject) => {
    generateKeyPair('ed25519', { publicKeyEncoding: { format: 'der', type: 'spki' }, privateKeyEncoding: { format: 'der', type: 'pkcs8' } }, (err, publicKey, privateKey) => {
      if (err) return reject(err);
      resolve({
        private_key_pkcs8_b64: Buffer.from(privateKey as unknown as Uint8Array).toString('base64'),
        public_key_spki_b64: Buffer.from(publicKey as unknown as Uint8Array).toString('base64'),
      });
    });
  });
}
