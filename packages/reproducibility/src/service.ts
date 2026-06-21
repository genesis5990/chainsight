/**
 * ReproPackService — public surface used by the API.
 *
 * Orchestrates: builder + storage + DB + verifier. Build is invoked
 * synchronously by the API (the manifests are typically small enough);
 * very large cases will be moved to the BullMQ queue in Phase-2.
 */

import type {
  CaseId,
  PackBuildRequest,
  PackBuildResult,
  PackManifest,
  PackStatusRow,
  PackStorageBackend,
  ReproPackService as ReproPackServiceContract,
  VerificationResult,
} from '@chainsight/shared-types';
import { PackBuilder } from './builder';
import type { CaseSource } from './case_source';
import type { PackRepository } from './pack_repository';
import { PackVerifier } from './verifier';

export interface ReproPackServiceOptions {
  source: CaseSource;
  repo: PackRepository;
  storage: PackStorageBackend;
  /** Deterministic clock. */
  now?: () => string;
  /** Deterministic pack_id generator (manifest_hash → uuid-shaped id). */
  packIdProvider?: (input: { case_id: CaseId; manifest_hash: string }) => string;
  /** Signed-URL TTL in seconds. */
  signed_url_ttl_seconds?: number;
}

export class ReproPackService implements ReproPackServiceContract {
  private readonly nowFn: () => string;
  private readonly packIdProvider: (input: { case_id: CaseId; manifest_hash: string }) => string;
  private readonly signedUrlTtl: number;
  private readonly verifier: PackVerifier;

  constructor(private readonly opts: ReproPackServiceOptions) {
    this.nowFn = opts.now ?? (() => new Date().toISOString());
    this.packIdProvider = opts.packIdProvider ?? defaultPackIdProvider;
    this.signedUrlTtl = opts.signed_url_ttl_seconds ?? 5 * 60;
    this.verifier = new PackVerifier({ now: this.nowFn });
  }

  async build(req: PackBuildRequest): Promise<PackBuildResult> {
    const builder = new PackBuilder({
      source: this.opts.source,
      now: this.nowFn,
      packIdProvider: this.packIdProvider,
    });
    const built = await builder.build(req);
    const manifest = built.manifest;

    try {
      await this.opts.repo.insertBuilding({
        pack_id: built.pack_id,
        case_id: req.case_id,
        agency_id: req.agency_id,
        built_by_id: req.built_by_id,
        manifest_hash: manifest.manifest_hash,
      });
    } catch (e) {
      // If the (case_id, manifest_hash) UNIQUE collides, the pack is already
      // built — return its existing row's storage_ref.
      const message = (e as Error).message;
      if (/unique|duplicate/i.test(message)) {
        const existing = await this.opts.repo.byId(built.pack_id);
        if (existing && existing.storage_ref) {
          return {
            pack_id: existing.pack_id,
            manifest_hash: existing.manifest_hash,
            storage_ref: existing.storage_ref,
            atoms_locked: 0,
            stats: manifest.stats,
            built_at: existing.built_at,
          };
        }
      }
      throw e;
    }

    let storage_ref: string;
    try {
      storage_ref = await this.opts.storage.putPack({
        agency_id: req.agency_id,
        case_id: req.case_id,
        pack_id: built.pack_id,
        bytes: built.bytes,
      });
    } catch (e) {
      await this.opts.repo.markFailed(built.pack_id, (e as Error).message);
      throw e;
    }

    let finalize: { atoms_locked: number };
    try {
      finalize = await this.opts.repo.finalize({
        pack_id: built.pack_id,
        case_id: req.case_id,
        storage_ref,
        total_atoms: manifest.stats.total_atoms,
        total_traces: manifest.stats.total_traces,
        total_events: manifest.stats.total_events,
        chain_tip_hash: manifest.chain_tip_hash,
        manifest_size_bytes: built.bytes.byteLength,
        finalize_atoms: req.finalize,
      });
    } catch (e) {
      await this.opts.repo.markFailed(built.pack_id, (e as Error).message);
      throw e;
    }

    return {
      pack_id: built.pack_id,
      manifest_hash: manifest.manifest_hash,
      storage_ref,
      atoms_locked: finalize.atoms_locked,
      stats: manifest.stats,
      built_at: manifest.built_at,
    };
  }

  async status(pack_id: string): Promise<PackStatusRow | null> {
    return this.opts.repo.byId(pack_id);
  }

  async download(pack_id: string): Promise<{ signed_url: string; ttl_seconds: number } | null> {
    const row = await this.opts.repo.byId(pack_id);
    if (!row || !row.storage_ref) return null;
    const signed_url = await this.opts.storage.signedUrl(row.storage_ref, this.signedUrlTtl);
    return { signed_url, ttl_seconds: this.signedUrlTtl };
  }

  async verify(pack_id: string): Promise<VerificationResult> {
    const row = await this.opts.repo.byId(pack_id);
    if (!row || !row.storage_ref) {
      return {
        pack_id,
        overall: 'fail',
        recomputed_manifest_hash: '',
        expected_manifest_hash: '',
        manifest_hash_match: false,
        sections: [],
        chain_valid: false,
        errors: ['pack not found or not finalized'],
        verified_at: this.nowFn(),
      };
    }
    const bytes = await this.opts.storage.getPack(row.storage_ref);
    return this.verifier.verify(bytes);
  }

  async listForCase(case_id: CaseId): Promise<PackStatusRow[]> {
    return this.opts.repo.listForCase(case_id);
  }
}

/* ─── default pack_id provider ─────────────────────────────────────────── */

import { sha256Hex } from './canonical';

export function defaultPackIdProvider(input: { case_id: CaseId; manifest_hash: string }): string {
  // UUID-v7-shaped id derived from the manifest hash so identical pack
  // bytes produce identical pack ids. The first 32 hex chars of the hash
  // are placed in UUID positions; we set the version nibble to '7'.
  const k = sha256Hex(`${input.case_id}|${input.manifest_hash}`);
  const hex = k.replace(/[^0-9a-f]/gi, '').padEnd(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* ─── re-export for callers ────────────────────────────────────────────── */

export type { PackManifest };
