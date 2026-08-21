/**
 * Connector unit tests with mocked fetch — no live HTTP.
 */

import { describe, it, expect } from 'vitest';
import { EtherscanConnector } from '../src/connectors/etherscan';
import { BlockchairConnector } from '../src/connectors/blockchair';
import { OpenSanctionsConnector } from '../src/connectors/opensanctions';
import { AnthropicConnector } from '../src/connectors/anthropic';
import type { ResolvedCredential } from '../src/types';

const noCtl = { deadline_ms: 5000 } as const;

function makeFetch(responses: Array<{ ok: boolean; status?: number; json: unknown; text?: string }>): typeof fetch {
  let i = 0;
  return (async () => {
    const r = responses[i++];
    if (!r) throw new Error('fetch called more times than expected');
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.json,
      text: async () => r.text ?? JSON.stringify(r.json),
    } as Response;
  }) as unknown as typeof fetch;
}

describe('EtherscanConnector', () => {
  it('fetches tx + receipt + block and returns normalized payload', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', from: '0xfrom', to: '0xto', gas: '0x5208', gasPrice: '0x4a817c800',
        hash: '0xabc', input: '0xa9059cbb000000000000000000000000abc', value: '0x16345785d8a0000',
      } } },
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', contractAddress: null,
        gasUsed: '0x5208', status: '0x1', transactionHash: '0xabc',
      } } },
      { ok: true, json: { result: { timestamp: '0x65000000', hash: '0xbh' } } },
    ]);
    const conn = new EtherscanConnector({ fetch_impl: fetchImpl });
    const credential: ResolvedCredential = { credential_ref: 'ES', secret: 'KEY' };
    const res = await conn.call('get_tx_by_hash', { chain: 'evm:1', tx_hash: '0xabc' }, credential, noCtl);
    const data = res.data as { chain: string; tx_hash: string; block_height: number; status: string; selector: string | null; fee_native_minor: string };
    expect(data.chain).toBe('evm:1');
    expect(data.tx_hash).toBe('0xabc');
    expect(data.block_height).toBe(10);
    expect(data.status).toBe('success');
    expect(data.selector).toBe('0xa9059cbb');
    // gas 0x5208 (21000) × gasPrice 0x4a817c800 (20 gwei) = 420000000000000
    expect(data.fee_native_minor).toBe('420000000000000');
  });

  it('rejects unsupported chains', async () => {
    const conn = new EtherscanConnector({ fetch_impl: makeFetch([]) });
    await expect(
      conn.call('get_tx_by_hash', { chain: 'bitcoin:mainnet', tx_hash: '0xabc' }, null, noCtl),
    ).rejects.toThrow(/does not support chain 'bitcoin:mainnet'/);
  });

  it('resolves multi-chain via evm:<chainid> notation', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', from: '0xfrom', to: '0xto', gas: '0x5208', gasPrice: '0x4a817c800',
        hash: '0xabc', input: '0x', value: '0x0',
      } } },
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', contractAddress: null,
        gasUsed: '0x5208', status: '0x1', transactionHash: '0xabc',
      } } },
      { ok: true, json: { result: { timestamp: '0x65000000', hash: '0xbh' } } },
    ]);
    const conn = new EtherscanConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('get_tx_by_hash', { chain: 'evm:56', tx_hash: '0xabc' }, null, noCtl);
    const data = res.data as { chain: string };
    expect(data.chain).toBe('evm:56');
  });

  it('resolves short-name aliases (e.g. polygon)', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', from: '0xfrom', to: '0xto', gas: '0x5208', gasPrice: '0x4a817c800',
        hash: '0xabc', input: '0x', value: '0x0',
      } } },
      { ok: true, json: { result: {
        blockHash: '0xbh', blockNumber: '0xa', contractAddress: null,
        gasUsed: '0x5208', status: '0x1', transactionHash: '0xabc',
      } } },
      { ok: true, json: { result: { timestamp: '0x65000000', hash: '0xbh' } } },
    ]);
    const conn = new EtherscanConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('get_tx_by_hash', { chain: 'polygon', tx_hash: '0xabc' }, null, noCtl);
    const data = res.data as { chain: string };
    expect(data.chain).toBe('evm:137');
  });

  it('fetches native balance for a supported chain', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { status: '1', result: '1000000000000000000' } },
    ]);
    const conn = new EtherscanConnector({ fetch_impl: fetchImpl });
    const credential: ResolvedCredential = { credential_ref: 'ES', secret: 'KEY' };
    const res = await conn.call('get_address_balance', { chain: 'evm:137', address: '0x1111111111111111111111111111111111111111' }, credential, noCtl);
    const data = res.data as { chain: string; address: string; balance_native_minor: string };
    expect(data.chain).toBe('evm:137');
    expect(data.balance_native_minor).toBe('1000000000000000000');
  });

  it('rejects balance for unsupported chains', async () => {
    const conn = new EtherscanConnector({ fetch_impl: makeFetch([]) });
    await expect(
      conn.call('get_address_balance', { chain: 'solana', address: '0x1111111111111111111111111111111111111111' }, null, noCtl),
    ).rejects.toThrow(/does not support chain 'solana'/);
  });
});

describe('BlockchairConnector', () => {
  it('fetches Bitcoin balance in satoshis', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { data: { bc1qtest: { address: { balance: 123456789, received: 987654321, spent: 864197532, transaction_count: 42 } } } } },
    ]);
    const conn = new BlockchairConnector({ fetch_impl: fetchImpl });
    const credential: ResolvedCredential = { credential_ref: 'BC', secret: 'KEY' };
    const res = await conn.call('get_address_balance', { chain: 'btc', address: 'bc1qtest' }, credential, noCtl);
    const data = res.data as { chain: string; balance_native_minor: string; received_native_minor: string; spent_native_minor: string; tx_count: number };
    expect(data.chain).toBe('btc');
    expect(data.balance_native_minor).toBe('123456789');
    expect(data.received_native_minor).toBe('987654321');
    expect(data.spent_native_minor).toBe('864197532');
    expect(data.tx_count).toBe(42);
  });

  it('fetches UTXO transaction inputs and outputs', async () => {
    const fetchImpl = makeFetch([
      { ok: true, json: { data: { tx1: {
        transaction: { hash: 'tx1', block_id: 700000, time: '2023-01-01T00:00:00Z', fee: 1000 },
        inputs: [
          { recipient: 'bc1qin1', value: 500000, index: 0, transaction_hash: 'prev1' },
          { recipient: 'bc1qin2', value: 300000, index: 1, transaction_hash: 'prev2' },
        ],
        outputs: [
          { recipient: 'bc1qout1', value: 499000, index: 0, is_spent: true },
          { recipient: 'bc1qout2', value: 300000, index: 1, is_spent: false },
        ],
      } } } },
    ]);
    const conn = new BlockchairConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('get_tx_by_hash', { chain: 'btc', tx_hash: 'tx1' }, null, noCtl);
    const data = res.data as { tx_hash: string; inputs: Array<{ address: string; value_native_minor: string }>; outputs: Array<{ spent: boolean }>; fee_native_minor: string };
    expect(data.tx_hash).toBe('tx1');
    expect(data.inputs).toHaveLength(2);
    expect(data.inputs[0].address).toBe('bc1qin1');
    expect(data.inputs[0].value_native_minor).toBe('500000');
    expect(data.outputs).toHaveLength(2);
    expect(data.outputs[0].spent).toBe(true);
    expect(data.fee_native_minor).toBe('1000');
  });

  it('rejects unsupported chains', async () => {
    const conn = new BlockchairConnector({ fetch_impl: makeFetch([]) });
    await expect(
      conn.call('get_address_balance', { chain: 'sol', address: 'abc' }, null, noCtl),
    ).rejects.toThrow(/does not support chain 'sol'/);
  });
});

describe('OpenSanctionsConnector', () => {
  it('returns match=false when address is not listed', async () => {
    const fetchImpl = makeFetch([{ ok: true, json: { responses: { q: { results: [] } } } }]);
    const conn = new OpenSanctionsConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('get_address_attribution', {
      address_ref: 'evm:1_addr:0x1111111111111111111111111111111111111111',
    }, null, noCtl);
    const data = res.data as { match: boolean; label: string | null; category: string | null };
    expect(data.match).toBe(false);
    expect(data.label).toBeNull();
  });

  it('returns sanctions category when dataset is OFAC SDN', async () => {
    const fetchImpl = makeFetch([{
      ok: true,
      json: { responses: { q: { results: [{ id: 'ofac-1', caption: 'Some Bad Actor', score: 0.92, datasets: ['us_ofac_sdn'] }] } } },
    }]);
    const conn = new OpenSanctionsConnector({ fetch_impl: fetchImpl });
    const res = await conn.call('get_address_attribution', {
      address_ref: 'evm:1_addr:0x2222222222222222222222222222222222222222',
    }, null, noCtl);
    const data = res.data as { match: boolean; category: string; label: string };
    expect(data.match).toBe(true);
    expect(data.category).toBe('sanctions');
    expect(data.label).toContain('Bad Actor');
  });
});

describe('AnthropicConnector', () => {
  it('joins text content parts and returns model_id + token_count', async () => {
    const fetchImpl = makeFetch([{
      ok: true,
      json: {
        id: 'msg_123', model: 'claude-3-5-haiku-20241022',
        content: [{ type: 'text', text: 'Hello, ' }, { type: 'text', text: 'world.' }],
        usage: { input_tokens: 10, output_tokens: 4 },
      },
    }]);
    const conn = new AnthropicConnector({ fetch_impl: fetchImpl });
    const credential: ResolvedCredential = { credential_ref: 'ANT', secret: 'sk-ant-xxx' };
    const res = await conn.call('llm_narrative', { prompt: 'Say hi' }, credential, noCtl);
    const data = res.data as { text: string; model_id: string; token_count: { input: number; output: number } };
    expect(data.text).toBe('Hello, world.');
    expect(data.model_id).toBe('claude-3-5-haiku-20241022');
    expect(data.token_count).toEqual({ input: 10, output: 4 });
    expect(res.metadata.tokens_used).toBe(14);
  });

  it('throws when no credential is provided (BYOK)', async () => {
    const conn = new AnthropicConnector({ fetch_impl: makeFetch([]) });
    await expect(
      conn.call('llm_narrative', { prompt: 'x' }, null, noCtl),
    ).rejects.toThrow(/requires a credential/);
  });
});
