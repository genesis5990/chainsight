/**
 * PackBuilder — pure-function pack builder (v1.0 Backend §1.8).
 *
 * `build()` returns { manifest, bytes } where bytes is the ZIP. The pack
 * is content-addressed by manifest_hash; two builds from the same case
 * state produce byte-identical bytes — verified by determinism tests.
 */

import { zipSync, type Zippable } from 'fflate';
import type {
  CaseId,
  FrozenAgentCall,
  FrozenAtom,
  FrozenAttributionRow,
  FrozenEvent,
  FrozenInspectorRun,
  FrozenMathRecipe,
  FrozenNarrative,
  FrozenProviderResponse,
  FrozenTrace,
  ManifestAgentCallsSection,
  ManifestAtomsSection,
  ManifestAttributionSection,
  ManifestEventsSection,
  ManifestInspectorRunsSection,
  ManifestMathRecipesSection,
  ManifestNarrativesSection,
  ManifestProviderResponsesSection,
  ManifestReplayScriptSection,
  ManifestRuleVersionsSection,
  ManifestSections,
  ManifestTracesSection,
  PackBuildRequest,
  PackManifest,
} from '@chainsight/shared-types';
import {
  REPRO_MANIFEST_FILENAME,
  REPRO_PACK_VERSION,
  REPRO_REPLAY_SCRIPT_FILENAME,
} from '@chainsight/shared-types';
import type { CaseSource } from './case_source';
import { canonicalJson, chainLinkHash, hashValue, sha256Hex } from './canonical';
import { renderOfflineVerifier, renderReplayScript } from './replay_script';

export interface PackBuilderOptions {
  source: CaseSource;
  /** Deterministic clock — pass to tests for repeatable built_at. */
  now: () => string;
  /** Deterministic pack_id generator — keyed off (manifest_hash, case_id) by default. */
  packIdProvider: (input: { case_id: CaseId; manifest_hash: string }) => string;
}

export interface PackBuildOutput {
  pack_id: string;
  manifest: PackManifest;
  /** ZIP bytes. */
  bytes: Uint8Array;
  /** Filenames inside the zip → bytes (useful for tests). */
  files: Record<string, Uint8Array>;
}

export class PackBuilder {
  constructor(private readonly opts: PackBuilderOptions) {}

  async build(req: PackBuildRequest): Promise<PackBuildOutput> {
    const built_at = this.opts.now();
    const source = this.opts.source;
    const case_id = req.case_id;

    // ── 1. Collect inputs ─────────────────────────────────────────────
    const [
      atoms, events, math_recipes, provider_responses,
      traces, inspector_runs, agent_calls, attributions,
      narratives, rule_versions,
    ] = await Promise.all([
      source.loadAtoms(case_id),
      source.loadEvents(case_id),
      source.loadMathRecipes(case_id),
      source.loadProviderResponses(case_id),
      source.loadTraces(case_id),
      source.loadInspectorRuns(case_id),
      source.loadAgentCalls(case_id),
      source.loadAttributions(case_id),
      source.loadNarratives(case_id),
      source.loadRuleVersions(case_id),
    ]);

    // ── 2. Stable-sort + compute hash-chain links ────────────────────
    const sortedAtoms = sortAtoms(atoms);
    const linkedAtoms = computeChainLinks(sortedAtoms);
    const sortedEvents = sortEvents(events);
    const sortedRecipes = sortByKey(math_recipes, (r) => r.recipe_hash);
    const sortedResponses = sortByKey(provider_responses, (r) => r.request_hash);
    const sortedTraces = sortByKey(traces, (t) => t.job_id);
    const sortedInspectorRuns = sortByKey(inspector_runs, (r) => r.run_id);
    const sortedAgentCalls = sortByKey(agent_calls, (c) => c.input_hash);
    const sortedAttributions = sortByKey(attributions, (a) => `${a.subject_ref}|${a.source_dataset}`);
    const sortedNarratives = sortByKey(narratives, (n) => `${n.context}|${n.ref_id}`);

    // ── 3. Build sections (without section_hash) ─────────────────────
    const atomsSection: ManifestAtomsSection = {
      section_hash: '',
      count: linkedAtoms.length,
      atoms: linkedAtoms,
    };
    const eventsSection: ManifestEventsSection = {
      section_hash: '', count: sortedEvents.length, events: sortedEvents,
    };
    const recipesSection: ManifestMathRecipesSection = {
      section_hash: '', count: sortedRecipes.length, recipes: sortedRecipes,
    };
    const responsesSection: ManifestProviderResponsesSection = {
      section_hash: '', count: sortedResponses.length, responses: sortedResponses,
    };
    const tracesSection: ManifestTracesSection = {
      section_hash: '', count: sortedTraces.length, traces: sortedTraces,
    };
    const inspectorRunsSection: ManifestInspectorRunsSection = {
      section_hash: '', count: sortedInspectorRuns.length, runs: sortedInspectorRuns,
    };
    const agentCallsSection: ManifestAgentCallsSection = {
      section_hash: '', count: sortedAgentCalls.length, calls: sortedAgentCalls,
    };
    const ruleVersionsSection: ManifestRuleVersionsSection = {
      section_hash: '', versions: sortKeys(rule_versions),
    };
    const attributionSection: ManifestAttributionSection = {
      section_hash: '', count: sortedAttributions.length, rows: sortedAttributions,
    };
    const narrativesSection: ManifestNarrativesSection = {
      section_hash: '', count: sortedNarratives.length, transcripts: sortedNarratives,
    };

    const stats = {
      total_atoms: linkedAtoms.length,
      total_events: sortedEvents.length,
      total_traces: sortedTraces.length,
      total_math_recipes: sortedRecipes.length,
      total_provider_responses: sortedResponses.length,
    };
    // Replay script body depends only on (case_id, built_at, stats) — stable
    // before any hashes are computed. pack_id + manifest_hash are read from
    // manifest.json at verify time, not baked into the script.
    const replayScript = renderReplayScript({ case_id, built_at, stats });
    // Compute section hashes (placeholder script hash for now).
    atomsSection.section_hash         = hashValue(omitSectionHash(atomsSection));
    eventsSection.section_hash        = hashValue(omitSectionHash(eventsSection));
    recipesSection.section_hash       = hashValue(omitSectionHash(recipesSection));
    responsesSection.section_hash     = hashValue(omitSectionHash(responsesSection));
    tracesSection.section_hash        = hashValue(omitSectionHash(tracesSection));
    inspectorRunsSection.section_hash = hashValue(omitSectionHash(inspectorRunsSection));
    agentCallsSection.section_hash    = hashValue(omitSectionHash(agentCallsSection));
    ruleVersionsSection.section_hash  = hashValue(omitSectionHash(ruleVersionsSection));
    attributionSection.section_hash   = hashValue(omitSectionHash(attributionSection));
    narrativesSection.section_hash    = hashValue(omitSectionHash(narrativesSection));

    const replayScriptHash = sha256Hex(replayScript);
    const replayScriptSection: ManifestReplayScriptSection = {
      section_hash: '',
      filename: REPRO_REPLAY_SCRIPT_FILENAME,
      script_hash: replayScriptHash,
    };
    replayScriptSection.section_hash = hashValue(omitSectionHash(replayScriptSection));

    const sections: ManifestSections = {
      atoms: atomsSection,
      events: eventsSection,
      math_recipes: recipesSection,
      provider_responses: responsesSection,
      traces: tracesSection,
      inspector_runs: inspectorRunsSection,
      agent_calls: agentCallsSection,
      rule_versions: ruleVersionsSection,
      attribution_snapshot: attributionSection,
      narrative_transcripts: narrativesSection,
      replay_script: replayScriptSection,
    };

    // Chain tip = last atom's chain_link_hash (or '' for an empty case).
    const chainTipHash = linkedAtoms.length > 0 ? linkedAtoms[linkedAtoms.length - 1]!.chain_link_hash : '';
    const chainTipSeq = linkedAtoms.length > 0 ? linkedAtoms[linkedAtoms.length - 1]!.event_seq : 0;

    // ── 4. Manifest WITHOUT manifest_hash → compute hash → fill it in.
    const manifestWithoutHash: Omit<PackManifest, 'manifest_hash' | 'pack_id'> & { pack_id: 'PENDING'; manifest_hash: '' } = {
      pack_version: REPRO_PACK_VERSION,
      pack_id: 'PENDING',
      case_id,
      agency_id: req.agency_id,
      built_by_id: req.built_by_id,
      built_at,
      chain_tip_seq: chainTipSeq,
      chain_tip_hash: chainTipHash,
      sections,
      signature: null,
      stats,
      manifest_hash: '',
    };
    const manifestHashWithoutPackId = hashValue(omitVolatile(manifestWithoutHash));
    const pack_id = this.opts.packIdProvider({ case_id, manifest_hash: manifestHashWithoutPackId });

    // The final manifest fills pack_id + manifest_hash. manifest_hash is
    // computed over the manifest with manifest_hash field set to '' but with
    // the real pack_id, so the hash is determined by (everything except the
    // hash field itself). Including pack_id in the hashed payload means the
    // same case state on different runs produces the same hash (because
    // pack_id is derived from manifest_hash via packIdProvider).
    const manifestWithPackId = { ...manifestWithoutHash, pack_id };
    const manifest_hash = hashValue(omitManifestHash(manifestWithPackId));
    const manifest: PackManifest = { ...manifestWithPackId, manifest_hash };

    // ── 5. Assemble ZIP (deterministic: STORED method, sorted entries) ─
    const verifierBytes = new TextEncoder().encode(renderOfflineVerifier());
    const manifestJsonStr = canonicalJson(manifest);
    const manifestBytes = new TextEncoder().encode(manifestJsonStr);
    const replayScriptBytes = new TextEncoder().encode(replayScript);

    const files: Record<string, Uint8Array> = {
      [REPRO_MANIFEST_FILENAME]: manifestBytes,
      [REPRO_REPLAY_SCRIPT_FILENAME]: replayScriptBytes,
      'verify.mjs': verifierBytes,
    };
    const bytes = assembleZipDeterministic(files);

    void replayScriptHash; // already baked into section_hash via the section payload.

    return { pack_id, manifest, bytes, files };
  }
}

/* ─── ordering + chain-link helpers ────────────────────────────────────── */

function sortAtoms(atoms: FrozenAtom[]): FrozenAtom[] {
  return atoms.slice().sort((a, b) => {
    if (a.event_seq !== b.event_seq) return a.event_seq - b.event_seq;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function sortEvents(events: FrozenEvent[]): FrozenEvent[] {
  return events.slice().sort((a, b) => a.event_seq - b.event_seq);
}

function sortByKey<T>(items: T[], key: (t: T) => string): T[] {
  return items.slice().sort((a, b) => {
    const ka = key(a); const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function sortKeys(obj: Record<string, string>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k]!;
  return sorted;
}

function computeChainLinks(atoms: FrozenAtom[]): FrozenAtom[] {
  const byId = new Map<string, FrozenAtom>();
  const out: FrozenAtom[] = [];
  for (const a of atoms) {
    const parent = a.parent_atom_id ? byId.get(a.parent_atom_id) : null;
    const parentHash = parent?.payload_hash ?? null;
    const chain_link_hash = chainLinkHash(a.payload_hash, parentHash);
    const linked: FrozenAtom = { ...a, chain_link_hash };
    out.push(linked);
    byId.set(linked.id, linked);
  }
  return out;
}

function omitSectionHash<T extends { section_hash: string }>(section: T): Omit<T, 'section_hash'> {
  const copy = { ...section };
  delete (copy as Record<string, unknown>).section_hash;
  return copy;
}

function omitManifestHash<T extends { manifest_hash: string }>(m: T): Omit<T, 'manifest_hash'> {
  const copy = { ...m };
  delete (copy as Record<string, unknown>).manifest_hash;
  return copy;
}

function omitVolatile<T extends { manifest_hash: string; pack_id: string }>(m: T): Omit<T, 'manifest_hash' | 'pack_id'> {
  const copy = { ...m };
  delete (copy as Record<string, unknown>).manifest_hash;
  delete (copy as Record<string, unknown>).pack_id;
  return copy;
}

/* ─── ZIP assembly (deterministic) ─────────────────────────────────────── */

/**
 * Assemble a STORED-only (level 0) ZIP with sorted filenames + frozen mtime
 * so two calls with the same files produce byte-identical output.
 *
 * fflate's zipSync supports level 0 via `{ level: 0 }`, and accepts an
 * mtime to freeze headers. We use `1980-01-01T00:00:00Z` which is the ZIP
 * format's epoch minimum — every consumer renders the same value back.
 */
function assembleZipDeterministic(files: Record<string, Uint8Array>): Uint8Array {
  const frozenMtime = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
  const zippable: Zippable = {};
  for (const name of Object.keys(files).sort()) {
    zippable[name] = [files[name]!, { level: 0, mtime: frozenMtime }];
  }
  return zipSync(zippable);
}
