/**
 * EtherscanConnector — implements get_tx_by_hash, get_address_neighbors,
 * get_address_balance, and get_address_attribution across EVM chains via the
 * public Etherscan v2 multi-chain API.
 *
 * Returns normalized ChainTx / neighbors / balance shapes that the inspector
 * pipeline's RouterChainProvider consumes. Etherscan-specific HTTP shape never
 * leaves this file.
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

const ETHERSCAN_BASE = 'https://api.etherscan.io/v2/api';

/**
 * Etherscan v2 chainid map. Keyed by ChainSight's canonical `evm:<chainid>`
 * notation, with common short names (BeliefChainId + aliases) as conveniences.
 * Mirrors the chain coverage of the legacy Base44 etherscanAPI function.
 */
const EVM_CHAIN_IDS: Record<string, string> = {
  'evm:1': '1',
  'evm:56': '56',
  'evm:137': '137',
  'evm:42161': '42161',
  'evm:10': '10',
  'evm:8453': '8453',
  'evm:43114': '43114',
  'evm:250': '250',
  'evm:100': '100',
  'evm:324': '324',
  'evm:59144': '59144',
  'evm:534352': '534352',
  'evm:5000': '5000',
  'evm:81457': '81457',
  'evm:42220': '42220',
  'evm:25': '25',
  // Short-name aliases
  eth: '1',
  ethereum: '1',
  bsc: '56',
  binance_smart_chain: '56',
  bnb: '56',
  polygon: '137',
  matic: '137',
  arbitrum: '42161',
  arb: '42161',
  optimism: '10',
  op: '10',
  base: '8453',
  avalanche: '43114',
  avax: '43114',
  fantom: '250',
  ftm: '250',
  gnosis: '100',
  xdai: '100',
  zksync: '324',
  linea: '59144',
  scroll: '534352',
  mantle: '5000',
  blast: '81457',
  celo: '42220',
  cronos: '25',
  cro: '25',
};

/** Resolve a chain argument to an Etherscan v2 chainid, or null if unsupported. */
function chainIdFor(chain: unknown): string | null {
  const key = String(chain ?? '').toLowerCase();
  if (EVM_CHAIN_IDS[key]) return EVM_CHAIN_IDS[key];
  // Accept bare chainid numbers (e.g. '1', '56') for forward-compat.
  if (/^\d+$/.test(key)) return key;
  return null;
}

export interface EtherscanTxResponse {
  chain: `evm:${string}`;
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

export interface EtherscanNeighborsResponse {
  chain: `evm:${string}`;
  address: string;
  direction: 'inflow' | 'outflow' | 'both';
  edges: Array<{
    chain: `evm:${string}`;
    tx_hash: string;
    edge_index: number;
    block_height: number;
    block_hash?: string;
    block_time_utc: string;
    from_subject: string;
    to_subject: string;
    value_native_minor: string;
    edge_kind: 'tx_native' | 'token_transfer';
    cost_usd: number;
  }>;
  total_cost_usd: number;
  node_attribution_kind: string | null;
  raw_provider_id: 'etherscan';
}

export interface EtherscanAttributionResponse {
  chain: `evm:${string}`;
  address: string;
  attribution_kind: string | null;
  label: string | null;
  source: 'etherscan_label' | 'unknown';
  raw_provider_id: 'etherscan';
}

export interface EtherscanBalanceResponse {
  chain: `evm:${string}`;
  address: string;
  balance_native_minor: string;
  raw_provider_id: 'etherscan';
}

export class EtherscanConnector implements ProviderConnector {
  readonly provider_id = 'etherscan';
  readonly capabilities: readonly Capability[] = [
    'get_tx_by_hash',
    'get_address_neighbors',
    'get_address_attribution',
    'get_address_balance',
  ];

  constructor(private readonly opts: EtherscanConnectorOptions = {}) {}

  async call<TPayload>(
    capability: Capability,
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    if (capability === 'get_address_neighbors') {
      return this.getNeighbors(args, credential, options) as Promise<ConnectorResponse<TPayload>>;
    }
    if (capability === 'get_address_attribution') {
      return this.getAttribution(args, credential, options) as Promise<ConnectorResponse<TPayload>>;
    }
    if (capability === 'get_address_balance') {
      return this.getBalance(args, credential, options) as Promise<ConnectorResponse<TPayload>>;
    }
    if (capability !== 'get_tx_by_hash') {
      throw new Error(`EtherscanConnector does not support capability '${capability}'`);
    }
    const chainId = chainIdFor(args.chain);
    if (!chainId) {
      throw new Error(`EtherscanConnector does not support chain '${String(args.chain)}'`);
    }
    const txHash = String(args.tx_hash ?? '');
    if (!txHash.startsWith('0x')) {
      throw new Error(`tx_hash must start with 0x: '${txHash}'`);
    }

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ETHERSCAN_BASE;
    const apiKey = credential ? `&apikey=${encodeURIComponent(credential.secret)}` : '';

    // 1) eth_getTransactionByHash
    const txUrl = `${base}?chainid=${chainId}&module=proxy&action=eth_getTransactionByHash&txhash=${txHash}${apiKey}`;
    const txRes = await fetchImpl(txUrl, { signal: options.signal });
    if (!txRes.ok) throw new Error(`etherscan tx HTTP ${txRes.status}`);
    const txBody = await txRes.json() as { result?: EtherscanRawTx | null; error?: { message: string } };
    if (txBody.error) throw new Error(`etherscan tx error: ${txBody.error.message}`);
    if (!txBody.result) throw new Error(`etherscan: tx ${txHash} not found`);
    const rawTx = txBody.result;

    // 2) eth_getTransactionReceipt
    const rcUrl = `${base}?chainid=${chainId}&module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}${apiKey}`;
    const rcRes = await fetchImpl(rcUrl, { signal: options.signal });
    if (!rcRes.ok) throw new Error(`etherscan receipt HTTP ${rcRes.status}`);
    const rcBody = await rcRes.json() as { result?: EtherscanRawReceipt | null; error?: { message: string } };
    if (rcBody.error) throw new Error(`etherscan receipt error: ${rcBody.error.message}`);
    if (!rcBody.result) throw new Error(`etherscan: receipt for ${txHash} not found`);
    const rawRc = rcBody.result;

    // 3) eth_getBlockByNumber to fetch block_time_utc
    const blockHex = rawTx.blockNumber;
    const blkUrl = `${base}?chainid=${chainId}&module=proxy&action=eth_getBlockByNumber&tag=${blockHex}&boolean=false${apiKey}`;
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
      chain: `evm:${chainId}`,
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
        request_id: `etherscan:${chainId}:${txHash}`,
      },
    };
  }

  /**
   * get_address_balance — native balance for an address on any supported EVM
   * chain. Returns the raw minor-unit balance (wei) as a string, matching the
   * `IntegerAmount` convention used across shared-types.
   */
  private async getBalance(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<EtherscanBalanceResponse>> {
    const chainId = chainIdFor(args.chain);
    if (!chainId) {
      throw new Error(`EtherscanConnector.get_address_balance does not support chain '${String(args.chain)}'`);
    }
    const address = String(args.address ?? '').toLowerCase();
    if (!address.startsWith('0x')) {
      throw new Error(`address must start with 0x: '${address}'`);
    }

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ETHERSCAN_BASE;
    const apiKey = credential ? `&apikey=${encodeURIComponent(credential.secret)}` : '';

    const url = `${base}?chainid=${chainId}&module=account&action=balance&address=${address}&tag=latest${apiKey}`;
    const res = await fetchImpl(url, { signal: options.signal });
    if (!res.ok) throw new Error(`etherscan balance HTTP ${res.status}`);
    const body = await res.json() as { status?: string; message?: string; result?: string };
    if (body.status !== '1' || body.result === undefined) {
      throw new Error(`etherscan balance error: ${body.message ?? 'no result'}`);
    }

    const data: EtherscanBalanceResponse = {
      chain: `evm:${chainId}`,
      address,
      balance_native_minor: body.result,
      raw_provider_id: 'etherscan',
    };
    return {
      data,
      metadata: { request_id: `etherscan-balance:${chainId}:${address}` },
    };
  }

  /**
   * get_address_neighbors — paginate Etherscan `txlist` + `tokentx` actions.
   * Returns a normalized neighbors payload. Tracer filters by direction +
   * block_window. Deterministic ordering for cache reproducibility.
   */
  private async getNeighbors(
    args: Record<string, unknown>,
    credential: ResolvedCredential | null,
    options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<EtherscanNeighborsResponse>> {
    const chainId = chainIdFor(args.chain);
    if (!chainId) {
      throw new Error(`EtherscanConnector.get_address_neighbors does not support chain '${String(args.chain)}'`);
    }
    const address = String(args.address ?? '').toLowerCase();
    if (!address.startsWith('0x')) {
      throw new Error(`address must start with 0x: '${address}'`);
    }
    const direction = String(args.direction ?? 'both') as 'inflow' | 'outflow' | 'both';
    const window = (args.block_window as { from?: number; to?: number } | undefined) ?? {};
    const startBlock = Number.isFinite(window.from) ? Number(window.from) : 0;
    const endBlock = Number.isFinite(window.to) ? Number(window.to) : 99999999;
    const pageSize = Math.min(Number(args.page_size ?? 100), 1000);

    const fetchImpl = this.opts.fetch_impl ?? fetch;
    const base = this.opts.base_url ?? ETHERSCAN_BASE;
    const apiKey = credential ? `&apikey=${encodeURIComponent(credential.secret)}` : '';

    const txUrl = `${base}?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&page=1&offset=${pageSize}${apiKey}`;
    const ttUrl = `${base}?chainid=${chainId}&module=account&action=tokentx&address=${address}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&page=1&offset=${pageSize}${apiKey}`;

    const [txRes, ttRes] = await Promise.all([
      fetchImpl(txUrl, { signal: options.signal }),
      fetchImpl(ttUrl, { signal: options.signal }),
    ]);
    if (!txRes.ok) throw new Error(`etherscan neighbors-tx HTTP ${txRes.status}`);
    if (!ttRes.ok) throw new Error(`etherscan neighbors-token HTTP ${ttRes.status}`);

    const txBody = await txRes.json() as { status?: string; message?: string; result?: EtherscanListTx[] | string };
    const ttBody = await ttRes.json() as { status?: string; message?: string; result?: EtherscanListToken[] | string };

    const nativeTxs = Array.isArray(txBody.result) ? txBody.result : [];
    const tokenTxs = Array.isArray(ttBody.result) ? ttBody.result : [];

    const edges: EtherscanNeighborsResponse['edges'] = [];
    for (const t of nativeTxs) {
      if (!matchesDirection(address, t.from, t.to, direction)) continue;
      if (BigInt(t.value || '0') === 0n) continue;
      edges.push({
        chain: `evm:${chainId}`,
        tx_hash: t.hash,
        edge_index: 0,
        block_height: Number(t.blockNumber),
        block_hash: t.blockHash,
        block_time_utc: new Date(Number(t.timeStamp) * 1000).toISOString(),
        from_subject: `evm:${chainId}_addr:${t.from.toLowerCase()}`,
        to_subject: `evm:${chainId}_addr:${t.to.toLowerCase()}`,
        value_native_minor: t.value,
        edge_kind: 'tx_native',
        cost_usd: 0.0001,
      });
    }
    for (const t of tokenTxs) {
      if (!matchesDirection(address, t.from, t.to, direction)) continue;
      if (BigInt(t.value || '0') === 0n) continue;
      edges.push({
        chain: `evm:${chainId}`,
        tx_hash: t.hash,
        edge_index: Number(t.transactionIndex ?? 0),
        block_height: Number(t.blockNumber),
        block_hash: t.blockHash,
        block_time_utc: new Date(Number(t.timeStamp) * 1000).toISOString(),
        from_subject: `evm:${chainId}_addr:${t.from.toLowerCase()}`,
        to_subject: `evm:${chainId}_addr:${t.to.toLowerCase()}`,
        value_native_minor: t.value,
        edge_kind: 'token_transfer',
        cost_usd: 0.0001,
      });
    }

    edges.sort((a, b) => {
      if (a.block_height !== b.block_height) return a.block_height - b.block_height;
      if (a.tx_hash !== b.tx_hash) return a.tx_hash < b.tx_hash ? -1 : 1;
      return a.edge_index - b.edge_index;
    });
    const seen = new Set<string>();
    const deduped = edges.filter((e) => {
      const k = `${e.tx_hash}:${e.edge_index}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const data: EtherscanNeighborsResponse = {
      chain: `evm:${chainId}`,
      address,
      direction,
      edges: deduped,
      total_cost_usd: deduped.length * 0.0001,
      node_attribution_kind: null,
      raw_provider_id: 'etherscan',
    };
    return {
      data,
      metadata: { request_id: `etherscan-neighbors:${chainId}:${address}:${direction}:${startBlock}-${endBlock}` },
    };
  }

  /**
   * get_address_attribution — Etherscan's free tier does not expose a public
   * attribution API. Return a safe 'unknown' shape; router falls through to
   * OpenSanctions. Pro tier label-cloud left for a future extension.
   */
  private async getAttribution(
    args: Record<string, unknown>,
    _credential: ResolvedCredential | null,
    _options: ConnectorCallOptions,
  ): Promise<ConnectorResponse<EtherscanAttributionResponse>> {
    const chainId = chainIdFor(args.chain);
    if (!chainId) {
      throw new Error(`EtherscanConnector.get_address_attribution does not support chain '${String(args.chain)}'`);
    }
    const address = String(args.address ?? '').toLowerCase();
    if (!address.startsWith('0x')) {
      throw new Error(`address must start with 0x: '${address}'`);
    }
    const data: EtherscanAttributionResponse = {
      chain: `evm:${chainId}`,
      address,
      attribution_kind: null,
      label: null,
      source: 'unknown',
      raw_provider_id: 'etherscan',
    };
    return {
      data,
      metadata: { request_id: `etherscan-attr:${chainId}:${address}` },
    };
  }
}

function matchesDirection(
  address: string,
  from: string,
  to: string,
  direction: 'inflow' | 'outflow' | 'both',
): boolean {
  const a = address.toLowerCase();
  const f = from.toLowerCase();
  const t = to.toLowerCase();
  if (direction === 'inflow') return t === a && f !== a;
  if (direction === 'outflow') return f === a && t !== a;
  return f === a || t === a;
}

interface EtherscanListTx {
  blockHash: string;
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
}

interface EtherscanListToken extends EtherscanListTx {
  blockHash: string;
  transactionIndex?: string;
  contractAddress?: string;
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
