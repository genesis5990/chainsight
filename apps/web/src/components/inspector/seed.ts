/**
 * Realistic seed data for the Transaction Inspector demo.
 *
 * Models the same Uniswap V3 swap walked through in v0.5 addendum 3 §8.2.
 * No live RPC or attribution provider is called — every value below is
 * authored verbatim to mirror what production would produce.
 */

import type {
  ActionSuggestion,
  CaseContextEntry,
  CounterpartyEntry,
  CriticNote,
  DecodedSwap,
  KeyValueRow,
  ObfuscationFinding,
  PlainLanguageSummary,
  TransactionAnalysis,
} from './types';
import { createPendingAnalysis } from './types';

export function seedSwapAnalysis(): TransactionAnalysis {
  return {
    ...createPendingAnalysis({
      id: 'demo-analysis-001' as TransactionAnalysis['id'],
      case_id: 'demo-case-arbiter' as TransactionAnalysis['case_id'],
      transaction_node_id: 'demo-txnode-0001' as TransactionAnalysis['transaction_node_id'],
      requested_by: 'demo-investigator-doe' as TransactionAnalysis['requested_by'],
      header: {
        tx_hash: '0x4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3c1a9b2',
        chain: 'ethereum',
        block_height: 20512338,
        block_timestamp: '2024-08-12T14:33:00Z',
        confirmation_depth: 142,
        finality: 'final',
        explorer_url:
          'https://etherscan.io/tx/0x4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3c1a9b2',
      },
    }),
  };
}

export const seedSummary: PlainLanguageSummary = {
  paragraph:
    'On August 12, 2024 at 14:33 UTC, address 0xdef…a4c2 executed a Uniswap V3 swap on Ethereum, exchanging 423.7 USDT for 0.1248 ETH at an effective price of $3,395.83/ETH (0.41% slippage vs. spot). The transaction paid 0.0021 ETH ($7.13) in gas and routed through the USDT/WETH 0.05% fee pool. The receiving address 0x123…bf90 had not previously interacted with the sending address. This appears to be a routine swap, with no obfuscation indicators present.',
  verifier_passed: true,
  belief_atoms_referenced: [
    'ba-001',
    'ba-002',
    'ba-003',
    'ba-004',
    'ba-005',
  ] as PlainLanguageSummary['belief_atoms_referenced'],
};

export const seedFacts: KeyValueRow[] = [
  {
    field: 'From',
    value: '0xdef…a4c2',
    copyable_full: '0xdefa1bcde234567890123456789012345678a4c2',
    pivot_to_address: 'eth:0xdefa1bcde234567890123456789012345678a4c2',
    note: '(EOA, no contract code)',
  },
  {
    field: 'To (top-level)',
    value: '0xE5…0aD',
    copyable_full: '0xE5d7C2a3b1C8f2D9e4A6b8E1f3C5d7A9B0c1E0aD',
    pivot_to_address: 'eth:0xE5d7C2a3b1C8f2D9e4A6b8E1f3C5d7A9B0c1E0aD',
    note: '(Uniswap Universal Router)',
  },
  { field: 'Value', value: '0 ETH', note: '(token swap; native value in calldata)' },
  { field: 'Gas used', value: '168,432' },
  { field: 'Gas price', value: '12.4 gwei' },
  { field: 'Effective fee', value: '0.0021 ETH ($7.13 at tx time)' },
  { field: 'Nonce', value: '1,847' },
  { field: 'Input data', value: '0x3593564c…', note: '(decoded below)' },
  { field: 'Status', value: 'Success' },
  { field: 'Block', value: '20,512,338' },
  { field: 'Position in block', value: '87' },
  { field: 'Tx type', value: 'EIP-1559 (Type 2)' },
];

export const seedSwap: DecodedSwap = {
  kind: 'swap',
  protocol: 'Uniswap V3',
  router_function: 'execute',
  command: 'V3_SWAP_EXACT_IN',
  token_in: {
    symbol: 'USDT',
    amount: '423.7184',
    contract: 'eth:0xdAC17F958D2ee523a2206206994597C13D831ec7',
    fiat_value: '$423.72',
  },
  token_out: {
    symbol: 'ETH',
    amount: '0.1248',
    fiat_value: '$423.72',
  },
  recipient: 'eth:0x123abcd45678efgh90ij1234kl56mn78op90bf90',
  path: [
    {
      from_symbol: 'USDT',
      to_symbol: 'WETH',
      pool_label: '0.05% fee pool',
      pool_address: 'eth:0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    },
    {
      from_symbol: 'WETH',
      to_symbol: 'ETH',
      pool_label: 'native unwrap',
      pool_address: 'eth:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    },
  ],
  effective_rate: '3,395.83 USDT/ETH',
  spot_rate_at_block: '3,409.94 USDT/ETH',
  slippage_pct: 0.41,
  fee_breakdown: {
    lp_fee: { symbol: 'USDT', amount: '0.21' },
    protocol_fee: { symbol: 'USDT', amount: '0.00' },
    gas_fee: { symbol: 'ETH', amount: '0.0021', fiat_value: '$7.13' },
  },
};

export const seedCounterparties: CounterpartyEntry[] = [
  {
    address: 'eth:0xdefa1bcde234567890123456789012345678a4c2',
    attribution: 'Unattributed EOA',
    sources: [],
    risk: 'medium',
    risk_reason: 'Mixer-adjacent (one hop from a Tornado Cash deposit address).',
  },
  {
    address: 'eth:0xE5d7C2a3b1C8f2D9e4A6b8E1f3C5d7A9B0c1E0aD',
    attribution: 'Uniswap Universal Router v1.2',
    sources: [
      { provider: 'Chainalysis', label: 'Uniswap Router', confidence: 0.99 },
      { provider: 'Arkham', label: 'Uniswap Universal Router', confidence: 0.97 },
    ],
    risk: 'low',
    risk_reason: 'Clean infrastructure address.',
  },
  {
    address: 'eth:0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    attribution: 'Uniswap V3 USDT/WETH 0.05% Pool',
    sources: [
      { provider: 'Chainalysis', label: 'Uniswap V3 Pool', confidence: 0.99 },
      { provider: 'TRM', label: 'Uniswap V3', confidence: 0.98 },
    ],
    risk: 'low',
  },
  {
    address: 'eth:0x123abcd45678efgh90ij1234kl56mn78op90bf90',
    attribution: 'Unattributed EOA',
    sources: [],
    risk: 'medium',
    risk_reason: 'Newly created (no on-chain history before this tx).',
  },
];

export const seedCaseContext: CaseContextEntry[] = [
  {
    text: 'This transaction is hop 7 of Path A (your primary evidentiary path).',
    pivot_target: { kind: 'path', id: 'path-A' },
    tier: 'T1',
  },
  {
    text: 'Cumulative taint from source at this hop: 87.3% under FIFO, 91.1% under LIBR.',
    tier: 'T2',
  },
  {
    text: 'This transaction shares its sending address with 3 other transactions in this case.',
    pivot_target: { kind: 'address', id: 'eth:0xdefa…' },
    tier: 'T0',
  },
  {
    text: 'The recipient address appears in Wallet: Suspect\u2019s Ledger Nano (analyzed yesterday).',
    pivot_target: { kind: 'wallet', id: 'wallet-ledger-nano-001' },
    tier: 'T1',
  },
  {
    text: 'A memo exists on this transaction: \u201cConfirmed via subpoena #2024-0184\u201d \u2014 open.',
    pivot_target: { kind: 'memo', id: 'memo-456' },
    tier: 'T1',
  },
  {
    text: 'Important marker set by Investigator Doe on 2026-06-12.',
    is_important_marker: true,
    tier: 'T1',
  },
];

export const seedObfuscation: ObfuscationFinding[] = [
  {
    id: 'obf-001',
    detector: 'peel_chain',
    severity: 'alert',
    confidence: 0.91,
    headline: 'Peel chain hop detected',
    detail:
      'This transaction is hop 4 of 12 in a peel-chain pattern that originates at 0xabc…d4e3.',
    navigate_to: '/findings/obf-001',
  },
  {
    id: 'obf-002',
    detector: 'low_liquidity_pool',
    severity: 'warning',
    confidence: 0.62,
    headline: 'Low-liquidity pool usage',
    detail:
      'The Uniswap pool used has under $50k TVL. Slippage tolerance is higher than typical for this asset pair.',
    navigate_to: '/findings/obf-002',
  },
];

export const seedCritic: CriticNote[] = [
  {
    id: 'critic-001',
    kind: 'challenge',
    text:
      'The attribution for 0xdef…a4c2 as a likely Tornado-adjacent address is based on a single-source heuristic (T3). Consider seeking corroboration before treating as court-grade.',
    tier_concern: 'T3',
  },
  {
    id: 'critic-002',
    kind: 'observation',
    text:
      'Recipient 0x123…bf90 has no history beyond this transaction. If this is a fresh deposit address, attribution will require a subpoena to the receiving entity.',
  },
];

export const seedActions: ActionSuggestion[] = [
  { kind: 'mark_important', label: 'Mark as Important', icon: '⭐', enabled: true },
  { kind: 'attach_memo', label: 'Attach a memo', icon: '📎', enabled: true },
  { kind: 'add_to_active_path', label: 'Add to active path', icon: '🎨', enabled: true },
  { kind: 'trace_forward', label: 'Trace forward 3 hops', icon: '🔗', enabled: true, params: { hops: 3 } },
  { kind: 'trace_backward', label: 'Trace backward 3 hops', icon: '🔙', enabled: true, params: { hops: 3 } },
  {
    kind: 'draft_subpoena',
    label: 'Draft subpoena request',
    icon: '📑',
    enabled: false,
    disabled_reason: 'Recipient is not attributed to a regulated VASP.',
  },
  {
    kind: 'add_freeze_opportunity',
    label: 'Add to freeze list',
    icon: '❄️',
    enabled: false,
    disabled_reason: 'Recipient is not an exchange deposit address.',
  },
  { kind: 'export_pdf_exhibit', label: 'Export as PDF exhibit', icon: '📤', enabled: true },
];

/**
 * Timing schedule for the streaming demo. Mirrors realistic per-section
 * latencies — Section 2 (structured facts) lands fast because it's just
 * chain RPC; Section 1 (narrative) lands last because it waits on the
 * Narrative Agent + Verifier.
 */
export const STREAM_SCHEDULE: Array<{
  section: keyof TransactionAnalysis['sections'];
  loading_at: number; // ms
  ready_at: number; // ms
}> = [
  { section: 'structured_facts', loading_at: 50, ready_at: 600 },
  { section: 'decoded_action', loading_at: 100, ready_at: 1200 },
  { section: 'counterparty_intel', loading_at: 200, ready_at: 2200 },
  { section: 'case_context', loading_at: 300, ready_at: 2800 },
  { section: 'obfuscation_findings', loading_at: 400, ready_at: 3400 },
  { section: 'critic_notes', loading_at: 500, ready_at: 4400 },
  { section: 'summary', loading_at: 100, ready_at: 5600 },
  { section: 'suggested_actions', loading_at: 600, ready_at: 6200 },
];
