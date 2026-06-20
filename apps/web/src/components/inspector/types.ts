/**
 * Re-export inspector types from shared-types for ergonomic imports.
 * Component files import from here so a future move of types is one diff.
 */
export type {
  TransactionAnalysis,
  TransactionAnalysisId,
  TransactionNodeRef,
  AnalysisStatus,
  SectionStatus,
  SectionMeta,
  InspectorHeader,
  PlainLanguageSummary,
  KeyValueRow,
  DecodedAction,
  DecodedSwap,
  DecodedBridge,
  DecodedTransfer,
  DecodedContractCall,
  DecodedUtxoSpend,
  DecodedNftOp,
  DecodedMintBurn,
  DecodedApprove,
  DecodedOther,
  TokenAmount,
  CounterpartyEntry,
  RiskLevel,
  AttributionSource,
  CaseContextEntry,
  ObfuscationFinding,
  CriticNote,
  ActionSuggestion,
  ActionKind,
  AddressRef,
} from '@chainsight/shared-types';
export { createPendingAnalysis } from '@chainsight/shared-types';
