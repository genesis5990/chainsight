/**
 * Tracer stress test — Op Lemon paths.
 *
 * Goal: prove the runner stays correct + bounded under load. We fan out N
 * concurrent autonomous traces over the same Op Lemon stub subgraph the
 * acceptance walkthrough seeds, varying max_hops_per_path, branching_cap,
 * and budget. Then we replay one job at different limits to confirm the
 * built-in termination rules fire when they should (max_hops, budget,
 * attribution_terminal, all_frontiers_terminated).
 *
 * What this measures:
 *   - p50 / p95 / p99 wall-clock per job
 *   - atoms emitted per traversed edge (should stay 4 = tx + sent + recv + taint)
 *   - termination-reason distribution
 *   - idempotency: same (case_id, origin, mode, ...) → same TracerService job_id
 *
 * Why in-process: the runner is the same code path that ships inside the
 * worker. Driving it directly removes BullMQ scheduling jitter and lets us
 * stress 200+ jobs in seconds. The complementary live test (curl the API)
 * just confirms the route wires through; the runner itself is the hotspot.
 *
 * Usage: pnpm tsx scripts/tracer_stress.ts
 */

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
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
  TerminationReason,
  TraceJob,
  TraceProgressEvent,
} from '@chainsight/shared-types';
import { TracerRunner, StubNeighborsProvider, mkEdge } from '@chainsight/tracer-agent';
import { traceIdempotencyKey, deriveJobId } from '@chainsight/tracer-agent';

/* ─── Op Lemon subgraph (autonomous-trace shaped) ──────────────────────── */

const VICTIM   = 'evm:1_addr:0xv1ct1m'   as SubjectRef;
const BRIDGE   = 'evm:1_addr:0xbr1dge'   as SubjectRef;
const RANSOM   = 'evm:1_addr:0xran5om'   as SubjectRef;
const MIXER    = 'evm:1_addr:0xm1x3rrr'  as SubjectRef;
const EXCHANGE = 'evm:1_addr:0xexch4nge' as SubjectRef;
const PEELHOP1 = 'evm:1_addr:0xpeel001'  as SubjectRef;
const PEELHOP2 = 'evm:1_addr:0xpeel002'  as SubjectRef;
const PEELHOP3 = 'evm:1_addr:0xpeel003'  as SubjectRef;
const COINBASE = 'evm:1_addr:0xc01nbase' as SubjectRef;

function makeProvider(): StubNeighborsProvider {
  const p = new StubNeighborsProvider();
  p.add({ node: VICTIM, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xVB1', block_height: 100, from: VICTIM, to: BRIDGE, value: '10000000000000000000' as never }),
  ]});
  p.add({ node: BRIDGE, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xBR1', block_height: 110, from: BRIDGE, to: RANSOM, value: '10000000000000000000' as never }),
  ]});
  p.add({ node: RANSOM, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xRM1', block_height: 120, from: RANSOM, to: MIXER,    value: '5000000000000000000' as never }),
    mkEdge({ chain: 'evm:1', tx_hash: '0xRH1', block_height: 125, from: RANSOM, to: EXCHANGE, value: '3000000000000000000' as never }),
    mkEdge({ chain: 'evm:1', tx_hash: '0xRP1', block_height: 121, from: RANSOM, to: PEELHOP1, value: '2000000000000000000' as never }),
  ]});
  // 3-hop peel chain ending at a coinbase (gives the runner a deep branch).
  p.add({ node: PEELHOP1, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xPP1', block_height: 130, from: PEELHOP1, to: PEELHOP2, value: '1900000000000000000' as never }),
  ]});
  p.add({ node: PEELHOP2, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xPP2', block_height: 140, from: PEELHOP2, to: PEELHOP3, value: '1800000000000000000' as never }),
  ]});
  p.add({ node: PEELHOP3, direction: 'forward', edges: [
    mkEdge({ chain: 'evm:1', tx_hash: '0xPP3', block_height: 150, from: PEELHOP3, to: COINBASE, value: '1700000000000000000' as never }),
  ]});
  // Terminals.
  p.add({ node: MIXER,    direction: 'forward', node_attribution_kind: 'mixer',    edges: [] });
  p.add({ node: EXCHANGE, direction: 'forward', node_attribution_kind: 'exchange', edges: [] });
  p.add({ node: COINBASE, direction: 'forward', node_attribution_kind: 'coinbase', edges: [] });
  return p;
}

const CASE_ID = '00000000-0000-0000-0000-acceacceacce' as CaseId;
const CTX: AgencyContext = {
  user_id: '00000000-0000-0000-0000-1111aaaa1111',
  agency_id: 'agency-stress',
  active_case_id: CASE_ID,
  roles: ['investigator'],
  supervisory_scope_id: null,
  available_capabilities: [],
};

/* ─── Lightweight fake belief service (counts emits, no I/O) ───────────── */

class CountingBeliefService implements BeliefStateService {
  atoms: BeliefAtom[] = [];
  async emit(input: BeliefAtomInput): Promise<BeliefAtom> {
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
  async queryAtoms(_f: AtomFilter): Promise<BeliefAtom[]> { return []; }
  async getAtomsBySubject() { return []; }
  async getAtomsByCase() { return []; }
  async getOpenChallenges() { return []; }
  async getEventsSince() { return []; }
  async *subscribe(_c: CaseId): AsyncIterable<BeliefStateEvent> { /* */ }
  __unused?(_a: SupportingEvidence, _b: ChallengeResolutionInput) { /* */ }
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function buildJob(overrides: Partial<TraceJob> = {}): TraceJob {
  return {
    job_id: randomUUID(),
    case_id: CASE_ID,
    initiated_by_id: CTX.user_id,
    agency_id: CTX.agency_id,
    idempotency_key: 'idem-' + randomUUID(),
    mode: 'autonomous',
    origin: [VICTIM],
    direction: 'forward',
    max_hops_per_path: 5,
    max_total_hops: 50,
    branching_cap: 10,
    budget_usd: 1.0,
    methodology: 'fifo',
    taint_threshold: 0.0,
    terminate_at_kinds: ['exchange', 'mixer', 'coinbase'],
    emit_progress_every_n_hops: 1,
    ...overrides,
  };
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

interface JobOutcome {
  duration_ms: number;
  atoms: number;
  hops: number;
  budget_spent_usd: number;
  termination_reason: TerminationReason | null;
  branch_terminations: Record<TerminationReason, number>;
}

async function runJob(opts: { max_hops?: number; branching_cap?: number; budget?: number; mode?: TraceJob['mode'] } = {}): Promise<JobOutcome> {
  const belief = new CountingBeliefService();
  const events: TraceProgressEvent[] = [];
  const runner = new TracerRunner({
    belief,
    neighbors: makeProvider(),
    emit: (e) => { events.push(e); },
  });
  const job = buildJob({
    max_hops_per_path: opts.max_hops,
    branching_cap: opts.branching_cap,
    budget_usd: opts.budget,
    mode: opts.mode ?? 'autonomous',
  });
  const t0 = performance.now();
  const result = await runner.run(job, CTX);
  const duration_ms = performance.now() - t0;
  return {
    duration_ms,
    atoms: result.emitted_atom_ids.length,
    hops: result.summary.total_hops,
    budget_spent_usd: result.summary.total_budget_spent_usd,
    termination_reason: result.summary.termination_reason,
    branch_terminations: result.summary.branch_termination_counts,
  };
}

/* ─── Scenario 1: fan-out of identical autonomous jobs ─────────────────── */

async function scenarioConcurrency(): Promise<void> {
  const N = 200;
  console.log(`\n── Scenario 1: ${N} concurrent autonomous traces (default limits) ──`);
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: N }, () => runJob()));
  const wall = performance.now() - t0;
  const durations = results.map((r) => r.duration_ms);
  const atoms = results.map((r) => r.atoms);
  const hops = results.map((r) => r.hops);
  const terminations = results.reduce<Record<string, number>>((acc, r) => {
    const k = r.termination_reason ?? 'none';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  total wall: ${wall.toFixed(0)}ms`);
  console.log(`  per-job p50 / p95 / p99 (ms): ${percentile(durations, 50).toFixed(1)} / ${percentile(durations, 95).toFixed(1)} / ${percentile(durations, 99).toFixed(1)}`);
  console.log(`  atoms emitted (min/avg/max): ${Math.min(...atoms)} / ${(atoms.reduce((a,b)=>a+b,0)/atoms.length).toFixed(1)} / ${Math.max(...atoms)}`);
  console.log(`  hops (min/avg/max):          ${Math.min(...hops)} / ${(hops.reduce((a,b)=>a+b,0)/hops.length).toFixed(1)} / ${Math.max(...hops)}`);
  console.log(`  termination distribution:    ${JSON.stringify(terminations)}`);
  // Invariant: every traversed edge emits 4 atoms (tx_exists + sent + recv + taint).
  const ratios = results.map((r) => (r.hops > 0 ? r.atoms / r.hops : 0));
  const allMatch = ratios.every((r) => r === ratios[0]);
  console.log(`  atoms/hops ratio constant across jobs: ${allMatch ? 'YES ✓' : 'NO ✗'} (sample: ${ratios[0]?.toFixed(2)})`);
}

/* ─── Scenario 2: termination-rule sweep ───────────────────────────────── */

async function scenarioTerminationSweep(): Promise<void> {
  console.log('\n── Scenario 2: termination rules fire when expected ──');
  const cases: Array<{ label: string; opts: Parameters<typeof runJob>[0]; expect: TerminationReason | 'any_terminal' }> = [
    { label: 'tight max_hops (1)',     opts: { max_hops: 1, budget: 100, branching_cap: 50 }, expect: 'max_hops_reached' },
    { label: 'tiny budget ($0.001)',   opts: { max_hops: 50, budget: 0.001, branching_cap: 50 }, expect: 'budget_exhausted' },
    { label: 'wide-open (defaults)',   opts: { max_hops: 50, budget: 1.0, branching_cap: 50 }, expect: 'any_terminal' },
  ];
  for (const c of cases) {
    const r = await runJob(c.opts);
    const ok = c.expect === 'any_terminal'
      ? r.termination_reason !== null
      : r.branch_terminations[c.expect as TerminationReason] > 0 || r.termination_reason === c.expect;
    console.log(`  ${ok ? '✓' : '✗'} ${c.label.padEnd(28)} → reason=${r.termination_reason} hops=${r.hops} budget=${r.budget_spent_usd.toFixed(4)} branch=${JSON.stringify(r.branch_terminations)}`);
  }
}

/* ─── Scenario 3: idempotency-key stability ────────────────────────────── */

async function scenarioIdempotency(): Promise<void> {
  console.log('\n── Scenario 3: same (case, origin, mode, …) → same job_id ──');
  const baseline = {
    case_id: CASE_ID,
    origin: [VICTIM] as SubjectRef[],
    mode: 'autonomous' as const,
    methodology: 'fifo' as const,
    direction: 'forward' as const,
    max_hops_per_path: 5,
    max_total_hops: 50,
    branching_cap: 10,
    budget_usd: 1.0,
  };
  const k1 = traceIdempotencyKey(baseline);
  const k2 = traceIdempotencyKey(baseline);
  const id1 = deriveJobId(k1);
  const id2 = deriveJobId(k2);
  console.log(`  k1=${k1}`);
  console.log(`  k2=${k2}`);
  console.log(`  job_id match: ${id1 === id2 ? '✓ YES' : '✗ NO'} (${id1.slice(0, 8)}… vs ${id2.slice(0, 8)}…)`);

  // Changing any input should yield a different key.
  const k3 = traceIdempotencyKey({ ...baseline, max_hops_per_path: 6 });
  console.log(`  changing max_hops perturbs key: ${k1 !== k3 ? '✓ YES' : '✗ NO'}`);
}

/* ─── Scenario 4: backward-direction stress (varying origin) ───────────── */

async function scenarioBackward(): Promise<void> {
  console.log('\n── Scenario 4: 50 jobs across varied origins + directions ──');
  const origins: SubjectRef[] = [VICTIM, BRIDGE, RANSOM, PEELHOP1, PEELHOP2];
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) => {
      const origin = origins[i % origins.length]!;
      const job = buildJob({ origin: [origin], direction: i % 2 === 0 ? 'forward' : 'backward' });
      const belief = new CountingBeliefService();
      const runner = new TracerRunner({ belief, neighbors: makeProvider() });
      return runner.run(job, CTX);
    }),
  );
  const wall = performance.now() - t0;
  const okCount = results.filter((r) => r.summary.termination_reason !== null).length;
  console.log(`  total wall: ${wall.toFixed(0)}ms over 50 jobs`);
  console.log(`  jobs that terminated cleanly: ${okCount}/${results.length}`);
  console.log(`  total atoms across run: ${results.reduce((s, r) => s + r.emitted_atom_ids.length, 0)}`);
}

async function main(): Promise<void> {
  console.log('Tracer stress — Op Lemon');
  console.log(`Case: ${CASE_ID}`);
  console.log(`Origin: ${VICTIM}`);
  await scenarioConcurrency();
  await scenarioTerminationSweep();
  await scenarioIdempotency();
  await scenarioBackward();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('stress test failed:', err);
  process.exit(1);
});
