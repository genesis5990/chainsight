# ChainSight v0.6 — Consolidated Design

> v0.6 supersedes the v0.4 consolidated reference. It folds in every decision and feature from v0.4 through v0.6 addenda into one canonical index.
>
> All prior documents remain valid — this file points to them and reflects their cumulative state.
> When a future version updates a decision, the change is recorded here in the Decision log with the prior position preserved for audit.

---

## Decision log

Every open question raised across the design conversation, with final disposition.

| ID      | Topic                                           | Status           | Decision                                                                                                                                                                                                                                                                                        |
| ------- | ----------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1**  | Autonomy line for AI attributions               | ✅ Locked (v0.3) | Human-in-the-loop required for any court-grade attribution. AI proposes; investigator publishes. Enforced at the database layer: `signoff_id` mandatory on any court-grade `is_controlled_by`/`is_entity` BeliefAtom.                                                                           |
| **G2**  | Public anchoring of reproducibility hashes      | ⏳ Open          | Lean: anchor only at case-close, only the final manifest hash, only when the case is going to court. Default off; opt-in per case.                                                                                                                                                              |
| **G3**  | Cross-case learning consent model               | ⏳ Open          | Lean: differential-privacy aggregation on by default within an agency tenant, opt-in (signed agreement) for cross-agency. Air-gapped tenants: never.                                                                                                                                            |
| **G4**  | Freeze decision UI                              | ✅ Locked (v0.3) | One-pager design: trace summary, confidence with intervals, open Critic challenges, methodology used, VASP info, SLA clock, three buttons (Freeze / Don't Freeze / Escalate). Every click logged.                                                                                               |
| **G5**  | Path immutability after sign-off                | ✅ Locked (v0.4) | Finalized paths are immutable. New facts spawn a new path version with a `supersedes` link to the prior one. Database constraint enforces. UI shows "Fork to revise," never "Edit."                                                                                                             |
| **G6**  | Proactive AI path suggestions                   | ✅ Locked (v0.4) | Suggestion Agent proposes the three highest-value evidentiary paths in a collapsible sidebar. Canvas stays clean until investigator promotes with a click. Critic Agent reviews every proposal.                                                                                                 |
| **G7**  | Cross-path math when paths share nodes          | ✅ Locked (v0.4) | Case-level math is canonical. Per-path views are projections. Variance disclosure renders prominently when sum-of-paths ≠ case total. Verifier Agent will not let a report through without it.                                                                                                  |
| **G8**  | Reseller economics with providers               | ⏳ Open          | Lean: vendor-neutral in v1; optional fully-disclosed revenue-share program in v2. Neutrality is part of the trust pitch.                                                                                                                                                                        |
| **G9**  | Pillar 3 scope expansion                        | ✅ Locked (v0.5) | BYOK Marketplace expanded to **BYOK Provider & Storage Marketplace**. Every external data source AND every storage backend is interchangeable. On-premises / classified deployments supported as first-class.                                                                                   |
| **G10** | Address-to-address vs transaction-centric graph | ✅ Locked (v0.5) | All graphs are transaction-centric. AddressNode and TransactionNode are both first-class. Every edge connects the two types. Transactions always render in the middle. Applied retroactively across earlier docs.                                                                               |
| **G11** | Path styling persistence                        | ✅ Locked (v0.5) | Name and color persist with TracePath; included in Reproducibility Pack; locked at finalization (G5); curated palette with semantic awareness; only one path per case can wear the "primary evidentiary" accent.                                                                                |
| **G12** | Wallet object scoping                           | ✅ Locked (v0.5) | A Wallet always belongs to exactly one case. If the same physical wallet is relevant to two cases, each case gets its own Wallet linked to the same source documents.                                                                                                                           |
| **G13** | Seed-phrase / private-key handling              | ✅ Locked (v0.5) | Used in memory to derive addresses, immediately discarded. No signing capability exposed. Audit log records use without storing the material. Default scan covers common derivation paths (BIP-44/49/84/86, Solana ed25519, Tron).                                                              |
| **G14** | Transaction Inspector persistence               | ✅ Locked (v0.5) | Default: ephemeral, cached 24h. Auto-save triggers when investigator takes any dependent action (mark, memo, path add, subpoena draft). Explicit save adds to Reproducibility Pack.                                                                                                             |
| **G15** | Cache scope hierarchy                           | ✅ Locked (v0.6) | Immutable chain data cached at `global_chain_data` scope (shared across all cases and agencies). Attribution data cached at `agency` scope. Case-specific computations cached at `case` scope. Per-user isolation for private personal attributions.                                            |
| **G16** | First-touch live-fetch rule                     | ✅ Locked (v0.6) | Live tracing of previously unsearched information always hits the API first. Caching is the result of the first call, not a precondition. Guarantees ground-truth on initial inspection, every time.                                                                                            |
| **G17** | Refresh UI                                      | ✅ Locked (v0.6) | Persistent refresh button at top of graph. Last-refreshed badge with color-coded freshness (green/yellow/orange/red). Scope dropdown (just this tx / selected / viewport / case). Real cost estimate computed against agency's pinned provider price sheet before the click.                    |
| **G18** | UTXO clustering as one-click                    | ✅ Locked (v0.6) | Right-click → "Cluster this address" runs full CIH + change detection + CoinJoin exclusion + recursive expansion. Cluster rendered as foldable group on canvas. Cluster Provenance Report as a default exhibit type. Investigator overrides (add/exclude/split/merge) are first-class.          |
| **G19** | Personal attribution as first-class             | ✅ Locked (v0.6) | Per-investigator persistent attributions that survive across all their cases. Four visibility tiers (private / specific users / team / org). Counter-attribution preserves disagreement honestly. Personal Attribution library is portable across agencies (subject to clearance restrictions). |
| **G20** | Caching as Pillar 3 sub-system                  | ✅ Locked (v0.6) | The cache layer is what makes BYOK economically viable at scale. Treated as a first-class architectural concern, not an optimization. Cost telemetry visible in the Provider Marketplace.                                                                                                       |

---

## The architectural pillars (locked through v0.6)

After all iterations, the platform stands on three pillars. Everything else hangs off these.

### Pillar 1 — The Belief State Service (accuracy)

Every claim the AI makes is a first-class object with provenance, derivation, confidence, tier (T0–T3), source provider, and challenge history. No agent has private knowledge; every agent reads from and writes to the shared belief state. This is what makes a 50-hop autonomous trace defensible.

### Pillar 2 — The Reproducibility Pack (court-defensibility)

Every report ships with a frozen snapshot — chain data, rule versions, attribution snapshots, tool log, model card, SBS history, presentation sequence, personal attributions at the time of report, and a `replay.sh` that reconstructs the entire trace. Opposing counsel re-runs it on their hardware; same inputs produce same outputs forever. This survives the D'Aloia-style mathematical audit.

### Pillar 3 — The BYOK Provider & Storage Marketplace (commercial leverage)

Every external data source AND every storage backend is interchangeable through a capability-based router. Agencies bring their own data licenses (Chainalysis, TRM, Elliptic, Etherscan, Allium, etc.) and their own infrastructure (AWS, on-prem MinIO, classified clusters). The **Cache Layer** (Feature 9) is what makes Pillar 3 economically viable at scale — first-touch live, subsequent reads from cache, manual refresh always one click away, real cost telemetry visible.

These three are the answer to "why does ChainSight exist when Chainalysis/TRM/Elliptic already do." Each addresses a real gap none of the incumbents solve well.

---

## The top-level product principle (locked v0.4, reinforced v0.5 and v0.6)

> **"So Easy a Caveman Can Do It" on the surface. Uncompromising sophistication beneath.**
>
> Every investigator interaction is one click, one keystroke, or one drag. Every interaction triggers Belief Atom writes, Math Service calls, Critic reviews, BYOK provider calls (or cache hits), and immutable audit logging. The investigator sees a responsive graph. The court sees a defensible record. The agency sees a tool their newest investigator can use on day one and their most senior expert can defend on the witness stand.

This is the design tiebreaker when any other principle conflicts.

---

## Feature catalog (locked through v0.6)

| #        | Feature                                                                                                         | Source doc          | Status                     |
| -------- | --------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------- |
| **F1**   | Case intake, manifest, IOC parsing                                                                              | v0.1 schema         | Locked                     |
| **F2**   | Time-frame + market-context snapshot at intake                                                                  | v0.1 schema         | Locked                     |
| **F3**   | Chain scope detection (auto-multi-chain for shared addresses)                                                   | v0.1 schema         | Locked                     |
| **F4**   | Tx volume + trace scope estimator (cost projection before run)                                                  | v0.1 schema         | Locked                     |
| **F5**   | Multi-chain visual trace (canvas v1)                                                                            | v0.1 schema         | Locked                     |
| **F6**   | Token swap decoding (Uniswap v2/v3/v4, Raydium, Jupiter, etc.)                                                  | v0.1 schema         | Locked                     |
| **F7**   | Bridge & cross-chain correlation (LayerZero, CCTP, Wormhole, etc.)                                              | v0.1 schema         | Locked                     |
| **F8**   | Multi-methodology accounting (FIFO / LIFO / HIFO / LIBR / pari passu / rolling charge)                          | v0.1 schema         | Locked                     |
| **F9**   | Attribution & OSINT layered sources                                                                             | v0.1 schema         | Locked                     |
| **F10**  | Collaboration & visualization (real-time CRDT canvas)                                                           | v0.1 schema         | Locked                     |
| **F11**  | Reporting templates (SAR, seizure affidavit, civil exhibit, expert declaration)                                 | v0.1 schema         | Locked                     |
| **F12**  | UTXO + account-model unified graphing                                                                           | v0.1 schema         | Locked (unified under G10) |
| **F13**  | Multi-methodology side-by-side comparison                                                                       | v0.1 schema         | Locked                     |
| **F14**  | Evidence storage with chain-of-custody                                                                          | v0.1 schema         | Locked                     |
| **B1**   | Structured Belief State Service                                                                                 | v0.2 accuracy spine | Locked                     |
| **B2**   | Tiered determinism (T0/T1/T2/T3)                                                                                | v0.2 accuracy spine | Locked                     |
| **B3**   | Reproducibility Packs                                                                                           | v0.2 accuracy spine | Locked                     |
| **B4**   | Confidence calculus + decay visualization                                                                       | v0.2 accuracy spine | Locked                     |
| **B5**   | Adversarial Critic Agent (parallel, not post-process)                                                           | v0.2 accuracy spine | Locked                     |
| **B6**   | Hallucination gates (citation tokens + Math Service + Verifier)                                                 | v0.2 accuracy spine | Locked                     |
| **B7**   | Ground Truth Flywheel + nightly regression CI                                                                   | v0.2 accuracy spine | Locked                     |
| **B8**   | Privacy, encryption, governance                                                                                 | v0.2 accuracy spine | Locked                     |
| **PSR**  | Path Selection → Report (click, lasso, auto-pathfind, NL)                                                       | v0.3 PSR            | Locked                     |
| **BYOK** | Provider Marketplace + Capability Router                                                                        | v0.3 BYOK           | Locked                     |
| **CAN**  | Canvas UX: marks, memos, icons, color discipline, value-split indicators, "Where did the money go?" overlay     | v0.4 canvas UX      | Locked                     |
| **KEY**  | API key entry (single, bulk paste, `.env` file drop)                                                            | v0.4 API key        | Locked                     |
| **F15**  | Deconfliction tab (manual + auto-detected + cross-agency federation)                                            | v0.5 main           | Locked                     |
| **F16**  | Document ingest with AI extraction + swappable storage backend                                                  | v0.5 main           | Locked                     |
| **F17**  | Present in Court mode (timeline, value-Sankey, path-playback, entity views) with accounting following the frame | v0.5 main           | Locked                     |
| **F18**  | Automatic obfuscation detection (11 patterns at launch)                                                         | v0.5 main           | Locked                     |
| **F19**  | Path styling (name + color + full-path highlight + curated palette)                                             | v0.5 addendum 2     | Locked                     |
| **F20**  | Transaction-centric graph (address → tx → address)                                                              | v0.5 addendum 2     | Locked (G10)               |
| **F21**  | Wallet History Analyzer (paste addresses or derive from seed; 3/5 hop default)                                  | v0.5 addendum 2     | Locked                     |
| **F22**  | Transaction Inspector ("Analyze this transaction" popup)                                                        | v0.5 addendum 3     | Locked                     |
| **F23**  | Cache layer (4 tiers + first-touch live + manual refresh + cost telemetry)                                      | v0.6                | Locked                     |
| **F24**  | One-push UTXO co-input + change clustering + Cluster Provenance Report                                          | v0.6                | Locked                     |
| **F25**  | Personal Attribution (per-user, persistent across cases, shareable)                                             | v0.6                | Locked                     |

---

## Updated build phasing (v0.6 final)

This phasing reflects everything in the feature catalog.

| Phase       | Months | Deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase 0** | 1      | Case model, intake, evidence vault; **Capability Router + Provider Marketplace stub**; **Belief State Service stub**; **Transaction-centric graph data layer (G10)**; **Cache layer foundation (immutable + global scope)**; **Personal Attribution data model + basic apply**; basic single-chain Ethereum trace; FIFO accounting; API key entry (all three modes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Phase 1** | 2–3    | Bitcoin UTXO engine; BSC/Base/Arb/Polygon/Tron; CCTP + LayerZero + Wormhole bridges; visual canvas v1; LIFO + LIBR; **full Math Service**; **Reproducibility Pack v1**; **Path styling (name + color + highlight)**; **Wallet data model + manual CRUD**; **UTXOCluster v1 (CIH + optimal-change)**; **Full cache tier system + refresh button + last-refresh badge**; deconfliction tab data model; CaseDocument data model + platform-managed storage; investigator markup system (Important / Memos / Icons / Tags)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Phase 2** | 4–6    | AI agent layer (orchestrator + tracer + bridge + swap + attribution + narrative + **critic in parallel** + Verifier); memory stack (Redis + pgvector + Zep); **PSR click-select + auto-pathfind + single-path reports**; **Suggestion Agent**; skill library; **Transaction Inspector** (plain-language summary, structured facts, decoded action, counterparty intel, case context, suggested actions); **Wallet History Analyzer** (full multi-chain history pull + per-address summaries + attribution pass + obfuscation pass + sub-graph rendering + Wallet History Analysis Report); **full UTXO clustering ensemble** (full change detection + CoinJoin exclusion + cluster rendering); **Refresh cost estimator with real price sheets**; **Document Extraction Agent (subpoena returns + bank statements first)**; on-prem storage backend (MinIO, NFS); manual deconfliction tab UI; **Obfuscation Detection v1** (peel chains, mixer entry/exit, basic chain hopping — rule-based); **Personal Attribution sharing with specific users + team + org**; Personal Attribution library view; **"Where did the money go?" overlay with real-time methodology switching**                                                            |
| **Phase 3** | 7–9    | Court-readiness; **PSR multi-path + observer-mode playback + NL-select**; **G7 case-level math + variance disclosure**; pari passu + rolling charge methodologies; **G5 path immutability enforced at DB layer**; **Present in Court Mode (all four views + accounting-follows-the-frame panel)**; **Court Export Bundle (portable viewer)**; Obfuscation Detection v2 (CoinJoin participation, token-swap obfuscation, layered split-and-merge); document types expansion (court orders, MLAT, victim statements); auto-detected deconfliction within agency tenant; **Inspector obfuscation + Critic sections; compare-two-transactions mode; saved-analysis persistence**; **seed-phrase / private-key derivation (warrant attestation flow)**; incremental wallet delta re-analysis; cross-wallet clustering across multiple wallets in same case; **ML-augmented change detection (T3) supplementing T1 rules**; **counter-attribution flow with Critic-mediated resolution**; **provider webhook-driven cache invalidation**; chain-reorg listeners; sanctions-list-driven invalidation; SOC2 work begins; **Obfuscation Detection v3** (smart-contract obfuscation, time-decay, bridge front-running — ML-based with Critic gating) |
| **Phase 4** | 10–12  | Watcher Agent + rule DSL; real-time CRDT canvas; collaboration on paths; **cross-agency deconfliction federation** (privacy-preserving); **cross-agency Personal Attribution federation** (consent-gated); audio transcription for suspect interviews; compliance handoff workflow; FedRAMP path opens; expanded Provider catalog (Phase-3+ integrations); **admin-level cache governance + retention policies**; advanced cluster analytics (cross-cluster relationship inference); long-running wallet watch mode (continuous monitoring after analysis); Inspector personalization (compact mode learned per investigator); voice-assistant integration for Court Mode                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Document index (the design pack)

Twelve documents, all in `/home/user/workspace/`, all shared:

1. **`chainsight_mindmap.md`** — Mermaid mind map of the 14 domains + AI + platform (v0.1)
2. **`chainsight_schema.md`** — Module-by-module spec with data models (v0.1)
3. **`chainsight_merged_v0_2.md`** — Accuracy spine (B1–B8) merged with the domain vision (v0.2)
4. **`chainsight_v0_3_addendum.md`** — PSR module + D1/D2 (v0.3)
5. **`chainsight_v0_3_byok_addendum.md`** — BYOK Provider Marketplace as Pillar 3 (v0.3)
6. **`chainsight_v0_4_consolidated.md`** — First consolidated reference, G5/G6/G7 locked (v0.4) — superseded by this file but preserved
7. **`chainsight_v0_4_canvas_ux_addendum.md`** — Investigator markup, value splits, iconography, color discipline (v0.4)
8. **`chainsight_v0_4_api_key_entry_addendum.md`** — Single / bulk-paste / `.env` file API key entry (v0.4)
9. **`chainsight_v0_5_addendum.md`** — Deconfliction, Document Ingest, Court Mode, Obfuscation Detection (v0.5)
10. **`chainsight_v0_5_addendum_2.md`** — Path styling, Transaction-centric graph (G10), Wallet History Analyzer (v0.5)
11. **`chainsight_v0_5_addendum_3.md`** — Transaction Inspector (v0.5)
12. **`chainsight_v0_6_addendum.md`** — Cache layer, UTXO clustering, Personal Attribution (v0.6)
13. **`chainsight_v0_6_consolidated.md`** _(this file)_ — v0.6 canonical reference

---

## What's still open

- **G2** — Public anchoring policy
- **G3** — Cross-agency learning consent model
- **G8** — Reseller economics with data providers

---

## Where to next

The three options that have stood since v0.4 still stand. With the design now this comprehensive, my read on them has shifted:

**Option A — Build-ready engineering spec.** The technical core has grown — it's now Tracer + Belief State + Pathfinder + Math Service + Inspector pipeline + Cache layer + Clustering engine. About a day and a half; ~50 pages of dense engineering spec ready for an engineering team. Still derisks the deepest technical bets.

**Option B — UI mockups.** Now covers eight distinct surfaces (canvas with markup, PSR selection, Court Mode, API key entry, Deconfliction tab, Wallet Analyzer, Transaction Inspector, Personal Attribution library). About a day; would produce wireframes plus an interactive prototype. Best artifact for pilot or stakeholder conversations.

**Option C — Go-to-market plan.** Pricing tiers (private PI / department / agency / classified); competitive positioning vs. Chainalysis/TRM/Elliptic/Crystal/Arkham/Merkle Science; pilot-customer profile; BYOK partnership outreach list; demo script with the Inspector and "Where did the money go?" overlay as the headline moments; sales objection-handling guide. About a day.

**Or continue adding features.** You know this domain better than the documents do. If there's a feature on your mind we haven't captured, this is the cheapest moment to capture it.

Pick one — or queue two in parallel.
