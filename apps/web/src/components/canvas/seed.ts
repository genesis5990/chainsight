/**
 * Realistic seed case graph for the Canvas demo.
 *
 * The case: tracing 12.5 ETH from a ransomware payment through a peel chain
 * into a Uniswap V3 swap, then onward to a Binance deposit. ~36 nodes,
 * one primary evidentiary path (Path A — gold), one alternative path
 * (Path B — cool blue), plus side activity that didn't make a path.
 *
 * Numbers are made up but plausible.
 */

import type {
  AddressNode,
  AddressNodeId,
  CanvasCaseGraph,
  CanvasEdge,
  EdgeId,
  InvestigatorMark,
  TracePath,
  TracePathId,
  TransactionNode,
  TransactionNodeId,
} from '@chainsight/shared-types';

// --- ID helpers (brand-cast) ---
const A = (s: string) => s as AddressNodeId;
const T = (s: string) => s as TransactionNodeId;
const E = (s: string) => s as EdgeId;

// =====================================================================
// Address nodes
// =====================================================================

const addresses: AddressNode[] = [
  // The victim
  {
    kind: 'address',
    id: A('addr-victim'),
    address: 'eth:0xV1ct1mC0rp0000000000000000000000000000ab',
    label: 'Victim — Acme Corp',
    family: 'markup',
    entity_icon: 'eoa',
    marker_icons: ['court_grade', 'pivot'],
    marked_important: true,
    cumulative_taint: 1.0,
    tags: ['source-of-evidence', 'subpoena-2024-0143'],
  },
  // The first hop after the victim — known ransomware crew address
  {
    kind: 'address',
    id: A('addr-rw-1'),
    address: 'eth:0xRansomCrew11111111111111111111111111aaaa',
    label: 'Ransomware crew (LockBit-affiliated)',
    family: 'taint',
    entity_icon: 'unattributed',
    marker_icons: ['red_flag', 'court_grade'],
    marked_important: true,
    cumulative_taint: 1.0,
  },

  // Peel chain — 5 hops of address↔tx↔address with 5-10% peeled off each hop
  {
    kind: 'address',
    id: A('addr-peel-1'),
    address: 'eth:0xPee1Cha1n1111111111111111111111111110001',
    family: 'taint',
    entity_icon: 'eoa',
    marker_icons: [],
    cumulative_taint: 0.92,
  },
  {
    kind: 'address',
    id: A('addr-peel-1-side'),
    address: 'eth:0xPee1Cha1nS1de111111111111111111111110001',
    family: 'caution',
    entity_icon: 'eoa',
    marker_icons: [],
    cumulative_taint: 0.08,
  },
  {
    kind: 'address',
    id: A('addr-peel-2'),
    address: 'eth:0xPee1Cha1n2222222222222222222222222220002',
    family: 'taint',
    entity_icon: 'eoa',
    marker_icons: [],
    cumulative_taint: 0.87,
  },
  {
    kind: 'address',
    id: A('addr-peel-2-side'),
    address: 'eth:0xPee1Cha1nS1de222222222222222222222220002',
    family: 'caution',
    entity_icon: 'eoa',
    marker_icons: [],
    cumulative_taint: 0.05,
  },
  {
    kind: 'address',
    id: A('addr-peel-3'),
    address: 'eth:0xPee1Cha1n3333333333333333333333333330003',
    family: 'elevated',
    entity_icon: 'eoa',
    marker_icons: ['has_note'],
    cumulative_taint: 0.82,
  },
  {
    kind: 'address',
    id: A('addr-peel-3-side'),
    address: 'eth:0xPee1Cha1nS1de333333333333333333333330003',
    family: 'caution',
    entity_icon: 'eoa',
    marker_icons: [],
    cumulative_taint: 0.05,
  },

  // The Uniswap leg
  {
    kind: 'address',
    id: A('addr-swap-eoa'),
    address: 'eth:0xdefa1bcde234567890123456789012345678a4c2',
    label: 'Unattributed EOA (swap initiator)',
    family: 'elevated',
    entity_icon: 'eoa',
    marker_icons: ['pivot', 'watched'],
    marked_important: true,
    cumulative_taint: 0.78,
  },
  {
    kind: 'address',
    id: A('addr-uniswap-router'),
    address: 'eth:0xE5d7C2a3b1C8f2D9e4A6b8E1f3C5d7A9B0c1E0aD',
    label: 'Uniswap Universal Router v1.2',
    family: 'clean',
    entity_icon: 'dex',
    marker_icons: [],
    cumulative_taint: 0,
  },
  {
    kind: 'address',
    id: A('addr-uniswap-pool'),
    address: 'eth:0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    label: 'Uniswap V3 USDT/WETH 0.05%',
    family: 'clean',
    entity_icon: 'dex',
    marker_icons: [],
    cumulative_taint: 0,
  },

  // Post-swap — newly-created recipient EOA
  {
    kind: 'address',
    id: A('addr-post-swap'),
    address: 'eth:0x123abcd45678efgh90ij1234kl56mn78op90bf90',
    label: 'Newly-created EOA',
    family: 'elevated',
    entity_icon: 'eoa',
    marker_icons: ['red_flag'],
    cumulative_taint: 0.78,
  },

  // The off-ramp — Binance deposit
  {
    kind: 'address',
    id: A('addr-binance-deposit'),
    address: 'eth:0xBinanceDep0s1tWa11111111111111111111aaaa',
    label: 'Binance — deposit wallet 1417',
    family: 'clean',
    entity_icon: 'centralized_exchange',
    marker_icons: ['off_ramp', 'awaiting_subpoena', 'court_grade'],
    marked_important: true,
    cumulative_taint: 0.78,
  },
  {
    kind: 'address',
    id: A('addr-binance-hot'),
    address: 'eth:0xBinanceHotWa11et2222222222222222222222ab',
    label: 'Binance hot wallet 14',
    family: 'clean',
    entity_icon: 'hot_wallet',
    marker_icons: [],
    cumulative_taint: 0,
  },

  // Alternative path (Path B) — leftover funds went through Tornado
  {
    kind: 'address',
    id: A('addr-tornado'),
    address: 'eth:0xTornadoCashContract00000000000000000000000',
    label: 'Tornado Cash 10-ETH pool',
    family: 'privacy',
    entity_icon: 'mixer',
    marker_icons: ['red_flag'],
    cumulative_taint: 0.18,
  },

  // Context — exchange the victim used to obtain the original ETH
  {
    kind: 'address',
    id: A('addr-victim-cex'),
    address: 'eth:0xV1ct1mExchange00000000000000000000000000ab',
    label: 'Kraken — victim historical CEX',
    family: 'context',
    entity_icon: 'centralized_exchange',
    marker_icons: [],
    cumulative_taint: 0,
  },
];

// =====================================================================
// Transaction nodes
// =====================================================================

const transactions: TransactionNode[] = [
  // T0 — the ransomware payment itself
  {
    kind: 'transaction',
    id: T('tx-ransom-payment'),
    tx_hash: '0xR4ns0mPay4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4',
    chain: 'ethereum',
    block_height: 20510001,
    block_timestamp: '2024-08-12T13:01:00Z',
    activity_icon: 'transfer',
    family: 'taint',
    marker_icons: ['court_grade'],
    marked_important: true,
    total_value_native: '12.500 ETH',
    total_value_fiat_at_tx: '$42,610',
    has_obfuscation_finding: false,
  },

  // T1..T5 — peel chain hops
  ...peelTx(1, '20510120', '13:09', '12.500', '$42,610', 0.05),
  ...peelTx(2, '20510240', '13:15', '11.875', '$40,479', 0.05),
  ...peelTx(3, '20510360', '13:22', '11.281', '$38,455', 0.05),

  // T6 — the Uniswap V3 swap (the focal tx — also Inspector demo target)
  {
    kind: 'transaction',
    id: T('tx-uniswap-swap'),
    tx_hash: '0x4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3c1a9b2',
    chain: 'ethereum',
    block_height: 20512338,
    block_timestamp: '2024-08-12T14:33:00Z',
    activity_icon: 'swap',
    family: 'elevated',
    marker_icons: ['pivot', 'has_note', 'court_grade'],
    marked_important: true,
    total_value_native: '8.420 ETH',
    total_value_fiat_at_tx: '$28,710',
    has_obfuscation_finding: true,
  },

  // T7 — onward transfer from swap recipient to Binance deposit
  {
    kind: 'transaction',
    id: T('tx-binance-deposit'),
    tx_hash: '0xB1nanceDeposit9c5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3',
    chain: 'ethereum',
    block_height: 20513110,
    block_timestamp: '2024-08-12T14:45:00Z',
    activity_icon: 'exchange_deposit',
    family: 'taint',
    marker_icons: ['off_ramp', 'court_grade'],
    marked_important: true,
    total_value_native: '8.412 ETH',
    total_value_fiat_at_tx: '$28,683',
  },

  // T8 — Binance internal hot-wallet sweep
  {
    kind: 'transaction',
    id: T('tx-binance-sweep'),
    tx_hash: '0xB1nanceSweep0000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    chain: 'ethereum',
    block_height: 20513150,
    block_timestamp: '2024-08-12T14:48:00Z',
    activity_icon: 'transfer',
    family: 'clean',
    marker_icons: [],
    total_value_native: '8.412 ETH',
    total_value_fiat_at_tx: '$28,683',
  },

  // T9 — Path B side: 0.594 ETH from peel-3-side dumped into Tornado
  {
    kind: 'transaction',
    id: T('tx-tornado-deposit'),
    tx_hash: '0xTornadoDeposit00111122223333444455556666777788889999aaaabbbbcc',
    chain: 'ethereum',
    block_height: 20512000,
    block_timestamp: '2024-08-12T14:00:00Z',
    activity_icon: 'transfer',
    family: 'privacy',
    marker_icons: ['red_flag'],
    total_value_native: '0.594 ETH',
    total_value_fiat_at_tx: '$2,028',
    has_obfuscation_finding: true,
  },

  // T10 — context: original victim ETH withdrawal from Kraken (pre-ransom)
  {
    kind: 'transaction',
    id: T('tx-victim-withdrawal'),
    tx_hash: '0xV1ct1mW1thdrawal00000000000000000000000000000000000000000000',
    chain: 'ethereum',
    block_height: 20480000,
    block_timestamp: '2024-08-10T08:00:00Z',
    activity_icon: 'exchange_withdrawal',
    family: 'context',
    marker_icons: [],
    total_value_native: '15.000 ETH',
    total_value_fiat_at_tx: '$51,135',
  },
];

function peelTx(
  hop: number,
  block: string,
  timeShort: string,
  inAmt: string,
  inFiat: string,
  _peelPct: number,
): TransactionNode[] {
  return [
    {
      kind: 'transaction',
      id: T(`tx-peel-${hop}`),
      tx_hash: `0xPee1Cha1nHop${hop}000000000000000000000000000000000000000000000`,
      chain: 'ethereum',
      block_height: Number(block),
      block_timestamp: `2024-08-12T${timeShort}:00Z`,
      activity_icon: 'transfer',
      family: 'taint',
      marker_icons: hop === 3 ? ['has_note'] : [],
      total_value_native: `${inAmt} ETH`,
      total_value_fiat_at_tx: inFiat,
      has_obfuscation_finding: true, // peel-chain detector fires
    },
  ];
}

// =====================================================================
// Edges (always address↔transaction)
// =====================================================================

const edges: CanvasEdge[] = [
  // Context: victim withdrew ETH from Kraken
  edge('e-vw-1', 'addr-victim-cex', 'tx-victim-withdrawal', '15.000', '$51,135', 1.0),
  edge('e-vw-2', 'tx-victim-withdrawal', 'addr-victim', '15.000', '$51,135', 1.0),

  // T0: victim → ransom crew
  edge('e-t0-in', 'addr-victim', 'tx-ransom-payment', '12.500', '$42,610', 1.0, {
    paths: ['path-A', 'path-B'],
  }),
  edge('e-t0-out', 'tx-ransom-payment', 'addr-rw-1', '12.500', '$42,610', 1.0, {
    paths: ['path-A', 'path-B'],
  }),

  // T1: rw-1 → peel-1 (95%) + peel-1-side (5%)
  edge('e-t1-in', 'addr-rw-1', 'tx-peel-1', '12.500', '$42,610', 1.0, { paths: ['path-A', 'path-B'] }),
  edge('e-t1-out-main', 'tx-peel-1', 'addr-peel-1', '11.875', '$40,479', 0.95, {
    paths: ['path-A', 'path-B'],
  }),
  edge('e-t1-out-side', 'tx-peel-1', 'addr-peel-1-side', '0.625', '$2,131', 0.05),

  // T2: peel-1 → peel-2 (95%) + peel-2-side (5%)
  edge('e-t2-in', 'addr-peel-1', 'tx-peel-2', '11.875', '$40,479', 1.0, { paths: ['path-A', 'path-B'] }),
  edge('e-t2-out-main', 'tx-peel-2', 'addr-peel-2', '11.281', '$38,455', 0.95, {
    paths: ['path-A', 'path-B'],
  }),
  edge('e-t2-out-side', 'tx-peel-2', 'addr-peel-2-side', '0.594', '$2,024', 0.05),

  // T3: peel-2 → peel-3 (95%) + peel-3-side (5%)
  edge('e-t3-in', 'addr-peel-2', 'tx-peel-3', '11.281', '$38,455', 1.0, { paths: ['path-A', 'path-B'] }),
  edge('e-t3-out-main', 'tx-peel-3', 'addr-peel-3', '10.717', '$36,532', 0.95, {
    paths: ['path-A', 'path-B'],
  }),
  edge('e-t3-out-side', 'tx-peel-3', 'addr-peel-3-side', '0.564', '$1,923', 0.05, {
    paths: ['path-B'],
  }),

  // Path A: peel-3 → swap-eoa (consolidation to single EOA before Uniswap)
  edge('e-consolidate', 'addr-peel-3', 'tx-uniswap-swap', '8.420', '$28,710', 0.79, {
    paths: ['path-A'],
  }),
  edge('e-uniswap-router', 'tx-uniswap-swap', 'addr-uniswap-router', '8.420', '$28,710', 1.0, {
    paths: ['path-A'],
  }),
  edge('e-uniswap-pool', 'addr-uniswap-router', 'tx-uniswap-swap', '8.420', '$28,710', 1.0),
  edge('e-uniswap-swap-pool', 'addr-uniswap-pool', 'tx-uniswap-swap', '8.420', '$28,710', 1.0),

  // Recipient EOA receives the swap output (here we simplify the inner USDT→ETH return as a single edge)
  edge('e-swap-out', 'tx-uniswap-swap', 'addr-post-swap', '8.412', '$28,683', 1.0, {
    paths: ['path-A'],
  }),

  // T7: post-swap → Binance deposit
  edge('e-bdep-in', 'addr-post-swap', 'tx-binance-deposit', '8.412', '$28,683', 1.0, {
    paths: ['path-A'],
  }),
  edge('e-bdep-out', 'tx-binance-deposit', 'addr-binance-deposit', '8.412', '$28,683', 1.0, {
    paths: ['path-A'],
  }),

  // T8: Binance internal sweep
  edge('e-bsweep-in', 'addr-binance-deposit', 'tx-binance-sweep', '8.412', '$28,683', 1.0),
  edge('e-bsweep-out', 'tx-binance-sweep', 'addr-binance-hot', '8.412', '$28,683', 1.0),

  // Path B: peel-3-side → Tornado mixer
  edge('e-tornado-in', 'addr-peel-3-side', 'tx-tornado-deposit', '0.594', '$2,028', 1.0, {
    paths: ['path-B'],
  }),
  edge('e-tornado-out', 'tx-tornado-deposit', 'addr-tornado', '0.594', '$2,028', 1.0, {
    paths: ['path-B'],
  }),
];

function edge(
  id: string,
  src: string,
  tgt: string,
  abs: string,
  fiat: string,
  share: number,
  opts: { paths?: string[] } = {},
): CanvasEdge {
  return {
    id: E(id),
    source: (src as unknown) as CanvasEdge['source'],
    target: (tgt as unknown) as CanvasEdge['target'],
    absolute_value_native: abs,
    absolute_value_fiat_at_tx: fiat,
    share_of_parent_tx: share,
    path_ids: opts.paths?.map((p) => p as TracePathId),
    edge_weight: Math.max(0.4, Math.log10(Number(abs.split(' ')[0]) + 1)),
  };
}

// =====================================================================
// Trace paths
// =====================================================================

const paths: TracePath[] = [
  {
    id: 'path-A' as TracePathId,
    case_id: 'demo-case-arbiter' as TracePath['case_id'],
    display_name: 'Path A — Ransom → Binance off-ramp',
    color: 'accent_gold',
    is_primary: true,
    status: 'under_review',
    methodology: 'fifo',
    hop_count: 7,
    value_at_terminus_fiat: '$28,683',
    ordered_steps: [],
  },
  {
    id: 'path-B' as TracePathId,
    case_id: 'demo-case-arbiter' as TracePath['case_id'],
    display_name: 'Path B — Peel residue → Tornado mixer',
    color: 'cool_violet',
    is_primary: false,
    status: 'draft',
    methodology: 'libr',
    hop_count: 4,
    value_at_terminus_fiat: '$2,028',
    ordered_steps: [],
  },
];

// =====================================================================
// Marks (important sidebar contents)
// =====================================================================

const marks: InvestigatorMark[] = [
  {
    id: 'mark-1' as InvestigatorMark['id'],
    case_id: 'demo-case-arbiter' as InvestigatorMark['case_id'],
    target_kind: 'address',
    target_id: 'addr-binance-deposit',
    importance: 'court_grade',
    rationale: 'Off-ramp identified. Subpoena to Binance issued 2026-06-15.',
    tags: ['off-ramp', 'subpoena'],
    marked_by: 'demo-investigator-doe' as InvestigatorMark['marked_by'],
    marked_at: '2026-06-15T10:14:00Z',
    belief_tier: 'T0',
  },
  {
    id: 'mark-2' as InvestigatorMark['id'],
    case_id: 'demo-case-arbiter' as InvestigatorMark['case_id'],
    target_kind: 'transaction',
    target_id: 'tx-uniswap-swap',
    importance: 'critical',
    rationale: 'Pivot point. Funds re-denominated USDT→ETH before deposit.',
    tags: ['pivot', 'dex'],
    marked_by: 'demo-investigator-doe' as InvestigatorMark['marked_by'],
    marked_at: '2026-06-12T16:02:00Z',
    belief_tier: 'T0',
  },
  {
    id: 'mark-3' as InvestigatorMark['id'],
    case_id: 'demo-case-arbiter' as InvestigatorMark['case_id'],
    target_kind: 'address',
    target_id: 'addr-rw-1',
    importance: 'court_grade',
    rationale: 'First-hop ransomware crew address — LockBit-affiliated per OFAC.',
    tags: ['sanctioned', 'first-hop'],
    marked_by: 'demo-investigator-doe' as InvestigatorMark['marked_by'],
    marked_at: '2026-06-11T09:30:00Z',
    belief_tier: 'T0',
  },
  {
    id: 'mark-4' as InvestigatorMark['id'],
    case_id: 'demo-case-arbiter' as InvestigatorMark['case_id'],
    target_kind: 'address',
    target_id: 'addr-victim',
    importance: 'noteworthy',
    rationale: 'Victim. Source of funds confirmed via subpoena #2024-0143.',
    tags: ['victim', 'source'],
    marked_by: 'demo-investigator-doe' as InvestigatorMark['marked_by'],
    marked_at: '2026-06-10T14:00:00Z',
    belief_tier: 'T0',
  },
  {
    id: 'mark-5' as InvestigatorMark['id'],
    case_id: 'demo-case-arbiter' as InvestigatorMark['case_id'],
    target_kind: 'address',
    target_id: 'addr-swap-eoa',
    importance: 'critical',
    rationale: 'Likely controlled by the same crew. Watch for further activity.',
    tags: ['watch'],
    marked_by: 'demo-investigator-doe' as InvestigatorMark['marked_by'],
    marked_at: '2026-06-13T11:18:00Z',
    belief_tier: 'T0',
  },
];

// =====================================================================
// Export the assembled case
// =====================================================================

export const SEED_CASE: CanvasCaseGraph = {
  case_id: 'demo-case-arbiter' as CanvasCaseGraph['case_id'],
  case_name: 'Acme Corp ransomware — Aug 2024',
  nodes: [...addresses, ...transactions],
  edges,
  paths,
  marks,
  active_methodology: 'fifo',
  last_refreshed_at: '2026-06-20T15:00:00Z',
};
