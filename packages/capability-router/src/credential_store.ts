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
