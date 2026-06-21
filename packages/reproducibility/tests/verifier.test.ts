/**
 * PackVerifier tampering tests.
 */

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { PackBuilder } from '../src/builder';
import { PackVerifier } from '../src/verifier';
import { InMemoryCaseSource, buildOpLemonFixture, CASE_ID } from './fixtures';
import { defaultPackIdProvider } from '../src/service';
import { canonicalJson } from '../src/canonical';

async function buildFresh() {
  const builder = new PackBuilder({
    source: new InMemoryCaseSource(buildOpLemonFixture()),
    now: () => '2026-06-21T18:00:00.000Z',
    packIdProvider: defaultPackIdProvider,
  });
  return builder.build({ case_id: CASE_ID, agency_id: 'A', built_by_id: 'u-1', finalize: false });
}

describe('PackVerifier — tampering detection', () => {
  it('flags a fail when manifest is mutated', async () => {
    const built = await buildFresh();
    const files = unzipSync(built.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']!));
    // Tamper an atom's payload — the manifest_hash + section_hash + chain_link
    // all break at once.
    manifest.sections.atoms.atoms[0].object_payload = { hacked: true };
    const tamperedZip = zipSync({
      'manifest.json': [new TextEncoder().encode(canonicalJson(manifest)), { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
      'replay.sh': [files['replay.sh']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
      'verify.mjs': [files['verify.mjs']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
    });
    const verifier = new PackVerifier({ now: () => '2026-06-21T18:00:01.000Z' });
    const result = await verifier.verify(tamperedZip);
    expect(result.overall).toBe('fail');
    expect(result.manifest_hash_match).toBe(false);
  });

  it('flags a fail when replay.sh is replaced', async () => {
    const built = await buildFresh();
    const files = unzipSync(built.bytes);
    const tamperedZip = zipSync({
      'manifest.json': [files['manifest.json']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
      'replay.sh': [new TextEncoder().encode('#!/usr/bin/env bash\nexit 0\n'), { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
      'verify.mjs': [files['verify.mjs']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
    });
    const verifier = new PackVerifier();
    const result = await verifier.verify(tamperedZip);
    expect(result.overall).toBe('fail');
    expect(result.errors.some((e) => /replay.sh/i.test(e))).toBe(true);
  });

  it('flags a fail when manifest.json is missing', async () => {
    const built = await buildFresh();
    const files = unzipSync(built.bytes);
    const tamperedZip = zipSync({
      'replay.sh': [files['replay.sh']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
      'verify.mjs': [files['verify.mjs']!, { level: 0, mtime: new Date(Date.UTC(1980, 0, 1)) }],
    });
    const verifier = new PackVerifier();
    const result = await verifier.verify(tamperedZip);
    expect(result.overall).toBe('fail');
    expect(result.errors.some((e) => /manifest.json missing/.test(e))).toBe(true);
  });
});
