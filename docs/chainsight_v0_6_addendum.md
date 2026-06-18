# ChainSight v0.6 — Caching, UTXO Clustering, Personal Attribution

> Four new features. The caching layer is the most architecturally consequential — it determines whether the BYOK marketplace is economically viable at scale. The UTXO co-input clustering is the most technically interesting. The personal attribution system is the one that turns the platform from a tool investigators _use_ into a tool that _learns_ them.

This addendum extends every prior version. It does not replace anything; it adds cross-cutting systems that every other feature now depends on.

---

## Feature 9 — The Cache Layer (cost-controlled provider calls)

### 9.1 The cost reality

The BYOK marketplace from v0.3 lets agencies bring their own API keys. That removes our cost exposure but it shifts it directly onto the agency. A 100-address wallet analysis with 5-hop tracing across three chains can easily fire **tens of thousands** of provider API calls. At Chainalysis or TRM enterprise rates, an uncached investigation can burn through hundreds of dollars in attribution calls alone, before anyone has even read the results.

If we don't cache aggressively, the platform makes BYOK a financial trap rather than a feature. **Caching is therefore a first-class architectural concern**, not an optimization.

### 9.2 The caching tiers

Different data has different "freshness needs." We tier accordingly:

| Tier             | Examples                                                                          | Default TTL | Refresh policy                                                 |
| ---------------- | --------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| **Immutable**    | Confirmed transaction data, block contents, historical state at a finalized block | Forever     | Never refreshed unless block reorg invalidates                 |
| **Slow-drift**   | Address attribution labels, entity clusters, contract metadata, sanctions lists   | 7 days      | Background refresh on weekly cadence; manual refresh available |
| **Medium-drift** | Token metadata, market caps, contract verification status                         | 24 hours    | Daily background; manual refresh available                     |
| **Fast-drift**   | Spot prices, address balances, mempool state                                      | 5 minutes   | On-demand only; manual refresh always available                |
| **Live**         | Streaming subscriptions (Allium Kafka, Blocknative mempool, etc.)                 | N/A         | Always live; no caching                                        |

These TTLs are defaults the agency admin can override per provider, per capability, per case. A high-priority active case might force shorter TTLs; a long-running historical investigation might extend them.

### 9.3 The first-touch rule (your spec, locked)

**Live tracing of previously unsearched information always hits the API first.** Whenever the investigator initiates an action that touches an address, transaction, or entity that the platform has _no cached data on_, the call goes straight through to the provider. Caching is the result of that first call, not a precondition.

This rule guarantees that the first time an investigator looks at something, they see ground truth from the live provider — not stale data from another investigator's earlier work. After the first touch, subsequent reads use the cache until the TTL expires or the investigator manually refreshes.

### 9.4 Cache scope and isolation

```typescript
CacheEntry {
  id: uuid
  cache_key: string                 // canonical hash of (capability + args + provider_install)
  capability: string                // "get_tx_by_hash", "get_address_attribution", etc.
  args_canonical: string            // canonicalized JSON of arguments
  provider_install_id: uuid         // which install's response this is
  response_payload: bytes           // compressed, encrypted with case DEK
  response_metadata: ResponseMeta   // provider, response code, response time, raw headers
  fetched_at: timestamp
  ttl_tier: enum                    // immutable | slow_drift | medium_drift | fast_drift
  expires_at: timestamp | null      // null = immutable
  scope: enum                       // case | agency | global_chain_data
  scope_ref: uuid                   // case_id or agency_id
  refresh_count: int                // how many times this has been refreshed
  manual_refresh_history: RefreshEvent[]
  byte_size: int
  hit_count: int                    // for cache-efficiency telemetry
}

RefreshEvent {
  refreshed_by: investigator_id
  refreshed_at: timestamp
  reason: enum                      // manual | scheduled | invalidated_by_reorg |
                                    // invalidated_by_provider | invalidated_by_admin
  prior_payload_hash: sha256        // for audit trail of what changed
  new_payload_hash: sha256
  delta_detected: bool              // did the data actually change?
}
```

**Scope rules**:

- **Immutable chain data** (confirmed tx contents, block contents) — cached at the `global_chain_data` scope, shared across all cases and agencies. The Bitcoin block at height 800000 is the same for everyone; caching it once is correct.
- **Attribution data** — cached at the `agency` scope by default. Different agencies may have different provider mixes and may see different attributions; caching per-agency respects that. Within an agency, all cases share the cache.
- **Case-specific computations** (taint scores, methodology results, path projections) — cached at the `case` scope. These depend on the case's specific input set.

This tiering means a wallet history analysis that touches 500 addresses in Case A populates the agency cache; if Case B later touches 200 of those same addresses, **only 300 fresh provider calls are needed**, not 500. The agency's spend drops dramatically as case volume grows.

### 9.5 The refresh button (your spec, locked)

A persistent button at the top of the graph view, next to the zoom and pan controls:

```
┌──────────────────────────────────────────────────────────────┐
│  🔄 Refresh data         Last refreshed: 4 hours ago         │
└──────────────────────────────────────────────────────────────┘
```

Clicking the refresh button opens a small dropdown with **scope choices**:

```
🔄 Refresh data
─────────────────────────────────────
What would you like to refresh?

  ○ Just this transaction
  ○ Currently selected entities
  ○ Visible viewport
  ● All entities in this case          ← default

What kind of data?

  ☑ Attribution labels
  ☑ Token metadata
  ☑ Address balances
  ☐ Re-pull transaction history
  ☐ Re-run obfuscation detection

Estimated cost: ~$3.40 across your installed providers
Estimated time: ~30 seconds

                              [Cancel]  [Refresh]
```

The default refresh scope is **all entities in the case**, refreshing the slow-drift and medium-drift tiers. Aggressive options (re-pulling tx history, re-running detection) are opt-in because they're expensive. The cost estimate is real — it's computed by simulating which capability calls would actually fire after cache eviction, against the agency's pinned price sheet for each provider.

After a refresh, the timestamp updates and any data that actually changed (delta detected) is highlighted on the canvas for ~5 seconds with a subtle pulse so the investigator sees what's new.

### 9.6 The "last refreshed" indicator

Always visible. It shows the most recent refresh timestamp of any cached data in the current view, and it color-codes by age:

- 🟢 Green: under 1 hour old
- 🟡 Yellow: 1–24 hours old
- 🟠 Orange: 1–7 days old
- 🔴 Red: over 7 days old (likely needs refresh before relying on it for court)

Hovering shows a breakdown per data type:

```
Last refreshed (data type):
  Chain data (immutable):     Always fresh
  Attribution labels:          4 hours ago
  Token metadata:              4 hours ago
  Address balances:            4 hours ago
  Sanctions lists:             18 hours ago
  Obfuscation detection rules: 2 days ago (catalog version 2026.06.12)
```

This is what gives the investigator confidence: they can tell at a glance whether the data they're looking at is current. For courtroom prep, "refresh everything to fresh state, freeze the Reproducibility Pack, and present from the frozen pack" becomes the standard workflow.

### 9.7 Cache invalidation triggers (automatic)

Cached data is invalidated automatically when:

- **Chain reorganization** — if a block we cached was reorged out, every tx in that block is invalidated. The platform listens to reorg notifications from the chain-data provider streams.
- **Sanctions list update** — when OFAC SDN or equivalent lists are updated (we poll daily), any address that newly appears on a list is force-refreshed across all caches that touched it.
- **Provider-pushed update** — Chainalysis, TRM, and Elliptic offer webhook notifications when an attribution is updated. We subscribe where available and invalidate on push.
- **Admin invalidation** — agency admin can force a global cache flush for compliance reasons (audit findings, methodology changes, regulatory updates).
- **Case-level invalidation** — when a case is reopened after extended dormancy, the platform offers a one-click "refresh everything since the case was closed."

Every invalidation is logged to the immutable audit trail.

### 9.8 Cost telemetry

The Provider Marketplace UI gains a new section: **Cost telemetry**.

```
PROVIDER COST — JUNE 2026

  Chainalysis          $1,247.30   (cache hit rate: 89%)
  TRM Labs               $843.12   (cache hit rate: 92%)
  Etherscan               $24.00   (cache hit rate: 96%)
  Alchemy                $112.40   (cache hit rate: N/A — RPC)
  Anthropic              $387.20   (cache hit rate: N/A — LLM)
  ─────────────────────────────
  TOTAL              $2,614.02

  Cache savings (est)  $14,820.00   (would have been $17,434 without caching)
  Cache hit rate         91% overall

  By case:
    Operation Bluebird     $1,847.20  (most expensive)
    Operation Stardust     $412.30
    Operation Mockingbird  $208.40
    ...
```

The agency admin sees in real time which cases and which capabilities are driving spend, and what the cache is saving them. The "estimated cost" appearing on every refresh button click is computed from the same telemetry.

### 9.9 Integration with the pillars

| Pillar                          | Touchpoint                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**     | Cache hits and misses logged as provenance events on every BeliefAtom — "this attribution came from cache X, fetched at timestamp Y"                          |
| **Reproducibility (Pillar 2)**  | The cache _is_ the reproducibility substrate — every cached response is the snapshot that survives in the Pack. Replays use the cache, not the live provider. |
| **BYOK Marketplace (Pillar 3)** | The cache makes BYOK economically viable; without it, the marketplace's commercial promise breaks at the first 200-address wallet analysis                    |
| **Court Mode**                  | Presentations run entirely from cache (Pillar 2 already locked this); the cache _is_ the frozen state                                                         |
| **Transaction Inspector**       | Every Inspector call checks cache first; cache hits return instantly, cache misses fire to the provider                                                       |

### 9.10 What this gives investigators

- **First-touch always hits live**: ground truth on first inspection, every time
- **Subsequent reads are instant**: caching is invisible until they need it
- **Refresh is one click**: always knowable, never automatic without intent
- **Last-refresh badge always visible**: confidence in what they're looking at
- **Cost is predictable**: monthly spend telemetry, refresh-cost estimates before the click

---

## Feature 10 — One-Push UTXO Co-Input & Change Address Clustering

### 10.1 The mechanic

For Bitcoin and other UTXO chains, two of the most fundamental clustering heuristics are:

- **Common-Input Heuristic (CIH)**: all addresses that appear as inputs to the same transaction are likely controlled by the same entity (because spending them required the entity to sign with each address's private key).
- **Change detection**: in a transaction with two outputs, one is the "payment" and the other is "change" returning to the sender. Identifying the change output lets us extend the cluster forward in time.

These heuristics are the bedrock of UTXO blockchain forensics. They're also imperfect — CoinJoin transactions deliberately break CIH; sophisticated users avoid address reuse; modern wallets use diverse change patterns. The platform should run them well, surface their confidence honestly, and let the investigator decide.

### 10.2 The one-click flow

The investigator selects any UTXO address on the canvas. Right-click menu (or `K` for cluster) shows:

```
🔗 Cluster this address (CIH + change detection)
```

One click. The platform:

1. **Pulls every transaction** where the selected address appears as an input
2. **Applies CIH**: every co-input address in those transactions joins the cluster
3. **Recursively expands**: for each newly-clustered address, repeat — pull its txs, apply CIH again — until no new addresses are added or a configurable depth cap is reached (default 6 expansion rounds, sufficient for almost any real-world cluster)
4. **Runs change detection** on every output of every clustered transaction, using a layered heuristic ensemble:
   - **Optimal change**: the smaller of two outputs is statistically more often change for typical spending patterns
   - **Round-payment heuristic**: round-numbered outputs (0.05 BTC, 1.00 BTC) are payments; non-round outputs are likely change
   - **One-time-use detection**: outputs to fresh addresses that have never appeared elsewhere are more likely change
   - **Script-type matching**: change typically uses the same script type (P2WPKH, P2TR, etc.) as the inputs; payments often differ
   - **Address-reuse signal**: if one output's address has been used elsewhere by the cluster, it's likely change
5. **Joins change outputs to the cluster** with per-output confidence scores
6. **Detects CoinJoin transactions** and excludes them from CIH propagation (CoinJoin txs have signature equal-value-output patterns; including them in CIH would catastrophically merge unrelated clusters)
7. **Renders the cluster on the canvas** as a visually grouped sub-graph with the cluster's assigned color (using the same palette logic as path styling from Feature 5)
8. **Saves the cluster** as a first-class object linked to the case
9. **Emits BeliefAtoms** for every clustering inference, with confidence and rule version

The investigator sees a progress indicator and then a cluster pop into existence as a unified entity. Hundreds of addresses might collapse into a single visually grouped node, expandable to see its members.

### 10.3 The cluster data model

```typescript
UTXOCluster {
  id: uuid
  case_id: uuid
  chain: string                     // "bitcoin", "bitcoin_cash", "litecoin", etc.
  name: string                      // investigator-set or auto-derived
  display_color: ColorRef           // canvas color for the cluster
  seed_address: AddressRef          // the address the investigator started from
  member_addresses: ClusterMember[]
  member_count: int

  // clustering metadata
  cih_expansion_rounds: int
  cih_confidence: float             // aggregate confidence of the CIH-derived members
  change_detection_results: ChangeDetectionResult[]

  // exclusions
  coinjoin_txs_excluded: TxRef[]
  manually_excluded_addresses: AddressRef[]   // investigator can prune false positives

  // attribution
  cluster_attribution: ClusterAttribution | null   // if the cluster maps to a known entity
  attribution_provenance: AttributionSource[]

  // lifecycle
  computed_at: timestamp
  rule_version: string
  refreshable: bool
  last_refreshed_at: timestamp | null
  status: enum                      // active | superseded | manually_pruned

  // reproducibility
  content_hash: sha256              // deterministic hash of the cluster definition
  belief_atoms_emitted: BeliefAtomId[]
}

ClusterMember {
  address: AddressRef
  joined_via: enum                  // cih | change_detection | manual_add
  joined_at_expansion_round: int    // for CIH-derived members, which round
  confidence: float
  evidence_txs: TxRef[]             // the txs that prove this membership
}

ChangeDetectionResult {
  tx: TxRef
  identified_change_output_index: int
  confidence: float
  heuristics_applied: string[]      // ["optimal_change", "one_time_use", "script_type_match"]
  alternative_interpretations: AlternativeChange[]   // if heuristics disagreed
}
```

### 10.4 What the investigator sees on the canvas

Before clustering: 47 individual addresses scattered across the case graph, each with its own connections.

After clustering: 1 visually grouped cluster entity (rendered as a larger, multi-bordered shape with the cluster color), containing those 47 addresses. The cluster as a whole has aggregated stats (total inflow, total outflow, lifetime span, top counterparties). Edges to and from cluster members can either collapse into aggregate cluster-level edges (default for cleanliness) or remain individual (toggle for forensic detail).

Double-clicking the cluster expands it in place — the 47 addresses fan out within the cluster boundary, each individually inspectable. Double-click again to collapse back. Clusters are foldable units, like directories in a file tree.

The cluster carries a confidence chip: `Cluster: 47 addresses, CIH avg confidence 0.94, change detection avg 0.78`. The investigator can tell at a glance how strong the cluster is.

### 10.5 Investigator overrides

CIH is a heuristic, not a proof. CoinJoin and CoinJoin-like services can corrupt CIH. The investigator must be able to override:

- **Exclude an address** from a cluster (the investigator has evidence — perhaps a subpoena return — that the address is not actually co-controlled)
- **Exclude a transaction** from CIH propagation (the investigator identifies a CoinJoin the detector missed)
- **Manually add an address** (the investigator has evidence the address belongs but the heuristics missed it)
- **Split a cluster** (the investigator concludes the cluster has merged two distinct entities)
- **Merge two clusters** (the investigator concludes two clusters are actually one entity)

Every override emits a BeliefAtom with the investigator as provenance (T0 — investigator-asserted) and is reflected in the Reproducibility Pack. The override survives forever even if the heuristics later disagree.

### 10.6 The "show the work" report

A UTXO cluster generates a standardized **Cluster Provenance Report** on demand, structured as:

1. **Seed address and chain**
2. **Expansion log** — round-by-round, which addresses joined and via which transactions
3. **Change detection log** — every change-output identification with the heuristics that supported it
4. **Excluded transactions** — every CoinJoin or otherwise excluded tx, with the rationale
5. **Investigator overrides** — every manual add/exclude/split/merge, with the investigator's rationale
6. **Confidence summary** — aggregate cluster confidence + per-member confidence distribution
7. **Methodology disclosure** — heuristic versions used, rule versions pinned
8. **Reproducibility sub-pack** — frozen inputs, deterministic re-run

This is what survives the [D'Aloia mathematical audit](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/) for UTXO cluster claims. Courts increasingly demand it; the platform produces it as a default exhibit type.

### 10.7 Integration with locked features

| System                                  | Touchpoint                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**             | Every cluster membership, every change detection, every override emits BeliefAtoms                                                                                                     |
| **Reproducibility (Pillar 2)**          | Cluster definitions are content-hashed; replay reconstructs identical clusters from frozen tx data                                                                                     |
| **BYOK Marketplace (Pillar 3)**         | UTXO data pulled through installed chain-data providers (Blockchair, Blockstream, Mempool.space, Allium); change detection rules versioned and pinned                                  |
| **Cache layer (Feature 9)**             | All UTXO data pulled during clustering is cached at the `global_chain_data` scope — tx structure is immutable, so the cache amortizes the cost across every case in the agency forever |
| **Wallet History Analyzer (v0.5 F7)**   | The wallet analyzer auto-runs clustering on every UTXO address as part of its pass; clusters discovered there feed back into the case graph                                            |
| **Transaction-centric graph (v0.5 F6)** | Clusters are grouped AddressNodes; the transaction-in-the-middle rule is preserved (transactions don't get clustered; only addresses do)                                               |
| **Canvas UX**                           | Cluster rendering follows the icon and color discipline; double-click-to-expand is the universal expand affordance                                                                     |
| **Obfuscation Detection (v0.5 F4)**     | CoinJoin detection is shared between this clustering feature and the obfuscation detection layer — both use the same detector                                                          |

### 10.8 Build phasing

| Phase       | Clustering additions                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase 1** | UTXOCluster data model; one-click CIH-only clustering on Bitcoin; basic change detection (optimal-change heuristic only)                                     |
| **Phase 2** | Full change detection heuristic ensemble; CoinJoin detection and exclusion; cluster rendering on canvas with expand/collapse; investigator override controls |
| **Phase 3** | Cluster Provenance Report as a default exhibit; auto-clustering during Wallet History Analyzer runs; multi-UTXO-chain support (Bitcoin Cash, Litecoin, Doge) |
| **Phase 4** | ML-augmented change detection (gradient-boosted classifier as a T3 supplement to T1 rules); cross-cluster relationship inference                             |

---

## Feature 11 — Personal Attribution (the user's own labels)

### 11.1 What it is

A separate attribution layer that **belongs to the investigator, not to the platform's BYOK providers**. The investigator can tag any address or transaction with their own attribution — a label, a category, a free-text note, optional confidence — and that attribution **persists across every case they work**.

Three months later, the investigator opens a new case and encounters address `0xabc...d4e3`. The address renders on the canvas with their personal label visible: **"Suspect's exchange deposit — confirmed via subpoena #2024-0184"**, in the color they chose, with the date they applied the label.

This is the feature that turns the platform from a tool the investigator uses into a tool that **remembers them**. The investigator's accumulated knowledge follows them forever.

### 11.2 The data model

```typescript
PersonalAttribution {
  id: uuid
  attributor_id: investigator_id    // whose attribution this is
  target_type: enum                 // address | transaction | cluster | entity | swap_pool | bridge_contract
  target_ref: TargetRef             // chain-qualified reference
  target_chain: string

  // the attribution content
  label: string                     // primary short label, e.g. "John Doe's Binance deposit"
  category: enum                    // exchange_deposit | suspect_eoa | victim_wallet |
                                    // mixer | otc_desk | sanctioned | known_clean |
                                    // smart_contract | bridge | custom
  custom_category: string | null    // if category == "custom"
  description: text                 // free-form longer note
  display_color: ColorRef | null    // optional color override on the canvas
  display_icon: IconRef | null      // optional icon overlay

  // confidence and basis
  confidence: float                 // attributor's own confidence
  basis: enum                       // subpoena_confirmed | self_admitted | osint_confirmed |
                                    // pattern_inferred | provider_corroborated | hypothesis
  supporting_evidence: EvidenceRef[]   // case docs, memos, external links

  // lifecycle
  created_at: timestamp
  updated_at: timestamp
  last_seen_at: timestamp           // when did the attributor last work on this entity?
  use_count: int                    // how many cases has this attribution appeared in?

  // sharing
  visibility: enum                  // private | shared_with_users | shared_with_team |
                                    // shared_with_org | shared_externally
  shared_with: SharedScope          // specific users, teams, or org-wide
  shared_at: timestamp | null
  acceptor_log: AcceptorEvent[]     // who accepted this when shared

  // case linkage
  cases_referenced_in: CaseRef[]    // every case this attribution has touched
  primary_case_id: uuid | null      // the case where this attribution was first established
}
```

### 11.3 Applying an attribution

The investigator right-clicks any address, transaction, or cluster on the canvas and selects **Add my attribution**. A compact modal opens:

```
┌─────────────────────────────────────────────────────────┐
│  Add your attribution                              [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Target:  0xabc...d4e3 (Ethereum)                       │
│                                                         │
│  Label:   ┌─────────────────────────────────────────┐   │
│           │ John Doe's Binance deposit              │   │
│           └─────────────────────────────────────────┘   │
│                                                         │
│  Category: [ Exchange deposit ▼ ]                       │
│                                                         │
│  Confidence: ●●●●○ (4 of 5 — high)                      │
│                                                         │
│  Basis: [ Subpoena confirmed ▼ ]                        │
│                                                         │
│  Description (optional):                                │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Confirmed via subpoena #2024-0184. KYC matches  │    │
│  │ suspect identity. See attached doc.             │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Display color: 🟥 Red    Icon: 🏦                       │
│                                                         │
│  Visibility:                                            │
│  ● Private (only me)                                    │
│  ○ Share with specific users                            │
│  ○ Share with my team                                   │
│  ○ Share with my organization                           │
│                                                         │
│                                          [Cancel] [Save] │
└─────────────────────────────────────────────────────────┘
```

Save. Done. The attribution now persists.

### 11.4 What the investigator sees going forward

Every time this investigator opens any case (current or new) and encounters this address, the canvas renders the attribution prominently:

- The label appears as a floating chip near the entity
- The display color overrides the default attribution color (per the canvas UX color discipline — this is an investigator-blessed override and is logged)
- The icon overlays the entity
- A small badge — `📌 your attribution` — indicates the source
- Hovering shows the full attribution detail and the case it was first established in

The personal attribution **does not replace provider attribution** — both are visible, and disagreement is surfaced. If Chainalysis says "unattributed" but the investigator says "John Doe's deposit," both are shown and the investigator's own label takes visual priority in their UI. Other investigators (without the shared attribution) still see the Chainalysis label by default.

### 11.5 The sharing model

The four visibility levels:

**Private** (default)

- Only the attributing investigator sees the label
- Stored in their personal attribution space
- Survives across all their cases forever
- Other investigators on shared cases see the provider attribution; they don't even know a personal attribution exists

**Shared with specific users**

- The investigator picks named colleagues
- Those colleagues see the attribution in their canvas going forward
- They can accept it (it joins their personal attributions, with the original attributor cited), reject it, or simply view it without accepting (visible while looking at the entity in a shared case but not added to their personal store)

**Shared with team**

- All members of the investigator's team see and have access
- Useful for joint task forces working a multi-suspect operation
- Team members can accept individually

**Shared with organization**

- The entire agency tenant inherits the attribution
- Surfaces alongside provider attributions for everyone
- Subject to org-level governance (org admin can revoke org-wide shares)
- Becomes effectively a private label database the agency builds over time

**Shared externally** (Phase 4, opt-in, federated)

- Cross-agency sharing through the same federated mechanism as cross-agency deconfliction (v0.5 F1)
- Privacy-preserving by default — uses hashed exchange so other agencies discover that a label exists without revealing its content until they request to view
- Subject to MOU and signed agreements between agencies
- Never default-on

### 11.6 Acceptance and counter-attribution

When attribution is shared with another user, the recipient sees a notification:

```
Investigator J. Doe shared an attribution with you.

  Target:      0xabc...d4e3 (Ethereum)
  Label:       John Doe's Binance deposit
  Category:    Exchange deposit
  Basis:       Subpoena confirmed
  Description: Confirmed via subpoena #2024-0184...

  [View in canvas]  [Accept]  [Reject]  [Counter-attribute]
```

**Accept** — adds to the recipient's personal attribution store with provenance recorded ("via J. Doe, accepted on date X")

**Reject** — the attribution is not adopted; the original attributor is notified

**Counter-attribute** — the recipient sets their own attribution for the same target, which differs from the sender's. Both attributions now coexist on the entity. The canvas surfaces the disagreement explicitly: "J. Doe says X; you say Y." The Critic Agent flags the disagreement as worth resolving.

Counter-attribution is important: it preserves disagreement honestly rather than forcing one investigator's view onto another.

### 11.7 The personal attribution library

The investigator gains a new top-level view: **My Attributions**. A library across all their cases showing:

- Every personal attribution they've ever applied
- Sortable by category, recency, confidence, sharing status, case
- Searchable by label text
- Filterable by chain, target type, case
- Bulk operations: change visibility, export, delete (with audit trail), share with a new set of users

This becomes the investigator's institutional knowledge base. Five years into a career, an experienced investigator's personal attribution library is **their accumulated expertise made queryable**. It is among the most valuable assets they own as a professional, and the platform respects that by making it portable: investigators who change agencies can export their personal attributions and re-import into a new tenant (subject to classification and clearance restrictions).

### 11.8 Provenance and Belief State integration

A personal attribution writes a BeliefAtom with:

- Subject: the target entity
- Predicate: "has_personal_attribution"
- Object: the attribution payload
- Confidence: the attributor's confidence
- Tier: **T0 (investigator-asserted)** when the basis is "subpoena_confirmed" or "self_admitted"; **T2** when "osint_confirmed" or "provider_corroborated"; **T3** when "pattern_inferred" or "hypothesis"
- Provenance: the attributor, the case where it was established, the supporting evidence

The Tracer Agent and Attribution Agent both read personal attributions when reasoning about an entity. A personal attribution **does not auto-promote to court-grade** (D1 still applies — court-grade requires the explicit signoff workflow), but it serves as a strong signal in confidence calculations.

### 11.9 Governance and audit

- Every attribution creation, edit, share, accept, reject, counter, and revocation is logged to the immutable audit trail
- Org-level admins can audit shared and org-wide attributions
- The platform supports retention and legal-hold rules (sometimes an investigator leaves an agency and their attributions need to be preserved for ongoing cases)
- An attribution can be **revoked** by its creator at any time; revocation propagates to all recipients with an audit note
- Attributions referenced in finalized reports become **immutable for the report's lifetime** even if revoked elsewhere — the report's Reproducibility Pack preserves the attribution as it stood at report-generation time (consistent with G5 path immutability)

### 11.10 Why this matters

Three reasons.

First, **provider attributions are incomplete**. Chainalysis, TRM, and Elliptic are excellent but they don't know everything. An investigator who's worked 50 ransomware cases has identified addresses no provider has labeled yet. The platform should be the place that knowledge lives, not a Google Doc or a Notion page.

Second, **agencies build institutional memory**. An org-shared attribution library is a federated intelligence asset — every case enriches it for every future case. A new investigator joining the team inherits the cumulative knowledge.

Third, **investigators trust their own work**. A platform that treats their judgment as first-class — rendering their labels prominently, making them shareable, making them auditable — is a platform they will use long-term. Investigators who feel like their expertise is captured by the tool become advocates for it.

### 11.11 Integration with locked features

| System                                | Touchpoint                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**           | Personal attributions are BeliefAtoms; the platform's primary attribution-reasoning system reads them alongside provider attributions                                       |
| **Reproducibility (Pillar 2)**        | Attributions referenced in reports are frozen in the Reproducibility Pack at report-generation time                                                                         |
| **BYOK Marketplace (Pillar 3)**       | Personal attributions coexist with provider attributions; disagreements surface as Critic Challenges; multi-source corroboration (now including personal) raises confidence |
| **Cache layer (Feature 9)**           | Personal attributions are part of the agency cache (with strict per-user isolation for private attributions); they're never invalidated by external provider refreshes      |
| **Canvas UX**                         | Personal attributions get visual priority for the attributing user; color and icon overrides logged to audit                                                                |
| **Transaction Inspector (v0.5 F8)**   | Counterparty intelligence section lists personal attributions alongside provider attributions                                                                               |
| **PSR and reports**                   | Personal attributions cited in reports with the attributor and basis named explicitly                                                                                       |
| **Wallet History Analyzer (v0.5 F7)** | Wallet analysis surfaces personal attributions for any of the wallet's addresses immediately                                                                                |
| **Court Mode (v0.5 F3)**              | Personal attributions visible during presentation, with the attributor named on hover                                                                                       |

---

## Cross-feature interactions

These four features (9, 10, 11) interlock with everything earlier. The most important interactions:

- **Cache × UTXO Clustering**: clustering pulls hundreds of UTXO transactions; nearly all are immutable chain data; the global-chain-data cache means the second cluster operation in the same agency is virtually free regardless of overlap with the first
- **Cache × Personal Attribution**: personal attributions live in the agency cache (with strict per-user privacy isolation); reads are instant; they're never invalidated by provider refreshes
- **UTXO Clustering × Personal Attribution**: an investigator who applies a personal attribution to a cluster sees it propagate to every member address (with the cluster's confidence applied)
- **Personal Attribution × Court Mode**: in presentation, the platform can show "this attribution was established by Investigator Doe on date X, basis: subpoena #Y" — making the human chain of attribution as auditable as the algorithmic one
- **Cache × Cost Telemetry × Refresh**: the refresh button's cost estimate is informed by the cache, the price sheet, and the current TTL state — investigators see real numbers, not guesses
- **Personal Attribution × Provider Attribution**: when an investigator's personal attribution contradicts a provider's, the Critic Agent surfaces the disagreement and asks which is current; resolution updates the investigator's confidence or triggers a provider refresh

---

## Build phasing (consolidated, with these features)

| Phase       | Highlights                                                                                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | Cache layer foundation (global-chain-data scope, immutable-tier caching, manual refresh button, last-refresh badge); Personal Attribution data model + basic apply-and-render                                                            |
| **Phase 1** | Full cache tier system (immutable / slow / medium / fast); refresh scope dropdown; cost telemetry stub; UTXOCluster v1 (CIH + optimal-change only); Personal Attribution sharing with specific users                                     |
| **Phase 2** | Refresh cost estimator with real provider price sheets; full UTXO change detection ensemble; CoinJoin detection and exclusion; cluster rendering on canvas; Personal Attribution team and org sharing; Personal Attribution library view |
| **Phase 3** | Provider webhook-driven cache invalidation; chain-reorg listeners; sanctions-list-driven invalidation; ML-augmented change detection (T3); counter-attribution flow with Critic-mediated disagreement resolution                         |
| **Phase 4** | Cross-agency Personal Attribution federation (privacy-preserving); admin-level cache governance; advanced cluster analytics (cross-cluster relationship inference)                                                                       |

---

## Updated pack status

Twelve documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md`
2. `chainsight_schema.md`
3. `chainsight_merged_v0_2.md`
4. `chainsight_v0_3_addendum.md` (PSR)
5. `chainsight_v0_3_byok_addendum.md` (BYOK marketplace)
6. `chainsight_v0_4_consolidated.md` (locked decisions)
7. `chainsight_v0_4_canvas_ux_addendum.md` (canvas markup)
8. `chainsight_v0_4_api_key_entry_addendum.md` (API key UX)
9. `chainsight_v0_5_addendum.md` (deconfliction, docs, court, obfuscation)
10. `chainsight_v0_5_addendum_2.md` (path styling, transaction-centric graph, wallet analyzer)
11. `chainsight_v0_5_addendum_3.md` (Transaction Inspector)
12. `chainsight_v0_6_addendum.md` (this file — cache, UTXO clustering, personal attribution)

---

## The principle this turn locked

Three principles, each captured by one feature:

- **Caching makes BYOK affordable.** Without it, the marketplace's promise breaks at scale. With it, agencies pay the BYOK provider once per piece of information and amortize across every case forever.
- **Heuristics are first-class, not magic.** CIH and change detection are powerful but imperfect; the platform runs them well, exposes their confidence, allows overrides, and produces a Cluster Provenance Report that survives court scrutiny.
- **Investigators are the smartest sensor in the system.** Their personal attributions, accumulated over a career, are intelligence the platform respects, persists, shares on their terms, and makes auditable. The platform becomes more valuable to them the longer they use it.
