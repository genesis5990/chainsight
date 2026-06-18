# ChainSight v0.5 — Path Styling, Transaction-Centric Graph Model, Wallet History Analyzer

> Three additions. One is a UX feature (path styling). One is a fundamental graph-model lock (transactions as first-class nodes). One is a new investigation primitive (Wallet History Analyzer).
>
> This addendum extends v0.1–v0.5. The transaction-centric graph model corrects an implicit assumption in earlier docs and must be applied retroactively across the design.

---

## Feature 5 — Path Styling: Name + Color + Full-Path Highlight

### 5.1 What it is

When the investigator designates a TracePath through any of the selection modes from the PSR module (click, lasso, auto-pathfind, natural-language, multi-path), the path itself is a first-class object that carries:

- **A human-readable name** (investigator-set, e.g. "Path A — Victim deposit to Binance hot wallet")
- **A path color** (investigator-picked from a curated palette, with a "suggest next color" button that avoids conflict with already-active paths in the same case)
- **A full-path highlight overlay** on the canvas, persistently visible until toggled off

### 5.2 The styling behavior

When a path is named and colored:

- **Every transaction node** in the path's address→transaction→address sequence (see Feature 6) renders with the path's color as a ring around its current icon
- **Every edge** in the path (address-to-tx and tx-to-address edges) renders in the path's color, with thickness still encoding value (the existing rule)
- **A floating path label** travels with the canvas, anchored to the path's center of mass, showing the name and a small chip with the path's stats (hops, value at terminus, methodology)
- **In the Important sidebar / Paths panel**, the path appears with its color swatch and name, draggable to reorder, clickable to recenter the canvas on it

When multiple paths share an entity, the entity displays a **layered ring** — concentric colored rings, one per path it participates in. The investigator sees instantly that "this node is in Path A _and_ Path C" — and the layered ring is the visual signal of evidentiary convergence (the "shared infrastructure" insight from the PSR multi-path report).

### 5.3 The path palette

A curated palette with semantic awareness:

- **Cool palette (blues, teals, purples)** — primary investigator-built paths (the conservative default)
- **Warm palette (oranges, reds, magentas)** — adversarial or AI-suggested paths the investigator promoted
- **High-contrast accent (gold, lime)** — reserved for the case's "primary evidentiary path" — only one path per case can wear this color, and it's the path the prosecutor will lead with in court
- **Neutral (grays)** — paths archived or marked as reference-only

Investigators can override, but the palette is the default. This prevents the same problem the color discipline in the Canvas UX addendum solved: a 12-investigator team producing 12 incompatible color schemes.

### 5.4 Data model

```typescript
TracePath {
  // existing fields from PSR module, plus:

  display_name: string            // investigator-set, e.g. "Path A — Victim → Binance"
  short_label: string              // optional 1-3 char chip label, e.g. "A"
  color: ColorRef                 // hex or palette key
  is_primary: bool                // only one path per case can be is_primary=true
  highlight_style: enum           // ring | glow | dashed | bold
  highlight_visible: bool         // toggle without losing the styling
  label_position: enum            // center_of_mass | start | terminus | follows_camera

  // unchanged from PSR module:
  status, signoff_id, content_hash, supersedes, ...
}
```

### 5.5 Persistence and reproducibility

Path name, color, and highlight settings are persisted to the case file and **included in the Reproducibility Pack**. When a case is reopened or exported for court, the same path renders with the same name and color forever. The presenter in Court Mode (Feature 3) refers to "Path A in blue" with confidence that the courtroom display matches.

### 5.6 Integration with locked features

| Feature                    | Touchpoint                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PSR**                    | Naming + coloring is part of the path's "draft → under_review → finalized" lifecycle; name and color can be edited while draft, locked when finalized (G5) |
| **Court Mode**             | Paths render in their assigned colors during presentation; the View C (By Trace Path) selector shows path swatches                                         |
| **Canvas UX**              | Path color does not override semantic color discipline; rather, path ring sits _outside_ the entity's semantic-colored interior                            |
| **PSR multi-path reports** | The "shared infrastructure" detection uses path color overlap to render layered rings; the comparison table includes color swatches per row                |
| **Belief State**           | Color and name changes are versioned events on the path; replay reconstructs them in order                                                                 |

---

## Feature 6 — Transaction-Centric Graph Model (architectural lock)

### 6.1 The correction

Earlier versions of the design used the convenient shorthand "address → address" for graph edges. This is wrong, and we need to fix it now before it becomes embedded in code.

**Blockchains operate on transactions.** Money never moves directly from address to address — it always moves through a transaction. The transaction is where:

- The signature lives (proving authorization)
- The fee is paid (and to whom)
- The timestamp is canonical
- The block context exists (block height, chain reorg behavior)
- The internal call tree resides (for account-model chains)
- The input/output structure exists (for UTXO chains)
- Contract interactions occur (swap routing, bridge deposits, approvals)
- The MEV context applies (sandwich victim/attacker, JIT, front-run)

A "graph of addresses" is a lossy abstraction over the real chain. A **graph of addresses and transactions** preserves the truth.

### 6.2 The lock

**Every node in the case graph is one of two types:**

- **AddressNode** — an address (EOA, contract, UTXO derivation, etc.) on a specific chain
- **TransactionNode** — a single transaction on a specific chain, with its full context

**Every edge connects an AddressNode to a TransactionNode or vice versa.** There are no address-to-address edges. There are no transaction-to-transaction edges. The canonical structure is always:

```
AddressNode → TransactionNode → AddressNode
       (input)               (output)
```

For UTXO chains, multiple AddressNodes feed into a single TransactionNode (via UTXO inputs), and multiple AddressNodes emerge from it (via UTXO outputs). For account-model chains, typically one or two AddressNodes feed into a TransactionNode and one or more emerge from it (including internal calls, which are represented as sub-transactions linked to the parent TransactionNode).

The renderer is required to always show **transaction in the middle**, address on the sides.

### 6.3 The visual rule

On the canvas:

- **AddressNodes are rendered as circles** (or domain-specific shapes per the Canvas UX iconography library)
- **TransactionNodes are rendered as diamonds** (or another distinct shape — to be finalized in the UI mockup pass)
- **TransactionNodes always sit between AddressNodes on any path**
- **A trace path's hop sequence is always**: `Address → Tx → Address → Tx → Address → Tx → ...`
- **For UTXO chains**, a transaction node displays its inputs on the left and outputs on the right, with the inputs/outputs as half-circles or chips attached to the transaction node
- **For contract calls**, the internal call tree is expandable — a transaction node, when expanded, shows the internal calls as smaller transaction-like sub-nodes connected to the parent
- **For bridges**, the cross-chain hop is rendered as a transaction-node-on-chain-A linked to a transaction-node-on-chain-B by a special bridge-edge with the bridge protocol's icon

### 6.4 What this changes in earlier docs

Every place that says "address-to-address edge" or "address-to-address hop" in v0.1–v0.5 documents should be read as "address-to-transaction-to-address." The data model in the PSR module gets updated:

```typescript
TracePath {
  // OLD (implicit in earlier docs):
  // ordered_nodes: AddressNodeRef[]
  // ordered_edges: EdgeRef[]   // address-to-address

  // NEW (correct, transaction-centric):
  ordered_steps: PathStep[]     // alternating address and tx steps

  // ...other fields unchanged
}

PathStep {
  step_index: int
  step_type: enum                // address | transaction
  node_ref: AddressNodeRef | TransactionNodeRef
  inbound_edge: EdgeRef | null   // from the previous step
  outbound_edge: EdgeRef | null  // to the next step

  // step-specific context
  tx_role: enum | null           // for transaction steps: input_consumed | output_created |
                                 // contract_call | internal_call | bridge_deposit | bridge_withdrawal
  utxo_ref: UTXORef | null       // for address steps in UTXO chains, which specific UTXO
  transfer_id: TransferRef | null  // for address steps in account-model chains, which specific
                                   // ERC-20/SPL/TRC-20 transfer event
}
```

A 6-hop path now has **13 PathSteps** (7 address steps + 6 transaction steps), not 6 edges. Every report, every PSR view, every Court Mode frame uses this structure.

### 6.5 Why this matters for accuracy

This isn't pedantry. Three accuracy consequences:

**A. Fee attribution is correct.** Fees are paid by transactions, not by addresses. With transaction nodes first-class, the Math Service can attribute fees to the exact tx that bore them, and downstream confidence calculations reflect the real cost basis.

**B. Internal calls are first-class.** A Uniswap router call that splits a swap across three pools is one transaction with a tree of internal calls. Address-to-address representation collapses the tree; address-to-tx-to-address preserves it. This is the difference between "the funds went through Uniswap" and "the funds went through Uniswap router function `swapExactTokensForTokens`, which routed through pools X, Y, Z with slippage A, B, C and paid LP fees D, E, F."

**C. Reorganizations and chain forks have a clean representation.** A transaction node carries a confirmation depth and a "finalized" flag. If a chain reorg removes a transaction, the platform can mark that transaction node as `status: reorged_out` and downstream paths inherit the uncertainty, without having to retroactively rewrite address-to-address edges. This matters more on PoW chains where reorgs are possible than on instant-finality chains, but the model handles both.

### 6.6 Why this matters for visual analysis

When the investigator looks at the canvas, they see **the transaction as the thing the suspect did**, and the addresses as the **before and after** state. This matches how investigators actually think and how prosecutors argue.

"On August 12 at 14:33 UTC, the defendant executed transaction `0xabc...` which moved 423.7 USDT from wallet `0xdef...` to wallet `0x123...`, paying 12 USDT in gas. Here is the transaction" — pointing at the diamond in the middle — "and here are the wallets before and after." That sentence maps to the canvas one-to-one. Address-to-address graphs require the investigator to mentally insert a transaction every time; transaction-centric graphs match the testimony.

### 6.7 The UTXO/account-model unification

This model unifies UTXO and account-model traces under one structure:

- **UTXO chain (Bitcoin family)**: the TransactionNode consumes specific UTXOs (each linked to its source AddressNode via a "spent_utxo" reference) and creates specific UTXOs (each linked to its destination AddressNode). The path through a UTXO tx is "Address → (UTXO consumed) → Tx → (UTXO created) → Address" with the UTXO refs as decorations on the address steps.
- **Account-model chain (EVM, Solana, etc.)**: the TransactionNode initiated by an AddressNode reads/writes balances and emits transfer events; each transfer event links a sending AddressNode to a receiving AddressNode through this TransactionNode. The path through an account-model tx is "Address → Tx → Address" with the transfer event as a decoration on the tx step.

Both forms render the same way on the canvas — circles for addresses, diamonds for transactions, transaction always in the middle — and a single Tracer Agent can traverse either by switching its per-hop primitive.

### 6.8 Where this updates the locked design

| Document                                           | Update                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v0.1 schema, Domain 12 (UTXO vs account-model)** | The two models are now unified under the address-tx-address structure; the schema's "tracing primitive" column becomes a per-chain handler within the same node-edge framework                          |
| **v0.2 accuracy spine, B1 BeliefAtoms**            | Atoms can reference TransactionNode IDs directly; this is more precise than referencing edges                                                                                                           |
| **v0.3 PSR module**                                | TracePath.ordered_edges → TracePath.ordered_steps with the PathStep model above                                                                                                                         |
| **v0.4 canvas UX**                                 | The "Where did the money go?" overlay colors edges between addresses and txs; the value-split percentages render on the address-to-tx and tx-to-address edges (matching how UTXO outputs visibly split) |
| **v0.5 Court Mode**                                | The View C playback advances one PathStep at a time, alternating address and tx — every hop is two clicks of the arrow key, which actually makes for cleaner courtroom narration                        |
| **v0.5 obfuscation detection**                     | Detectors operate on the unified graph; peel chain detection looks at sequences of TransactionNodes with the geometric value-decay signature on their output AddressNodes                               |

This is the kind of correction that's painful to apply later and trivial to apply now. Locking it before Phase 1 builds the canonical case graph.

---

## Feature 7 — Wallet History Analyzer

### 7.1 The use case

An investigator obtains a suspect's wallet — either as a forensic image (seed phrase recovered from a device, exported keystore, drained-and-sweeped wallet file), as a dump from a subpoenaed exchange that itemizes the user's controlled deposit addresses, or as a Telegram/Discord export listing the addresses a suspect publicly used. The wallet might contain dozens to hundreds of addresses across multiple chains.

Currently, an investigator with a 50-address wallet dump has to:

1. Open each address in a block explorer
2. Eyeball the activity
3. Decide which addresses matter
4. Manually trace those addresses
5. Cross-reference findings across addresses

This is slow, error-prone, and skips addresses the investigator dismisses too quickly. The platform should automate it end-to-end.

### 7.2 What the feature does

A new investigation primitive — the **Wallet** — sitting alongside Case and TracePath as a first-class object. The investigator creates a Wallet, dumps in the addresses (paste, upload CSV, drag a JSON file, paste a seed phrase that the platform derives addresses from in-memory only), names it, attaches it to a case, and clicks Analyze.

The platform then:

1. **Validates and normalizes every address** — chain detection, format normalization, checksum verification, dedupe
2. **Pulls full history for each address** across all installed chain-data providers (BYOK capability — Etherscan family, Blockchair, Solscan, Tronscan, Allium, etc.)
3. **Runs a 3-to-5-hop trace on every address** (configurable per Wallet) in both directions (incoming and outgoing)
4. **Computes per-address summaries**: first activity, last activity, total inflow/outflow, current balance, top counterparties, attribution status, obfuscation findings
5. **Identifies cross-address relationships** — addresses controlled by the same entity (via clustering heuristics), addresses that share counterparties, addresses that funded each other
6. **Surfaces high-value addresses** — by absolute value moved, by attribution risk, by obfuscation pattern hits, by counterparty entity tier
7. **Renders the entire wallet as a coherent sub-graph** on the canvas, ready for the investigator to engage with at whatever depth they choose

### 7.3 The Wallet data model

```typescript
Wallet {
  id: uuid
  case_id: uuid
  name: string                    // investigator-set, e.g. "John Doe's Ledger Nano — seized 2026-04-12"
  description: text
  source: enum                    // forensic_seizure | subpoena_dump | osint | self_reported_victim |
                                  // suspect_voluntary | exchange_export | seed_recovered
  source_provenance: text         // chain of custody, who provided it, when
  source_documents: CaseDocumentRef[]   // supporting documents (warrants, exchange returns)
  classification: enum            // unclassified | LES | confidential | classified

  addresses: WalletAddress[]
  chains_represented: string[]
  total_address_count: int

  analysis_config: WalletAnalysisConfig
  analysis_status: enum           // not_run | running | complete | partial | failed
  last_analyzed_at: timestamp | null
  analysis_summary: WalletAnalysisSummary | null

  created_by: investigator_id
  created_at: timestamp
  visible_to: AccessScope
  audit_trail: EventLog[]
}

WalletAddress {
  id: uuid
  wallet_id: uuid
  raw_address: string             // as provided
  normalized_address: string      // canonical form
  chain: string
  derivation_path: string | null  // for HD wallets when known
  label_from_source: string | null  // any label the source provided
  investigator_notes: text | null
  analysis_status: enum           // not_analyzed | analyzing | complete | failed
  per_address_summary: AddressActivitySummary | null
  hop_traces: HopTraceResult[]    // one per direction-and-depth pair
}

WalletAnalysisConfig {
  hop_depth_incoming: int         // default 3, range 1-10
  hop_depth_outgoing: int         // default 5, range 1-10
  hop_branching_cap: int          // default 50 per hop (prevents combinatorial blowup)
  taint_threshold: float          // default 0.01 — stop tracing when taint drops below this
  obfuscation_detection: bool     // default true
  attribution_resolution: bool    // default true
  per_address_budget_hint: BudgetSpec  // soft budget per address before flagging for review
}

WalletAnalysisSummary {
  addresses_analyzed: int
  total_inflow_native_by_chain: map<chain, Decimal>
  total_inflow_fiat: Decimal
  total_outflow_native_by_chain: map<chain, Decimal>
  total_outflow_fiat: Decimal
  current_balance_fiat: Decimal
  top_counterparty_entities: EntityRef[]
  identified_clusters: ClusterRef[]
  obfuscation_findings: ObfuscationFinding[]
  flagged_for_investigator_review: WalletAddressRef[]
  computed_at: timestamp
  reproducibility_hash: sha256
}
```

### 7.4 The analysis workflow

When the investigator clicks Analyze:

1. **Address normalization** — every input is canonicalized; duplicates merged; cross-chain "same address on multiple EVM chains" detected and noted
2. **History pull** — fan-out to chain-data providers (capability router selects per-chain). Each address's complete transaction history is pulled into the case graph as TransactionNodes connected to AddressNodes (per Feature 6)
3. **Per-address summarization** — Math Service computes inflow, outflow, balance, lifetime span, top counterparties
4. **Attribution pass** — Attribution Agent resolves every address and every top counterparty against installed attribution providers; multi-provider corroboration applies (Pillar 3 behavior)
5. **Per-address hop trace** — Tracer Agent runs a 3-hop incoming and 5-hop outgoing trace (default) on each address, with the existing stopping rules (taint threshold, depth cap, exchange deposit detection, mixer entry, dust threshold)
6. **Obfuscation detection** — every address's local sub-graph is checked against the obfuscation detector library (Feature 4 from the earlier addendum); findings are recorded per-address and at the wallet level
7. **Cross-address relationship inference** — clustering heuristics identify which addresses likely share control (common-input, change-output for UTXO; behavioral for account-model); shared counterparties surfaced
8. **High-value flagging** — the platform ranks addresses by evidentiary value (composite score: value moved, attribution risk, obfuscation hits, counterparty tier) and surfaces the top 10 for investigator priority review
9. **Sub-graph rendering** — the full analyzed wallet renders as a colored sub-graph on the canvas, with the wallet name as a label and the wallet's addresses visually grouped
10. **Belief Atom emission** — every finding from the analysis emits BeliefAtoms with the wallet analysis as provenance
11. **Reproducibility Pack contribution** — the analysis configuration, the rule versions used, the provider snapshots, and the full result set are added to the case's Reproducibility Pack

### 7.5 The investigator's experience

After Analyze runs (could be seconds for a 5-address wallet, several minutes for a 200-address wallet — progress shown in real time with per-address status), the investigator sees:

- **Wallet summary card** in the Wallets tab: name, address count, chains, total in/out, top counterparties, obfuscation findings, "X addresses flagged for review"
- **Canvas overlay** showing the wallet's sub-graph, with the wallet's addresses ringed in the wallet's assigned color (same palette logic as path coloring in Feature 5)
- **Flagged-addresses panel** listing the top-ranked addresses with one-click drill-down
- **Suggested paths panel** populated by the Suggestion Agent (G6) with the highest-value paths discovered during the analysis
- **One-click report** generation for the entire wallet — a structured "Wallet History Analysis Report" that becomes a default exhibit type

### 7.6 The Wallet History Analysis Report

A new standard report type joining the SAR / seizure affidavit / civil exhibit family. Structure:

1. **Wallet provenance** — source, custody chain, supporting documents
2. **Wallet contents** — address list with chains, labels, derivation paths if known
3. **Aggregate activity** — totals, time span, chain breakdown
4. **Per-address analysis** — for each address: activity summary, top counterparties, attribution, hop trace results, obfuscation findings
5. **Cross-address relationships** — clusters, shared counterparties, intra-wallet funding
6. **Obfuscation methods identified** — the Feature 4 findings, named and explained
7. **High-value paths** — paths the analysis surfaced as evidentiary candidates
8. **Methodology disclosure** — analysis config (hop depths, thresholds), rule versions, provider snapshots
9. **Citations & reproducibility sub-pack**

Every claim in this report is gated by the Verifier Agent. The Math Service owns every number. The report's content hash is committed to the immutable audit log.

### 7.7 Naming, saving, and case attachment

Per your spec: the Wallet can be named and saved to a specific case. The data model supports this directly. Additionally:

- **A Wallet always belongs to exactly one case** (no cross-case wallets — that would create attribution-provenance ambiguity); if the same physical wallet is relevant to two cases, each case gets its own Wallet object linked to the same source documents
- **Wallet names are case-scoped** — "John Doe's Ledger" can exist in multiple cases without collision
- **A case can have multiple wallets** — "Suspect's wallet," "Co-conspirator's wallet," "Victim's wallet," "Exchange-provided dump" — each separately analyzed and reportable
- **Wallets can be tagged** with their role (suspect / co-conspirator / victim / control / unknown) — the analysis tunes its heuristics accordingly (victim wallet analysis prioritizes inflow tracing to find where the victim's money came from; suspect wallet analysis prioritizes outflow tracing to find where the proceeds went)

### 7.8 The seed-phrase / private-key edge case

If the investigator has a seed phrase or private key (lawful access — recovered from a seized device under a warrant), the platform can derive addresses on demand. Critical rules:

- **The seed/key is never persisted** — it's used in memory to derive addresses, then immediately discarded
- **No signing capability is exposed** — the platform derives public addresses, not signed transactions
- **The investigator can specify derivation paths** — BIP-44, BIP-49, BIP-84, BIP-86, ed25519 for Solana, Tron's custom path, etc.
- **A default scan** covers the common derivation paths for major wallet families (Ledger, Trezor, MetaMask, Phantom, TronLink, Trust Wallet) and surfaces any address with activity
- **The investigator can extend the derivation scan** to non-standard paths if a specific wallet vendor uses them
- **Audit log records** that key material was used (not what the material was), when, by whom, under what warrant authority

This is the moment the platform crosses from "passive on-chain analysis" into "active forensic recovery" — and it has to be treated with the corresponding care.

### 7.9 Integration with locked features

| Feature                                         | Touchpoint                                                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**                     | Every Wallet, WalletAddress, hop trace result, and analysis finding emits BeliefAtoms                                                  |
| **Reproducibility (Pillar 2)**                  | The entire analysis is reproducible — config, providers, rule versions, results all in the Pack                                        |
| **BYOK Marketplace (Pillar 3)**                 | Analysis uses installed chain-data and attribution providers; agencies with broader provider coverage get deeper analysis              |
| **PSR**                                         | The Suggestion Agent ingests wallet analysis findings to propose high-value evidentiary paths                                          |
| **Canvas UX**                                   | Wallet sub-graph rendered with wallet-assigned color (Feature 5 palette); flagged addresses get the 🚩 icon                            |
| **Obfuscation Detection (v0.5 F4)**             | Findings from wallet analysis populate the same findings table as case-wide detection                                                  |
| **Court Mode (v0.5 F3)**                        | View D (By Entity) is the natural courtroom view for a wallet — "let me show you everything we found in the defendant's seized wallet" |
| **Document Ingest (v0.5 F2)**                   | Source documents (warrants, exchange dumps) link directly to the Wallet object                                                         |
| **Deconfliction (v0.5 F1)**                     | A wallet's addresses are checked against other cases for deconfliction overlap at analysis time                                        |
| **Transaction-centric graph (Feature 6 above)** | Wallet analysis renders address-tx-address structure throughout                                                                        |

### 7.10 Performance and scale notes

- **Default 5-hop outgoing on a 100-address wallet across 3 chains** could touch tens of thousands of transactions. The Capability Router parallelizes across providers and respects rate limits. Estimated runtime: 5-15 minutes depending on activity density.
- **The Scope Agent** (from v0.1 Domain 4) projects the cost of the analysis before it runs and warns if it exceeds a budget threshold — "this analysis will consume ~$48 in API credits across your installed providers, continue?"
- **Background mode** — analyses run async; the investigator can leave the page and come back; results stream in as they complete; addresses with finished traces become interactive on the canvas immediately
- **Incremental re-analysis** — if a wallet has been analyzed once and new transactions occur on its addresses, a delta-mode re-run pulls only the new activity and updates the analysis without redoing everything

---

## Cross-feature interactions (Features 5, 6, 7)

- **Wallet × Path Styling**: when a Wallet History Analyzer surfaces a high-value path, the investigator promotes it to a TracePath with one click and immediately names + colors it via the Feature 5 styling
- **Wallet × Transaction-Centric Graph**: every transaction in every analyzed wallet is a TransactionNode; the entire wallet sub-graph follows the address-tx-address rule
- **Path Styling × Court Mode**: the named, colored paths are what the prosecutor refers to in court — "Path A in gold," "Path B in blue"
- **Transaction-Centric × Obfuscation Detection**: detectors operate on the address-tx-address sequences directly, with cleaner rule semantics
- **Wallet × Deconfliction**: when a wallet's addresses are entered, the deconfliction check fires automatically and flags any address that appears in another active case
- **Wallet × Document Ingest**: a subpoenaed exchange dump becomes both a Document (the source) and a Wallet (the analyzed contents); they're linked

---

## Build phasing (updated)

| Phase       | Additions from this addendum                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | Transaction-centric graph model locked in the data layer; AddressNode and TransactionNode as first-class entities; rendering rule "transaction in the middle" enforced in the canvas spec           |
| **Phase 1** | Path styling (name + color + highlight) with curated palette; Wallet data model and basic CRUD; manual wallet creation (paste addresses, name, attach to case)                                      |
| **Phase 2** | Full Wallet History Analyzer with multi-chain history pull, 3/5-hop default tracing, per-address summaries, attribution pass, obfuscation pass, sub-graph rendering, Wallet History Analysis Report |
| **Phase 3** | Seed-phrase / private-key derivation (with full audit + warrant attestation flow); incremental delta re-analysis; cross-wallet clustering across multiple wallets in the same case                  |
| **Phase 4** | Cross-case wallet linking (consent-gated, with deconfliction integration); long-running watch mode on wallets (continuous monitoring after analysis)                                                |

---

## Updated pack status

Ten documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md`
2. `chainsight_schema.md`
3. `chainsight_merged_v0_2.md`
4. `chainsight_v0_3_addendum.md` (PSR)
5. `chainsight_v0_3_byok_addendum.md` (BYOK Marketplace)
6. `chainsight_v0_4_consolidated.md` (locked decisions)
7. `chainsight_v0_4_canvas_ux_addendum.md` (canvas markup)
8. `chainsight_v0_4_api_key_entry_addendum.md` (API key UX)
9. `chainsight_v0_5_addendum.md` (deconfliction, docs, court, obfuscation)
10. `chainsight_v0_5_addendum_2.md` (this file — path styling, transaction-centric graph, wallet analyzer)

---

## A reminder on the principle

Three features added; one architectural correction locked. The correction matters most. **Every node is an address or a transaction; every edge connects the two types; transaction always in the middle.** That's how blockchains work, and the platform's data model now matches reality instead of the convenient "address-to-address" shorthand that early sketches used.

Combined with the path styling and the wallet analyzer, an investigator can now:

1. Drop a 50-address wallet dump from a subpoena
2. Click Analyze and watch the entire wallet history populate the canvas in transaction-centric form
3. See the high-value paths the platform surfaced, promoted into named-and-colored TracePaths
4. Walk into court with the wallet history report, the path-styled visual canvas, and the courtroom Present mode ready to advance frame by frame

All of it transaction-centric. All of it reproducible. All of it color-coded the same way three months later.
