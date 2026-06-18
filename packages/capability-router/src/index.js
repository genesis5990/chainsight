/**
 * @chainsight/capability-router
 *
 * Pillar 3. Every external data source is a capability, not a vendor name.
 * Calling code never says `etherscan.getTx()` — it says
 * `router.resolve("get_tx_by_hash", args)`. Provider selection, fallback,
 * budget enforcement, and cache integration all happen here.
 *
 * Phase 0 Week 1 skeleton. Real implementation lands Week 3 with the first
 * Etherscan provider wired in.
 */
// Phase 0 Week 1: placeholder.
export const phase0Placeholder = true;
