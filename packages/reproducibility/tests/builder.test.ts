/**
 * PackBuilder determinism + structure tests.
 */

import { describe, it, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { PackBuilder } from '../src/builder';
import { PackVerifier } from '../src/verifier';
import { InMemoryCaseSource, buildOpLemonFixture, CASE_ID } from './fixtures';
import { canonicalJson, sha256Hex } from '../src/canonical';
import { defaultPackIdProvider } from '../src/service';
import type { PackManifest } from '@chainsight/shared-types';

function makeBuilder(now = () => '2026-06-21T18:00:00.000Z') {
  return new PackBuilder({
    source: new InMemoryCaseSource(buildOpLemonFixture()),
    now,
    packIdProvider: defaultPackIdProvider,
  });
}

describe('PackBuilder determinism', () => {
  it('produces byte-identical pack bytes on two builds from the same state', async () => {
    const b1 = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const b2 = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    expect(b1.manifest.manifest_hash).toBe(b2.manifest.manifest_hash);
    expect(b1.pack_id).toBe(b2.pack_id);
    expect(b1.bytes.byteLength).toBe(b2.bytes.byteLength);
    // Compare every byte
    for (let i = 0; i < b1.bytes.byteLength; i++) {
      if (b1.bytes[i] !== b2.bytes[i]) throw new Error(`byte mismatch at ${i}`);
    }
  });

  it('changes manifest_hash when atoms change', async () => {
    const b1 = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });

    // Tamper a payload
    const tamperedFixture = buildOpLemonFixture();
    tamperedFixture.atoms[0]!.object_payload = { ...tamperedFixture.atoms[0]!.object_payload, block_height: 101 };
    const tamperedBuilder = new PackBuilder({
      source: new InMemoryCaseSource(tamperedFixture),
      now: () => '2026-06-21T18:00:00.000Z',
      packIdProvider: defaultPackIdProvider,
    });
    const b2 = await tamperedBuilder.build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    expect(b1.manifest.manifest_hash).not.toBe(b2.manifest.manifest_hash);
  });
});

describe('PackBuilder structure', () => {
  it('produces a ZIP with manifest.json + replay.sh + verify.mjs', async () => {
    const built = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const files = unzipSync(built.bytes);
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'replay.sh', 'verify.mjs']);
  });

  it('manifest_hash matches sha256(canonical-JSON(manifest without manifest_hash))', async () => {
    const built = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const manifest = built.manifest as PackManifest;
    const withoutHash = { ...manifest, manifest_hash: undefined };
    const recomputed = sha256Hex(canonicalJson(withoutHash));
    expect(recomputed).toBe(manifest.manifest_hash);
  });

  it('every section has a section_hash that matches its canonical-JSON', async () => {
    const built = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const manifest = built.manifest;
    for (const [name, sectionUnknown] of Object.entries(manifest.sections)) {
      const section = sectionUnknown as unknown as { section_hash: string } & Record<string, unknown>;
      const withoutHash: Record<string, unknown> = { ...section };
      delete withoutHash.section_hash;
      const expected = sha256Hex(canonicalJson(withoutHash));
      expect(section.section_hash, `section ${name}`).toBe(expected);
    }
  });

  it('chain_link_hash chains payload_hash through parent atoms', async () => {
    const built = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const atoms = built.manifest.sections.atoms.atoms;
    expect(atoms.length).toBe(3);
    // First atom: no parent → chain_link_hash = sha256(payload_hash + '')
    const expected0 = sha256Hex(atoms[0]!.payload_hash + '');
    expect(atoms[0]!.chain_link_hash).toBe(expected0);
    // Second atom: parent is atoms[0]
    const expected1 = sha256Hex(atoms[1]!.payload_hash + atoms[0]!.payload_hash);
    expect(atoms[1]!.chain_link_hash).toBe(expected1);
  });
});

describe('PackBuilder × PackVerifier', () => {
  it('verifier returns pass for a freshly built pack', async () => {
    const built = await makeBuilder().build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
    const verifier = new PackVerifier({ now: () => '2026-06-21T18:00:01.000Z' });
    const result = await verifier.verify(built.bytes);
    expect(result.overall).toBe('pass');
    expect(result.manifest_hash_match).toBe(true);
    expect(result.chain_valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.sections.every((s) => s.verdict === 'pass')).toBe(true);
  });
});
