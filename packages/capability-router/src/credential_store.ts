/**
 * CredentialStore — resolves a provider install's credential_ref to a
 * decrypted secret.
 *
 * Phase 1 Week 4: env-var-backed store. Each install's credential_ref is
 * the env var name (e.g. 'ETHERSCAN_API_KEY'). This is correct for the
 * solo-dev dev environment AND for SaaS Blind tier where the agency hosts
 * secrets via Fly secrets (env vars).
 *
 * Future (Phase 2): Supabase Vault for SaaS Blind and a KMS-backed store
 * for On-Prem. The interface here does not change.
 */

import type { ResolvedCredential } from './types';

export interface CredentialStore {
  /**
   * Resolve a credential_ref to a decrypted secret. Returns null if the
   * credential is not configured (caller decides whether to fail open
   * — e.g. a free public endpoint — or to skip the install).
   */
  resolve(credential_ref: string): Promise<ResolvedCredential | null>;
}

export class EnvCredentialStore implements CredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(credential_ref: string): Promise<ResolvedCredential | null> {
    if (!credential_ref) return null;
    const secret = this.env[credential_ref];
    if (!secret) return null;
    return {
      credential_ref,
      secret,
    };
  }
}

/**
 * Test/in-memory store. Useful for unit tests and as a base for the
 * eventual Vault-backed implementation.
 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly secrets = new Map<string, ResolvedCredential>();

  set(credential_ref: string, secret: string, extra?: Record<string, string>): void {
    this.secrets.set(credential_ref, { credential_ref, secret, extra });
  }

  async resolve(credential_ref: string): Promise<ResolvedCredential | null> {
    return this.secrets.get(credential_ref) ?? null;
  }
}

/**
 * Vault-backed credential store (Phase-2 SaaS Blind).
 *
 * credential_ref shape: 'vault:<credential_id>' where credential_id is the
 * uuid of a belief.agency_credentials row. The store reads the row and
 * decrypts secret_cipher according to cipher_algo:
 *   - 'plain_b64'   → base64-decode (dev / no-pgsodium fallback)
 *   - 'pgsodium'    → call belief.decrypt_agency_credential() RPC (server-side
 *                     decryption; never exposes the key to the client).
 */
export interface VaultStoreClient {
  schema(name: string): {
    from(table: string): {
      select(cols: string): {
        eq(
          col: string,
          val: unknown,
        ): {
          maybeSingle(): Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    rpc<T = unknown>(
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{ data: T | null; error: { message: string } | null }>;
  };
}

import type { EnvelopeCipher } from './envelope_cipher';

export class VaultCredentialStore implements CredentialStore {
  constructor(
    private readonly client: VaultStoreClient,
    private readonly cipher?: EnvelopeCipher,
  ) {}

  async resolve(credential_ref: string): Promise<ResolvedCredential | null> {
    if (!credential_ref?.startsWith('vault:')) return null;
    const credential_id = credential_ref.slice('vault:'.length);
    try {
      const { data, error } = await this.client
        .schema('belief')
        .from('agency_credentials')
        .select('id, agency_id, provider_id, label, secret_cipher, cipher_algo')
        .eq('id', credential_id)
        .maybeSingle();
      if (error || !data) return null;
      const row = data as {
        secret_cipher: string;
        cipher_algo: string;
        agency_id: string;
        provider_id: string;
        label: string;
      };
      let storedSecret: string | null = null;
      if (row.cipher_algo === 'vault' || row.cipher_algo === 'pgsodium') {
        // Vault path: call the controlled RPC to fetch the wrapped blob.
        // The RPC lives in the belief schema. Calling it on the root client
        // targets public.decrypt_agency_credential, which does not exist, so
        // every Vault credential silently resolved to null.
        const { data: decrypted, error: rpcErr } = await this.client
          .schema('belief')
          .rpc<string>('decrypt_agency_credential', { p_credential_id: credential_id });
        if (rpcErr || !decrypted) return null;
        storedSecret = decrypted;
      } else if (row.cipher_algo === 'plain_b64') {
        storedSecret = Buffer.from(row.secret_cipher, 'base64').toString('utf8');
      }
      if (!storedSecret) return null;

      // App-layer envelope: unwrap with CHAINSIGHT_MASTER_KEY. Fail closed
      // when the cipher is active and the blob will not open (wrong key,
      // tampering, or a legacy unwrapped row): returning storedSecret here
      // would send ciphertext to the provider as if it were the API key.
      let secret = storedSecret;
      if (this.cipher?.active) {
        const unwrapped = this.cipher.unwrap(storedSecret);
        if (unwrapped === null) return null;
        secret = unwrapped;
      }

      return {
        credential_ref,
        secret,
        extra: { provider_id: row.provider_id, label: row.label, agency_id: row.agency_id },
      };
    } catch {
      return null;
    }
  }
}

/**
 * FallbackCredentialStore — try each backing store in order; first hit wins.
 * Recommended chain for SaaS Blind: [VaultCredentialStore, EnvCredentialStore].
 * Recommended for self-hosted dev: [EnvCredentialStore] only.
 */
export class FallbackCredentialStore implements CredentialStore {
  constructor(private readonly stores: CredentialStore[]) {}

  async resolve(credential_ref: string): Promise<ResolvedCredential | null> {
    for (const s of this.stores) {
      const hit = await s.resolve(credential_ref);
      if (hit) return hit;
    }
    return null;
  }
}
