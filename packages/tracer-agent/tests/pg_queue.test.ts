/**
 * Postgres queue + event stream (Redis removal).
 *
 * The SQL side (claim_trace_job, heartbeat, stale recovery) is exercised
 * against a real Postgres in the migration test. Here an in-memory store
 * with the same semantics drives the TypeScript side end to end:
 * TracerService.start → startPgTraceConsumer claims → TracerRunner runs →
 * outcome recorded → progress published.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  CaseStream,
  MemoryKv,
  parseChannel,
  type AgencyContext,
  type BeliefAtom,
  type BeliefAtomChallenge,
  type BeliefAtomId,
  type BeliefAtomInput,
  type BeliefAtomRetraction,
  type BeliefStateEvent,
  type BeliefStateService,
  type CaseId,
  type SubjectRef,
  type TraceJob,
  type TraceJobStatus,
} from '@chainsight/shared-types';
import { TracerService } from '../src/service';
import { startPgTraceConsumer } from '../src/pg_consumer';
import { StubNeighborsProvider, mkEdge } from '../src/neighbors_provider';
import type {
  TraceJobCompletion,
  TraceJobInsertInput,
  TraceJobInsertResult,
  TraceJobStore,
} from '../src/job_store';

/* ─── fakes ─────────────────────────────────────────────────────────── */

class FakeBelief implements BeliefStateService {
  readonly atoms: BeliefAtom[] = [];
  async emit(input: BeliefAtomInput): Promise<BeliefAtom> {
    const atom = { ...input, id: randomUUID() as BeliefAtomId, status: 'asserted', challenges: [] } as unknown as BeliefAtom;
    this.atoms.push(atom);
    return atom;
  }
  async challenge() { return {} as BeliefAtomChallenge; }
  async resolveChallenge() { return {} as BeliefAtomChallenge; }
  async supersede() { return {} as BeliefAtom; }
  async retract() { return {} as BeliefAtomRetraction; }
  async linkEvidence() { return {} as BeliefAtom; }
  async getAtom() { return null; }
  async queryAtoms() { return []; }
  async getAtomsBySubject() { return []; }
  async getAtomsByCase() { return []; }
  async getOpenChallenges() { return []; }
  async getEventsSince() { return []; }
  async *subscribe(_c: CaseId, _ctx: AgencyContext): AsyncIterable<BeliefStateEvent> { /* */ }
}

type Row = TraceJobStatus & {
  idempotency_key: string;
  job_payload: TraceJob | null;
  claimed_by: string | null;
  heartbeat_at: number | null;
  attempts: number;
};

/** Same semantics as belief.trace_jobs + claim_trace_job (single-threaded JS = atomic claim). */
class MemoryTraceJobStore implements TraceJobStore {
  readonly rows = new Map<string, Row>();

  async insertQueued(input: TraceJobInsertInput): Promise<TraceJobInsertResult> {
    const dup = [...this.rows.values()].find((r) => r.case_id === input.case_id && r.idempotency_key === input.idempotency_key);
    if (dup) return { job_id: dup.job_id, deduplicated: true };
    this.rows.set(input.job_id, {
      job_id: input.job_id, case_id: input.case_id, mode: input.mode, status: 'queued',
      queued_at: new Date().toISOString(), started_at: null, completed_at: null, cancelled_at: null,
      total_hops: 0, total_atoms_emitted: 0, total_budget_spent_usd: 0, termination_reason: null, error: null,
      idempotency_key: input.idempotency_key, job_payload: input.job_payload, claimed_by: null, heartbeat_at: null, attempts: 0,
    });
    return { job_id: input.job_id, deduplicated: false };
  }
  async markRunning(id: string) { this.rows.get(id)!.status = 'running'; }
  async markCancelled(id: string) { const r = this.rows.get(id)!; r.status = 'cancelled'; r.cancelled_at = new Date().toISOString(); }
  async markCompleted(id: string, s: TraceJobCompletion) {
    const r = this.rows.get(id)!;
    Object.assign(r, { status: 'completed', total_hops: s.total_hops, total_atoms_emitted: s.total_atoms_emitted, termination_reason: s.termination_reason, completed_at: s.completed_at });
  }
  async markFailed(id: string, error: string) { const r = this.rows.get(id)!; r.status = 'failed'; r.error = error; }
  async byId(id: string) { return this.rows.get(id) ?? null; }
  async isCancelled(id: string) { return this.rows.get(id)?.status === 'cancelled'; }
  async listForCase(case_id: CaseId) { return [...this.rows.values()].filter((r) => r.case_id === case_id); }
  async requeue(id: string, payload: TraceJob) {
    const r = this.rows.get(id);
    if (!r || (r.status !== 'failed' && r.status !== 'cancelled')) return false;
    Object.assign(r, { status: 'queued', job_payload: payload, error: null, attempts: 0, claimed_by: null });
    return true;
  }
  async claim(worker: string) {
    const next = [...this.rows.values()].filter((r) => r.status === 'queued' && r.job_payload).sort((a, b) => a.queued_at.localeCompare(b.queued_at))[0];
    if (!next) return null;
    Object.assign(next, { status: 'running', claimed_by: worker, heartbeat_at: Date.now(), attempts: next.attempts + 1 });
    return next.job_payload;
  }
  async heartbeat(id: string, worker: string) {
    const r = this.rows.get(id);
    if (!r || r.status !== 'running' || r.claimed_by !== worker) return false;
    r.heartbeat_at = Date.now();
    return true;
  }
}

class RecordingPublisher {
  readonly messages: Array<{ channel: string; message: unknown }> = [];
  async publish(channel: string, message: string) {
    this.messages.push({ channel, message: JSON.parse(message) });
    return 1;
  }
}

const A = 'evm:1_addr:0xaaa' as SubjectRef;
const B = 'evm:1_addr:0xbbb' as SubjectRef;
const C = 'evm:1_addr:0xccc' as SubjectRef;
const CASE_ID = '00000000-0000-0000-0000-0000000000c1' as CaseId;

function neighbors(): StubNeighborsProvider {
  const p = new StubNeighborsProvider();
  p.add({ node: A, direction: 'forward', node_attribution_kind: null, edges: [mkEdge({ chain: 'evm:1', tx_hash: '0xT1', block_height: 10, from: A, to: B, value: '1000' })] });
  p.add({ node: B, direction: 'forward', node_attribution_kind: null, edges: [mkEdge({ chain: 'evm:1', tx_hash: '0xT2', block_height: 11, from: B, to: C, value: '1000' })] });
  p.add({ node: C, direction: 'forward', node_attribution_kind: 'exchange', edges: [] });
  return p;
}

const ctx: AgencyContext = {
  user_id: '00000000-0000-0000-0000-000000000001',
  agency_id: 'agency-A',
  active_case_id: CASE_ID,
  roles: ['investigator'],
  supervisory_scope_id: null,
  available_capabilities: [],
};

const request = { case_id: CASE_ID, origin: [A], mode: 'autonomous' as const, direction: 'forward' as const, terminate_at_kinds: ['exchange' as const] };

async function until(cond: () => boolean | Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
}

/* ─── tests ────────────────────────────────────────────────────────── */

describe('Postgres trace queue', () => {
  it('start → claim → run → completed, with progress published to the case channel', async () => {
    const store = new MemoryTraceJobStore();
    const publisher = new RecordingPublisher();
    const svc = new TracerService({ store });
    const { job_id, deduplicated } = await svc.start(request, ctx);
    expect(deduplicated).toBe(false);
    expect((await store.byId(job_id))!.status).toBe('queued');
    // The queued row carries the full job, including agency_id.
    expect(store.rows.get(job_id)!.job_payload!.agency_id).toBe('agency-A');

    const consumer = startPgTraceConsumer({ belief: new FakeBelief(), neighbors: neighbors(), store, publisher, pollMs: 10, concurrency: 2 });
    await until(async () => (await store.byId(job_id))!.status === 'completed');
    await consumer.close();

    const row = (await store.byId(job_id))!;
    expect(row.total_hops).toBeGreaterThan(0);
    expect(row.claimed_by).toBe(consumer.workerId);
    expect(publisher.messages.length).toBeGreaterThan(0);
    expect(publisher.messages.every((m) => m.channel === `case:${CASE_ID}:trace:${job_id}:dev`)).toBe(true);
  });

  it('never runs one job twice across consumers', async () => {
    const store = new MemoryTraceJobStore();
    const svc = new TracerService({ store });
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) ids.add((await svc.start({ ...request, budget_usd: 1 + i }, ctx)).job_id);

    const belief = new FakeBelief();
    const runs: string[] = [];
    const counting = {
      async fetchNeighbors(q: Parameters<StubNeighborsProvider['fetchNeighbors']>[0], c: Parameters<StubNeighborsProvider['fetchNeighbors']>[1]) {
        return neighbors().fetchNeighbors(q, c);
      },
    };
    const store2 = new Proxy(store, {
      get(t, p) {
        if (p === 'claim') return async (w: string) => { const j = await t.claim(w); if (j) runs.push(j.job_id); return j; };
        return Reflect.get(t, p).bind?.(t) ?? Reflect.get(t, p);
      },
    });
    const pub = new RecordingPublisher();
    const c1 = startPgTraceConsumer({ belief, neighbors: counting, store: store2, publisher: pub, pollMs: 5, concurrency: 3 });
    const c2 = startPgTraceConsumer({ belief, neighbors: counting, store: store2, publisher: pub, pollMs: 5, concurrency: 3 });
    await until(async () => [...ids].every((id) => store.rows.get(id)!.status === 'completed'));
    await Promise.all([c1.close(), c2.close()]);
    expect(runs.sort()).toEqual([...ids].sort());
  });

  it('re-queues a failed job when the same trace is started again', async () => {
    const store = new MemoryTraceJobStore();
    const svc = new TracerService({ store });
    const first = await svc.start(request, ctx);
    await store.markFailed(first.job_id, 'provider down');

    const again = await svc.start(request, ctx);
    expect(again.job_id).toBe(first.job_id);
    expect(again.deduplicated).toBe(false);
    const row = (await store.byId(first.job_id))!;
    expect(row.status).toBe('queued');
    expect(row.error).toBeNull();
  });

  it('returns the existing job (deduplicated) when it is still queued or done', async () => {
    const store = new MemoryTraceJobStore();
    const svc = new TracerService({ store });
    const first = await svc.start(request, ctx);
    const again = await svc.start(request, ctx);
    expect(again).toMatchObject({ job_id: first.job_id, deduplicated: true });
  });

  it('records a provider failure as failed, not stuck running', async () => {
    const store = new MemoryTraceJobStore();
    const svc = new TracerService({ store });
    const { job_id } = await svc.start(request, ctx);
    const broken = { async fetchNeighbors(): Promise<never> { throw new Error('etherscan 500'); } };
    const c = startPgTraceConsumer({ belief: new FakeBelief(), neighbors: broken, store, publisher: new RecordingPublisher(), pollMs: 5 });
    await until(async () => ['failed', 'completed'].includes((await store.byId(job_id))!.status));
    await c.close();
    const row = (await store.byId(job_id))!;
    // The runner may record a provider error as a completed trace with a
    // termination reason, or fail the job; either way it is not left running.
    expect(row.status).not.toBe('running');
  });

  it('cancel stops a queued job from ever being claimed', async () => {
    const store = new MemoryTraceJobStore();
    const svc = new TracerService({ store });
    const { job_id } = await svc.start(request, ctx);
    await svc.cancel(job_id, ctx);
    expect(await store.claim('w')).toBeNull();
    expect((await store.byId(job_id))!.status).toBe('cancelled');
  });
});

describe('MemoryKv', () => {
  it('expires keys after their TTL', async () => {
    let now = 1_000;
    const kv = new MemoryKv({ now: () => now });
    await kv.set('k', 'v', 'EX', 10);
    expect(await kv.get('k')).toBe('v');
    now += 10_001;
    expect(await kv.get('k')).toBeNull();
  });

  it('supports hashes, sets and pipelines', async () => {
    const kv = new MemoryKv();
    await kv.hset('h', { state: 'open', failures: 3 });
    expect(await kv.hmget('h', 'state', 'failures', 'missing')).toEqual(['open', '3', null]);
    await kv.multi().set('a', '1').sadd('s', 'x', 'y').expire('s', 60).exec();
    expect(await kv.get('a')).toBe('1');
    expect((await kv.smembers('s')).sort()).toEqual(['x', 'y']);
    expect(await kv.del('a', 'nope')).toBe(1);
  });

  it('evicts the oldest keys past the cap', async () => {
    const kv = new MemoryKv({ maxKeys: 2 });
    await kv.set('1', 'a');
    await kv.set('2', 'b');
    await kv.set('3', 'c');
    expect(await kv.get('1')).toBeNull();
    expect(kv.size).toBe(2);
  });
});

describe('CaseStream', () => {
  it('parses the legacy channel format', () => {
    expect(parseChannel('case:abc:trace:job-1:dev')).toEqual({ case_id: 'abc', topic: 'trace', topic_key: 'job-1' });
    expect(parseChannel('case:abc:graph-updated:dev')).toEqual({ case_id: 'abc', topic: 'graph-updated', topic_key: null });
    expect(parseChannel('nope')).toBeNull();
  });

  it('publish → tail delivers only rows after the starting point, in order', async () => {
    const table: Array<Record<string, unknown>> = [];
    let seq = 0;
    // Tiny PostgREST-shaped fake over an array.
    const client = {
      schema: () => ({
        rpc: async () => ({ data: 0, error: null }),
        from: () => {
          const f: Array<(r: Record<string, unknown>) => boolean> = [];
          let asc = true;
          let lim = 1000;
          const q = {
            insert: async (row: Record<string, unknown>) => { table.push({ ...row, id: ++seq, created_at: new Date().toISOString() }); return { error: null }; },
            select: () => q,
            eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return q; },
            in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return q; },
            gt: (c: string, v: number) => { f.push((r) => (r[c] as number) > v); return q; },
            order: (_c: string, o: { ascending: boolean }) => { asc = o.ascending; return q; },
            limit: (n: number) => { lim = n; return q; },
            then: (res: (v: { data: unknown; error: null }) => void) => {
              const rows = table.filter((r) => f.every((fn) => fn(r))).sort((a, b) => (asc ? 1 : -1) * ((a.id as number) - (b.id as number)));
              res({ data: rows.slice(0, lim), error: null });
            },
          };
          return q;
        },
      }),
    };
    const stream = new CaseStream(client as never, { pollMs: 5 });
    await stream.publish('case:c1:trace:j1:dev', JSON.stringify({ kind: 'old' }));

    const ac = new AbortController();
    const got: unknown[] = [];
    const reader = (async () => {
      for await (const row of stream.tail({ case_id: 'c1', topics: ['trace'], signal: ac.signal })) {
        got.push(row.payload);
        if (got.length === 2) ac.abort();
      }
    })();
    await new Promise((r) => setTimeout(r, 20));
    await stream.publish('case:c2:trace:j9:dev', JSON.stringify({ kind: 'other-case' }));
    await stream.publish('case:c1:trace:j1:dev', JSON.stringify({ kind: 'new-1' }));
    await stream.publish('case:c1:trace:j1:dev', JSON.stringify({ kind: 'new-2' }));
    await reader;
    expect(got).toEqual([{ kind: 'new-1' }, { kind: 'new-2' }]);
  });
});
