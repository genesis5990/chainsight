/**
 * @chainsight/reproducibility
 *
 * Pillar 2. Every report ships with a frozen snapshot — chain data, rule
 * versions, attribution snapshots, tool log, model card, SBS history, and a
 * replay.sh that reconstructs identical output. Opposing counsel re-runs it
 * on their hardware; same inputs produce same outputs forever.
 *
 * Phase 0 Week 1 skeleton. Real pack builder lands Week 6.
 */

export interface ReproducibilityPackManifest {
  case_id: string;
  built_at: string;
  content_hash: string;
  contents: {
    chain_data_snapshot: string;
    rule_version_manifest: string;
    attribution_snapshot: string;
    tool_log: string;
    model_card: string;
    sbs_history: string;
    replay_script: string;
  };
}

export const phase0Placeholder = true;
