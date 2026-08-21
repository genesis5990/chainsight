/**
 * BlockchairConnector — implements get_address_balance and get_tx_by_hash for
 * Bitcoin (UTXO) via the Blockchair public API.
 *
 * Bitcoin transactions are UTXO-shaped (multiple inputs and outputs), so the
 * response shapes here differ from the EVM `from`/`to` shapes returned by the
 * Etherscan connector. The inspector pipeline adapts these into ChainTxFixture
 * parties downstream.
 *
 * Requires a BLOCKCHAIR_API_KEY for reasonable rate limits; the free tier is
 * heavily throttled.
 */

import type {
  Capability,
  ConnectorCallOptions,
  ConnectorResponse,
  ProviderConnector,
  ResolvedCredential,
} from '../types';

const BLOCKCHAIR_BASE = 'https://api.blockchair.com';

/** Map ChainSight chain notation to Blockchair chain slugs. */
const BLOCKCHAIR_CHAINS: Record<string, string> = {
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
};

function blockchairChainFor(chain: unknown): string | null {
  const key = String(chain ?? '').toLowerCase();
  return BLOCKCHAIR_CHAINS[key] ?? null;
}

export interface BlockchairBalanceResponse {
  chain: 'btc';
  address: string;
  balance_native_minor: string;
  received_native_minor: string;
  spent_native_minor: string;
  tx_count: number;
  raw_provider_id: 'blockchair';
}

export interface BlockchairUtxoInput {
  address: string;
  value_native_minor: string;
  prev_tx_hash: string;
  prev_output_index: number;
}

export interface BlockchairUtxoOutput {
  address: string;
  value_native_minor: string;
  output_index: number;
  spent: boolean;
}

export interface BlockchairTxResponse {
  chain: 'btc';
  tx_hash: string;
  block_hash: string | null;
  block_height: number | null;
  block_time_utc: string | null;
  fee_native_minor: string;
  inputs: BlockchairUtxoInput[];
  outputs: BlockchairUtxoOutput[];
  raw_provider_id: 'blockchair';
}

export interface BlockchairConnectorOptions {
  /** Override base URL (used by tests with a mock server). */
  base_url?: string;
  /** Inject a fetch — defaults to global fetch. */
  fetch_impl?: typeof fetch;
}

export class BlockchairConnector implements ProviderConnector {
  readonly provider_id = 'blockchair';
  readonly capabilities: readonly Capability[] = [
    'get_address_balance',
    'get_tx_by_hash',
  ];

  constructor(private readonly opts: BlockchairConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability === 'get_address_balance') {
      return this.getBalance(args, credential, options) as Promise<ConnectorResponse<TPayload>>;
    }
    if (capability !== 'get_tx_by_hash') {
      throw new Error(`BlockchairConnector does not support capability '${capability}'`);
    }
    return this.getTx(args, credential, options) as Promise<ConnectorResponse<TPayload>>;
  }

  /**
   * get_address_balance — native balance (satoshis) plus received/spent totals
   * and transaction count for a Bitcoin address.
   */
  private async getBalance(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<BlockchairBalanceResponse>> {
    const chainSlug = blockchairChainFor(args.chain);
    if (!chainSlug) {
      throw new Error(`BlockchairConnector.get_address_balance does not support chain '${String(args.chain)}'`);
    }
    const address = String(args.address ?? '').trim();
    if (!address) {
      throw new Error('address is required');
    }

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? BLOCKCHAIR_BASE;
    const apiKey = credential ? `&key=${encodeURIComponent(credential.secret)}` : '';

    const url = `${base}/${chainSlug}/dashboards/address/${encodeURIComponent(address)}?limit=0${apiKey}`;
    const res = await fetchImpl(url, { signal: options.signal });
    if (!res.ok) throw new Error(`blockchair balance HTTP ${res.status}`);
    const body = await res.json() as BlockchairAddressDashboard;
    const entry = body.data?.[address];
    if (!entry?.address) {
      throw new Error(`blockchair: address ${address} not found`);
    }
    const a = entry.address;

    const data: BlockchairBalanceResponse = {
      chain: 'btc',
      address,
      balance_native_minor: String(a.balance ?? 0),
      received_native_minor: String(a.received ?? 0),
      spent_native_minor: String(a.spent ?? 0),
      tx_count: Number(a.transaction_count ?? 0),
      raw_provider_id: 'blockchair',
    };
    return {
      data,
      metadata: { request_id: `blockchair-balance:${address}` },
    };
  }

  /**
   * get_tx_by_hash — full UTXO transaction (inputs + outputs) for a Bitcoin
   * transaction hash.
   */
  private async getTx(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<BlockchairTxResponse>> {
    const chainSlug = blockchairChainFor(args.chain);
    if (!chainSlug) {
      throw new Error(`BlockchairConnector.get_tx_by_hash does not support chain '${String(args.chain)}'`);
    }
    const txHash = String(args.tx_hash ?? '').trim();
    if (!txHash) {
      throw new Error('tx_hash is required');
    }

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? BLOCKCHAIR_BASE;
    const apiKey = credential ? `&key=${encodeURIComponent(credential.secret)}` : '';

    const url = `${base}/${chainSlug}/dashboards/transaction/${encodeURIComponent(txHash)}${apiKey}`;
    const res = await fetchImpl(url, { signal: options.signal });
    if (!res.ok) throw new Error(`blockchair tx HTTP ${res.status}`);
    const body = await res.json() as BlockchairTxDashboard;
    const entry = body.data?.[txHash];
    if (!entry?.transaction) {
      throw new Error(`blockchair: transaction ${txHash} not found`);
    }
    const tx = entry.transaction;

    const inputs: BlockchairUtxoInput[] = (entry.inputs ?? []).map((inp) => ({
      address: inp.recipient ?? '',
      value_native_minor: String(inp.value ?? 0),
      prev_tx_hash: inp.transaction_hash ?? '',
      prev_output_index: Number(inp.index ?? 0),
    }));
    const outputs: BlockchairUtxoOutput[] = (entry.outputs ?? []).map((out) => ({
      address: out.recipient ?? '',
      value_native_minor: String(out.value ?? 0),
      output_index: Number(out.index ?? 0),
      spent: Boolean(out.is_spent),
    }));

    const data: BlockchairTxResponse = {
      chain: 'btc',
      tx_hash: txHash,
      block_hash: null,
      block_height: tx.block_id != null ? Number(tx.block_id) : null,
      block_time_utc: tx.time ? new Date(tx.time).toISOString() : null,
      fee_native_minor: String(tx.fee ?? 0),
      inputs,
      outputs,
      raw_provider_id: 'blockchair',
    };
    return {
      data,
      metadata: { request_id: `blockchair-tx:${txHash}` },
    };
  }
}

/* ─── Blockchair raw shapes (minimal) ─────────────────────────────────── */

interface BlockchairAddressDashboard {
  data?: Record<string, {
    address?: {
      balance?: number;
      received?: number;
      spent?: number;
      transaction_count?: number;
    };
  }>;
}

interface BlockchairTxDashboard {
  data?: Record<string, {
    transaction?: {
      hash?: string;
      block_id?: number;
      time?: string;
      fee?: number;
    };
    inputs?: Array<{
      recipient?: string;
      value?: number;
      index?: number;
      transaction_hash?: string;
    }>;
    outputs?: Array<{
      recipient?: string;
      value?: number;
      index?: number;
      is_spent?: boolean;
    }>;
  }>;
}
