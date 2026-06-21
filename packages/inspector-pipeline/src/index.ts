/**
 * @chainsight/inspector-pipeline v0.1.0 (Phase-1 Week-3 implementation of v1.1 §5).
 *
 * The 8-section Inspector pipeline. Imported by both the API (for synchronous
 * test runs / replays) and the worker (for the BullMQ job consumer).
 */

export { InspectorRunner } from './runner';
export type { InspectorRunnerOptions } from './runner';

export { verifyCitations, splitSentences } from './citation_verifier';
export type { AtomIndexEntry, VerifyInputs } from './citation_verifier';

export { StubLlmClient } from './llm_stub';
export type { LlmNarrativeClient, LlmNarrativeStream, LlmNarrativeInputs } from './llm_stub';

export { FixtureChainProvider, ACME_VICTIM_BTC_REF, RANSOM_CREW_ETH_REF } from './chain_provider_stub';
export type { ChainProvider, ChainTxFixture, ChainTxParty } from './chain_provider_stub';

export { makeBullMQConsumer, INSPECTOR_QUEUE_NAME } from './bullmq_consumer';
export type { BullMQConsumerOptions } from './bullmq_consumer';

export {
  SupabaseInspectorRunPersister,
  computeCacheKey,
} from './run_persister';
export type { InspectorRunPersister, SupabaseLike } from './run_persister';

export { RouterChainProvider, adaptEtherscan } from './router_chain_provider';
export type { RouterChainProviderOptions } from './router_chain_provider';

export { RouterLlmClient } from './router_llm_client';
export type { RouterLlmClientOptions } from './router_llm_client';

export { SupabaseInspectorRunLookup } from './run_lookup';
export type { InspectorRunLookup } from './run_lookup';
