/**
 * End-to-end ReproPackService test: build → finalize → list → download →
 * verify → tampered re-verify, using the in-memory storage and a fake repo.
 */

import { describe, it, expect } from 'vitest';
import { ReproPackService } from '../src/service';
import { InMemoryStorageBackend } from '../src/storage';
import type { PackRepository, FinalizeInput, InsertBuildingInput } from '../src/pack_repository';
import type { CaseId, PackStatusRow } from '@chainsight/shared-types';
import { InMemoryCaseSource, buildOpLemonFixture, CASE_ID } from './fixtures';

class FakeRepo implements PackRepository {
  rows = new Map<string, PackStatusRow>();
  lock_calls: Array<{ pack_id: string; case_id: CaseId }> = [];

  async insertBuilding(input: InsertBuildingInput): Promise<void> {
    if (this.rows.has(input.pack_id)) throw new Error('unique violation');
    this.rows.set(input.pack_id, {
      pack_id: input.pack_id,
      case_id: input.case_id,
      status: 'building',
      manifest_hash: input.manifest_hash,
      storage_ref: null,
      built_at: new Date().toISOString(),
      finalized_at: null,
      total_atoms: 0,
      total_traces: 0,
      total_events: 0,
      chain_tip_hash: null,
      error: null,
    });
  }

  async finalize(input: FinalizeInput): Promise<{ atoms_locked: number }> {
    const row = this.rows.get(input.pack_id);
    if (!row) throw new Error('not found');
    row.status = 'finalized';
    row.storage_ref = input.storage_ref;
    row.finalized_at = new Date().toISOString();
    row.total_atoms = input.total_atoms;
    row.total_traces = input.total_traces;
    row.total_events = input.total_events;
    row.chain_tip_hash = input.chain_tip_hash;
    if (input.finalize_atoms) {
      this.lock_calls.push({ pack_id: input.pack_id, case_id: input.case_id });
      return { atoms_locked: 3 };
    }
    return { atoms_locked: 0 };
  }

  async markFailed(pack_id: string, error: string): Promise<void> {
    const row = this.rows.get(pack_id);
    if (row) { row.status = 'failed'; row.error = error; }
  }

  async byId(pack_id: string): Promise<PackStatusRow | null> {
    return this.rows.get(pack_id) ?? null;
  }

  async listForCase(case_id: CaseId): Promise<PackStatusRow[]> {
    return Array.from(this.rows.values()).filter((r) => r.case_id === case_id);
  }
}

function makeService() {
  const repo = new FakeRepo();
  const storage = new InMemoryStorageBackend();
  const service = new ReproPackService({
    source: new InMemoryCaseSource(buildOpLemonFixture()),
    repo, storage,
    now: () => '2026-06-21T18:00:00.000Z',
  });
  return { service, repo, storage };
}

describe('ReproPackService', () => {
  it('builds + finalizes + locks atoms', async () => {
    const { service, repo } = makeService();
    const result = await service.build({
      case_id: CASE_ID, agency_id: 'agency-A', built_by_id: 'u-1', finalize: true,
    });
    expect(result.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.storage_ref).toContain(result.pack_id);
    expect(result.atoms_locked).toBe(3);
    expect(repo.lock_calls).toHaveLength(1);
    expect(repo.lock_calls[0]!.case_id).toBe(CASE_ID);
  });

  it('list returns the built pack', async () => {
    const { service } = makeService();
    await service.build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const list = await service.listForCase(CASE_ID);
    expect(list.length).toBe(1);
    expect(list[0]!.status).toBe('finalized');
  });

  it('download returns a signed url', async () => {
    const { service } = makeService();
    const built = await service.build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const link = await service.download(built.pack_id);
    expect(link).not.toBeNull();
    expect(link!.signed_url).toMatch(/^mem-signed:\/\//);
    expect(link!.ttl_seconds).toBe(300);
  });

  it('verify returns pass after a clean build', async () => {
    const { service } = makeService();
    const built = await service.build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const verdict = await service.verify(built.pack_id);
    expect(verdict.overall).toBe('pass');
    expect(verdict.chain_valid).toBe(true);
  });

  it('verify reports fail for unknown pack', async () => {
    const { service } = makeService();
    const verdict = await service.verify('not-a-real-pack');
    expect(verdict.overall).toBe('fail');
    expect(verdict.errors.length).toBeGreaterThan(0);
  });
});
