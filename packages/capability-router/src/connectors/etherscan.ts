/**
 * EtherscanConnector — implements get_tx_by_hash for evm:1 (Ethereum mainnet)
 * via the public Etherscan v2 API.
 *
 * Returns a normalized ChainTx shape that the inspector pipeline's
 * RouterChainProvider consumes. Etherscan-specific HTTP shape never leaves
 * this file.
 *
 * Free tier requires no key but allows up to 5 req/s. With an API key the
 * router can lift the rate limit. We always pass the key when configured.
 */

import type {
  Capability,
  ConnectorCallOptions,
  ConnectorResponse,
  ProviderConnector,
  ResolvedCredential,
} from '../types';

const ETHERSCAN_BASE = 'https://api.etherscan.io/api';

export interface EtherscanTxResponse {
  chain: 'evm:1';
  tx_hash: string;
  block_hash: string;
  block_height: number;
  block_time_utc: string;
  from: string;
  to: string;
  value_native_minor: string;
  gas_used: string;
  gas_price_minor: string;
  fee_native_minor: string;
  status: 'success' | 'failed';
  input_data: string;
  selector: string | null;
  contract_address: string | null;
  /** Provider-side fingerprint (for audit). */
  raw_provider_id: string;
}

export interface EtherscanConnectorOptions {
  /** Override base URL (used by tests with a mock server). */
  base_url?: string;
  /** Inject a fetch — defaults to global fetch. */
  fetch_impl?: typeof fetch;
}

export class EtherscanConnector implements ProviderConnector {
  readonly provider_id = 'etherscan';
  readonly capabilities: readonly Capability[] = ['get_tx_by_hash'];

  constructor(private readonly opts: EtherscanConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability !== 'get_tx_by_hash') {
      throw new Error(`EtherscanConnector does not support capability '${capability}'`);
    }
    const chain = String(args.chain ?? '');
    const txHash = String(args.tx_hash ?? '');
    if (chain !== 'evm:1') {
      throw new Error(`EtherscanConnector only supports chain 'evm:1', got '${chain}'`);
    }
    if (!txHash.startsWith('0x')) {
      throw new Error(`tx_hash must start with 0x: '${txHash}'`);
    }

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ETHERSCAN_BASE;

    // 1) eth_getTransactionByHash
    const txUrl = `${base}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}${credential ? `&apikey=${encodeURIComponent(credential.secret)}` : ''}`;
    const txRes = await fetchImpl(txUrl, { signal: options.signal });
    if (!txRes.ok) throw new Error(`etherscan tx HTTP ${txRes.status}`);
    const txBody = await txRes.json() as { result?: EtherscanRawTx | null; error?: { message: string } };
    if (txBody.error) throw new Error(`etherscan tx error: ${txBody.error.message}`);
    if (!txBody.result) throw new Error(`etherscan: tx ${txHash} not found`);
    const rawTx = txBody.result;

    // 2) eth_getTransactionReceipt
    const rcUrl = `${base}?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}${credential ? `&apikey=${encodeURIComponent(credential.secret)}` : ''}`;
    const rcRes = await fetchImpl(rcUrl, { signal: options.signal });
    if (!rcRes.ok) throw new Error(`etherscan receipt HTTP ${rcRes.status}`);
    const rcBody = await rcRes.json() as { result?: EtherscanRawReceipt | null; error?: { message: string } };
    if (rcBody.error) throw new Error(`etherscan receipt error: ${rcBody.error.message}`);
    if (!rcBody.result) throw new Error(`etherscan: receipt for ${txHash} not found`);
    const rawRc = rcBody.result;

    // 3) eth_getBlockByNumber to fetch block_time_utc
    const blockHex = rawTx.blockNumber;
    const blkUrl = `${base}?module=proxy&action=eth_getBlockByNumber&tag=${blockHex}&boolean=false${credential ? `&apikey=${encodeURIComponent(credential.secret)}` : ''}`;
    const blkRes = await fetchImpl(blkUrl, { signal: options.signal });
    if (!blkRes.ok) throw new Error(`etherscan block HTTP ${blkRes.status}`);
    const blkBody = await blkRes.json() as { result?: { timestamp: string; hash: string } | null };
    const blockTimeUtc = blkBody.result?.timestamp
      ? new Date(Number(BigInt(blkBody.result.timestamp)) * 1000).toISOString()
      : new Date(0).toISOString();
    const blockHash = blkBody.result?.hash ?? rawTx.blockHash ?? '';

    const gasUsed = BigInt(rawRc.gasUsed);
    const gasPrice = BigInt(rawTx.gasPrice);
    const valueNativeMinor = BigInt(rawTx.value);
    const feeNativeMinor = gasUsed * gasPrice;

    const inputData = rawTx.input ?? '0x';
    const selector = inputData.length >= 10 ? inputData.slice(0, 10) : null;

    const data: EtherscanTxResponse = {
      chain: 'evm:1',
      tx_hash: txHash,
      block_hash: blockHash,
      block_height: Number(BigInt(blockHex)),
      block_time_utc: blockTimeUtc,
      from: rawTx.from,
      to: rawTx.to ?? '',
      value_native_minor: valueNativeMinor.toString(),
      gas_used: gasUsed.toString(),
      gas_price_minor: gasPrice.toString(),
      fee_native_minor: feeNativeMinor.toString(),
      status: rawRc.status === '0x1' ? 'success' : 'failed',
      input_data: inputData,
      selector,
      contract_address: rawRc.contractAddress ?? (rawTx.to ?? null),
      raw_provider_id: 'etherscan',
    };

    return {
      data: data as unknown as TPayload,
      metadata: {
        request_id: `etherscan:${txHash}`,
      },
    };
  }
}

/* ─── Etherscan v2 raw shapes (minimal) ────────────────────────────────── */

interface EtherscanRawTx {
  blockHash: string;
  blockNumber: string;
  from: string;
  to: string | null;
  gas: string;
  gasPrice: string;
  hash: string;
  input: string;
  value: string;
}

interface EtherscanRawReceipt {
  blockHash: string;
  blockNumber: string;
  contractAddress: string | null;
  gasUsed: string;
  status: string;
  transactionHash: string;
}
