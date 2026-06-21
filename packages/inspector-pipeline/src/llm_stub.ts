/**
 * LLM narrative client — Phase-1 Week-3 deterministic stub.
 *
 * Produces a templated narrative with embedded ⟦atom:id⟧ citations using the
 * BeliefAtoms already emitted earlier in the pipeline. Token-streams the
 * output at ~50 tokens/s by default so the section-streaming UX is realistic.
 *
 * Real BYOK client lands Week 4 via Capability Router. The interface is
 * shaped so the swap is type-only.
 */

import type {
  BeliefAtomId,
  PipelineInspectorParties,
  PipelineInspectorDecodedAction,
  PipelineInspectorValueFees,
  PipelineInspectorCounterpartyAttribution,
} from '@chainsight/shared-types';

export interface LlmNarrativeInputs {
  parties: PipelineInspectorParties;
  decoded: PipelineInspectorDecodedAction;
  value: PipelineInspectorValueFees;
  attribution: PipelineInspectorCounterpartyAttribution;
  /** Atom ids previously emitted by the pipeline, available for citation. */
  available_atoms: { atom_id: BeliefAtomId; predicate: string; subject_ref: string }[];
  /** Per-call deadline in ms. Default 8000. */
  deadline_ms?: number;
}

export interface LlmNarrativeStream {
  /** Yield tokens as they arrive. */
  tokens(): AsyncIterable<string>;
  /** Final assembled text + metadata. */
  finalize(): Promise<{ text: string; model_id: string; token_count: number }>;
}

export interface LlmNarrativeClient {
  generate(inputs: LlmNarrativeInputs): LlmNarrativeStream;
}

// ─── deterministic stub ─────────────────────────────────────────────────────

export class StubLlmClient implements LlmNarrativeClient {
  /** Make tests instant by default. Set >0 for realistic UX during dev. */
  constructor(private readonly tokenIntervalMs = 0) {}

  generate(inputs: LlmNarrativeInputs): LlmNarrativeStream {
    const text = buildNarrative(inputs);
    const tokenInterval = this.tokenIntervalMs;
    const tokens = text.split(/(\s+)/); // keep whitespace tokens
    let totalEmitted = 0;

    return {
      async *tokens() {
        for (const tok of tokens) {
          if (tokenInterval > 0) await new Promise((r) => setTimeout(r, tokenInterval));
          totalEmitted += 1;
          yield tok;
        }
      },
      async finalize() {
        return {
          text,
          model_id: 'chainsight-narrative-stub@v1',
          token_count: totalEmitted || tokens.length,
        };
      },
    };
  }
}

/**
 * Templated narrative. Every factual sentence is wrapped with a ⟦atom:id⟧
 * marker pointing at the relevant atom. Sentence boundaries are explicit
 * (one sentence per line) so the citation verifier can split deterministically.
 */
function buildNarrative(inputs: LlmNarrativeInputs): string {
  const atomBy = new Map(inputs.available_atoms.map((a) => [a.predicate, a.atom_id]));

  const txExists       = atomBy.get('tx_exists');
  const sentAtom       = atomBy.get('address_sent');
  const receivedAtom   = atomBy.get('address_received');
  const valueAtom      = atomBy.get('has_value_at_block');
  const attrAtom       = atomBy.get('has_attribution');

  const from = inputs.parties.parties.find((p) => p.role === 'from')?.address_ref ?? '<unknown>';
  const to   = inputs.parties.parties.find((p) => p.role === 'to')?.address_ref ?? '<unknown>';
  const value = inputs.value.value_native_major;
  const fiat  = inputs.value.value_fiat;
  const currency = inputs.value.fiat_currency;

  // One sentence per line so the verifier counts cleanly.
  const sentences: string[] = [];

  if (txExists) {
    sentences.push(
      `The transaction was included in block ${inputs.decoded.decoded.block_height ?? 'unknown'} and executed successfully \u27e6atom:${txExists}\u27e7.`,
    );
  }

  if (sentAtom && receivedAtom) {
    sentences.push(
      `It moved ${value} ${chainAssetSymbol(from)} from ${shorten(from)} to ${shorten(to)} \u27e6atom:${sentAtom}\u27e7 \u27e6atom:${receivedAtom}\u27e7.`,
    );
  }

  if (valueAtom) {
    sentences.push(
      `At the time of inclusion, that value was approximately ${fiat} ${currency} \u27e6atom:${valueAtom}\u27e7.`,
    );
  }

  // Counterparty attribution sentence (cited only if we have an attribution atom)
  const knownAttr = inputs.attribution.attributions[0];
  if (attrAtom && knownAttr) {
    sentences.push(
      `The counterparty ${shorten(knownAttr.subject_ref)} is attributed as ${knownAttr.label} \u27e6atom:${attrAtom}\u27e7.`,
    );
  } else {
    // Deliberately leave this sentence uncited so the verifier surfaces it.
    sentences.push(
      `The counterparty's attribution has not yet been corroborated.`,
    );
  }

  // Decoded action note
  if (inputs.decoded.action_kind !== 'unknown') {
    const kind = inputs.decoded.action_kind.replace(/_/g, ' ');
    if (txExists) {
      sentences.push(`The decoded action kind is ${kind} \u27e6atom:${txExists}\u27e7.`);
    } else {
      sentences.push(`The decoded action kind is ${kind}.`);
    }
  }

  return sentences.join('\n');
}

function shorten(ref: string): string {
  if (ref.length <= 24) return ref;
  return ref.slice(0, 14) + '\u2026' + ref.slice(-6);
}

function chainAssetSymbol(ref: string): string {
  const chain = ref.split(':')[0];
  switch (chain) {
    case 'eth':
    case 'arbitrum':
    case 'base':
      return 'ETH';
    case 'polygon':
      return 'MATIC';
    case 'btc':
      return 'BTC';
    case 'sol':
      return 'SOL';
    case 'tron':
      return 'TRX';
    default:
      return 'native';
  }
}
