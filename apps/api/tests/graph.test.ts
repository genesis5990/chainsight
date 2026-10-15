import { describe, it, expect } from 'vitest';
import { toCanvasGraph } from '../src/lib/graph_shape';

const A = 'evm:1_addr:0x43605d68015b0a4df59e20afc77c9413665eb8dd';
const B = 'evm:1_addr:0x1db3439a222c519ab44bb1144fc28167b4fa6ee6';
const C = 'evm:1_addr:0x7e2d0fe0ffdd78c264f8d40d19acb7d04390c6e8';
const TX1 = 'evm:1_tx:0x' + '1'.repeat(64);
const TX2 = 'evm:1_tx:0x' + '2'.repeat(64);

const row = (id: string, from: string, to: string, tx: string, value: string, kind = 'tx_native', h = 100) => ({
  id, chain: 'evm:1', from_subject: from, to_subject: to, edge_kind: kind, tx_ref: tx,
  edge_index: 0, block_height: h, block_time: '2024-01-01T00:00:00Z', value_minor: value,
});

describe('toCanvasGraph', () => {
  it('builds address → transaction → address with ETH amounts', () => {
    const g = toCanvasGraph('c', [row('e1', A, B, TX1, '2500000000000000000'), row('e2', B, C, TX2, '1000000000000000000', 'tx_native', 101)], false);
    expect(g.stats).toEqual({ addresses: 3, transactions: 2, transfers: 2, truncated: false });
    expect(g.nodes.filter((n) => n.kind === 'address')).toHaveLength(3);
    expect(g.nodes.filter((n) => n.kind === 'transaction')).toHaveLength(2);
    // Every edge touches a transaction node (never address↔address).
    const txIds = new Set(g.nodes.filter((n) => n.kind === 'transaction').map((n) => n.id));
    expect(g.edges.every((e) => txIds.has(String(e.source)) !== txIds.has(String(e.target)))).toBe(true);
    expect(g.edges.find((e) => e.id === 'e1:in')!.absolute_value_native).toBe('2.5 ETH');
    expect(g.transfers[0]).toMatchObject({ from: A.split('_addr:')[1], to: B.split('_addr:')[1], amount: '2.5 ETH', block_height: 100 });
  });

  it('keeps token amounts raw and splits shares within a transaction', () => {
    const g = toCanvasGraph('c', [row('e1', A, B, TX1, '3000', 'token_transfer'), row('e2', A, C, TX1, '1000', 'token_transfer')], false);
    expect(g.transfers.map((t) => t.amount)).toEqual(['3000 (token units)', '1000 (token units)']);
    expect(g.edges.find((e) => e.id === 'e1:in')!.share_of_parent_tx).toBe(0.75);
    const tx = g.nodes.find((n) => n.kind === 'transaction') as { total_value_native?: string };
    expect(tx.total_value_native).toBeUndefined();
  });

  it('formats small and whole native values exactly', () => {
    const g = toCanvasGraph('c', [row('e1', A, B, TX1, '120000000000000'), row('e2', B, C, TX2, '1000000000000000000')], true);
    expect(g.transfers.map((t) => t.amount)).toEqual(['0.00012 ETH', '1 ETH']);
    expect(g.stats.truncated).toBe(true);
  });
});
