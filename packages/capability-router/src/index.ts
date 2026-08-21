/**
 * @chainsight/capability-router v0.2.0 (Phase-1 Week-4).
 *
 * Pillar 3 — every external data source is a capability, not a vendor.
 * Calling code never says `etherscan.getTx()` — it says
 * `router.resolve('get_tx_by_hash', args, ctx)`. Provider selection,
 * fallback, budget enforcement, retries, circuit breaking, and caching
 * all happen here.
 */

export {
  CapabilityRouter,
  NoopAudit,
  type CapabilityRouterOptions,
  type ResolutionAudit,
} from './router';

export type {
  AgencyContext,
  AgencyProviderInstall,
  BudgetContext,
  Capability,
  CapabilityResult,
  CapabilityResultSource,
  CacheScope,
  CacheTtlTier,
  ConnectorCallOptions,
  ConnectorMetadata,
  ConnectorResponse,
  ProviderConnector,
  ResolveOptions,
  ResolvedCredential,
} from './types';
export {
  AllProvidersFailedError,
  BudgetExhaustedError,
  CapabilityUnavailableError,
  CircuitBreakerOpenError,
} from './types';

export {
  ProviderCircuitBreaker,
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  RESET_TIMEOUT_MS,
  type BreakerSnapshot,
  type BreakerState,
  type CircuitBreakerOptions,
} from './circuit_breaker';

export {
  EnvCredentialStore,
  InMemoryCredentialStore,
  VaultCredentialStore,
  FallbackCredentialStore,
  type CredentialStore,
  type VaultStoreClient,
} from './credential_store';

export {
  Aes256GcmEnvelopeCipher,
  PassThroughEnvelopeCipher,
  envelopeCipherFromEnv,
  generateMasterKey,
  type EnvelopeCipher,
} from './envelope_cipher';

export {
  InMemoryInstallRegistry,
  type InstallRegistry,
} from './install_registry';

export {
  SupabaseInstallRegistry,
  SupabaseResolutionAudit,
  type SupabaseRouterClient,
} from './supabase_registry';

export {
  RedisL1Cache,
  SupabaseL2Cache,
  computeArgsHash,
  computeCacheKey,
  deriveScope,
  deriveTtlTier,
  ttlSeconds,
  type CacheBackend,
  type CacheEntry,
  type SupabaseCacheClient,
} from './cache';

export {
  EtherscanConnector,
  type EtherscanConnectorOptions,
  type EtherscanTxResponse,
  type EtherscanBalanceResponse,
  type EtherscanNeighborsResponse,
  type EtherscanAttributionResponse,
} from './connectors/etherscan';

export {
  BlockchairConnector,
  type BlockchairConnectorOptions,
  type BlockchairBalanceResponse,
  type BlockchairTxResponse,
  type BlockchairUtxoInput,
  type BlockchairUtxoOutput,
} from './connectors/blockchair';

export {
  OpenSanctionsConnector,
  type OpenSanctionsConnectorOptions,
  type OpenSanctionsResponse,
} from './connectors/opensanctions';

export {
  AnthropicConnector,
  type AnthropicConnectorOptions,
  type AnthropicNarrativeRequest,
  type AnthropicNarrativeResponse,
  type AnthropicStreamChunk,
} from './connectors/anthropic';

// Legacy placeholder (kept so older imports don't break during the transition)
export const phase0Placeholder = true;
