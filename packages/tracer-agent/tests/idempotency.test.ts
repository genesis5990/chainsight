import { describe, it, expect } from 'vitest';
import { traceIdempotencyKey, withTraceDefaults } from '../src/idempotency';
import { deriveJobId } from '../src/job_store';
import type { SubjectRef, TraceJobRequest } from '@chainsight/shared-types';

describe('traceIdempotencyKey', () => {
  const base = {
    case_id: 'case-1',
    origin: ['evm:1_addr:0xaaa' as SubjectRef, 'evm:1_addr:0xbbb' as SubjectRef],
    mode: 'forward_n',
    methodology: 'fifo',
    direction: 'forward',
    max_hops_per_path: 10,
    max_total_hops: 200,
    branching_cap: 30,
    budget_usd: 5,
  };

  it('is deterministic for identical inputs', () => {
    const a = traceIdempotencyKey(base);
    const b = traceIdempotencyKey(base);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-insensitive on origin', () => {
    const a = traceIdempotencyKey(base);
    const b = traceIdempotencyKey({ ...base, origin: base.origin.slice().reverse() });
    expect(a).toBe(b);
  });

  it('changes with mode', () => {
    const a = traceIdempotencyKey(base);
    const b = traceIdempotencyKey({ ...base, mode: 'autonomous' });
    expect(a).not.toBe(b);
  });

  it('changes with budget', () => {
    const a = traceIdempotencyKey(base);
    const b = traceIdempotencyKey({ ...base, budget_usd: 10 });
    expect(a).not.toBe(b);
  });
});

describe('withTraceDefaults', () => {
  it('fills Phase-1 defaults for omitted fields', () => {
    const req: TraceJobRequest = {
      case_id: 'case-1' as TraceJobRequest['case_id'],
      mode: 'forward_n',
      origin: ['evm:1_addr:0xabc' as SubjectRef],
    };
    const r = withTraceDefaults(req);
    expect(r.direction).toBe('forward');
    expect(r.max_hops_per_path).toBe(12);
    expect(r.max_total_hops).toBe(200);
    expect(r.branching_cap).toBe(30);
    expect(r.budget_usd).toBe(5);
    expect(r.methodology).toBe('fifo');
    expect(r.taint_threshold).toBe(0.01);
    expect(r.terminate_at_kinds).toEqual(['exchange', 'fiat_offramp', 'coinbase']);
  });

  it('preserves explicit values', () => {
    const r = withTraceDefaults({
      case_id: 'case-1' as TraceJobRequest['case_id'],
      mode: 'autonomous',
      origin: ['evm:1_addr:0xabc' as SubjectRef],
      budget_usd: 25,
      max_hops_per_path: 20,
    });
    expect(r.budget_usd).toBe(25);
    expect(r.max_hops_per_path).toBe(20);
  });
});

describe('deriveJobId', () => {
  it('produces a UUID-shaped string', () => {
    const id = deriveJobId('a'.repeat(64));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is deterministic for the same idempotency key', () => {
    const k = '0123456789abcdef'.repeat(4);
    expect(deriveJobId(k)).toBe(deriveJobId(k));
  });
});
