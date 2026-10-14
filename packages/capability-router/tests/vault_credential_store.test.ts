import { describe, expect, it } from 'vitest';
import { VaultCredentialStore, envelopeCipherFromEnv } from '../src/index';

const KEY = Buffer.alloc(32, 7).toString('base64');

/**
 * Minimal Supabase-shaped client. `rpc` exists only under schema('belief'),
 * mirroring the real database, where decrypt_agency_credential lives in
 * belief, not public. The root-level rpc throws so a regression to
 * `client.rpc(...)` fails loudly instead of resolving to null.
 */
function fakeClient(row: Record<string, unknown>, decrypted: string | null) {
  const calls: Array<{ schema: string; fn: string; args: Record<string, unknown> }> = [];
  const client = {
    schema(name: string) {
      return {
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
          }),
        }),
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ schema: name, fn, args });
          return { data: decrypted, error: null };
        },
      };
    },
    rpc: () => {
      throw new Error('root-level rpc targets the public schema');
    },
  };
  return { client, calls };
}

describe('VaultCredentialStore', () => {
  const row = {
    id: 'cred-1',
    agency_id: 'agency-1',
    provider_id: 'etherscan',
    label: 'default',
    secret_cipher: 'ignored',
    cipher_algo: 'vault',
  };

  it('decrypts through belief.decrypt_agency_credential and unwraps the envelope', async () => {
    const cipher = envelopeCipherFromEnv({ CHAINSIGHT_MASTER_KEY: KEY });
    const { client, calls } = fakeClient(row, cipher.wrap('REAL-PROVIDER-KEY'));
    const store = new VaultCredentialStore(client as never, cipher);

    const r = await store.resolve('vault:cred-1');

    expect(r?.secret).toBe('REAL-PROVIDER-KEY');
    expect(r?.extra).toMatchObject({ provider_id: 'etherscan', agency_id: 'agency-1' });
    expect(calls).toEqual([
      { schema: 'belief', fn: 'decrypt_agency_credential', args: { p_credential_id: 'cred-1' } },
    ]);
  });

  it('fails closed (null) when the envelope cannot be opened', async () => {
    const writer = envelopeCipherFromEnv({ CHAINSIGHT_MASTER_KEY: KEY });
    const reader = envelopeCipherFromEnv({ CHAINSIGHT_MASTER_KEY: Buffer.alloc(32, 9).toString('base64') });
    const { client } = fakeClient(row, writer.wrap('REAL-PROVIDER-KEY'));
    const store = new VaultCredentialStore(client as never, reader);

    expect(await store.resolve('vault:cred-1')).toBeNull();
  });
});
