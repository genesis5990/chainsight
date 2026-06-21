/**
 * RouterLlmClient — narrative client backed by the Capability Router.
 *
 * Phase 1 Week 4: Anthropic (Claude) via `llm_narrative` capability. The
 * Router enforces the BYOK Pillar — no system-wide LLM key. Streaming is
 * simulated by chunking the final text on word boundaries; real SSE
 * streaming lands when Anthropic's streaming endpoint is wired in Week 5.
 *
 * If the Router has no install for `llm_narrative`, falls back to a
 * provided stub so the pipeline still produces an explainable narrative.
 */

import type { AgencyContext } from '@chainsight/shared-types';
import type {
  AnthropicNarrativeResponse,
  CapabilityRouter,
} from '@chainsight/capability-router';
import {
  AllProvidersFailedError,
  CapabilityUnavailableError,
} from '@chainsight/capability-router';
import type { LlmNarrativeClient, LlmNarrativeInputs, LlmNarrativeStream } from './llm_stub';

export interface RouterLlmClientOptions {
  router: CapabilityRouter;
  ctx: AgencyContext;
  /** Fallback when no LLM install is configured. */
  fallback?: LlmNarrativeClient;
  /** Model override. */
  model?: string;
  /** Token-chunk delay in ms. Default 0 (instant). */
  token_interval_ms?: number;
  /** System prompt — defaults to the Inspector v1.1 §5.7 system text. */
  system_prompt?: string;
}

const DEFAULT_SYSTEM = `You are ChainSight's Inspector narrative agent. Produce a concise plain-language summary of a single blockchain transaction. Cite each factual claim using the marker ⟦atom:<id>⟧ where <id> is the BeliefAtom id of the supporting evidence. NEVER write a factual claim that you cannot cite. Sentences without citations will be flagged.`;

export class RouterLlmClient implements LlmNarrativeClient {
  constructor(private readonly opts: RouterLlmClientOptions) {}

  generate(inputs: LlmNarrativeInputs): LlmNarrativeStream {
    const tokenInterval = this.opts.token_interval_ms ?? 0;
    const promise = this.callRouter(inputs);

    return {
      async *tokens() {
        const { text } = await promise;
        const parts = text.split(/(\s+)/); // keep whitespace runs
        for (const tok of parts) {
          if (tokenInterval > 0) await new Promise((r) => setTimeout(r, tokenInterval));
          if (tok.length > 0) yield tok;
        }
      },
      finalize: async () => promise,
    };
  }

  private async callRouter(inputs: LlmNarrativeInputs): Promise<{ text: string; model_id: string; token_count: number }> {
    const prompt = renderPrompt(inputs);
    try {
      const result = await this.opts.router.resolve<AnthropicNarrativeResponse>(
        'llm_narrative',
        {
          prompt,
          system: this.opts.system_prompt ?? DEFAULT_SYSTEM,
          model: this.opts.model,
          max_tokens: 1024,
        },
        this.opts.ctx,
        { deadline_ms: inputs.deadline_ms ?? 10_000 },
      );
      return {
        text: result.data.text,
        model_id: result.data.model_id,
        token_count: (result.data.token_count?.input ?? 0) + (result.data.token_count?.output ?? 0),
      };
    } catch (err) {
      if (
        err instanceof CapabilityUnavailableError
        || err instanceof AllProvidersFailedError
      ) {
        if (this.opts.fallback) {
          const stream = this.opts.fallback.generate(inputs);
          return stream.finalize();
        }
      }
      throw err;
    }
  }
}

/* ─── prompt rendering ─────────────────────────────────────────────────── */

function renderPrompt(inputs: LlmNarrativeInputs): string {
  const lines: string[] = [];
  lines.push('# Inspector context');
  lines.push('');
  lines.push('## Parties');
  for (const p of inputs.parties.parties) {
    lines.push(`- ${p.role}: \`${p.address_ref}\`${p.display_label ? ` (${p.display_label})` : ''}`);
  }
  lines.push('');
  lines.push('## Decoded action');
  lines.push(`- kind: ${inputs.decoded.action_kind}${inputs.decoded.signature ? ` (${inputs.decoded.signature})` : ''}`);
  lines.push(`- confidence: ${inputs.decoded.confidence}`);
  lines.push('');
  lines.push('## Value + fees');
  lines.push(`- value: ${inputs.value.value_native_major ?? inputs.value.value_native_minor} (${inputs.value.value_fiat ?? '?'} ${inputs.value.fiat_currency})`);
  lines.push(`- fee:   ${inputs.value.fee_native_minor} (${inputs.value.fee_fiat ?? '?'} ${inputs.value.fiat_currency})`);
  lines.push('');
  lines.push('## Attribution');
  for (const a of inputs.attribution.attributions) {
    lines.push(`- ${a.subject_ref}: ${a.label} (${a.category}, conf=${a.confidence})`);
  }
  lines.push('');
  lines.push('## Available atom ids (cite using ⟦atom:<id>⟧)');
  for (const a of inputs.available_atoms) {
    lines.push(`- ⟦atom:${a.atom_id}⟧ → ${a.predicate} on \`${a.subject_ref}\``);
  }
  lines.push('');
  lines.push('## Task');
  lines.push('Write 3–5 sentences explaining what happened in this transaction. Cite every factual claim with the corresponding ⟦atom:<id>⟧ marker. Plain prose, no headings.');
  return lines.join('\n');
}
