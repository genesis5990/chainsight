/**
 * A 10-frame courtroom narrative scoped to the Acme Corp ransomware case.
 *
 * Frame plan:
 *   1.  Title — "Acme Corp ransomware: tracing $42,610"
 *   2.  Over-time — incident timeline from victim withdrawal → off-ramp
 *   3.  By-trace-path — Path A, Hop 1 (victim → ransom crew)
 *   4.  By-trace-path — Path A, Hop 2 (ransom crew → peel hop 1)
 *   5.  By-trace-path — Path A, Hop 5 (consolidation → Uniswap swap)
 *   6.  By-trace-path — Path A, Hop 6 (Uniswap swap → recipient EOA)
 *   7.  By-trace-path — Path A, Hop 7 (recipient EOA → Binance deposit)
 *   8.  By-value — Sankey of taint flow under FIFO (whole case)
 *   9.  By-entity — Binance deposit wallet (the off-ramp)
 *  10.  Document — subpoena return supporting the Binance attribution
 */

import type {
  AccountingState,
  CourtFrame,
  FrameDeck,
  FrameId,
  TracePathId,
  TransactionNodeId,
} from '@chainsight/shared-types';

const F = (s: string) => s as FrameId;
const TX = (s: string) => s as TransactionNodeId;

// Helper to mint accounting state with the case-wide constants pre-filled.
const TOTAL = '$42,610';
function acct(partial: Partial<AccountingState>): AccountingState {
  return {
    frame_methodology: 'fifo',
    frame_type_label: '—',
    total_tainted_input_fiat: TOTAL,
    traceable_at_frame_fiat: TOTAL,
    traceable_at_frame_pct: 1.0,
    lost_to_mixers_fiat: '$0',
    lost_to_mixers_pct: 0,
    off_ramped_fiat: '$0',
    off_ramped_pct: 0,
    ...partial,
  };
}

const frames: CourtFrame[] = [
  // ───────────────────────── Frame 1 ─────────────────────────
  {
    id: F('f-01'),
    index: 1,
    kind: 'title',
    title: 'Acme Corp ransomware',
    subtitle:
      'Tracing the ransom payment from Acme\u2019s wallet to the Binance off-ramp.',
    methodology: 'fifo',
    payload: {
      kind: 'title',
      hero: '$42,610',
      bullets: [
        '12.500 ETH paid 12 August 2024 at 13:01 UTC',
        '7 hops over 1 hour 44 minutes',
        'Off-ramped to Binance deposit wallet 1417',
      ],
    },
    read_aloud:
      'Members of the jury, on August 12 2024 at 1:01 PM UTC, Acme Corp paid 12.5 ether — worth forty-two thousand six hundred ten US dollars at the time — to a ransomware crew. We will now walk through every hop of that money, ending at a Binance account we have already subpoenaed.',
    accounting: acct({
      frame_type_label: 'Opening',
    }),
  },

  // ───────────────────────── Frame 2 ─────────────────────────
  {
    id: F('f-02'),
    index: 2,
    kind: 'over_time',
    title: 'Incident timeline',
    subtitle: 'From the victim\u2019s ETH withdrawal to the Binance deposit, in chronological order.',
    methodology: 'fifo',
    payload: {
      kind: 'over_time',
      range_start: '2024-08-10T00:00:00Z',
      range_end: '2024-08-12T16:00:00Z',
      playhead_at: '2024-08-12T14:45:00Z',
      events: [
        {
          id: 'e-1',
          at: '2024-08-10T08:00:00Z',
          kind: 'tx',
          label: 'Victim withdraws 15 ETH from Kraken',
          value_fiat: '$51,135',
          chain: 'ETH',
        },
        {
          id: 'e-2',
          at: '2024-08-12T12:50:00Z',
          kind: 'memo',
          label: 'Acme Corp IT discovers the ransomware demand letter',
        },
        {
          id: 'e-3',
          at: '2024-08-12T13:01:00Z',
          kind: 'tx',
          label: 'Acme Corp pays 12.5 ETH to ransomware crew address',
          value_fiat: '$42,610',
          chain: 'ETH',
        },
        {
          id: 'e-4',
          at: '2024-08-12T13:09:00Z',
          kind: 'finding',
          label: 'Peel-chain detector fires (hop 1 of 12 detected)',
        },
        {
          id: 'e-5',
          at: '2024-08-12T13:09:00Z',
          kind: 'tx',
          label: 'Peel hop 1 — 95% onward, 5% peeled to side address',
          value_fiat: '$42,610',
          chain: 'ETH',
        },
        {
          id: 'e-6',
          at: '2024-08-12T13:15:00Z',
          kind: 'tx',
          label: 'Peel hop 2',
          value_fiat: '$40,479',
          chain: 'ETH',
        },
        {
          id: 'e-7',
          at: '2024-08-12T13:22:00Z',
          kind: 'tx',
          label: 'Peel hop 3',
          value_fiat: '$38,455',
          chain: 'ETH',
        },
        {
          id: 'e-8',
          at: '2024-08-12T14:33:00Z',
          kind: 'tx',
          label: 'Consolidated value swapped on Uniswap V3 — 423.7 USDT \u2192 0.1248 ETH (illustrative)',
          value_fiat: '$28,710',
          chain: 'ETH',
        },
        {
          id: 'e-9',
          at: '2024-08-12T14:45:00Z',
          kind: 'tx',
          label: 'Deposit into Binance hot-wallet 14 funnel',
          value_fiat: '$28,683',
          chain: 'ETH',
        },
        {
          id: 'e-10',
          at: '2024-08-12T14:48:00Z',
          kind: 'subpoena',
          label: 'Binance subpoena #2024-0184 issued by SDNY',
        },
      ],
    },
    read_aloud:
      'Here is the entire incident on one timeline. The shaded events are everything we have confirmed by tier zero cryptographic proof. The blue playhead is where we currently are in the story.',
    accounting: acct({
      frame_type_label: 'Over time — full incident',
      frame_time: '2024-08-12T14:45:00Z',
      frame_chain: 'Ethereum',
      traceable_at_frame_fiat: '$40,580',
      traceable_at_frame_pct: 0.952,
      lost_to_mixers_fiat: '$2,030',
      lost_to_mixers_pct: 0.048,
      off_ramped_fiat: '$0',
      off_ramped_pct: 0,
    }),
  },

  // ───────────────────────── Frame 3 ─────────────────────────
  pathHop({
    index: 3,
    id: 'f-03',
    hopIndex: 1,
    hopTotal: 7,
    title: 'Path A · Hop 1 — Victim to ransomware crew',
    subtitle: 'The transaction the rest of the case follows from.',
    txHash:
      '0xR4ns0mPay4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4',
    txRef: 'tx-ransom-payment',
    chain: 'ethereum',
    at: '2024-08-12T13:01:00Z',
    fromAddress: '0xV1ct1mC0rp\u20260000ab (Acme Corp treasury)',
    toAddress: '0xRansomCrew11\u2026aaaa (LockBit-affiliated)',
    valueNative: '12.500 ETH',
    valueFiat: '$42,610',
    cumTaint: 1.0,
    elapsedMs: 0,
    memo:
      'Confirmed by Acme Corp CFO under oath (Doe deposition, 2024-09-04, exhibit B). The 12.5 ETH originated from Kraken withdrawal 2024-08-10.',
    attributions: [
      { provider: 'Chainalysis', label: 'LockBit affiliate cluster (high confidence)' },
      { provider: 'TRM', label: 'LockBit infrastructure' },
      { provider: 'Internal', label: 'Victim wallet — subpoena confirmed' },
    ],
    readAloud:
      'Hop one. The victim, Acme Corp, paid 12.5 ether — forty-two thousand six hundred ten dollars — to this address. Chainalysis and TRM independently attribute that address to the LockBit ransomware affiliate cluster.',
    acct: acct({
      frame_type_label: 'By Trace Path — Path A, Hop 1 of 7',
      frame_time: '2024-08-12T13:01:00Z',
      frame_chain: 'Ethereum',
      value_native: '12.500 ETH',
      value_fiat_at_frame: '$42,610',
      cumulative_taint_pct: 1.0,
      fees_absorbed_fiat: '$8.40',
      traceable_at_frame_fiat: TOTAL,
      traceable_at_frame_pct: 1.0,
      next_frame_label: 'Hop 2 of 7 — peel chain begins',
      next_frame_anticipated_taint_pct: 0.95,
    }),
  }),

  // ───────────────────────── Frame 4 ─────────────────────────
  pathHop({
    index: 4,
    id: 'f-04',
    hopIndex: 2,
    hopTotal: 7,
    title: 'Path A · Hop 2 — Peel chain begins',
    subtitle: '95% of value forwarded to the next hop; 5% peeled off to a side address.',
    txHash: '0xPee1Cha1nHop10000000000000000000000000000000000000000000000000',
    txRef: 'tx-peel-1',
    chain: 'ethereum',
    at: '2024-08-12T13:09:00Z',
    fromAddress: '0xRansomCrew11\u2026aaaa',
    toAddress: '0xPee1Cha1n11\u20260001 (95%) + 0xPee1Cha1nS1de11\u20260001 (5%)',
    valueNative: '11.875 ETH (95% onward)',
    valueFiat: '$40,479',
    cumTaint: 0.95,
    elapsedMs: 8 * 60_000,
    memo:
      'Peel-chain detector flagged at confidence 0.91. The 5% side branch becomes Path B (Tornado mixer).',
    attributions: [
      { provider: 'Internal detector', label: 'Peel chain (0.91 confidence)' },
    ],
    readAloud:
      'Hop two. The receiving address splits the value — 95 percent moves to the main chain we are tracing, 5 percent peels off. This pattern, called a peel chain, is one of the oldest laundering techniques and our detector flagged it immediately.',
    acct: acct({
      frame_type_label: 'By Trace Path — Path A, Hop 2 of 7',
      frame_time: '2024-08-12T13:09:00Z',
      frame_chain: 'Ethereum',
      value_native: '11.875 ETH',
      value_fiat_at_frame: '$40,479',
      cumulative_taint_pct: 0.95,
      fees_absorbed_fiat: '$16.20',
      traceable_at_frame_fiat: '$40,479',
      traceable_at_frame_pct: 0.95,
      next_frame_label: 'Hops 3-4 (collapsed) — peel continues to 82% retention',
      next_frame_anticipated_taint_pct: 0.82,
    }),
  }),

  // ───────────────────────── Frame 5 ─────────────────────────
  pathHop({
    index: 5,
    id: 'f-05',
    hopIndex: 5,
    hopTotal: 7,
    title: 'Path A · Hop 5 — Consolidation into Uniswap swap',
    subtitle: 'After three peel hops, the remaining 78% of value is swapped on Uniswap V3.',
    txHash:
      '0x4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3c1a9b2',
    txRef: 'tx-uniswap-swap',
    chain: 'ethereum',
    at: '2024-08-12T14:33:00Z',
    fromAddress: '0xdefa1b\u2026a4c2 (swap initiator EOA)',
    toAddress: '0xE5d7C2\u2026E0aD (Uniswap Universal Router v1.2)',
    valueNative: '8.420 ETH (78% of original)',
    valueFiat: '$28,710',
    cumTaint: 0.78,
    elapsedMs: 92 * 60_000,
    memo:
      'Swap re-denominates the value through USDT and back to ETH — a common obfuscation move. Slippage 0.41% is within typical range so the swap itself is unremarkable; the obfuscation signal is the re-denomination, not the price.',
    attributions: [
      { provider: 'Chainalysis', label: 'Uniswap Universal Router (clean)' },
      { provider: 'Arkham', label: 'Uniswap Universal Router' },
    ],
    readAloud:
      'Hop five. After three peel-chain transactions that stripped off 22 percent of the value, the remaining 8.42 ether is sent through a Uniswap swap. The swap converts the money into USDT and back into ether — a financial maneuver whose only purpose, in this context, is to break the on-chain trail visually. The math service still traces it.',
    acct: acct({
      frame_type_label: 'By Trace Path — Path A, Hop 5 of 7',
      frame_time: '2024-08-12T14:33:00Z',
      frame_chain: 'Ethereum',
      value_native: '8.420 ETH',
      value_fiat_at_frame: '$28,710',
      cumulative_taint_pct: 0.78,
      fees_absorbed_fiat: '$24.34',
      traceable_at_frame_fiat: '$33,236',
      traceable_at_frame_pct: 0.78,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
      next_frame_label: 'Hop 6 of 7 — swap output to recipient EOA',
      next_frame_anticipated_taint_pct: 0.78,
    }),
  }),

  // ───────────────────────── Frame 6 ─────────────────────────
  pathHop({
    index: 6,
    id: 'f-06',
    hopIndex: 6,
    hopTotal: 7,
    title: 'Path A · Hop 6 — Swap output to recipient EOA',
    subtitle: 'A newly-created address receives the swap output.',
    txHash:
      '0x4f3a7c91ed5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3c1a9b2',
    txRef: 'tx-uniswap-swap',
    chain: 'ethereum',
    at: '2024-08-12T14:33:00Z',
    fromAddress: '0xE5d7C2\u2026E0aD (Uniswap router)',
    toAddress: '0x123abc\u2026bf90 (newly-created EOA)',
    valueNative: '8.412 ETH',
    valueFiat: '$28,683',
    cumTaint: 0.78,
    elapsedMs: 92 * 60_000,
    memo: 'Recipient EOA has no prior on-chain history — created specifically for this hop.',
    attributions: [],
    readAloud:
      'Hop six. The swap output arrives at a freshly created address with no prior history. This is consistent with a disposable burner created to mediate the cash-out.',
    acct: acct({
      frame_type_label: 'By Trace Path — Path A, Hop 6 of 7',
      frame_time: '2024-08-12T14:33:00Z',
      frame_chain: 'Ethereum',
      value_native: '8.412 ETH',
      value_fiat_at_frame: '$28,683',
      cumulative_taint_pct: 0.78,
      fees_absorbed_fiat: '$24.34',
      traceable_at_frame_fiat: '$33,236',
      traceable_at_frame_pct: 0.78,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
      next_frame_label: 'Hop 7 of 7 — recipient EOA \u2192 Binance deposit',
      next_frame_anticipated_taint_pct: 0.78,
    }),
  }),

  // ───────────────────────── Frame 7 ─────────────────────────
  pathHop({
    index: 7,
    id: 'f-07',
    hopIndex: 7,
    hopTotal: 7,
    title: 'Path A · Hop 7 — Off-ramp to Binance',
    subtitle: 'The recipient EOA deposits the value directly into a Binance customer deposit wallet.',
    txHash:
      '0xB1nanceDeposit9c5a82b9b1d4a6e3c8b5f2d9e8c4a7b3d6e9f1c2a5b8d4e7f3',
    txRef: 'tx-binance-deposit',
    chain: 'ethereum',
    at: '2024-08-12T14:45:00Z',
    fromAddress: '0x123abc\u2026bf90 (recipient EOA)',
    toAddress: '0xBinanceDep0s1t\u2026aaaa (Binance deposit wallet 1417)',
    valueNative: '8.412 ETH',
    valueFiat: '$28,683',
    cumTaint: 0.78,
    elapsedMs: 104 * 60_000,
    memo:
      'Binance deposit wallet attribution confirmed by both Chainalysis and TRM independently, and corroborated by subpoena #2024-0184 returned 2024-09-12.',
    attributions: [
      { provider: 'Chainalysis', label: 'Binance customer deposit wallet (cluster 1417)' },
      { provider: 'TRM', label: 'Binance deposit infrastructure' },
      { provider: 'Subpoena', label: 'Binance KYC return 2024-09-12 (Exhibit C)' },
    ],
    readAloud:
      'Hop seven, the final hop. The disposable address sends the value directly to a Binance customer deposit wallet. Both commercial attribution providers, and the subpoena we received back from Binance on September twelfth, confirm that wallet belongs to a specific customer account.',
    acct: acct({
      frame_type_label: 'By Trace Path — Path A, Hop 7 of 7 (terminal)',
      frame_time: '2024-08-12T14:45:00Z',
      frame_chain: 'Ethereum',
      value_native: '8.412 ETH',
      value_fiat_at_frame: '$28,683',
      cumulative_taint_pct: 0.78,
      fees_absorbed_fiat: '$24.34',
      traceable_at_frame_fiat: '$28,683',
      traceable_at_frame_pct: 0.673,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
      off_ramped_fiat: '$28,683',
      off_ramped_pct: 0.673,
      next_frame_label: 'Step out to the case-level Sankey',
    }),
  }),

  // ───────────────────────── Frame 8 ─────────────────────────
  {
    id: F('f-08'),
    index: 8,
    kind: 'by_value',
    title: 'By value — the whole flow at a glance',
    subtitle: 'Sankey: original ransom payment on the left, terminal destinations on the right (FIFO).',
    methodology: 'fifo',
    payload: {
      kind: 'by_value',
      sankey_nodes: [
        { id: 's-victim', label: 'Acme Corp', side: 'source', family: 'context' },
        { id: 'm-rw', label: 'Ransomware crew', side: 'intermediate', family: 'taint' },
        { id: 'm-peel', label: 'Peel chain (3 hops)', side: 'intermediate', family: 'elevated' },
        { id: 'm-swap', label: 'Uniswap swap', side: 'intermediate', family: 'caution' },
        { id: 't-binance', label: 'Binance off-ramp', side: 'sink', family: 'clean' },
        { id: 't-tornado', label: 'Tornado mixer', side: 'sink', family: 'privacy' },
        { id: 't-fees', label: 'Fees absorbed', side: 'sink', family: 'context' },
      ],
      sankey_flows: [
        {
          id: 'flow-1',
          from: 's-victim',
          to: 'm-rw',
          value_native: '12.5 ETH',
          value_fiat: '$42,610',
          share_of_source: 1.0,
          taint_share: 1.0,
        },
        {
          id: 'flow-2',
          from: 'm-rw',
          to: 'm-peel',
          value_native: '12.5 ETH',
          value_fiat: '$42,610',
          share_of_source: 1.0,
          taint_share: 1.0,
        },
        {
          id: 'flow-3',
          from: 'm-peel',
          to: 'm-swap',
          value_native: '8.42 ETH',
          value_fiat: '$28,710',
          share_of_source: 0.674,
          taint_share: 0.78,
        },
        {
          id: 'flow-4',
          from: 'm-peel',
          to: 't-tornado',
          value_native: '0.594 ETH',
          value_fiat: '$2,028',
          share_of_source: 0.048,
          taint_share: 0.05,
        },
        {
          id: 'flow-5',
          from: 'm-peel',
          to: 't-fees',
          value_native: '—',
          value_fiat: '$56',
          share_of_source: 0.001,
          taint_share: 0,
        },
        {
          id: 'flow-6',
          from: 'm-swap',
          to: 't-binance',
          value_native: '8.412 ETH',
          value_fiat: '$28,683',
          share_of_source: 0.673,
          taint_share: 0.78,
        },
        {
          id: 'flow-7',
          from: 'm-swap',
          to: 't-fees',
          value_native: '—',
          value_fiat: '$27',
          share_of_source: 0.001,
          taint_share: 0,
        },
      ],
      highlight_flow_id: 'flow-6',
    },
    read_aloud:
      'Stepping back to look at the whole flow. Sixty-seven percent of the original payment landed in a Binance account we have subpoenaed. Five percent went into Tornado Cash and is, for now, lost to mixing. The remaining one percent was absorbed in network and swap fees. We can audit every flow under any of the five taint methodologies — press M to cycle them.',
    accounting: acct({
      frame_type_label: 'By Value — Sankey of the full case',
      value_fiat_at_frame: TOTAL,
      traceable_at_frame_fiat: '$28,683',
      traceable_at_frame_pct: 0.673,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
      off_ramped_fiat: '$28,683',
      off_ramped_pct: 0.673,
      next_frame_label: 'Zoom into Binance deposit wallet 1417',
    }),
  },

  // ───────────────────────── Frame 9 ─────────────────────────
  {
    id: F('f-09'),
    index: 9,
    kind: 'by_entity',
    title: 'Entity in focus — Binance deposit wallet 1417',
    subtitle: 'The off-ramp address. Subpoena #2024-0184 ties it to a specific Binance customer.',
    methodology: 'fifo',
    payload: {
      kind: 'by_entity',
      entity_label: 'Binance — deposit wallet 1417',
      entity_address: '0xBinanceDep0s1tWa11111111111111111111aaaa',
      entity_chain: 'eth',
      attributions: [
        { provider: 'Chainalysis', label: 'Binance customer deposit (cluster 1417)', confidence: 0.99 },
        { provider: 'TRM', label: 'Binance deposit infrastructure', confidence: 0.98 },
        { provider: 'Subpoena', label: 'Binance KYC return — Customer ID redacted', confidence: 1.0 },
      ],
      subpoena_refs: [
        {
          id: 'sub-1',
          label: 'Binance subpoena #2024-0184 (SDNY) — KYC + transaction history',
          date: '2024-08-12',
        },
        {
          id: 'sub-2',
          label: 'Binance follow-up #2024-0184-A — withdrawal records',
          date: '2024-09-04',
        },
      ],
      memos: [
        {
          id: 'm-1',
          text: 'KYC return confirms customer\u2019s identity. Customer subsequently withdrew to a US bank via SWIFT on 2024-08-13.',
          author: 'Doe',
          at: '2024-09-12T10:14:00Z',
        },
        {
          id: 'm-2',
          text: 'Marked court-grade after Verifier Agent confirmed every attribution row cites a BeliefAtom.',
          author: 'Doe',
          at: '2026-06-15T10:14:00Z',
        },
      ],
      transactions: [
        {
          tx_ref: TX('tx-binance-deposit'),
          tx_hash: '0xB1nanceDeposit9c\u2026',
          at: '2024-08-12T14:45:00Z',
          direction: 'in',
          counterparty_address: '0x123abc\u2026bf90',
          counterparty_label: 'Recipient EOA',
          value_native: '8.412 ETH',
          value_fiat_at_tx: '$28,683',
        },
        {
          tx_ref: TX('tx-binance-sweep'),
          tx_hash: '0xB1nanceSweep0000\u2026',
          at: '2024-08-12T14:48:00Z',
          direction: 'out',
          counterparty_address: '0xBinanceHotWa11et2\u2026',
          counterparty_label: 'Binance hot wallet 14 (internal)',
          value_native: '8.412 ETH',
          value_fiat_at_tx: '$28,683',
        },
      ],
    },
    read_aloud:
      'This is the destination address. The two commercial attribution providers and the subpoena return all converge on the same Binance customer. After Binance received the funds they were swept internally three minutes later into their hot wallet number 14 — a routine operational behavior, not a sign of obfuscation.',
    accounting: acct({
      frame_type_label: 'By Entity — Binance deposit wallet 1417',
      frame_chain: 'Ethereum',
      value_fiat_at_frame: '$28,683',
      traceable_at_frame_fiat: '$28,683',
      traceable_at_frame_pct: 0.673,
      off_ramped_fiat: '$28,683',
      off_ramped_pct: 0.673,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
      next_frame_label: 'Source document — Binance subpoena return',
    }),
  },

  // ───────────────────────── Frame 10 ─────────────────────────
  {
    id: F('f-10'),
    index: 10,
    kind: 'document',
    title: 'Source document — Binance subpoena return',
    subtitle:
      'Subpoena #2024-0184. The highlighted region is the row attributing wallet 1417 to the customer.',
    methodology: 'fifo',
    payload: {
      kind: 'document',
      document_id: 'doc-sub-2024-0184',
      document_title: 'Binance subpoena return #2024-0184',
      page_number: 4,
      bounding_box: { x: 12, y: 38, w: 76, h: 14 },
      supports_claim:
        'Binance customer (KYC verified) is the registered owner of deposit wallet 0xBinanceDep0s1t\u2026aaaa.',
    },
    read_aloud:
      'This is the document the chain of custody flows back to. Page four of the Binance return, the highlighted row, ties the wallet we have been tracing to a real customer Binance verified through KYC. This is the foundation of the attribution we presented two frames ago.',
    accounting: acct({
      frame_type_label: 'Source document — Binance #2024-0184, page 4',
      value_fiat_at_frame: '$28,683',
      traceable_at_frame_fiat: '$28,683',
      traceable_at_frame_pct: 0.673,
      off_ramped_fiat: '$28,683',
      off_ramped_pct: 0.673,
      lost_to_mixers_fiat: '$2,028',
      lost_to_mixers_pct: 0.048,
    }),
  },
];

function pathHop(args: {
  index: number;
  id: string;
  hopIndex: number;
  hopTotal: number;
  title: string;
  subtitle: string;
  txHash: string;
  txRef: string;
  chain: string;
  at: string;
  fromAddress: string;
  toAddress: string;
  valueNative: string;
  valueFiat: string;
  cumTaint: number;
  elapsedMs: number;
  memo?: string;
  attributions: Array<{ provider: string; label: string }>;
  readAloud: string;
  acct: AccountingState;
}): CourtFrame {
  return {
    id: F(args.id),
    index: args.index,
    kind: 'by_trace_path',
    title: args.title,
    subtitle: args.subtitle,
    methodology: 'fifo',
    payload: {
      kind: 'by_trace_path',
      path_id: 'path-A' as TracePathId,
      hop_index: args.hopIndex,
      hop_total: args.hopTotal,
      hop: {
        tx_ref: TX(args.txRef),
        tx_hash: args.txHash,
        chain: args.chain,
        at: args.at,
        from_address: args.fromAddress,
        to_address: args.toAddress,
        value_native: args.valueNative,
        value_fiat_at_tx: args.valueFiat,
        cumulative_taint_pct: args.cumTaint,
        elapsed_since_source_ms: args.elapsedMs,
        memo: args.memo,
        attributions: args.attributions,
      },
    },
    read_aloud: args.readAloud,
    accounting: args.acct,
  };
}

export const SEED_DECK: FrameDeck = {
  id: 'deck-acme-trial' as FrameDeck['id'],
  case_id: 'demo-case-arbiter' as FrameDeck['case_id'],
  case_name: 'Acme Corp ransomware — Aug 2024',
  title: 'Trial presentation — opening to off-ramp',
  curated_by: 'demo-investigator-doe' as FrameDeck['curated_by'],
  curated_at: '2026-06-19T18:00:00Z',
  methodology: 'fifo',
  frames,
  reproducibility_hash: 'sha256:0xRepro4ucibilityPackHashF1xtureD0NotTrustOnce',
};
