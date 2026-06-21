/**
 * Deterministic chain-data provider stub.
 *
 * Used by the Inspector pipeline in Phase-1 Week-3 to validate the section
 * state machine + citation contract end-to-end without depending on the
 * Capability Router (Week 4) being live yet.
 *
 * Replace with `import { CapabilityRouter } from '@chainsight/capability-router'`
 * when Week 4 ships. The interface is shaped so the swap is type-only.
 */

import type { BeliefChainId, IntegerAmount, SubjectRef, TxRef } from '@chainsight/shared-types';

export interface ChainTxParty {
  role: 'from' | 'to' | 'token_from' | 'token_to' | 'contract';
  address_ref: SubjectRef;
  display_label?: string;
  /** Pre-known attribution label (Phase 2: from the Attribution Agent). */
  known_attribution?: string;
}

export interface ChainTxFixture {
  chain: BeliefChainId;
  tx_hash: string;
  block_hash: string;
  block_height: number;
  block_time_utc: string;
  index_in_block: number;
  status: 'success' | 'failed';
  /** EVM-style. Non-EVM passes only fee_native_minor. */
  gas_used?: number;
  gas_price_minor?: IntegerAmount;
  fee_native_minor: IntegerAmount;
  value_native_minor: IntegerAmount;
  selector?: string;
  contract?: string;
  parties: ChainTxParty[];
}

export interface ChainProvider {
  fetchTx(txRef: TxRef): Promise<ChainTxFixture | null>;
}

// ─── canonical Op Lemon ransom payment fixture ──────────────────────────────

const ACME_VICTIM_BTC = 'btc:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh' as const;
const RANSOM_CREW_ETH = 'eth:0x742d35cc6634c0532925a3b844bc9e7595f0beb1' as const;

const FIXTURES: Record<TxRef, ChainTxFixture> = {
  // Op Lemon ransom payment: 47.2 ETH from victim's bridged wallet to the
  // ransom crew's primary EOA. The hash matches the v0.6 + Phase-0 seed data.
  ['eth_tx:0xa7b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9' as TxRef]: ({
    chain: 'eth',
    tx_hash: '0xa7b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9',
    block_hash: '0xb1c4d2e9f6a3b7c2e0d9f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1',
    block_height: 21_421_337,
    block_time_utc: '2026-04-09T14:31:00Z',
    index_in_block: 42,
    status: 'success',
    gas_used: 21_000,
    gas_price_minor: '24500000000',           // 24.5 gwei
    fee_native_minor: '514500000000000',      // 21k * 24.5 gwei
    value_native_minor: '47200000000000000000', // 47.2 ETH
    parties: [
      { role: 'from', address_ref: 'eth:0xv1ct1mbr1dge0acme0c0r0p0000000000000000fa' as SubjectRef, display_label: 'Acme bridge-out' },
      { role: 'to', address_ref: RANSOM_CREW_ETH as SubjectRef, display_label: 'Ransom crew (LockBit-affiliated)', known_attribution: 'Suspect EOA' },
    ],
  } as ChainTxFixture),

  // A simple ERC-20 transfer to test §3 decoded_action branch
  ['eth_tx:0xdeadbeefcafe00000000000000000000000000000000000000000000000000000001' as TxRef]: ({
    chain: 'eth',
    tx_hash: '0xdeadbeefcafe00000000000000000000000000000000000000000000000000000001',
    block_hash: '0xfeedface0000000000000000000000000000000000000000000000000000abcdef',
    block_height: 21_500_001,
    block_time_utc: '2026-04-20T09:15:00Z',
    index_in_block: 7,
    status: 'success',
    gas_used: 65_000,
    gas_price_minor: '20000000000',
    fee_native_minor: '1300000000000000',
    value_native_minor: '0',
    selector: '0xa9059cbb',
    contract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',  // USDT
    parties: [
      { role: 'from',       address_ref: 'eth:0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97' as SubjectRef },
      { role: 'token_from', address_ref: 'eth:0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97' as SubjectRef },
      { role: 'token_to',   address_ref: 'eth:0x28c6c06298d514db089934071355e5743bf21d60' as SubjectRef, display_label: 'Kraken hot wallet 14', known_attribution: 'Exchange deposit' },
      { role: 'contract',   address_ref: 'eth:0xdac17f958d2ee523a2206206994597c13d831ec7' as SubjectRef, display_label: 'USDT (Tether)' },
    ],
  } as ChainTxFixture),
};

export class FixtureChainProvider implements ChainProvider {
  async fetchTx(txRef: TxRef): Promise<ChainTxFixture | null> {
    const normalised = txRef.toLowerCase() as TxRef;
    return FIXTURES[normalised] ?? null;
  }
}

/** Acme Corp / Operation Lemon canonical anchors — exported for tests. */
export const ACME_VICTIM_BTC_REF = ACME_VICTIM_BTC;
export const RANSOM_CREW_ETH_REF = RANSOM_CREW_ETH;
