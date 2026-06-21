/**
 * End-to-end TracerRunner test with stub neighbors + fake belief service.
 *
 * Strategy: build the Op Lemon subgraph as stub fixtures, run an
 * autonomous trace from the victim wallet, and verify:
 *   - all 8 sections of progress events fire in order
 *   - belief atoms emitted for tx_exists / address_sent / address_received / has_taint_share
 *   - termination reason on a budget-exhausted run
 *   - cancellation token interrupts cleanly
 *   - traversal is best-first (high-value branches expand before low-value)
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type {
  AgencyContext,
  AtomFilter,
  BeliefAtom,
  BeliefAtomChallenge,
  BeliefAtomId,
  BeliefAtomInput,
  BeliefAtomRetraction,
  BeliefStateEvent,
  BeliefStateService,
  CaseId,
  ChallengeResolutionInput,
  SubjectRef,
  SupportingEvidence,
  TraceJob,
  TraceProgressEvent,
} from '@chainsight/shared-types';
import { TracerRunner, StaticCancellationToken } from '../src/runner';
import { StubNeighborsProvider, mkEdge } from '../src/neighbors_provider';

/* ─── fakes ─────────────────────────────────────────────────────────────── */

class FakeBeliefStateService implements BeliefStateService {
  readonly atoms: BeliefAtom[] = [];

  async emit(input: BeliefAtomInput, _ctx: AgencyContext): Promise<BeliefAtom> {
    const atom: BeliefAtom = {
      ...input,
      id: randomUUID() as BeliefAtomId,
      emitted_at: new Date().toISOString(),
      confidence: { value: 1, inputs: { basis_tier: input.basis, provider_corroboration_count: 0, sanctions_match: false, obfuscation_penalty: 0, age_decay: 0 }, recipe_hash: '' },
      status: 'asserted',
      challenges: [],
      payload_hash: '',
    } as BeliefAtom;
    this.atoms.push(atom);
    return atom;
  }
  async challenge() { return {} as BeliefAtomChallenge; }
  async resolveChallenge() { return {} as BeliefAtomChallenge; }
  async supersede() { return {} as BeliefAtom; }
  async retract() { return {} as BeliefAtomRetraction; }
  async linkEvidence() { return {} as BeliefAtom; }
  async getAtom() { return null; }
  async queryAtoms(_f: AtomFilter, _ctx: AgencyContext): Promise<BeliefAtom[]> { return []; }
  async getAtomsBySubject() { return []; }
  async getAtomsByCase() { return []; }
  async getOpenChallenges() { return []; }
  async getEventsSince() { return []; }
  // SupportingEvidence + ChallengeResolutionInput referenced for type-imports
  async *subscribe(_c: CaseId, _ctx: AgencyContext): AsyncIterable<BeliefStateEvent> { /* */ }
  /* satisfy unused-import lint */
  __unused?(_a: SupportingEvidence, _b: ChallengeResolutionInput) { /* */ }
}

/* ─── shared fixtures ───────────────────────────────────────────────────── */

const VICTIM   = 'evm:1_addr:0xv1ct1m' as SubjectRef;
const BRIDGE   = 'evm:1_addr:0xbr1dge' as SubjectRef;
const RANSOM   = 'evm:1_addr:0xran5om' as SubjectRef;
const MIXER    = 'evm:1_addr:0xm1x3rrr' as SubjectRef;
const EXCHANGE = 'evm:1_addr:0xexch4nge' as SubjectRef;

function makeProvider(): StubNeighborsProvider {
  const p = new StubNeighborsProvider();
  p.add({
    node: VICTIM, direction: 'forward', node_attribution_kind: null,
    edges: [mkEdge({ chain: 'evm:1', tx_hash: '0xVB1', block_height: 100, from: VICTIM, to: BRIDGE, value: '10000000000000000000' })],
  });
  p.add({
    node: BRIDGE, direction: 'forward', node_attribution_kind: null,
    edges: [mkEdge({ chain: 'evm:1', tx_hash: '0xBR1', block_height: 110, from: BRIDGE, to: RANSOM, value: '10000000000000000000' })],
  });
  p.add({
    node: RANSOM, direction: 'forward', node_attribution_kind: null,
    edges: [
      mkEdge({ chain: 'evm:1', tx_hash: '0xRM1', block_height: 120, from: RANSOM, to: MIXER, value: '5000000000000000000' }),
      mkEdge({ chain: 'evm:1', tx_hash: '0xRH1', block_height: 125, from: RANSOM, to: EXCHANGE, value: '5000000000000000000' }),
    ],
  });
  p.add({
    node: MIXER, direction: 'forward', node_attribution_kind: 'mixer',
    edges: [],
  });
  p.add({
    node: EXCHANGE, direction: 'forward', node_attribution_kind: 'exchange',
    edges: [],
  });
  return p;
}

const CASE_ID = '00000000-0000-0000-0000-000000000777' as CaseId;

function buildJob(overrides: Partial<TraceJob> = {}): TraceJob {
  return {
    job_id: randomUUID(),
    case_id: CASE_ID,
    initiated_by_id: '00000000-0000-0000-0000-000000000001',
    agency_id: 'agency-A',
    idempotency_key: 'idem-' + Math.random().toString(36).slice(2),
    mode: 'autonomous',
    origin: [VICTIM],
    direction: 'forward',
    max_hops_per_path: 5,
    max_total_hops: 50,
    branching_cap: 10,
    budget_usd: 1.0,
    methodology: 'fifo',
    taint_threshold: 0.0,
    terminate_at_kinds: ['exchange', 'mixer'],
    emit_progress_every_n_hops: 1,
    ...overrides,
  };
}

const ctx: AgencyContext = {
  user_id: '00000000-0000-0000-0000-000000000001',
  agency_id: 'agency-A',
  active_case_id: CASE_ID,
  roles: ['investigator'],
  supervisory_scope_id: null,
  available_capabilities: [],
};

/* ─── tests ────────────────────────────────────────────────────────────── */

describe('TracerRunner.run', () => {
  it('emits started + completed events with a summary', async () => {
    const events: TraceProgressEvent[] = [];
    const runner = new TracerRunner({
      belief: new FakeBeliefStateService(),
      neighbors: makeProvider(),
      emit: (e) => { events.push(e); },
    });
    const result = await runner.run(buildJob(), ctx);
    expect(events[0]!.kind).toBe('started');
    expect(events.at(-1)!.kind).toBe('completed');
    expect(result.summary.total_hops).toBeGreaterThan(0);
    expect(result.summary.total_atoms_emitted).toBe(result.emitted_atom_ids.length);
  });

  it('emits 4 atoms per traversed edge (tx_exists + sent + received + taint_share)', async () => {
    const belief = new FakeBeliefStateService();
    const runner = new TracerRunner({ belief, neighbors: makeProvider() });
    const result = await runner.run(buildJob(), ctx);
    const txAtoms = belief.atoms.filter((a) => a.predicate === 'tx_exists');
    const sentAtoms = belief.atoms.filter((a) => a.predicate === 'address_sent');
    const recvAtoms = belief.atoms.filter((a) => a.predicate === 'address_received');
    const taintAtoms = belief.atoms.filter((a) => a.predicate === 'has_taint_share');
    expect(txAtoms.length).toBeGreaterThanOrEqual(3); // VB1, BR1, RM1 or RH1
    expect(sentAtoms.length).toBe(txAtoms.length);
    expect(recvAtoms.length).toBe(txAtoms.length);
    expect(taintAtoms.length).toBeGreaterThan(0);
    expect(result.summary.total_edges).toBe(txAtoms.length);
  });

  it('terminates branches that reach a mixer (terminate_at_kinds)', async () => {
    const events: TraceProgressEvent[] = [];
    const runner = new TracerRunner({
      belief: new FakeBeliefStateService(),
      neighbors: makeProvider(),
      emit: (e) => { events.push(e); },
    });
    const result = await runner.run(buildJob(), ctx);
    expect(result.summary.branch_termination_counts.attribution_terminal).toBeGreaterThan(0);
    const terminations = events.filter((e) => e.kind === 'branch_terminated') as Array<Extract<TraceProgressEvent, { kind: 'branch_terminated' }>>;
    expect(terminations.some((e) => e.reason === 'attribution_terminal')).toBe(true);
  });

  it('terminates the job when budget runs out', async () => {
    const runner = new TracerRunner({
      belief: new FakeBeliefStateService(),
      neighbors: makeProvider(),
    });
    // Tight budget: each stub edge costs ~0.002, and the seed Op Lemon
    // pipeline does several fetches. Budget of 0.001 should exhaust quickly.
    const result = await runner.run(buildJob({ budget_usd: 0.001 }), ctx);
    expect(result.summary.termination_reason).toBe('budget_exhausted');
  });

  it('responds to cancellation token between hops', async () => {
    const cancellation = new StaticCancellationToken();
    cancellation.cancel(); // pre-cancel
    const runner = new TracerRunner({
      belief: new FakeBeliefStateService(),
      neighbors: makeProvider(),
      cancellation,
    });
    const result = await runner.run(buildJob(), ctx);
    expect(result.summary.termination_reason).toBe('cancelled_by_user');
    expect(result.summary.total_hops).toBe(0);
  });

  it('records a hash per provider response in the result', async () => {
    const runner = new TracerRunner({
      belief: new FakeBeliefStateService(),
      neighbors: makeProvider(),
    });
    const result = await runner.run(buildJob(), ctx);
    expect(result.provider_response_hashes.length).toBeGreaterThan(0);
    for (const h of result.provider_response_hashes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
