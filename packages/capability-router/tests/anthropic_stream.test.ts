/**
 * Streaming AnthropicConnector tests — uses a mock fetch that returns an
 * SSE-shaped ReadableStream so we exercise the parser without live HTTP.
 */

import { describe, it, expect } from 'vitest';
import { AnthropicConnector, type AnthropicStreamChunk } from '../src/connectors/anthropic';
import type { ResolvedCredential } from '../src/types';

function makeSseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
  // The connector calls res.body.getReader(); the standard Response shape
  // exposes that. Constructing a Response from a ReadableStream works in
  // Node 18+.
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const cred: ResolvedCredential = { credential_ref: 'ANT_KEY', secret: 'sk-ant-test' };
const callOpts = { deadline_ms: 5_000 } as const;

describe('AnthropicConnector.openStream', () => {
  it('yields text deltas in order and a final done chunk', async () => {
    const frames = [
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-3-5-haiku-20241022', usage: { input_tokens: 12 } } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ', world' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '.' } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 4 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    ];
    const fetchImpl = (async () => makeSseResponse(frames)) as unknown as typeof fetch;
    const conn = new AnthropicConnector({ fetch_impl: fetchImpl });

    const chunks: AnthropicStreamChunk[] = [];
    for await (const c of conn.openStream({ prompt: 'hi' }, cred, callOpts)) chunks.push(c);

    const texts = chunks.filter((c) => c.text_delta.length > 0).map((c) => c.text_delta);
    expect(texts).toEqual(['Hello', ', world', '.']);

    const final = chunks.find((c) => c.done);
    expect(final).toBeDefined();
    expect(final?.model_id).toBe('claude-3-5-haiku-20241022');
    expect(final?.token_count).toEqual({ input: 12, output: 4 });
  });

  it('handles a frame split across two chunk reads', async () => {
    // Split the JSON for a content_block_delta across two fetch chunks.
    const half1 = `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'split test' } }).slice(0, 30)}`;
    const half2 = `${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'split test' } }).slice(30)}\n\n`;
    const fetchImpl = (async () => makeSseResponse([half1, half2])) as unknown as typeof fetch;
    const conn = new AnthropicConnector({ fetch_impl: fetchImpl });

    const texts: string[] = [];
    for await (const c of conn.openStream({ prompt: 'hi' }, cred, callOpts)) {
      if (c.text_delta) texts.push(c.text_delta);
    }
    expect(texts.join('')).toBe('split test');
  });

  it('throws when no credential supplied (BYOK)', async () => {
    const conn = new AnthropicConnector({ fetch_impl: (async () => makeSseResponse([])) as unknown as typeof fetch });
    await expect(async () => {
      for await (const _ of conn.openStream({ prompt: 'hi' }, null, callOpts)) { /* */ }
    }).rejects.toThrow(/requires a credential/);
  });

  it('llm_narrative_stream capability collects the full text via call()', async () => {
    const frames = [
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-3-5-haiku-20241022' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Op Lemon trace' } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: ' summary.' } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 6 } })}\n\n`,
    ];
    const fetchImpl = (async () => makeSseResponse(frames)) as unknown as typeof fetch;
    const conn = new AnthropicConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('llm_narrative_stream', { prompt: 'go' }, cred, callOpts);
    const data = res.data as { text: string; model_id: string; token_count: { input: number; output: number } };
    expect(data.text).toBe('Op Lemon trace summary.');
    expect(data.model_id).toBe('claude-3-5-haiku-20241022');
    expect(data.token_count.output).toBe(6);
  });
});
