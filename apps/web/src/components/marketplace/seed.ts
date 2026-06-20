/**
 * Seed BYOK marketplace catalog + model registry + starter model matrix.
 *
 * Matches the catalog in v0.3 §2 + v0.9 §3 + §7. Numbers are plausible
 * but not authoritative \u2014 production reads these from a signed release.
 */

import type {
  AgentRole,
  AgentRoleId,
  LlmModel,
  LlmModelId,
  ModelAssignment,
  ModelMatrix,
  ProviderDefinition,
  ProviderId,
  ProviderInstall,
  ProviderInstallId,
} from '@chainsight/shared-types';

const P = (s: string) => s as ProviderId;
const I = (s: string) => s as ProviderInstallId;
const R = (s: string) => s as AgentRoleId;
const M = (s: string) => s as LlmModelId;

// =====================================================================
// Provider catalog (the shipped catalog from v0.3 §2)
// =====================================================================

export const PROVIDER_CATALOG: ProviderDefinition[] = [
  // --- Block explorers ---
  {
    id: P('etherscan'),
    name: 'Etherscan',
    vendor: 'Etherscan.io',
    category: 'block_explorer',
    capabilities: ['get_tx_by_hash', 'get_address_history', 'get_logs', 'verify_contract'],
    description: 'The reference Ethereum block explorer. Free tier covers most case work.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    pricing_hint: 'Free up to 5 req/s; from $99/mo for higher limits',
    auth_scheme: 'api_key',
    env_var_names: ['ETHERSCAN_API_KEY'],
    glyph: '\ud83d\udd0d',
    docs_url: 'https://etherscan.io/apis',
  },
  {
    id: P('blockchair'),
    name: 'Blockchair',
    vendor: 'Blockchair',
    category: 'block_explorer',
    capabilities: ['get_tx_by_hash', 'get_address_history', 'get_block_by_height'],
    description: 'Multi-chain explorer covering 17 blockchains including Bitcoin and Tron.',
    data_residency: ['CY'],
    pricing_model: 'usage_metered',
    pricing_hint: 'Free tier; Premium from $59/mo',
    auth_scheme: 'api_key',
    env_var_names: ['BLOCKCHAIR_API_KEY'],
    glyph: '\ud83d\udd17',
  },

  // --- Attribution ---
  {
    id: P('chainalysis'),
    name: 'Chainalysis Reactor',
    vendor: 'Chainalysis Inc.',
    category: 'attribution',
    capabilities: ['attribute_address', 'sanctions_screen', 'cluster_lookup', 'risk_score'],
    description:
      'Industry-standard attribution feed for law enforcement. Most agencies already license it.',
    data_residency: ['US', 'EU'],
    pricing_model: 'annual_contract',
    pricing_hint: 'Six-figure annual licenses; negotiated per agency',
    auth_scheme: 'api_key',
    env_var_names: ['CHAINALYSIS_API_KEY'],
    glyph: '\ud83c\udfdb\ufe0f',
    docs_url: 'https://docs.chainalysis.com/',
    is_us_gov_only: false,
  },
  {
    id: P('trm'),
    name: 'TRM Labs',
    vendor: 'TRM Labs Inc.',
    category: 'attribution',
    capabilities: ['attribute_address', 'sanctions_screen', 'cluster_lookup', 'risk_score'],
    description: 'Attribution + risk-scoring competitor to Chainalysis. Strong on cross-chain.',
    data_residency: ['US', 'SG'],
    pricing_model: 'annual_contract',
    auth_scheme: 'api_key',
    env_var_names: ['TRM_API_KEY'],
    glyph: '\ud83d\udcca',
  },
  {
    id: P('arkham'),
    name: 'Arkham Intelligence',
    vendor: 'Arkham',
    category: 'attribution',
    capabilities: ['attribute_address', 'cluster_lookup', 'entity_search'],
    description: 'Open-data + crowd-sourced attribution. Strong on DeFi & exchange labeling.',
    data_residency: ['US'],
    pricing_model: 'monthly_seat',
    pricing_hint: 'From $299/mo per seat',
    auth_scheme: 'api_key',
    env_var_names: ['ARKHAM_API_KEY'],
    glyph: '\ud83c\udfaf',
  },

  // --- RPC ---
  {
    id: P('alchemy'),
    name: 'Alchemy',
    vendor: 'Alchemy',
    category: 'rpc',
    capabilities: ['rpc_call', 'archive_query', 'trace_call'],
    description: 'Most widely-used hosted Ethereum/Polygon/Arbitrum RPC.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    pricing_hint: 'Free up to 300M compute units/mo',
    auth_scheme: 'api_key',
    env_var_names: ['ALCHEMY_API_KEY'],
    glyph: '\u2697\ufe0f',
  },
  {
    id: P('infura'),
    name: 'Infura',
    vendor: 'Consensys',
    category: 'rpc',
    capabilities: ['rpc_call', 'archive_query'],
    description: 'Reliable hosted RPC across major EVM chains + IPFS.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    auth_scheme: 'api_key',
    env_var_names: ['INFURA_PROJECT_ID', 'INFURA_PROJECT_SECRET'],
    glyph: '\ud83c\udf10',
  },

  // --- Historical price ---
  {
    id: P('coingecko'),
    name: 'CoinGecko Pro',
    vendor: 'CoinGecko',
    category: 'historical_price',
    capabilities: ['historical_price_at', 'market_cap_at'],
    description: 'Historical and current crypto market data with broad coverage.',
    data_residency: ['SG'],
    pricing_model: 'monthly_seat',
    pricing_hint: 'From $129/mo (Analyst tier)',
    auth_scheme: 'api_key',
    env_var_names: ['COINGECKO_API_KEY'],
    glyph: '\ud83d\udcc8',
  },

  // --- Sanctions ---
  {
    id: P('ofac'),
    name: 'OFAC SDN List (free)',
    vendor: 'US Treasury',
    category: 'sanctions_screening',
    capabilities: ['sanctions_screen', 'address_list_lookup'],
    description: 'Official US sanctions list. Always free; ChainSight mirrors it daily.',
    data_residency: ['US'],
    pricing_model: 'free',
    auth_scheme: 'none',
    env_var_names: [],
    glyph: '\ud83d\udeab',
    is_self_hostable: true,
    is_air_gap_capable: true,
  },

  // --- AI / LLM ---
  {
    id: P('anthropic'),
    name: 'Anthropic',
    vendor: 'Anthropic',
    category: 'llm',
    capabilities: ['llm_chat', 'llm_complete', 'llm_long_context'],
    description: 'Claude family models. ChainSight\u2019s default Orchestrator + Critic.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    pricing_hint: '$15/MTok in, $75/MTok out for Opus tier',
    auth_scheme: 'api_key',
    env_var_names: ['ANTHROPIC_API_KEY'],
    glyph: '\ud83e\udde0',
  },
  {
    id: P('openai'),
    name: 'OpenAI',
    vendor: 'OpenAI',
    category: 'llm',
    capabilities: ['llm_chat', 'llm_complete', 'llm_long_context'],
    description: 'GPT family models. Production-grade alternative to Anthropic.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    auth_scheme: 'api_key',
    env_var_names: ['OPENAI_API_KEY', 'OPENAI_ORG_ID'],
    glyph: '\ud83d\udfe2',
  },
  {
    id: P('deepseek'),
    name: 'DeepSeek API',
    vendor: 'DeepSeek',
    category: 'llm',
    capabilities: ['llm_chat', 'llm_long_context'],
    description: 'Tier-B efficient model. Cost-effective for Tracer + Attribution agents.',
    data_residency: ['CN', 'US-mirror'],
    pricing_model: 'usage_metered',
    pricing_hint: '$0.27/MTok in, $1.10/MTok out',
    auth_scheme: 'api_key',
    env_var_names: ['DEEPSEEK_API_KEY'],
    glyph: '\ud83d\udd17',
  },
  {
    id: P('runpod'),
    name: 'RunPod (self-hosted)',
    vendor: 'RunPod Inc.',
    category: 'llm',
    capabilities: ['llm_chat', 'llm_complete'],
    description:
      'Self-hosted GPU pods. Run Llama/Qwen/Phi on your own infrastructure for sovereignty.',
    data_residency: ['user-chosen'],
    pricing_model: 'self_hosted',
    pricing_hint: 'GPU-hour billed by RunPod; LLM is free at runtime',
    auth_scheme: 'api_key',
    env_var_names: ['RUNPOD_API_KEY', 'RUNPOD_ENDPOINT_ID'],
    glyph: '\u26a1',
    is_self_hostable: true,
  },
  {
    id: P('local'),
    name: 'On-prem (vLLM / Ollama)',
    vendor: 'Self-hosted',
    category: 'llm',
    capabilities: ['llm_chat', 'llm_complete'],
    description: 'Point ChainSight at your own vLLM or Ollama server. Air-gap capable.',
    data_residency: ['on-prem'],
    pricing_model: 'self_hosted',
    auth_scheme: 'none',
    env_var_names: ['LOCAL_LLM_BASE_URL', 'LOCAL_LLM_MODEL_NAME'],
    glyph: '\ud83d\udcbb',
    is_self_hostable: true,
    is_air_gap_capable: true,
  },

  // --- Embedding ---
  {
    id: P('voyage'),
    name: 'Voyage AI',
    vendor: 'Voyage',
    category: 'embedding',
    capabilities: ['embed_text', 'embed_code'],
    description: 'High-quality embeddings for vector memory.',
    data_residency: ['US'],
    pricing_model: 'usage_metered',
    auth_scheme: 'api_key',
    env_var_names: ['VOYAGE_API_KEY'],
    glyph: '\ud83e\udded',
  },
];

// =====================================================================
// LLM model registry (per v0.9 §3.2 + §7)
// =====================================================================

export const MODEL_REGISTRY: LlmModel[] = [
  // Tier C \u2014 frontier
  {
    id: M('claude-opus-4-6'),
    display_name: 'Claude Opus 4.6',
    vendor: 'Anthropic',
    tier: 'C_frontier',
    context_window_tokens: 200_000,
    input_cost_per_mtok: 15,
    output_cost_per_mtok: 75,
    is_self_hosted: false,
    belief_tier_floor: 'T2',
  },
  {
    id: M('claude-opus-4-8'),
    display_name: 'Claude Opus 4.8',
    vendor: 'Anthropic',
    tier: 'C_frontier',
    context_window_tokens: 200_000,
    input_cost_per_mtok: 18,
    output_cost_per_mtok: 90,
    is_self_hosted: false,
    belief_tier_floor: 'T2',
  },
  {
    id: M('gpt-5-5'),
    display_name: 'GPT-5.5',
    vendor: 'OpenAI',
    tier: 'C_frontier',
    context_window_tokens: 256_000,
    input_cost_per_mtok: 12,
    output_cost_per_mtok: 60,
    is_self_hosted: false,
    belief_tier_floor: 'T2',
  },

  // Tier B \u2014 efficient
  {
    id: M('deepseek-v4-pro'),
    display_name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    tier: 'B_efficient',
    context_window_tokens: 128_000,
    input_cost_per_mtok: 0.27,
    output_cost_per_mtok: 1.1,
    is_self_hosted: false,
    belief_tier_floor: 'T3',
  },
  {
    id: M('claude-sonnet-4-6'),
    display_name: 'Claude Sonnet 4.6',
    vendor: 'Anthropic',
    tier: 'B_efficient',
    context_window_tokens: 200_000,
    input_cost_per_mtok: 3,
    output_cost_per_mtok: 15,
    is_self_hosted: false,
    belief_tier_floor: 'T2',
  },

  // Tier A \u2014 local / fine-tuned
  {
    id: M('llama-4-70b-local'),
    display_name: 'Llama 4 70B (local)',
    vendor: 'Meta',
    tier: 'A_local',
    context_window_tokens: 128_000,
    input_cost_per_mtok: 0,
    output_cost_per_mtok: 0,
    is_self_hosted: true,
    belief_tier_floor: 'T3',
  },
  {
    id: M('qwen-3-5-8b'),
    display_name: 'Qwen 3.5 8B',
    vendor: 'Alibaba',
    tier: 'A_local',
    context_window_tokens: 32_000,
    input_cost_per_mtok: 0,
    output_cost_per_mtok: 0,
    is_self_hosted: true,
    belief_tier_floor: 'T3',
  },
  {
    id: M('phi-4-ft-docs'),
    display_name: 'Phi-4 FT (docs)',
    vendor: 'Microsoft / ChainSight',
    tier: 'A_local',
    context_window_tokens: 16_000,
    input_cost_per_mtok: 0,
    output_cost_per_mtok: 0,
    is_self_hosted: true,
    belief_tier_floor: 'T3',
  },
  {
    id: M('phi-4-ft-swap'),
    display_name: 'Phi-4 FT (swap)',
    vendor: 'Microsoft / ChainSight',
    tier: 'A_local',
    context_window_tokens: 16_000,
    input_cost_per_mtok: 0,
    output_cost_per_mtok: 0,
    is_self_hosted: true,
    belief_tier_floor: 'T3',
  },
];

// =====================================================================
// Agent roles (matches v0.9 §3.3 matrix)
// =====================================================================

export const AGENT_ROLES: AgentRole[] = [
  {
    id: R('orchestrator'),
    display_name: 'Orchestrator',
    description: 'Top-level planner. Decomposes investigator intent into agent calls.',
    default_model_id: M('claude-opus-4-6'),
  },
  {
    id: R('critic'),
    display_name: 'Critic Agent',
    description: 'Adversarial reviewer. Surfaces challenges before claims reach the investigator.',
    default_model_id: M('claude-opus-4-6'),
  },
  {
    id: R('narrative'),
    display_name: 'Narrative Agent',
    description: 'Writes plain-language summaries gated by the Verifier.',
    default_model_id: M('claude-opus-4-6'),
  },
  {
    id: R('tracer'),
    display_name: 'Tracer Agent',
    description: 'Walks the graph forward/backward under the active methodology.',
    default_model_id: M('deepseek-v4-pro'),
  },
  {
    id: R('attribution'),
    display_name: 'Attribution Agent',
    description: 'Reconciles multi-provider attribution; flags disagreements.',
    default_model_id: M('deepseek-v4-pro'),
  },
  {
    id: R('bridge'),
    display_name: 'Bridge Agent',
    description: 'Cross-chain transfer correlation.',
    default_model_id: M('qwen-3-5-8b'),
  },
  {
    id: R('swap'),
    display_name: 'Swap Agent',
    description: 'DEX call decoding + slippage analysis.',
    default_model_id: M('phi-4-ft-swap'),
  },
  {
    id: R('inspector'),
    display_name: 'Inspector summary',
    description: 'Composes the Transaction Inspector\u2019s 8-section output.',
    default_model_id: M('deepseek-v4-pro'),
  },
  {
    id: R('verifier'),
    display_name: 'Verifier',
    description: 'Citation-gates the Narrative Agent\u2019s output (every claim \u2192 BeliefAtom).',
    default_model_id: M('qwen-3-5-8b'),
  },
  {
    id: R('extraction'),
    display_name: 'Extraction Agent',
    description: 'Pulls structured fields out of subpoena returns + ledger PDFs.',
    default_model_id: M('phi-4-ft-docs'),
  },
];

// =====================================================================
// Installed providers + model assignments (the demo's starting state)
// =====================================================================

export const SEED_INSTALLS: ProviderInstall[] = [
  {
    id: I('inst-etherscan'),
    provider_id: P('etherscan'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:02:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 28473,
    cost_this_month_fiat: '$0',
  },
  {
    id: I('inst-chainalysis'),
    provider_id: P('chainalysis'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:08:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 4217,
    cost_this_month_fiat: 'on annual contract',
  },
  {
    id: I('inst-trm'),
    provider_id: P('trm'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:09:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 1830,
    cost_this_month_fiat: 'on annual contract',
  },
  {
    id: I('inst-arkham'),
    provider_id: P('arkham'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-11T09:30:00Z',
    key_scope: 'agency',
    health: 'yellow',
    health_reason: 'Rate-limited (HTTP 429) in 2.1% of calls. Consider upgrading plan.',
    calls_this_month: 2105,
    cost_this_month_fiat: '$299',
  },
  {
    id: I('inst-alchemy'),
    provider_id: P('alchemy'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:15:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 152037,
    cost_this_month_fiat: '$0',
  },
  {
    id: I('inst-coingecko'),
    provider_id: P('coingecko'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:20:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 8420,
    cost_this_month_fiat: '$129',
  },
  {
    id: I('inst-ofac'),
    provider_id: P('ofac'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-10T14:00:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 0,
    cost_this_month_fiat: '$0',
  },
  {
    id: I('inst-anthropic'),
    provider_id: P('anthropic'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-12T16:00:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 11240,
    cost_this_month_fiat: '$1,847',
  },
  {
    id: I('inst-deepseek'),
    provider_id: P('deepseek'),
    installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
    installed_at: '2026-06-12T16:05:00Z',
    key_scope: 'agency',
    health: 'green',
    calls_this_month: 47221,
    cost_this_month_fiat: '$125',
  },
];

export const SEED_ASSIGNMENTS: ModelAssignment[] = AGENT_ROLES.map((r) => ({
  role_id: r.id,
  override_model_id: null, // start with all defaults
}));

export const SEED_MATRIX: ModelMatrix = {
  assignments: SEED_ASSIGNMENTS,
  estimated_monthly_cost_fiat: '$1,972',
  baseline_all_frontier_fiat: '$14,200',
};
