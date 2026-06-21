/**
 * AnthropicConnector — implements llm_narrative (non-streaming) and
 * llm_narrative_stream (real SSE via the Anthropic Messages API).
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
  prompt: string;
  system?: string;
  max_tokens?: number;
  model?: string;
}

export interface AnthropicNarrativeResponse {
  text: string;
  model_id: string;
  token_count: { input: number; output: number };
  raw_provider_id: string;
}

export interface AnthropicConnectorOptions {
  base_url?: string;
  default_model?: string;
  api_version?: string;
  fetch_impl?: typeof fetch;
}

/** A single streamed token chunk surfaced by openStream(). */
export interface AnthropicStreamChunk {
  /** New text token delta (may be empty for non-text events). */
  text_delta: string;
  /** Set on the final event with token counts. */
  done?: boolean;
  model_id?: string;
  token_count?: { input: number; output: number };
}

export class AnthropicConnector implements ProviderConnector {
  readonly provider_id = 'anthropic';
  readonly capabilities: readonly Capability[] = ['llm_narrative', 'llm_narrative_stream'];

  constructor(private readonly opts: AnthropicConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability === 'llm_narrative_stream') {
      const final = await this.streamToCompletion(args, credential, options);
      return {
        data: final as unknown as TPayload,
        metadata: { tokens_used: final.token_count.input + final.token_count.output },
      };
    }
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

  /**
   * Open a true SSE stream against the Messages API. Yields one chunk per
   * `content_block_delta` SSE event. The final chunk includes `done: true`
   * with token counts from the `message_delta` event.
   */
  async *openStream(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): AsyncGenerator<AnthropicStreamChunk, void, void> {
    if (!credential?.secret) {
      throw new Error('AnthropicConnector.openStream requires a credential (BYOK)');
    }
    const req = args as unknown as AnthropicNarrativeRequest;
    if (!req.prompt) throw new Error('llm_narrative_stream requires `prompt`');

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ANTHROPIC_BASE;
    const model = req.model ?? this.opts.default_model ?? DEFAULT_MODEL;
    const apiVersion = this.opts.api_version ?? DEFAULT_VERSION;

    const body = {
      model,
      max_tokens: req.max_tokens ?? 1024,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      stream: true,
    };

    const res = await fetchImpl(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': credential.secret,
        'anthropic-version': apiVersion,
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      throw new Error(`anthropic stream HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    let buffered = '';
    let modelId = model;
    let inputTokens = 0;
    let outputTokens = 0;

    const decoder = new TextDecoder();
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        // SSE frames are delimited by blank lines.
        let frameEnd: number;
        while ((frameEnd = buffered.indexOf('\n\n')) !== -1) {
          const frame = buffered.slice(0, frameEnd);
          buffered = buffered.slice(frameEnd + 2);

          // Each frame has `event: <name>` and `data: <json>` lines.
          let dataLine = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('data: ')) dataLine = line.slice(6);
          }
          if (!dataLine) continue;
          let payload: AnthropicStreamEvent;
          try { payload = JSON.parse(dataLine) as AnthropicStreamEvent; }
          catch { continue; }

          if (payload.type === 'message_start' && payload.message?.model) {
            modelId = payload.message.model;
            if (payload.message.usage?.input_tokens !== undefined) {
              inputTokens = payload.message.usage.input_tokens;
            }
          } else if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
            const text = payload.delta.text ?? '';
            if (text.length > 0) yield { text_delta: text };
          } else if (payload.type === 'message_delta' && payload.usage?.output_tokens !== undefined) {
            outputTokens = payload.usage.output_tokens;
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }

    yield {
      text_delta: '',
      done: true,
      model_id: modelId,
      token_count: { input: inputTokens, output: outputTokens },
    };
  }

  /** Consume the stream and return a final AnthropicNarrativeResponse. */
  private async streamToCompletion(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<AnthropicNarrativeResponse> {
    let text = '';
    let model_id = this.opts.default_model ?? DEFAULT_MODEL;
    let token_count = { input: 0, output: 0 };
    for await (const chunk of this.openStream(args, credential, options)) {
      text += chunk.text_delta;
      if (chunk.done) {
        if (chunk.model_id) model_id = chunk.model_id;
        if (chunk.token_count) token_count = chunk.token_count;
      }
    }
    return { text, model_id, token_count, raw_provider_id: 'anthropic' };
  }
}

interface AnthropicRawResponse {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/* ─── SSE event shapes (minimal subset) ─────────────────────────────────── */

type AnthropicStreamEvent =
  | {
      type: 'message_start';
      message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    }
  | { type: 'content_block_delta'; delta?: { type?: string; text?: string } }
  | { type: 'content_block_start' | 'content_block_stop' | 'ping' | 'message_stop' }
  | { type: 'message_delta'; usage?: { output_tokens?: number } };
