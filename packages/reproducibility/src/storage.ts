/**
 * Pack storage backend abstraction.
 *
 * Production: SupabaseStorageBackend writes to the `repro-packs` bucket
 * under `{agency_id}/{case_id}/{pack_id}.zip`. Tests use an in-memory
 * backend so the determinism test doesn't need network.
 */

import type { CaseId, PackStorageBackend } from '@chainsight/shared-types';

/* ─── Supabase Storage shape we depend on ──────────────────────────────── */

export interface SupabaseStorageClient {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        file: Uint8Array | ArrayBuffer | Blob,
        options?: { upsert?: boolean; contentType?: string; cacheControl?: string },
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

const BUCKET = 'repro-packs';

function refToPath(storage_ref: string): string {
  // storage_ref shape: `supabase://repro-packs/{agency}/{case}/{pack}.zip`
  const prefix = `supabase://${BUCKET}/`;
  if (!storage_ref.startsWith(prefix)) {
    throw new Error(`unexpected storage_ref: ${storage_ref}`);
  }
  return storage_ref.slice(prefix.length);
}

export class SupabaseStorageBackend implements PackStorageBackend {
  constructor(private readonly client: SupabaseStorageClient, private readonly bucket: string = BUCKET) {}

  async putPack(input: { agency_id: string; case_id: CaseId; pack_id: string; bytes: Uint8Array }): Promise<string> {
    const path = `${input.agency_id}/${input.case_id}/${input.pack_id}.zip`;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, input.bytes, { upsert: true, contentType: 'application/zip', cacheControl: '3600' });
    if (error) throw new Error(`storage upload failed: ${error.message}`);
    return `supabase://${this.bucket}/${path}`;
  }

  async getPack(storage_ref: string): Promise<Uint8Array> {
    const path = refToPath(storage_ref);
    const { data, error } = await this.client.storage.from(this.bucket).download(path);
    if (error || !data) throw new Error(`storage download failed: ${error?.message ?? 'no data'}`);
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(storage_ref: string, ttl_seconds: number): Promise<string> {
    const path = refToPath(storage_ref);
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(path, ttl_seconds);
    if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`);
    return data.signedUrl;
  }
}

/* ─── In-memory backend for tests ──────────────────────────────────────── */

export class InMemoryStorageBackend implements PackStorageBackend {
  readonly store = new Map<string, Uint8Array>();

  async putPack(input: { agency_id: string; case_id: CaseId; pack_id: string; bytes: Uint8Array }): Promise<string> {
    const ref = `mem://repro-packs/${input.agency_id}/${input.case_id}/${input.pack_id}.zip`;
    this.store.set(ref, input.bytes);
    return ref;
  }

  async getPack(storage_ref: string): Promise<Uint8Array> {
    const bytes = this.store.get(storage_ref);
    if (!bytes) throw new Error(`no pack at ${storage_ref}`);
    return bytes;
  }

  async signedUrl(storage_ref: string, _ttl_seconds: number): Promise<string> {
    if (!this.store.has(storage_ref)) throw new Error(`no pack at ${storage_ref}`);
    return `mem-signed://${storage_ref}`;
  }
}
