/**
 * RouterLlmClient — narrative client backed by the Capability Router.
 *
 * Two modes:
 *   1. Buffered (default): calls `llm_narrative` through the router. The
 *      router's L1/L2 cache applies; final text is returned and chunked on
 *      whitespace boundaries so existing callers see token-by-token events.
 *   2. Real SSE streaming (opt-in via `streaming` opts): bypasses the router
 *      cache and consumes the Anthropic SSE stream directly. The router
 *      contract assumes a buffered payload so streaming is wired outside it.
 *
 * If the Router has no install for `llm_narrative`, falls back to the
 * provided stub so the pipeline still produces an explainable narrative.
 */

import type { AgencyContext } from '@chainsight/shared-types';
import type {
  AnthropicConnector,
  AnthropicNarrativeResponse,
  CapabilityRouter,
  ConnectorCallOptions,
  CredentialStore,
  InstallRegistry,
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
  /**
   * Optional streaming wiring. When supplied with an Anthropic connector +
   * install registry + credential store, RouterLlmClient consumes the
   * Anthropic SSE stream directly so callers see real per-token deltas.
   */
  streaming?: {
    connector: AnthropicConnector;
    installs: InstallRegistry;
    credentials: CredentialStore;
    /** Deadline for the SSE roundtrip. Default 10s. */
    deadline_ms?: number;
  };
}

const DEFAULT_SYSTEM = `You are ChainSight's Inspector narrative agent. Produce a concise plain-language summary of a single blockchain transaction. Cite each factual claim using the marker ⟦atom:<id>⟧ where <id> is the BeliefAtom id of the supporting evidence. NEVER write a factual claim that you cannot cite. Sentences without citations will be flagged.`;

export class RouterLlmClient implements LlmNarrativeClient {
  constructor(private readonly opts: RouterLlmClientOptions) {}

  generate(inputs: LlmNarrativeInputs): LlmNarrativeStream {
    if (this.opts.streaming) {
      return this.generateStreaming(inputs);
    }
    return this.generateBuffered(inputs);
  }

  /* ─── buffered (non-streaming) ─────────────────────────────────────── */

  private generateBuffered(inputs: LlmNarrativeInputs): LlmNarrativeStream {
    const tokenInterval = this.opts.token_interval_ms ?? 0;
    const promise = this.callRouter(inputs);

    return {
      async *tokens() {
        const { text } = await promise;
        const parts = text.split(/(\s+)/);
        for (const tok of parts) {
          if (tokenInterval > 0) await new Promise((r) => setTimeout(r, tokenInterval));
          if (tok.length > 0) yield tok;
        }
      },
      finalize: async () => promise,
    };
  }

  /* ─── real SSE streaming (opt-in) ──────────────────────────────────── */

  private generateStreaming(inputs: LlmNarrativeInputs): LlmNarrativeStream {
    const streamingOpts = this.opts.streaming!;
    const prompt = renderPrompt(inputs);
    const system = this.opts.system_prompt ?? DEFAULT_SYSTEM;
    const model = this.opts.model;
    const deadline_ms = inputs.deadline_ms ?? streamingOpts.deadline_ms ?? 10_000;
    const ctx = this.opts.ctx;

    const state = {
      text: '',
      model_id: model ?? 'claude-3-5-haiku-20241022',
      token_count: 0,
    };

    const self = this;
    async function* runStream(): AsyncGenerator<string, void, void> {
      const installs = await streamingOpts.installs.installsFor('llm_narrative_stream', ctx);
      const install = installs[0];
      const credential = install?.credential_ref
        ? await streamingOpts.credentials.resolve(install.credential_ref)
        : null;
      if (!install || (install.credential_ref && !credential)) {
        // No streaming install — fall back to buffered router call.
        const final = await self.callRouter(inputs);
        state.text = final.text;
        state.model_id = final.model_id;
        state.token_count = final.token_count;
        const parts = final.text.split(/(\s+)/);
        for (const tok of parts) if (tok.length > 0) yield tok;
        return;
      }

      const callOpts: ConnectorCallOptions = {
        deadline_ms,
        signal: AbortSignal.timeout(deadline_ms),
      };
      try {
        for await (const chunk of streamingOpts.connector.openStream(
          { prompt, system, model, max_tokens: 1024 },
          credential,
          callOpts,
        )) {
          if (chunk.text_delta.length > 0) {
            state.text += chunk.text_delta;
            yield chunk.text_delta;
          }
          if (chunk.done) {
            if (chunk.model_id) state.model_id = chunk.model_id;
            if (chunk.token_count) state.token_count = chunk.token_count.input + chunk.token_count.output;
          }
        }
      } catch (err) {
         
        console.warn('[router-llm] streaming failed, falling back to buffered response', { err });
        const final = await self.callRouter(inputs);
        const newText = final.text.slice(state.text.length); // surface only the unseen tail
        state.text = final.text;
        state.model_id = final.model_id;
        state.token_count = final.token_count;
        const parts = newText.split(/(\s+)/);
        for (const tok of parts) if (tok.length > 0) yield tok;
      }
    }

    const iterable = runStream();
    return {
      tokens: () => iterable,
      finalize: async () => ({
        text: state.text,
        model_id: state.model_id,
        token_count: state.token_count,
      }),
    };
  }

  /* ─── buffered router call ─────────────────────────────────────────── */

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
      if (err instanceof CapabilityUnavailableError || err instanceof AllProvidersFailedError) {
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
