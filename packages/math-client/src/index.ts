/**
 * @chainsight/math-client
 *
 * Typed client for the Python Math Service. The LLM never types numbers —
 * every value comes from a call to the Math Service. This package is what
 * the API and worker import to make those calls.
 *
 * Phase 0 Week 1: REST client. Phase 0 Week 2-3: switch to gRPC for hot path.
 */

export interface ValueAtBlockInput {
  chain: string;
  block_height: number;
  token_address?: string | null;
  amount_native: string;
}

export interface ValueAtBlockResult {
  chain: string;
  block_height: number;
  amount_native: string;
  amount_fiat_usd: string;
  method: string;
  rule_version: string;
}

export class MathClient {
  constructor(private readonly baseUrl: string) {}

  async computeValueAtBlock(input: ValueAtBlockInput): Promise<ValueAtBlockResult> {
    const res = await fetch(`${this.baseUrl}/v1/compute_value_at_block`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Math service responded ${res.status}`);
    return (await res.json()) as ValueAtBlockResult;
  }

  async health(): Promise<{ status: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    return (await res.json()) as { status: string };
  }
}
