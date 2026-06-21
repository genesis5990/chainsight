/**
 * RouterChainProvider + RouterLlmClient integration tests using
 * in-memory CapabilityRouter pieces (no live HTTP).
 */

import { describe, it, expect } from 'vitest';
import {
  CapabilityRouter,
  InMemoryCredentialStore,
  InMemoryInstallRegistry,
  type Capability,
  type ConnectorCallOptions,
  type ConnectorResponse,
  type ProviderConnector,
  type ResolvedCredential,
} from '@chainsight/capability-router';
import type { AgencyContext, TxRef } from '@chainsight/shared-types';
import { RouterChainProvider, adaptEtherscan } from '../src/router_chain_provider';
import { RouterLlmClient } from '../src/router_llm_client';
import { FixtureChainProvider } from '../src/chain_provider_stub';
import { StubLlmClient } from '../src/llm_stub';

class FakeConnector implements ProviderConnector {
  calls = 0;
  constructor(
    readonly provider_id: string,
    readonly capabilities: readonly Capability[],
    private readonly payload: unknown,
  ) {}
  async call<TPayload>(
    _cap: Capability, _args: Record<string, unknown>,
    _cred: ResolvedCredential | null, _opts: ConnectorCallOptions,
  ): Promise<ConnectorResponse<TPayload>> {
    this.calls += 1;
    return { data: this.payload as TPayload, metadata: {} };
  }
}

function ctx(): AgencyContext {
  return {
    user_id: 'u-1', agency_id: 'agency-A', active_case_id: 'case-1',
    roles: ['investigator'], supervisory_scope_id: null, available_capabilities: [],
  };
}

describe('RouterChainProvider', () => {
  it('adapts Etherscan payload into ChainTxFixture', () => {
    const fixture = adaptEtherscan({
      chain: 'evm:1',
      tx_hash: '0xabc', block_hash: '0xbh', block_height: 10,
      block_time_utc: '2026-04-09T14:31:00Z',
      from: '0xFROM', to: '0xTO',
      value_native_minor: '1000', gas_used: '21000', gas_price_minor: '20000000000',
      fee_native_minor: '420000000000000', status: 'success',
      input_data: '0xa9059cbb...', selector: '0xa9059cbb',
      contract_address: '0xToken', raw_provider_id: 'etherscan',
    });
    expect(fixture.chain).toBe('evm:1');
    expect(fixture.parties.find((p) => p.role === 'from')?.address_ref).toContain('0xfrom');
    expect(fixture.selector).toBe('0xa9059cbb');
  });

  it('fetches via Router and returns ChainTxFixture', async () => {
    const conn = new FakeConnector('etherscan', ['get_tx_by_hash'], {
      chain: 'evm:1',
      tx_hash: '0xabc', block_hash: '0xbh', block_height: 10,
      block_time_utc: '2026-04-09T14:31:00Z',
      from: '0xFROM', to: '0xTO',
      value_native_minor: '47200000000000000000', gas_used: '21000', gas_price_minor: '24500000000',
      fee_native_minor: '514500000000000', status: 'success',
      input_data: '0x', selector: null, contract_address: null, raw_provider_id: 'etherscan',
    });
    const router = new CapabilityRouter({
      connectors: [conn],
      installs: new InMemoryInstallRegistry().addDefault({
        provider_id: 'etherscan', enabled_capabilities: ['get_tx_by_hash'], priority: 1,
        credential_ref: null, enabled: true, budget_usd_per_month: null,
      }),
      credentials: new InMemoryCredentialStore(),
      caches: {},
    });
    const provider = new RouterChainProvider({ router, ctx: ctx() });
    const fixture = await provider.fetchTx('evm:1_tx:0xabc' as TxRef);
    expect(fixture).not.toBeNull();
    expect(fixture?.value_native_minor).toBe('47200000000000000000');
    expect(conn.calls).toBe(1);
  });

  it('falls back to fixture when no install is configured', async () => {
    const router = new CapabilityRouter({
      connectors: [],
      installs: new InMemoryInstallRegistry(),
      credentials: new InMemoryCredentialStore(),
      caches: {},
    });
    const fallback = new FixtureChainProvider();
    const provider = new RouterChainProvider({ router, ctx: ctx(), fallback });
    // op_lemon fixture key (lowercased by FixtureChainProvider)
    const fixture = await provider.fetchTx('eth_tx:0xa7b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9' as TxRef);
    expect(fixture).not.toBeNull();
    expect(fixture?.chain).toBe('eth');
  });
});

describe('RouterLlmClient', () => {
  it('streams via Router and returns final text + model id', async () => {
    const conn = new FakeConnector('anthropic', ['llm_narrative'], {
      text: 'The wallet ⟦atom:abc⟧ sent 47.2 ETH.',
      model_id: 'claude-3-5-haiku-20241022',
      token_count: { input: 50, output: 12 },
      raw_provider_id: 'anthropic',
    });
    const router = new CapabilityRouter({
      connectors: [conn],
      installs: new InMemoryInstallRegistry().addDefault({
        provider_id: 'anthropic', enabled_capabilities: ['llm_narrative'], priority: 1,
        credential_ref: 'ANT_KEY', enabled: true, budget_usd_per_month: null,
      }),
      credentials: (() => { const s = new InMemoryCredentialStore(); s.set('ANT_KEY', 'sk-ant'); return s; })(),
      caches: {},
    });
    const llm = new RouterLlmClient({ router, ctx: ctx() });
    const stream = llm.generate({
      parties: { parties: [] },
      decoded: { action_kind: 'transfer', confidence: 1, decoded: {} },
      value: { value_native_minor: '0', fiat_currency: 'USD', fee_native_minor: '0', math_recipe_hashes: { value: 'h1', fee: 'h2' } },
      attribution: { attributions: [] },
      available_atoms: [],
    });
    const tokens: string[] = [];
    for await (const t of stream.tokens()) tokens.push(t);
    expect(tokens.join('')).toContain('47.2 ETH');
    const final = await stream.finalize();
    expect(final.model_id).toBe('claude-3-5-haiku-20241022');
    expect(final.token_count).toBe(62);
  });

  it('falls back to stub when no install configured', async () => {
    const router = new CapabilityRouter({
      connectors: [], installs: new InMemoryInstallRegistry(),
      credentials: new InMemoryCredentialStore(), caches: {},
    });
    const llm = new RouterLlmClient({ router, ctx: ctx(), fallback: new StubLlmClient() });
    const stream = llm.generate({
      parties: { parties: [] },
      decoded: { action_kind: 'transfer', confidence: 1, decoded: {} },
      value: { value_native_minor: '0', fiat_currency: 'USD', fee_native_minor: '0', math_recipe_hashes: { value: 'h1', fee: 'h2' } },
      attribution: { attributions: [] },
      available_atoms: [],
    });
    const final = await stream.finalize();
    expect(final.text.length).toBeGreaterThan(0);
  });
});
