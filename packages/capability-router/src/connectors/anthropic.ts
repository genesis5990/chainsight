/**
 * AnthropicConnector — implements llm_narrative via the Anthropic Messages API.
 *
 * Returns a single completed narrative string. Phase 1 Week 4 does NOT
 * stream — it returns the final text once Claude completes. The inspector
 * pipeline's RouterLlmClient adapter exposes a streaming-shaped surface by
 * chunking the final string on word boundaries; real streaming lands once
 * we wire SSE in Week 5.
 *
 * BYOK: the API key is resolved from the install's credential_ref. No
 * fallback to a system key — that would violate the BYOK Pillar.
 */

import type {
  Capability,
  ConnectorCallOptions,
  ConnectorResponse,
  ProviderConnector,
  ResolvedCredential,
} from '../types';

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-3-5-haiku-20241022';
const DEFAULT_VERSION = '2023-06-01';

export interface AnthropicNarrativeRequest {
  /** The fully-rendered prompt the LLM should respond to. */
  prompt: string;
  /** Optional system prompt. */
  system?: string;
  /** Max tokens (defaults to 1024). */
  max_tokens?: number;
  /** Model override. */
  model?: string;
}

export interface AnthropicNarrativeResponse {
  text: string;
  model_id: string;
  token_count: { input: number; output: number };
  /** Provider-side fingerprint (for audit). */
  raw_provider_id: string;
}

export interface AnthropicConnectorOptions {
  base_url?: string;
  default_model?: string;
  api_version?: string;
  fetch_impl?: typeof fetch;
}

export class AnthropicConnector implements ProviderConnector {
  readonly provider_id = 'anthropic';
  readonly capabilities: readonly Capability[] = ['llm_narrative'];

  constructor(private readonly opts: AnthropicConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability !== 'llm_narrative') {
      throw new Error(`AnthropicConnector does not support capability '${capability}'`);
    }
    if (!credential?.secret) {
      throw new Error('AnthropicConnector requires a credential (BYOK)');
    }
    const req = args as unknown as AnthropicNarrativeRequest;
    if (!req.prompt) throw new Error('llm_narrative requires `prompt`');

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ANTHROPIC_BASE;
    const model = req.model ?? this.opts.default_model ?? DEFAULT_MODEL;
    const apiVersion = this.opts.api_version ?? DEFAULT_VERSION;

    const body = {
      model,
      max_tokens: req.max_tokens ?? 1024,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
    };

    const res = await fetchImpl(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': credential.secret,
        'anthropic-version': apiVersion,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`anthropic HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = await res.json() as AnthropicRawResponse;

    const textParts = (json.content ?? [])
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text);
    const text = textParts.join('');

    const data: AnthropicNarrativeResponse = {
      text,
      model_id: json.model ?? model,
      token_count: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
      raw_provider_id: 'anthropic',
    };
    return {
      data: data as unknown as TPayload,
      metadata: {
        request_id: json.id,
        tokens_used: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      },
    };
  }
}

interface AnthropicRawResponse {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
