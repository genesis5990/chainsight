/**
 * RouterChainProvider — chain-data provider backed by the Capability Router.
 *
 * Replaces FixtureChainProvider for live runs. Calls
 * `router.resolve('get_tx_by_hash', { chain, tx_hash }, ctx)` and adapts
 * the Etherscan-shaped payload to ChainTxFixture so the InspectorRunner
 * code path is unchanged.
 *
 * Optional fallback: a FixtureChainProvider can be passed and is consulted
 * when the router has no install or all providers fail — this is what
 * keeps the synthetic Op Lemon test tx working in environments that
 * haven't been seeded with an Etherscan key yet.
 */

import type {
  AgencyContext,
  BeliefChainId,
  IntegerAmount,
  SubjectRef,
  TxRef,
} from '@chainsight/shared-types';
import type {
  CapabilityRouter,
  EtherscanTxResponse,
} from '@chainsight/capability-router';
import {
  AllProvidersFailedError,
  CapabilityUnavailableError,
} from '@chainsight/capability-router';
import type { ChainProvider, ChainTxFixture, ChainTxParty } from './chain_provider_stub';

export interface RouterChainProviderOptions {
  router: CapabilityRouter;
  ctx: AgencyContext;
  /** Optional fixture-backed fallback for offline tests / seed data. */
  fallback?: ChainProvider;
}

export class RouterChainProvider implements ChainProvider {
  constructor(private readonly opts: RouterChainProviderOptions) {}

  async fetchTx(txRef: TxRef): Promise<ChainTxFixture | null> {
    const parsed = parseTxRef(txRef);
    if (!parsed) return this.opts.fallback?.fetchTx(txRef) ?? null;

    try {
      const result = await this.opts.router.resolve<EtherscanTxResponse>(
        'get_tx_by_hash',
        { chain: parsed.chain, tx_hash: parsed.tx_hash },
        this.opts.ctx,
      );
      return adaptEtherscan(result.data);
    } catch (err) {
      // Fall back to the fixture provider if no install / all providers failed
      if (
        err instanceof CapabilityUnavailableError
        || err instanceof AllProvidersFailedError
      ) {
        const fallback = await this.opts.fallback?.fetchTx(txRef);
        if (fallback) return fallback;
      }
      throw err;
    }
  }
}

/* ─── tx_ref parsing ───────────────────────────────────────────────────── */

function parseTxRef(txRef: TxRef): { chain: string; tx_hash: string } | null {
  // Accept both legacy `eth_tx:0x…` and v1.1 `evm:1_tx:0x…` forms.
  if (txRef.startsWith('evm:1_tx:')) return { chain: 'evm:1', tx_hash: txRef.slice('evm:1_tx:'.length) };
  if (txRef.startsWith('eth_tx:'))   return { chain: 'evm:1', tx_hash: txRef.slice('eth_tx:'.length) };
  return null;
}

/* ─── Etherscan → ChainTxFixture adapter ───────────────────────────────── */

export function adaptEtherscan(data: EtherscanTxResponse): ChainTxFixture {
  const parties: ChainTxParty[] = [
    {
      role: 'from',
      address_ref: `evm:1_addr:${data.from.toLowerCase()}` as SubjectRef,
    },
  ];
  if (data.to) {
    parties.push({
      role: 'to',
      address_ref: `evm:1_addr:${data.to.toLowerCase()}` as SubjectRef,
    });
  }

  return {
    chain: 'evm:1' as BeliefChainId,
    tx_hash: data.tx_hash,
    block_hash: data.block_hash,
    block_height: data.block_height,
    block_time_utc: data.block_time_utc,
    index_in_block: 0,
    status: data.status,
    gas_used: Number(data.gas_used),
    gas_price_minor: data.gas_price_minor as IntegerAmount,
    fee_native_minor: data.fee_native_minor as IntegerAmount,
    value_native_minor: data.value_native_minor as IntegerAmount,
    selector: data.selector ?? undefined,
    contract: data.contract_address ?? undefined,
    parties,
  };
}
