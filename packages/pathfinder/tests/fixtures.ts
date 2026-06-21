/**
 * Shared graph fixtures for pathfinder tests.
 *
 * The "Op Lemon" subgraph: 5 hops victim → bridge → ransom crew → mixer →
 * exchange, plus a competing parallel route that skips the mixer.
 */

import type {
  BeliefAtomId,
  CaseId,
  GraphEdge,
  GraphNode,
  SubjectRef,
} from '@chainsight/shared-types';

export const CASE_ID = '00000000-0000-0000-0000-00000000face' as CaseId;

export const VICTIM   = 'evm:1_addr:0xv1ct1m' as SubjectRef;
export const BRIDGE   = 'evm:1_addr:0xbr1dge' as SubjectRef;
export const RANSOM   = 'evm:1_addr:0xran5om' as SubjectRef;
export const MIXER    = 'evm:1_addr:0xm1x3rrr' as SubjectRef;
export const EXCHANGE = 'evm:1_addr:0xexch4nge' as SubjectRef;
export const HOTWALLET = 'evm:1_addr:0xhotw4llt' as SubjectRef;

let _edgeId = 0;
function nextEdgeId(): string { _edgeId += 1; return `00000000-0000-0000-0000-${String(_edgeId).padStart(12, '0')}`; }
function nextAtomId(): BeliefAtomId { return nextEdgeId() as unknown as BeliefAtomId; }

export function edge(
  from: SubjectRef,
  to: SubjectRef,
  block_height: number,
  value_minor: string,
  opts: { mixer?: boolean; bridge?: boolean; tx?: string; edge_index?: number } = {},
): GraphEdge {
  return {
    id: nextEdgeId(),
    case_id: CASE_ID,
    chain: 'evm:1' as GraphEdge['chain'],
    from_subject: from,
    to_subject: to,
    edge_kind: 'tx_native',
    tx_ref: opts.tx ?? `evm:1_tx:0x${block_height.toString().padStart(64, '0')}`,
    edge_index: opts.edge_index ?? 0,
    block_height,
    block_time: new Date(1_700_000_000_000 + block_height * 12_000).toISOString(),
    value_minor: value_minor as GraphEdge['value_minor'],
    obfuscation_marker: opts.mixer ? 'mixer' : null,
    bridge_marker: opts.bridge ? 'native' : null,
    source_atom_id: nextAtomId(),
  };
}

export function node(subject_ref: SubjectRef, chain = 'evm:1'): GraphNode {
  return {
    case_id: CASE_ID,
    subject_ref,
    subject_kind: 'address',
    chain: chain as GraphNode['chain'],
    first_seen_at: new Date(0).toISOString(),
    last_seen_at: new Date(0).toISOString(),
    in_edge_count: 0,
    out_edge_count: 0,
    total_in_minor: '0',
    total_out_minor: '0',
    attribution_count: 0,
    sanctions_hit: false,
  };
}

/**
 * Build a small Op Lemon subgraph for tests:
 *
 *   VICTIM ─[10 ETH @ block 100]─→ BRIDGE
 *   BRIDGE ─[10 ETH @ block 110]─→ RANSOM
 *   RANSOM ─[ 5 ETH @ block 120, MIXER]─→ MIXER
 *   MIXER  ─[ 5 ETH @ block 130]─→ EXCHANGE
 *   RANSOM ─[ 5 ETH @ block 125]─→ HOTWALLET    (parallel route, no mixer)
 *   HOTWALLET ─[ 5 ETH @ block 135]─→ EXCHANGE
 *
 * Plus a temporal-violating edge (block 90, before VICTIM→BRIDGE) used to
 * verify that temporal mode skips backwards travel.
 */
export function buildOpLemon(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: [VICTIM, BRIDGE, RANSOM, MIXER, EXCHANGE, HOTWALLET].map((s) => node(s)),
    edges: [
      edge(VICTIM,    BRIDGE,    100, '10000000000000000000', { tx: 'evm:1_tx:0xVB1' }),
      edge(BRIDGE,    RANSOM,    110, '10000000000000000000', { tx: 'evm:1_tx:0xBR1' }),
      edge(RANSOM,    MIXER,     120, '5000000000000000000',  { tx: 'evm:1_tx:0xRM1', mixer: true }),
      edge(MIXER,     EXCHANGE,  130, '5000000000000000000',  { tx: 'evm:1_tx:0xME1' }),
      edge(RANSOM,    HOTWALLET, 125, '5000000000000000000',  { tx: 'evm:1_tx:0xRH1' }),
      edge(HOTWALLET, EXCHANGE,  135, '5000000000000000000',  { tx: 'evm:1_tx:0xHE1' }),
      // back-edge: only traversable when temporal=false
      edge(BRIDGE,    VICTIM,    90,  '1000000000000000',    { tx: 'evm:1_tx:0xBV1' }),
    ],
  };
}
