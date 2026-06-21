import { describe, it, expect } from 'vitest';
import { Aes256GcmEnvelopeCipher, PassThroughEnvelopeCipher, generateMasterKey, envelopeCipherFromEnv } from '../src/envelope_cipher';

describe('Aes256GcmEnvelopeCipher', () => {
  const key = Buffer.from(generateMasterKey(), 'base64');

  it('round-trips a secret', () => {
    const c = new Aes256GcmEnvelopeCipher(key);
    const wrapped = c.wrap('SUPER_SECRET_API_KEY_DO_NOT_LEAK');
    expect(wrapped).not.toContain('SUPER_SECRET');
    const out = c.unwrap(wrapped);
    expect(out).toBe('SUPER_SECRET_API_KEY_DO_NOT_LEAK');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const c = new Aes256GcmEnvelopeCipher(key);
    const a = c.wrap('same plaintext');
    const b = c.wrap('same plaintext');
    expect(a).not.toBe(b);
    expect(c.unwrap(a)).toBe('same plaintext');
    expect(c.unwrap(b)).toBe('same plaintext');
  });

  it('rejects ciphertext tampered with a different key', () => {
    const c1 = new Aes256GcmEnvelopeCipher(key);
    const c2 = new Aes256GcmEnvelopeCipher(Buffer.from(generateMasterKey(), 'base64'));
    const wrapped = c1.wrap('hello');
    expect(c2.unwrap(wrapped)).toBeNull();
  });

  it('rejects malformed blobs', () => {
    const c = new Aes256GcmEnvelopeCipher(key);
    expect(c.unwrap('not-base64-!!!!')).toBeNull();
    expect(c.unwrap('AA==')).toBeNull();
  });

  it('throws on incorrect key length', () => {
    expect(() => new Aes256GcmEnvelopeCipher(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe('PassThroughEnvelopeCipher', () => {
  it('is a no-op (dev mode)', () => {
    const c = new PassThroughEnvelopeCipher();
    expect(c.active).toBe(false);
    expect(c.wrap('foo')).toBe('foo');
    expect(c.unwrap('foo')).toBe('foo');
  });
});

describe('envelopeCipherFromEnv', () => {
  it('returns pass-through when env var is unset', () => {
    const c = envelopeCipherFromEnv({} as NodeJS.ProcessEnv);
    expect(c.active).toBe(false);
  });

  it('returns AES cipher when env var is set', () => {
    const c = envelopeCipherFromEnv({ CHAINSIGHT_MASTER_KEY: generateMasterKey() } as NodeJS.ProcessEnv);
    expect(c.active).toBe(true);
  });
});
