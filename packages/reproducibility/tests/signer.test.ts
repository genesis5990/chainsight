import { describe, it, expect } from 'vitest';
import { Ed25519PackSigner, generateEd25519Keypair, verifyDetachedSignature } from '../src/signer';

describe('Sigstore-style detached pack signing', () => {
  it('signs and verifies a manifest hash', async () => {
    const kp = await generateEd25519Keypair();
    const signer = new Ed25519PackSigner('11111111-1111-7111-8111-111111111111', kp.private_key_pkcs8_b64, kp.public_key_spki_b64);
    const manifest_hash = 'a25f462f18e503f2f6fecb7a584fd8ffcb7e317ea8813947fb6ca3a3c377ea30';
    const sig = await signer.sign(manifest_hash);
    expect(sig).toBeTypeOf('string');
    expect(sig.length).toBeGreaterThan(0);

    const keys = { byId: { [signer.signer_id]: { algo: 'ed25519' as const, public_key_b64: signer.public_key_b64 } } };
    const verdict = verifyDetachedSignature(manifest_hash, sig, signer.signer_id, keys);
    expect(verdict.valid).toBe(true);
  });

  it('rejects a tampered manifest hash', async () => {
    const kp = await generateEd25519Keypair();
    const signer = new Ed25519PackSigner('22222222-2222-7222-8222-222222222222', kp.private_key_pkcs8_b64, kp.public_key_spki_b64);
    const sig = await signer.sign('a25f462f18e503f2f6fecb7a584fd8ffcb7e317ea8813947fb6ca3a3c377ea30');
    const keys = { byId: { [signer.signer_id]: { algo: 'ed25519' as const, public_key_b64: signer.public_key_b64 } } };
    const verdict = verifyDetachedSignature('deadbeef'.repeat(8), sig, signer.signer_id, keys);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('bad signature');
  });

  it('reports unsigned when signature is missing', () => {
    const verdict = verifyDetachedSignature('abc', null, null, { byId: {} });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('unsigned');
  });

  it('reports unknown signer when key id not trusted', async () => {
    const kp = await generateEd25519Keypair();
    const signer = new Ed25519PackSigner('33333333-3333-7333-8333-333333333333', kp.private_key_pkcs8_b64, kp.public_key_spki_b64);
    const sig = await signer.sign('a25f462f18e503f2f6fecb7a584fd8ffcb7e317ea8813947fb6ca3a3c377ea30');
    const verdict = verifyDetachedSignature(
      'a25f462f18e503f2f6fecb7a584fd8ffcb7e317ea8813947fb6ca3a3c377ea30',
      sig,
      signer.signer_id,
      { byId: {} },
    );
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toContain('unknown signer');
  });
});
