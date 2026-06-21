/**
 * Inspector Runner (v1.1 §5.3).
 *
 * Orchestrates the 8-section state machine for one tx_ref + methodology.
 * Emits InspectorEvent objects (caller is responsible for forwarding to a
 * Redis pub/sub channel or whatever transport carries them to the Web).
 *
 * For Phase-1 Week-3 the LLM and chain-data clients are stubs; both swap to
 * real implementations in Week 4 (Capability Router) without touching this
 * orchestration logic.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgencyContext,
  BeliefAtom,
  BeliefAtomId,
  BeliefStateService,
  CaseId,
  InspectorEvent,
  InspectorRunRequest,
  InspectorRunResult,
  InspectorSectionId,
  PipelineInspectorCitations,
  PipelineInspectorCounterpartyAttribution,
  PipelineInspectorDecodedAction,
  PipelineInspectorHeader,
  PipelineInspectorMethodology,
  PipelineInspectorNarrative,
  PipelineInspectorParties,
  PipelineInspectorValueFees,
  SubjectRef,
  TxRef,
} from '@chainsight/shared-types';
import { MathClient } from '@chainsight/math-client';
import type { ChainProvider, ChainTxFixture } from './chain_provider_stub';
import { verifyCitations } from './citation_verifier';
import type { LlmNarrativeClient } from './llm_stub';

export interface InspectorRunnerOptions {
  belief: BeliefStateService;
  math: MathClient;
  chain: ChainProvider;
  llm: LlmNarrativeClient;
  /** Optional emitter — if omitted, events are still returned in the result. */
  emit?: (event: InspectorEvent) => void | Promise<void>;
}

export class InspectorRunner {
  constructor(private readonly opts: InspectorRunnerOptions) {}

  async run(req: InspectorRunRequest): Promise<InspectorRunResult> {
    const run_id = randomUUID();
    const methodology = req.methodology ?? 'fifo';
    const ctx = this.buildAgencyContext(req);

    const recipe_bundle: Partial<Record<InspectorSectionId, string>> = {};
    const emitted_atom_ids: BeliefAtomId[] = [];

    await this.emit({ kind: 'run_started', run_id, tx_ref: req.tx_ref, cached: false });

    // ── §1 header + §2 parties (single chain-data fetch) ──────────────────
    const fixture = await this.opts.chain.fetchTx(req.tx_ref);
    if (!fixture) {
      const err = `chain provider returned no fixture for ${req.tx_ref}`;
      await this.emit({ kind: 'run_failed', run_id, section: 'header', error: err });
      throw new Error(err);
    }

    const header: PipelineInspectorHeader = {
      chain: fixture.chain,
      tx_hash: fixture.tx_hash,
      block_hash: fixture.block_hash,
      block_height: fixture.block_height,
      block_time_utc: fixture.block_time_utc,
      index_in_block: fixture.index_in_block,
      status: fixture.status,
      fee_native_minor: fixture.fee_native_minor,
    };
    await this.emit({ kind: 'section_ready', run_id, section: 'header', payload: header });
    recipe_bundle.header = await this.hashSection('header', header);

    const parties: PipelineInspectorParties = { parties: fixture.parties };
    await this.emit({ kind: 'section_ready', run_id, section: 'parties', payload: parties });
    recipe_bundle.parties = await this.hashSection('parties', parties);

    // ── §3 decoded action (Math) ──────────────────────────────────────────
    const decode = await this.opts.math.decodeAction(
      {
        chain: fixture.chain,
        tx_hash: fixture.tx_hash,
        selector: fixture.selector,
        contract: fixture.contract,
      },
      { actor_id: req.actor_id, agency_id: req.agency_id },
    );
    const decoded: PipelineInspectorDecodedAction = {
      selector: decode.selector ?? undefined,
      signature: decode.signature ?? undefined,
      action_kind: decode.action_kind,
      confidence: decode.confidence,
      decoded: { ...decode.decoded, block_height: fixture.block_height },
      math_recipe_hash: decode.recipe_hash,
    };
    await this.emit({ kind: 'section_ready', run_id, section: 'decoded_action', payload: decoded });
    recipe_bundle.decoded_action = decode.recipe_hash;

    // ── §4 value + fees (Math) ────────────────────────────────────────────
    const [valueResp, feeResp] = await Promise.all([
      this.opts.math.computeValueAtBlock(
        {
          chain: fixture.chain,
          amount_minor: fixture.value_native_minor,
          block_height: fixture.block_height,
        },
        { actor_id: req.actor_id, agency_id: req.agency_id },
      ),
      this.opts.math.computeFeeInFiat(
        {
          chain: fixture.chain,
          block_height: fixture.block_height,
          gas_used: fixture.gas_used,
          gas_price_minor: fixture.gas_price_minor,
          fee_native_minor: fixture.gas_used === undefined ? fixture.fee_native_minor : undefined,
        },
        { actor_id: req.actor_id, agency_id: req.agency_id },
      ),
    ]);
    const value_fees: PipelineInspectorValueFees = {
      value_native_minor: valueResp.value_native_minor,
      value_native_major: valueResp.value_native_major,
      value_fiat: valueResp.value_fiat,
      fiat_currency: valueResp.fiat_currency,
      price_used: valueResp.price_used,
      price_source: valueResp.price_source,
      fee_native_minor: feeResp.fee_native_minor,
      fee_fiat: feeResp.fee_fiat,
      math_recipe_hashes: { value: valueResp.recipe_hash, fee: feeResp.recipe_hash },
    };
    await this.emit({ kind: 'section_ready', run_id, section: 'value_fees', payload: value_fees });
    recipe_bundle.value_fees = combineHashes([valueResp.recipe_hash, feeResp.recipe_hash]);

    // ── Emit structural BeliefAtoms (asserted by chain data) ──────────────
    const txSubject = `${fixture.chain}_tx:${fixture.tx_hash}` as TxRef;
    const fromParty = fixture.parties.find((p) => p.role === 'from');
    const toParty   = fixture.parties.find((p) => p.role === 'to') ?? fixture.parties.find((p) => p.role === 'token_to');

    const txExistsAtom = await this.opts.belief.emit(
      {
        case_id: req.case_id,
        subject_ref: txSubject,
        predicate: 'tx_exists',
        object_payload: {
          tx_hash: fixture.tx_hash,
          block_height: fixture.block_height,
          block_hash: fixture.block_hash,
          block_time_utc: fixture.block_time_utc,
          from: fromParty?.address_ref,
          to: toParty?.address_ref,
        },
        basis: 'T0',
        basis_detail: `chain provider fixture (block ${fixture.block_height})`,
        emitted_by_kind: 'system',
        emitted_by_id: req.actor_id,
      },
      ctx,
    );
    emitted_atom_ids.push(txExistsAtom.id);

    let addressSentAtom: BeliefAtom | undefined;
    let addressReceivedAtom: BeliefAtom | undefined;
    if (fromParty && toParty) {
      addressSentAtom = await this.opts.belief.emit(
        {
          case_id: req.case_id,
          subject_ref: fromParty.address_ref,
          predicate: 'address_sent',
          object_payload: {
            tx_hash: fixture.tx_hash,
            counterparty: toParty.address_ref,
            value_native_minor: fixture.value_native_minor,
            block_height: fixture.block_height,
            edge_index: 0,
          },
          basis: 'T0',
          basis_detail: 'inspector pipeline §3',
          emitted_by_kind: 'system',
          emitted_by_id: req.actor_id,
          parent_atom_id: txExistsAtom.id,
        },
        ctx,
      );
      addressReceivedAtom = await this.opts.belief.emit(
        {
          case_id: req.case_id,
          subject_ref: toParty.address_ref,
          predicate: 'address_received',
          object_payload: {
            tx_hash: fixture.tx_hash,
            counterparty: fromParty.address_ref,
            value_native_minor: fixture.value_native_minor,
            block_height: fixture.block_height,
            edge_index: 0,
          },
          basis: 'T0',
          basis_detail: 'inspector pipeline §3',
          emitted_by_kind: 'system',
          emitted_by_id: req.actor_id,
          parent_atom_id: txExistsAtom.id,
        },
        ctx,
      );
      emitted_atom_ids.push(addressSentAtom.id, addressReceivedAtom.id);
    }

    // has_value_at_block atom
    const valueAtBlockAtom = await this.opts.belief.emit(
      {
        case_id: req.case_id,
        subject_ref: txSubject,
        predicate: 'has_value_at_block',
        object_payload: {
          value_native_minor: valueResp.value_native_minor,
          value_fiat: valueResp.value_fiat,
          fiat_currency: valueResp.fiat_currency,
          price_used: valueResp.price_used,
          price_source: valueResp.price_source,
          block_height: fixture.block_height,
        },
        basis: 'T2',
        basis_detail: `math recipe ${valueResp.recipe_hash.slice(0, 12)}…`,
        emitted_by_kind: 'system',
        emitted_by_id: req.actor_id,
        parent_atom_id: txExistsAtom.id,
        reproducibility_inputs: { math_recipe_hash: valueResp.recipe_hash },
      },
      ctx,
    );
    emitted_atom_ids.push(valueAtBlockAtom.id);

    // ── §5 methodology ────────────────────────────────────────────────────
    // Phase-1 Week-3: skipped unless a hop with lots is configured. The
    // section ALWAYS renders so the UI knows where to put it.
    const methodologyOut: PipelineInspectorMethodology = {
      methodology,
      applied: false,
      selections: [],
      total_attributed_minor: '0',
      total_taint_minor: '0',
      skip_reason: 'No existing lots supplied (Week 4 wires lot retrieval).',
    };
    await this.emit({ kind: 'section_ready', run_id, section: 'methodology', payload: methodologyOut });
    recipe_bundle.methodology = await this.hashSection('methodology', methodologyOut);

    // ── §6 counterparty attribution ───────────────────────────────────────
    const attributionAtoms: { atom_id: BeliefAtomId; predicate: string; subject_ref: string }[] = [];
    const attributionResults: PipelineInspectorCounterpartyAttribution['attributions'] = [];

    for (const p of fixture.parties) {
      if (p.known_attribution) {
        const atom = await this.opts.belief.emit(
          {
            case_id: req.case_id,
            subject_ref: p.address_ref,
            predicate: 'has_attribution',
            object_payload: {
              label: p.display_label ?? p.known_attribution,
              attribution_kind: p.known_attribution.toLowerCase().replace(/\s+/g, '_'),
            },
            basis: 'T2',
            basis_detail: `chain provider fixture attribution: ${p.known_attribution}`,
            emitted_by_kind: 'agent',
            emitted_by_id: req.actor_id,
            parent_atom_id: txExistsAtom.id,
          },
          ctx,
        );
        emitted_atom_ids.push(atom.id);
        attributionAtoms.push({ atom_id: atom.id, predicate: 'has_attribution', subject_ref: p.address_ref });
        attributionResults.push({
          subject_ref: p.address_ref,
          label: p.display_label ?? p.known_attribution,
          category: p.known_attribution,
          confidence: atom.confidence.value,
          atom_id: atom.id,
          source: 'attribution_agent_stub',
        });
      } else {
        attributionResults.push({
          subject_ref: p.address_ref,
          label: p.display_label ?? 'unattributed',
          category: 'unattributed',
          confidence: 0,
          source: 'none',
        });
      }
    }
    const attribution: PipelineInspectorCounterpartyAttribution = { attributions: attributionResults };
    await this.emit({
      kind: 'section_ready', run_id, section: 'counterparty_attribution', payload: attribution,
    });
    recipe_bundle.counterparty_attribution = await this.hashSection('counterparty_attribution', attribution);

    // Emit a tracking event so the Web can wire any newly-discovered atoms
    await this.emit({ kind: 'atoms_emitted', run_id, atom_ids: emitted_atom_ids.slice() });

    // ── §7 narrative (LLM stream) ─────────────────────────────────────────
    let narrative: PipelineInspectorNarrative | undefined;
    let citations: PipelineInspectorCitations | undefined;
    const include_narrative = req.include_narrative ?? true;
    if (include_narrative) {
      const available_atoms = [
        { atom_id: txExistsAtom.id, predicate: 'tx_exists', subject_ref: txSubject as SubjectRef },
        ...(addressSentAtom     ? [{ atom_id: addressSentAtom.id,     predicate: 'address_sent',     subject_ref: fromParty?.address_ref ?? '' as SubjectRef }] : []),
        ...(addressReceivedAtom ? [{ atom_id: addressReceivedAtom.id, predicate: 'address_received', subject_ref: toParty?.address_ref   ?? '' as SubjectRef }] : []),
        { atom_id: valueAtBlockAtom.id, predicate: 'has_value_at_block', subject_ref: txSubject as SubjectRef },
        ...attributionAtoms.map((a) => ({ atom_id: a.atom_id, predicate: a.predicate, subject_ref: a.subject_ref as SubjectRef })),
      ];

      const stream = this.opts.llm.generate({
        parties, decoded, value: value_fees, attribution, available_atoms,
      });

      for await (const tok of stream.tokens()) {
        await this.emit({ kind: 'narrative_token', run_id, token: tok });
      }

      const final = await stream.finalize();
      narrative = {
        text: final.text,
        finalized: true,
        model_id: final.model_id,
        token_count: final.token_count,
      };
      await this.emit({ kind: 'section_ready', run_id, section: 'narrative', payload: narrative });
      recipe_bundle.narrative = await this.hashSection('narrative', { model_id: final.model_id, text: final.text });

      // ── §8 citations ─────────────────────────────────────────────────────
      citations = verifyCitations({
        narrative: narrative.text,
        case_id: req.case_id,
        emitted: emitted_atom_ids.map((id) => ({ atom_id: id, case_id: req.case_id })),
      });
      await this.emit({ kind: 'section_ready', run_id, section: 'citations', payload: citations });
      recipe_bundle.citations = await this.hashSection('citations', citations);
    }

    // ── system 'inspector_run_completed' BeliefAtom ───────────────────────
    const runAtom = await this.opts.belief.emit(
      {
        case_id: req.case_id,
        subject_ref: txSubject,
        predicate: 'inspector_run_completed',
        object_payload: {
          tx_ref: req.tx_ref,
          methodology,
          section_hashes: recipe_bundle,
          emitted_atom_ids,
        },
        basis: 'T2',
        basis_detail: `inspector pipeline run ${run_id}`,
        emitted_by_kind: 'system',
        emitted_by_id: req.actor_id,
        reproducibility_inputs: { idempotency_key: req.idempotency_key, run_id },
      },
      ctx,
    );
    emitted_atom_ids.push(runAtom.id);

    await this.emit({
      kind: 'run_completed', run_id, emitted_atom_ids,
      recipe_hash_bundle: recipe_bundle as Record<InspectorSectionId, string>,
    });

    return {
      run_id,
      case_id: req.case_id,
      tx_ref: req.tx_ref,
      methodology,
      ran_at: new Date().toISOString(),
      ran_by_id: req.actor_id,
      cached: false,
      header,
      parties,
      decoded_action: decoded,
      value_fees,
      methodology_result: methodologyOut,
      counterparty_attribution: attribution,
      narrative,
      citations,
      emitted_atom_ids,
      recipe_hash_bundle: recipe_bundle,
    };
  }

  // ────────────────────────────────────────────────────────────────────────

  private async emit(event: InspectorEvent): Promise<void> {
    if (this.opts.emit) await this.opts.emit(event);
  }

  private buildAgencyContext(req: InspectorRunRequest): AgencyContext {
    return {
      user_id: req.actor_id,
      agency_id: req.agency_id,
      active_case_id: req.case_id,
      roles: ['investigator'],
      supervisory_scope_id: null,
      available_capabilities: [],
    };
  }

  /**
   * Stable per-section hash for the recipe bundle. Uses the same canonical
   * JSON convention as the belief-state hash module so a Reproducibility
   * Pack verifier can cross-check.
   */
  private async hashSection(section: InspectorSectionId, payload: unknown): Promise<string> {
    const { blake3 } = await import('@noble/hashes/blake3');
    const json = stableStringify({ section, payload });
    const bytes = blake3(json);
    return Buffer.from(bytes).toString('hex');
  }
}

// ─── stable stringify (matches belief-state canonical_json) ────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

function combineHashes(parts: string[]): string {
  // Concatenate-then-hash so the bundle hash differs from any single component.
  return parts.join(':');
}

// ── used types referenced in the import block ─────────────────────────────
// (kept as a type-only re-export so the public surface is small)
export type { ChainProvider, ChainTxFixture };
