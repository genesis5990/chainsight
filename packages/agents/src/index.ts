/**
 * @chainsight/agents
 *
 * Agent definitions for the heterogeneous AI stack (Tier A/B/C).
 *
 * Defaults from v0.9 AI strategy:
 *   - Orchestrator + Critic + Narrative: Claude Opus 4.6 (BYOK)
 *   - Tier B workers: DeepSeek V4 Pro / Claude Sonnet 4.6 (BYOK)
 *   - Tier A specialists: fine-tuned Phi-4 / Qwen 3.5 8B (Phase 2 self-hosted)
 *
 * Phase 0 Week 1 skeleton. First agent (Inspector summary) lands Week 5.
 */

export type ModelTier = 'A' | 'B' | 'C';

export interface AgentSpec {
  name: string;
  tier: ModelTier;
  defaultModel: string;
}

// Catalog of agents from v0.9 AI strategy §1.3. Fills in as each is built.
export const AGENT_CATALOG: ReadonlyArray<AgentSpec> = [
  { name: 'Orchestrator', tier: 'C', defaultModel: 'claude-opus-4-6' },
  { name: 'Critic', tier: 'C', defaultModel: 'claude-opus-4-6' },
  { name: 'Narrative', tier: 'C', defaultModel: 'claude-opus-4-6' },
  { name: 'Tracer', tier: 'B', defaultModel: 'deepseek-v4-pro' },
  { name: 'Attribution', tier: 'B', defaultModel: 'deepseek-v4-pro' },
  { name: 'Inspector summary', tier: 'B', defaultModel: 'claude-sonnet-4-6' },
  { name: 'Verifier', tier: 'A', defaultModel: 'qwen3-5-8b' },
  { name: 'Bridge', tier: 'A', defaultModel: 'phi-4-ft-bridge' },
  { name: 'Swap', tier: 'A', defaultModel: 'phi-4-ft-swap' },
  { name: 'Extraction', tier: 'A', defaultModel: 'phi-4-ft-docs' },
];
