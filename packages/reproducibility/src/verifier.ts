/**
 * PackVerifier — reads a pack ZIP and produces a VerificationResult.
 *
 * Mirrors the offline `verify.mjs` shipped inside the pack, so opposing
 * counsel can independently audit the same checks. Returned verdict is
 * machine-readable; the API surfaces it via GET /v1/repro-pack/:pack_id/verify.
 */

import { unzipSync } from 'fflate';
import type {
  ManifestSections,
  PackManifest,
  PackVerdict,
  SectionVerdict,
  VerificationResult,
} from '@chainsight/shared-types';
import { REPRO_MANIFEST_FILENAME, REPRO_REPLAY_SCRIPT_FILENAME } from '@chainsight/shared-types';
import { canonicalJson, chainLinkHash, hashValue, sha256Hex } from './canonical';

export interface PackVerifierOptions {
  /** Inject a clock for tests. */
  now?: () => string;
}

export class PackVerifier {
  private readonly nowFn: () => string;

  constructor(opts: PackVerifierOptions = {}) {
    this.nowFn = opts.now ?? (() => new Date().toISOString());
  }

  async verify(zipBytes: Uint8Array): Promise<VerificationResult> {
    const errors: string[] = [];
    const files = unzipSync(zipBytes);
    const manifestRaw = files[REPRO_MANIFEST_FILENAME];
    if (!manifestRaw) {
      return this.fail('manifest.json missing from pack', errors);
    }
    let manifest: PackManifest;
    try { manifest = JSON.parse(new TextDecoder().decode(manifestRaw)); }
    catch (e) { return this.fail(`manifest.json parse failed: ${(e as Error).message}`, errors); }

    // 1) Manifest hash.
    const expectedManifestHash = manifest.manifest_hash;
    const withoutHash = { ...manifest, manifest_hash: undefined };
    const recomputedManifestHash = hashValue(withoutHash);
    const manifestHashMatch = recomputedManifestHash === expectedManifestHash;
    if (!manifestHashMatch) errors.push('manifest_hash mismatch');

    // 2) Per-section hashes.
    const sectionVerdicts: SectionVerdict[] = [];
    for (const sectionName of Object.keys(manifest.sections) as (keyof ManifestSections)[]) {
      const section = manifest.sections[sectionName] as unknown as { section_hash: string } & Record<string, unknown>;
      const recomputed = hashValue(stripSectionHash(section));
      const ok = recomputed === section.section_hash;
      sectionVerdicts.push({
        section: sectionName,
        verdict: ok ? 'pass' : 'fail',
        recomputed_hash: recomputed,
        expected_hash: section.section_hash,
        detail: ok ? undefined : 'section hash mismatch',
      });
      if (!ok) errors.push(`section[${sectionName}] hash mismatch`);
    }

    // 3) Hash chain across atoms.
    const atoms = manifest.sections.atoms.atoms;
    let chainOk = true;
    const byId = new Map<string, (typeof atoms)[number]>();
    for (const a of atoms) {
      const parent = a.parent_atom_id ? byId.get(a.parent_atom_id) : null;
      const parentHash = parent?.payload_hash ?? null;
      const expectedLink = chainLinkHash(a.payload_hash, parentHash);
      if (expectedLink !== a.chain_link_hash) {
        chainOk = false;
        errors.push(`chain_link_hash mismatch on atom ${a.id}`);
        break;
      }
      byId.set(a.id, a);
    }
    if (!chainOk) {
      // Surface a hash_chain verdict alongside the section verdicts.
      sectionVerdicts.push({ section: 'atoms', verdict: 'fail', detail: 'hash chain broken' });
    }

    // 4) Sanity: replay script + verify.mjs present and script_hash matches.
    const replayBytes = files[REPRO_REPLAY_SCRIPT_FILENAME];
    if (!replayBytes) errors.push('replay.sh missing');
    else {
      const recomputedScriptHash = sha256Hex(replayBytes);
      if (recomputedScriptHash !== manifest.sections.replay_script.script_hash) {
        errors.push('replay.sh script_hash mismatch');
      }
    }
    if (!files['verify.mjs']) errors.push('verify.mjs missing');

    const overall: PackVerdict = errors.length === 0 ? 'pass' : 'fail';
    return {
      pack_id: manifest.pack_id,
      overall,
      recomputed_manifest_hash: recomputedManifestHash,
      expected_manifest_hash: expectedManifestHash,
      manifest_hash_match: manifestHashMatch,
      sections: sectionVerdicts,
      chain_valid: chainOk,
      errors,
      verified_at: this.nowFn(),
    };
  }

  private fail(message: string, errors: string[]): VerificationResult {
    errors.push(message);
    return {
      pack_id: 'unknown',
      overall: 'fail',
      recomputed_manifest_hash: '',
      expected_manifest_hash: '',
      manifest_hash_match: false,
      sections: [],
      chain_valid: false,
      errors,
      verified_at: this.nowFn(),
    };
  }
}

function stripSectionHash(section: { section_hash: string } & Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...section };
  delete copy.section_hash;
  return copy;
}

/** Canonical JSON helper re-exported for callers writing their own checks. */
export { canonicalJson };
