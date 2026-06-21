/**
 * replay.sh generator (v1.0 Backend §1.8 step 6).
 *
 * The pack ships with a bash script that opposing counsel can run on their
 * own hardware. It does NOT need network access: every frozen input lives
 * inside the pack ZIP. The script invokes the offline verifier with
 * `--pack <pack.zip>` and reports pass/fail per section.
 *
 * Phase-1: the script delegates to `node verify.mjs` (we embed verify.mjs
 * as a static file). LLM outputs are non-deterministic, so the script
 * compares frozen text rather than re-running models.
 */

import type { PackManifest } from '@chainsight/shared-types';
import { REPRO_PACK_VERSION, REPRO_REPLAY_SCRIPT_FILENAME } from '@chainsight/shared-types';

export function renderReplayScript(manifest: Pick<PackManifest, 'case_id' | 'built_at' | 'stats'>): string {
  // Determinism: the script body is a pure function of (case_id, built_at,
  // stats). We intentionally do NOT include pack_id or manifest_hash in the
  // header — those depend on the script hash, which would create a circular
  // dependency. The verifier reads pack_id + manifest_hash from manifest.json
  // at unpack time and prints them itself.
  const lines: string[] = [];
  lines.push('#!/usr/bin/env bash');
  lines.push('# ChainSight Reproducibility Pack — replay script');
  lines.push(`# pack_version : ${REPRO_PACK_VERSION}`);
  lines.push(`# case_id      : ${manifest.case_id}`);
  lines.push(`# built_at     : ${manifest.built_at}`);
  lines.push(`# total_atoms  : ${manifest.stats.total_atoms}`);
  lines.push(`# total_traces : ${manifest.stats.total_traces}`);
  lines.push('');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push('PACK_PATH="${1:-pack.zip}"');
  lines.push('if [ ! -f "${PACK_PATH}" ]; then');
  lines.push('  echo "usage: $0 <pack.zip>" >&2');
  lines.push('  exit 64');
  lines.push('fi');
  lines.push('');
  lines.push('# 1) Verify the ZIP unpacks to the expected file set.');
  lines.push('TMPDIR=$(mktemp -d)');
  lines.push('trap "rm -rf $TMPDIR" EXIT');
  lines.push('unzip -q -d "$TMPDIR" "$PACK_PATH"');
  lines.push('test -f "$TMPDIR/manifest.json" || { echo "manifest.json missing" >&2; exit 65; }');
  lines.push(`test -f "$TMPDIR/${REPRO_REPLAY_SCRIPT_FILENAME}" || { echo "${REPRO_REPLAY_SCRIPT_FILENAME} missing" >&2; exit 65; }`);
  lines.push('');
  lines.push('# 2) Run the offline Node verifier (manifest_hash + section hashes + chain).');
  lines.push('if command -v node >/dev/null 2>&1 && [ -f "$TMPDIR/verify.mjs" ]; then');
  lines.push('  node "$TMPDIR/verify.mjs" "$PACK_PATH"');
  lines.push('  exit $?');
  lines.push('fi');
  lines.push('');
  lines.push('# 3) Fallback when node is not available: parse manifest_hash and verify manually.');
  lines.push('MANIFEST_FILE="$TMPDIR/manifest.json"');
  lines.push('EXPECTED_HASH=$(jq -r .manifest_hash "$MANIFEST_FILE")');
  lines.push('echo "[manifest-hash] expected: $EXPECTED_HASH"');
  lines.push('if command -v sha256sum >/dev/null 2>&1; then');
  lines.push('  RECOMPUTED=$(jq -cS \'del(.manifest_hash)\' "$MANIFEST_FILE" | tr -d "\\n" | sha256sum | awk \'{print $1}\')');
  lines.push('else');
  lines.push('  RECOMPUTED=$(jq -cS \'del(.manifest_hash)\' "$MANIFEST_FILE" | tr -d "\\n" | shasum -a 256 | awk \'{print $1}\')');
  lines.push('fi');
  lines.push('echo "[manifest-hash] recomputed: $RECOMPUTED"');
  lines.push('if [ "$EXPECTED_HASH" = "$RECOMPUTED" ]; then');
  lines.push('  echo "PASS manifest hash matches"');
  lines.push('  exit 0');
  lines.push('else');
  lines.push('  echo "FAIL manifest hash mismatch" >&2');
  lines.push('  exit 1');
  lines.push('fi');
  lines.push('');
  // Trailing newline keeps the script POSIX-friendly.
  return lines.join('\n') + '\n';
}

/**
 * Static offline verifier shipped inside the pack.
 *
 * Single-file ESM module — no external deps beyond Node's stdlib. Reads
 * the pack ZIP via Node's built-in node:zlib + manual ZIP-end parsing
 * (we keep this small; pack ZIPs are stored uncompressed for predictability).
 *
 * Returns exit code 0 on pass, 1 on any verification failure.
 */
export function renderOfflineVerifier(): string {
  // The verifier deliberately mirrors PackVerifier's logic so external
  // auditors can read a single file and understand exactly what the
  // verifier checks. We intentionally re-implement canonical-JSON and
  // SHA-256 inline rather than importing from this package.
  return `// ChainSight Reproducibility Pack offline verifier (Phase-1 v1)
// Usage: node verify.mjs <pack.zip>
//
// Exit codes:
//   0 — every check passed (manifest hash + section hashes + hash chain).
//   1 — at least one check failed.
//   2 — pack could not be parsed (corrupt ZIP, missing files).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
function sha256Hex(s) {
  return createHash('sha256').update(typeof s === 'string' ? Buffer.from(s, 'utf8') : s).digest('hex');
}

function readZipFile(zip, name) {
  // Read local file headers; supports STORED (method 0) only.
  const eocdSig = 0x06054b50;
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === eocdSig) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('eocd not found');
  const cdEntries = zip.readUInt16LE(eocd + 10);
  const cdOffset = zip.readUInt32LE(eocd + 16);
  let p = cdOffset;
  for (let i = 0; i < cdEntries; i++) {
    const sig = zip.readUInt32LE(p);
    if (sig !== 0x02014b50) throw new Error('bad central dir sig');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const uncompSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const entryName = zip.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (entryName === name) {
      if (method !== 0) throw new Error('only stored entries supported');
      // Local header: skip 30 + nameLen + extraLen
      const lhExtraLen = zip.readUInt16LE(localOff + 28);
      const lhNameLen = zip.readUInt16LE(localOff + 26);
      const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
      return zip.slice(dataStart, dataStart + (compSize || uncompSize));
    }
  }
  throw new Error('entry not found: ' + name);
}

const packPath = process.argv[2];
if (!packPath) { console.error('usage: node verify.mjs <pack.zip>'); process.exit(64); }
let zip;
try { zip = readFileSync(packPath); }
catch (e) { console.error('could not read pack:', e.message); process.exit(2); }
let manifest;
try {
  const buf = readZipFile(zip, 'manifest.json');
  manifest = JSON.parse(buf.toString('utf8'));
} catch (e) { console.error('could not parse manifest:', e.message); process.exit(2); }

let failed = false;
function check(name, ok, detail = '') {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!ok) failed = true;
}

// 1) Manifest hash.
const expectedManifestHash = manifest.manifest_hash;
const withoutHash = { ...manifest, manifest_hash: undefined };
const recomputed = sha256Hex(canonicalJson(withoutHash));
check('manifest_hash', recomputed === expectedManifestHash, '(expected ' + expectedManifestHash + ')');

// 2) Section hashes.
for (const [name, section] of Object.entries(manifest.sections)) {
  const expected = section.section_hash;
  const copy = { ...section, section_hash: undefined };
  const got = sha256Hex(canonicalJson(copy));
  check('section[' + name + ']', got === expected);
}

// 3) Hash chain across atoms.
const atomsById = new Map();
for (const a of manifest.sections.atoms.atoms) atomsById.set(a.id, a);
let chainOk = true;
for (const a of manifest.sections.atoms.atoms) {
  const parent = a.parent_atom_id ? atomsById.get(a.parent_atom_id) : null;
  const parentHash = parent ? parent.payload_hash : '';
  const expectedLink = sha256Hex(a.payload_hash + parentHash);
  if (expectedLink !== a.chain_link_hash) { chainOk = false; break; }
}
check('hash_chain', chainOk);

process.exit(failed ? 1 : 0);
`;
}
