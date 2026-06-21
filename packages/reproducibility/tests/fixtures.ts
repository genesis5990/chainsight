/**
 * In-memory CaseSource for tests.
 */

import type {
  CaseId,
  FrozenAgentCall,
  FrozenAtom,
  FrozenAttributionRow,
  FrozenEvent,
  FrozenInspectorRun,
  FrozenMathRecipe,
  FrozenNarrative,
  FrozenProviderResponse,
  FrozenTrace,
} from '@chainsight/shared-types';
import type { CaseSource } from '../src/case_source';
import { sha256Hex, canonicalJson } from '../src/canonical';

export const CASE_ID = '00000000-0000-0000-0000-000000000abc' as CaseId;

export interface FixtureCase {
  atoms: FrozenAtom[];
  events: FrozenEvent[];
  math_recipes: FrozenMathRecipe[];
  provider_responses: FrozenProviderResponse[];
  traces: FrozenTrace[];
  inspector_runs: FrozenInspectorRun[];
  agent_calls: FrozenAgentCall[];
  attributions: FrozenAttributionRow[];
  narratives: FrozenNarrative[];
  rule_versions: Record<string, string>;
}

export class InMemoryCaseSource implements CaseSource {
  constructor(private readonly fixture: FixtureCase) {}
  async loadAtoms(_c: CaseId) { return this.fixture.atoms; }
  async loadEvents(_c: CaseId) { return this.fixture.events; }
  async loadMathRecipes(_c: CaseId) { return this.fixture.math_recipes; }
  async loadProviderResponses(_c: CaseId) { return this.fixture.provider_responses; }
  async loadTraces(_c: CaseId) { return this.fixture.traces; }
  async loadInspectorRuns(_c: CaseId) { return this.fixture.inspector_runs; }
  async loadAgentCalls(_c: CaseId) { return this.fixture.agent_calls; }
  async loadAttributions(_c: CaseId) { return this.fixture.attributions; }
  async loadNarratives(_c: CaseId) { return this.fixture.narratives; }
  async loadRuleVersions(_c: CaseId) { return this.fixture.rule_versions; }
}

/* ─── builders ─────────────────────────────────────────────────────────── */

function mkAtom(input: {
  id: string; seq: number; subject: string; predicate: string;
  payload: Record<string, unknown>; parent_id?: string;
}): FrozenAtom {
  const payload_hash = sha256Hex(canonicalJson({
    subject_ref: input.subject, predicate: input.predicate, object_payload: input.payload,
  }));
  return {
    id: input.id as FrozenAtom['id'],
    case_id: CASE_ID,
    subject_ref: input.subject,
    predicate: input.predicate,
    object_payload: input.payload,
    basis: 'T0',
    basis_detail: 'fixture',
    emitted_at: '2026-01-01T00:00:00.000Z',
    emitted_by_id: '00000000-0000-0000-0000-000000000001',
    emitted_by_kind: 'agent',
    parent_atom_id: input.parent_id as FrozenAtom['parent_atom_id'] | undefined,
    event_seq: input.seq,
    payload_hash,
    chain_link_hash: '', // builder fills this in
    status: 'asserted',
  };
}

/** Op Lemon trace fixture: 3 atoms, 1 trace, 2 provider responses. */
export function buildOpLemonFixture(): FixtureCase {
  const a1 = mkAtom({ id: '00000000-0000-0000-0000-aaaaaaaaaaa1', seq: 1, subject: 'evm:1_tx:0xVB1', predicate: 'tx_exists', payload: { tx_hash: '0xVB1', block_height: 100 } });
  const a2 = mkAtom({ id: '00000000-0000-0000-0000-aaaaaaaaaaa2', seq: 2, subject: 'evm:1_addr:0xv1ct1m', predicate: 'address_sent', payload: { tx_hash: '0xVB1', counterparty: 'evm:1_addr:0xbr1dge', value_native_minor: '10000000000000000000', block_height: 100 }, parent_id: a1.id });
  const a3 = mkAtom({ id: '00000000-0000-0000-0000-aaaaaaaaaaa3', seq: 3, subject: 'evm:1_addr:0xbr1dge', predicate: 'address_received', payload: { tx_hash: '0xVB1', counterparty: 'evm:1_addr:0xv1ct1m', value_native_minor: '10000000000000000000', block_height: 100 }, parent_id: a1.id });

  return {
    atoms: [a1, a2, a3],
    events: [
      { event_seq: 1, event_kind: 'atom_emitted', atom_id: a1.id, emitted_at: a1.emitted_at, emitted_by_id: a1.emitted_by_id, delta: { id: a1.id } },
      { event_seq: 2, event_kind: 'atom_emitted', atom_id: a2.id, emitted_at: a2.emitted_at, emitted_by_id: a2.emitted_by_id, delta: { id: a2.id } },
      { event_seq: 3, event_kind: 'atom_emitted', atom_id: a3.id, emitted_at: a3.emitted_at, emitted_by_id: a3.emitted_by_id, delta: { id: a3.id } },
    ],
    math_recipes: [
      { recipe_hash: 'abc123', rpc: 'ComputeValueAtBlock', inputs: { chain: 'evm:1', block_height: 100 }, output: { value_fiat: '20000.00' }, algo_version: 'math@v0.2.0' },
    ],
    provider_responses: [
      { request_hash: 'req-1', provider_id: 'etherscan', capability: 'get_tx_by_hash', args: { tx_hash: '0xVB1' }, response: { from: '0xv1ct1m', to: '0xbr1dge' }, fetched_at: '2026-01-01T00:00:00.000Z' },
    ],
    traces: [
      { job_id: 'job-1', case_id: CASE_ID, mode: 'autonomous', origin: ['evm:1_addr:0xv1ct1m'], total_hops: 3, total_atoms_emitted: 3, total_budget_spent_usd: 0.012, termination_reason: 'attribution_terminal', provider_response_hashes: ['hash-1'], completed_at: '2026-01-01T00:01:00.000Z' },
    ],
    inspector_runs: [],
    agent_calls: [],
    attributions: [],
    narratives: [],
    rule_versions: {
      math_service: 'math@v0.2.0',
      hash_algo: 'blake3-256@v1',
      tracer_agent: 'tracer@v0.1.0',
    },
  };
}
