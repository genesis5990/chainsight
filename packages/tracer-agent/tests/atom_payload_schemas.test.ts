/**
 * Every atom the tracer emits must pass the belief-state payload schemas.
 *
 * The runner tests use a fake belief service that accepts anything, so a
 * schema mismatch only surfaced in production: the first live Etherscan
 * trace failed with "object_payload invalid for predicate 'tx_exists'"
 * (missing block_hash), and has_taint_share sent fields the schema does not
 * define. This test validates exactly as SupabaseBeliefStateService.emit does.
 */

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PREDICATE_PAYLOAD_SCHEMAS } from '@chainsight/belief-state';
import type {
  AgencyContext,
  BeliefAtom,
  BeliefAtomChallenge,
  BeliefAtomId,
  BeliefAtomInput,
  BeliefAtomRetraction,
  BeliefStateEvent,
  BeliefStateService,
  CaseId,
  SubjectRef,
  TraceJob,
  TracerNeighborEdge,
} from '@chainsight/shared-types';
import { TracerRunner } from '../src/runner';
import { StubNeighborsProvider } from '../src/neighbors_provider';

class ValidatingBelief implements BeliefStateService {
  readonly atoms: BeliefAtomInput[] = [];
  async emit(input: BeliefAtomInput): Promise<BeliefAtom> {
    const schema = PREDICATE_PAYLOAD_SCHEMAS[input.predicate];
    if (!schema) throw new Error(`unknown predicate '${input.predicate}'`);
    const parsed = schema.safeParse(input.object_payload);
    if (!parsed.success) {
      throw new Error(`object_payload invalid for predicate '${input.predicate}': ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
    }
    this.atoms.push(input);
    return { ...input, id: randomUUID() as BeliefAtomId, status: 'asserted', challenges: [] } as unknown as BeliefAtom;
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

const A = 'evm:1_addr:0x43605d68015b0a4df59e20afc77c9413665eb8dd' as SubjectRef;
const B = 'evm:1_addr:0x1db3439a222c519ab44bb1144fc28167b4fa6ee6' as SubjectRef;
const C = 'evm:1_addr:0x7e2d0fe0ffdd78c264f8d40d19acb7d04390c6e8' as SubjectRef;

/** Shape exactly as EtherscanConnector.get_address_neighbors returns it. */
function etherscanEdge(from: SubjectRef, to: SubjectRef, n: number, value: string): TracerNeighborEdge {
  return {
    chain: 'evm:1',
    tx_hash: '0x' + n.toString(16).padStart(64, '0'),
    edge_index: 0,
    block_height: 18_000_000 + n,
    block_hash: '0x' + (n + 1000).toString(16).padStart(64, 'a'),
    block_time_utc: new Date(1_700_000_000_000 + n * 12_000).toISOString(),
    from_subject: from,
    to_subject: to,
    value_native_minor: value,
    edge_kind: 'tx_native',
    cost_usd: 0.0001,
  };
}

const CASE_ID = '3f6c2a1e-8b4d-4c2a-9f1e-2d7b5a9c0e41' as CaseId;
const ctx: AgencyContext = {
  user_id: 'e762d447-0d1a-4051-b184-b1ed0c7688c3',
  agency_id: 'agency-A',
  active_case_id: CASE_ID,
  roles: ['investigator'],
  supervisory_scope_id: null,
  available_capabilities: [],
};

function job(over: Partial<TraceJob> = {}): TraceJob {
  return {
    job_id: randomUUID(), case_id: CASE_ID, initiated_by_id: ctx.user_id, agency_id: 'agency-A',
    idempotency_key: 'k', mode: 'autonomous', origin: [A], direction: 'forward',
    max_hops_per_path: 3, max_total_hops: 20, branching_cap: 10, budget_usd: 1,
    methodology: 'fifo', taint_threshold: 0, terminate_at_kinds: ['exchange'], emit_progress_every_n_hops: 1,
    ...over,
  };
}

describe('tracer atoms vs belief-state payload schemas', () => {
  it('a trace over Etherscan-shaped edges emits only schema-valid atoms', async () => {
    const p = new StubNeighborsProvider();
    p.add({ node: A, direction: 'forward', node_attribution_kind: null, edges: [etherscanEdge(A, B, 1, '2500000000000000000')] });
    p.add({ node: B, direction: 'forward', node_attribution_kind: null, edges: [etherscanEdge(B, C, 2, '1000000000000000000')] });
    p.add({ node: C, direction: 'forward', node_attribution_kind: 'exchange', edges: [] });

    const belief = new ValidatingBelief();
    const result = await new TracerRunner({ belief, neighbors: p }).run(job(), ctx);

    expect(result.summary.total_hops).toBeGreaterThan(0);
    const preds = new Set(belief.atoms.map((a) => a.predicate));
    expect(preds).toEqual(new Set(['tx_exists', 'address_sent', 'address_received', 'has_taint_share']));

    const tx = belief.atoms.find((a) => a.predicate === 'tx_exists')!;
    expect((tx.object_payload as { block_hash: string }).block_hash).toMatch(/^0x[0-9a-f]{64}$/);

    const taint = belief.atoms.find((a) => a.predicate === 'has_taint_share')!.object_payload as Record<string, unknown>;
    // Labels what was computed, keeps what was asked for.
    expect(taint.methodology).toBe('proportional');
    expect(taint.requested_methodology).toBe('fifo');
    expect(taint.total_minor).toBe('2500000000000000000');
    expect(BigInt(taint.tainted_minor as string)).toBeLessThanOrEqual(BigInt(taint.total_minor as string));
    expect(taint.fraction).toBeGreaterThanOrEqual(0);
    expect(taint.fraction).toBeLessThanOrEqual(1);
  });

  it('rejects a tx_exists atom when the provider gives no block hash (nothing is invented)', async () => {
    const edge = etherscanEdge(A, B, 3, '1000');
    delete edge.block_hash;
    const p = new StubNeighborsProvider();
    p.add({ node: A, direction: 'forward', node_attribution_kind: null, edges: [edge] });
    const belief = new ValidatingBelief();
    await expect(new TracerRunner({ belief, neighbors: p }).run(job(), ctx)).rejects.toThrow(/tx_exists.*block_hash/);
  });
});
