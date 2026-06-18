# ChainSight v0.8 — Consolidated Design

> v0.8 supersedes the v0.6 consolidated reference. It folds every decision and feature from v0.1 through v0.8 into one canonical index.
> All prior documents remain valid — this file points to them and reflects the cumulative state.

---

## The four pillars (locked through v0.8)

| # | Pillar | Guarantee |
|---|---|---|
| **1** | Belief State Service | Accuracy — every AI claim is provenanced, tiered, challengeable |
| **2** | Reproducibility Pack | Court-defensibility — every report replays bit-for-bit forever |
| **3** | BYOK Provider & Storage Marketplace + Cache + In-House Heuristics Tier | Commercial leverage — agencies use their existing data deals OR run with zero external dependencies |
| **4** | Sovereign Deployment (On-Prem + SaaS Blind) | Trust — agencies retain operational privacy regardless of deployment mode |

---

## The top-level product principle (unchanged since v0.4)

> **"So Easy a Caveman Can Do It" on the surface. Uncompromising sophistication beneath.**
>
> Every investigator interaction is one click, one keystroke, or one drag. Every interaction triggers Belief Atom writes, Math Service calls, Critic reviews, BYOK provider calls (or cache hits), chain-of-custody log entries, and immutable audit logging. The investigator sees a responsive graph. The court sees a defensible record. The agency sees a tool their newest investigator can use on day one and their most senior expert can defend on the witness stand.

This is the design tiebreaker when any other principle conflicts.

---

## Decision log

| ID | Topic | Status | Decision |
|---|---|---|---|
| **G1** | Autonomy line for AI attributions | ✅ Locked v0.3 | Human-in-the-loop required for any court-grade attribution; `signoff_id` mandatory at DB layer |
| **G2** | Public anchoring of reproducibility hashes | ⏳ Open | Default off; opt-in at case-close when going to court |
| **G3** | Cross-case learning consent model | ⏳ Open | DP-within-tenant default-on; cross-tenant opt-in with signed agreement |
| **G4** | Freeze decision UI | ✅ Locked v0.3 | One-pager; three buttons; every click logged |
| **G5** | Path immutability after sign-off | ✅ Locked v0.4 | Finalized paths immutable; new facts spawn `supersedes`-linked version |
| **G6** | Proactive AI path suggestions | ✅ Locked v0.4 | Suggestion Agent in collapsible sidebar; investigator promotes with click; Critic reviews every proposal |
| **G7** | Cross-path math | ✅ Locked v0.4 | Case-level math canonical; per-path views projections; variance disclosure mandatory |
| **G8** | Reseller economics | ⏳ Open | Vendor-neutral in v1; optional v2 revenue share with full disclosure |
| **G9** | Pillar 3 scope expansion | ✅ Locked v0.5 | BYOK includes data providers AND storage backends |
| **G10** | Transaction-centric graph | ✅ Locked v0.5 | All graphs are address→tx→address; transaction always in the middle |
| **G11** | Path styling persistence | ✅ Locked v0.5 | Name + color persist with TracePath; in Reproducibility Pack; locked at finalization |
| **G12** | Wallet object scoping | ✅ Locked v0.5 | One Wallet per case; same physical wallet can exist in multiple cases as separate objects |
| **G13** | Seed-phrase handling | ✅ Locked v0.5 | In-memory only; immediately discarded; no signing capability exposed; audit log records use |
| **G14** | Transaction Inspector persistence | ✅ Locked v0.5 | Ephemeral default; auto-save on dependent action; explicit save to Reproducibility Pack |
| **G15** | Cache scope hierarchy | ✅ Locked v0.6 | Immutable: global; Attribution: agency; Computations: case; with per-user isolation for private attributions |
| **G16** | First-touch live-fetch rule | ✅ Locked v0.6 | Live API on first touch; cache for subsequent reads; manual refresh always available |
| **G17** | Refresh UI | ✅ Locked v0.6 | Persistent button; color-coded freshness badge; scope dropdown; real cost estimate before click |
| **G18** | UTXO clustering as one-click | ✅ Locked v0.6 | Full CIH + change detection + CoinJoin exclusion + recursive expansion; Cluster Provenance Report exhibit type |
| **G19** | Personal attribution as first-class | ✅ Locked v0.6 | Per-investigator persistent; four visibility tiers; counter-attribution preserves disagreement; portable across agencies |
| **G20** | Caching as Pillar 3 sub-system | ✅ Locked v0.6 | First-class architectural concern; what makes BYOK economically viable |
| **G21** | Air-gapped update path | ⏳ Open | Likely both physical media and one-way diode; confirm with first pilot |
| **G22** | Confidential computing for SaaS Blind v1 | ⏳ Open | Lean: envelope encryption + audited support as v1 floor; confidential computing in Phase 3 |
| **G23** | Verifiable build infrastructure | ⏳ Open | Lean: Sigstore from start |

---

## Feature catalog (locked through v0.8)

| ID | Feature | Source | Phase |
|---|---|---|---|
| **F1** | Case intake, manifest, IOC parsing | v0.1 | 0 |
| **F2** | Time-frame + market-context snapshot | v0.1 | 0 |
| **F3** | Chain scope detection (auto-multi-chain) | v0.1 | 0 |
| **F4** | Tx volume + trace scope estimator | v0.1 | 0 |
| **F5** | Multi-chain visual trace (canvas v1) | v0.1 | 1 |
| **F6** | Token swap decoding | v0.1 | 1 |
| **F7** | Bridge & cross-chain correlation | v0.1 | 1 |
| **F8** | Multi-methodology accounting | v0.1 | 1 |
| **F9** | Attribution & OSINT layered sources | v0.1 | 1 |
| **F10** | Collaboration & visualization | v0.1 | 2 |
| **F11** | Reporting templates | v0.1 | 2 |
| **F12** | UTXO + account-model unified graphing | v0.1 → G10 | 0 |
| **F13** | Multi-methodology side-by-side comparison | v0.1 | 2 |
| **F14** | Evidence storage with chain-of-custody | v0.1 → F29 | 0 |
| **B1** | Structured Belief State Service | v0.2 | 0 |
| **B2** | Tiered determinism (T0-T3) | v0.2 | 0 |
| **B3** | Reproducibility Packs | v0.2 | 1 |
| **B4** | Confidence calculus + decay visualization | v0.2 | 1 |
| **B5** | Adversarial Critic Agent | v0.2 | 2 |
| **B6** | Hallucination gates + Math Service + Verifier | v0.2 | 2 |
| **B7** | Ground Truth Flywheel + regression CI | v0.2 | 2 |
| **B8** | Privacy, encryption, governance | v0.2 | 0 |
| **PSR** | Path Selection → Report | v0.3 | 2 |
| **BYOK** | Provider Marketplace + Capability Router | v0.3 | 0 |
| **CAN** | Canvas UX (marks, memos, icons, color, value-split, "Where did the money go?" overlay) | v0.4 | 1-2 |
| **KEY** | API key entry (single / bulk / .env file) | v0.4 | 0 |
| **F15** | Deconfliction tab | v0.5 | 1-3 |
| **F16** | Document ingest + swappable storage | v0.5 | 1-2 |
| **F17** | Present in Court mode | v0.5 | 3 |
| **F18** | Automatic obfuscation detection | v0.5 | 2-3 |
| **F19** | Path styling | v0.5 | 1 |
| **F20** | Transaction-centric graph (G10) | v0.5 | 0 |
| **F21** | Wallet History Analyzer | v0.5 | 2 |
| **F22** | Transaction Inspector | v0.5 | 2 |
| **F23** | Cache layer | v0.6 | 0-1 |
| **F24** | UTXO co-input + change clustering | v0.6 | 1-2 |
| **F25** | Personal Attribution | v0.6 | 0-2 |
| **DEP** | Dual deployment (On-Prem + SaaS Blind) | v0.7 | 0 |
| **F26** | Expert Witness Profile | v0.8 | 0 |
| **F27** | Supervisor Mode | v0.8 | 1 |
| **F28** | Case Transfer / Handoff Workflow | v0.8 | 2 |
| **F29** | Chain of Custody as first-class system | v0.8 | 0 |
| **F30** | Mobile & field workflow (read-only, Court Mode driver, IOC capture) | v0.8 | 1-2 |
| **F31** | Training & Sandbox Environment | v0.8 | 1 |
| **F32** | Retraction Workflow | v0.8 | 2 |
| **F33** | Stablecoin Freeze + Burn + Reissue Workflow | v0.8 | 1 |
| **F34** | L2 / ZK Rollup Tooling Foundations | v0.8 | 0-1 |
| **F35** | Privacy-Coin Boundary Handlers | v0.8 | 2 |
| **F36** | DeFi Exploit Forensics | v0.8 | 2 |
| **F37** | NFT, Ordinals, Runes Tracing | v0.8 | 2-3 |
| **F38** | Lightning Network Awareness | v0.8 | 3 |
| **F39** | Emerging Asset Roadmap (track only) | v0.8 | Post-4 |
| **F40** | Dependency-Risk and In-House Heuristics Tier | v0.8 | 1 |
| **F41** | Bias, Fairness, and Civil-Rights Architecture | v0.8 | 0 commitments / 2 CLRB / 3 audit |
| **F42** | Certification and Accreditation Roadmap | v0.8 | 0 milestones / phased delivery |
| **F43** | Insurance, Liability, and Legal Architecture | v0.8 | 0 |
| **F44** | End-of-Life and Data Portability Guarantees | v0.8 | 0 documented / 2 escrow program |
| **F45** | Community, Network Effects, Sustainability | v0.8 | 2-4 |
| **F46** | Pricing and Packaging Framework | v0.8 | 0 framework / GTM finalizes pricing |
| **F47** | Localization and Internationalization Foundations | v0.8 | 0 arch / 4 full expansion |

**Sixty-one locked features.** Plus the dual deployment model and the anti-feature commitments below.

---

## Anti-feature commitments (locked v0.8)

Things ChainSight will deliberately **not** ship. In writing. In the MSA. In the CI test suite:

- No predictive policing
- No generative attack-pattern speculation
- No demographic correlation
- No mass surveillance modes
- No untargeted dragnet features
- No crypto trading or personal-portfolio features
- No vendor-managed key escrow
- No silent telemetry
- No vendor-as-broker for customer data (v1)
- No "trust us" privacy claims

---

## Build phasing (v0.8 final — six tiers)

| Phase | Months | Theme |
|---|---|---|
| **Phase 0** | 1-2 | Foundations + sovereignty + first-class chain-of-custody + bias/legal/cert commitments |
| **Phase 1** | 3-4 | Multi-chain + L2s + Math Service + canvas v1 + stablecoin workflow + supervisor mode + in-house heuristics + cache + training |
| **Phase 2** | 5-7 | AI agent layer + PSR + Inspector + Wallet Analyzer + privacy-coin handlers + DeFi forensics + NFT basics + retraction + handoff + SOC 2 Type 1 + CLRB |
| **Phase 3** | 8-10 | Court mode + multi-path + ML detectors + confidential computing + SOC 2 Type 2 + ISO 27001 + CJIS + FedRAMP Moderate begun |
| **Phase 4** | 11-14 | Federation + watchers + collaboration + FedRAMP Moderate + CMMC L2 + international expansion + community |
| **Post-4** | 15+ | FedRAMP High + IL5/IL6 + CMMC L3 + emerging assets |

Sixteen months from kickoff to FedRAMP-Moderate-ready commercial product. Federal-government-ready posture from Phase 0.

---

## Document index

Sixteen documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md` — Mind map (v0.1)
2. `chainsight_schema.md` — Module spec (v0.1)
3. `chainsight_merged_v0_2.md` — Accuracy spine (v0.2)
4. `chainsight_v0_3_addendum.md` — PSR (v0.3)
5. `chainsight_v0_3_byok_addendum.md` — BYOK Marketplace (v0.3)
6. `chainsight_v0_4_consolidated.md` — G5/G6/G7 locked (v0.4, superseded by v0.8)
7. `chainsight_v0_4_canvas_ux_addendum.md` — Canvas markup (v0.4)
8. `chainsight_v0_4_api_key_entry_addendum.md` — API key UX (v0.4)
9. `chainsight_v0_5_addendum.md` — Deconfliction, docs, court, obfuscation (v0.5)
10. `chainsight_v0_5_addendum_2.md` — Path styling, transaction-centric, wallet analyzer (v0.5)
11. `chainsight_v0_5_addendum_3.md` — Transaction Inspector (v0.5)
12. `chainsight_v0_6_addendum.md` — Cache, UTXO clustering, personal attribution (v0.6)
13. `chainsight_v0_6_consolidated.md` — Consolidated through v0.6 (superseded by v0.8)
14. `chainsight_v0_7_deployment_model_addendum.md` — Sovereign + SaaS Blind (v0.7)
15. `chainsight_v0_7_gap_analysis.md` — Gap analysis (v0.7)
16. `chainsight_v0_8_addendum.md` — Gap incorporation, 22 new features, anti-feature commitments (v0.8)
17. `chainsight_v0_8_consolidated.md` *(this file)* — v0.8 canonical reference

---

## What's still open

| ID | Topic |
|---|---|
| G2 | Public anchoring policy |
| G3 | Cross-agency learning consent model |
| G8 | Reseller economics |
| G21 | Air-gapped update path (physical media vs. diode) |
| G22 | Confidential computing as v1 floor vs Phase 3 |
| G23 | Verifiable build infrastructure (Sigstore confirmation) |

None block Phase 0. All are decidable at the moment of first pilot engagement.

---

## What to do next

Five paths, in roughly increasing complexity. All are now realistic given the state of the design:

**Path A — Build-ready engineering spec for the technical core.**
Tracer + Belief State + Pathfinder + Math Service + Inspector pipeline + Cache layer + Clustering engine + Capability Router. About a day and a half; ~50-60 pages of dense spec. Derisks the technical centerpiece. The right move if engineering will start soon.

**Path B — UI mockups for the eight surfaces.**
Canvas with markup, PSR selection, Court Mode, API key entry, Deconfliction tab, Wallet Analyzer, Transaction Inspector, Personal Attribution library, Supervisor Dashboard. About a day; wireframes plus optional interactive prototype. The right move if you're heading toward pilot conversations.

**Path C — Go-to-market plan.**
Pricing tiers (now informed by F46 packaging framework); positioning vs. Chainalysis/TRM/Elliptic/Crystal; sovereign-deployment differentiation; pilot-customer profile; BYOK partnership outreach; demo script; sales objection-handling. About a day. The right move if you're heading toward fundraising or sales.

**Path D — Pilot-customer search.**
The design is comprehensive enough to start qualifying real pilot candidates. Probably 2-3 candidates: a state-level financial crime unit, a federal field office that's frustrated with current tools, and a private compliance team. Outreach materials + qualification questions + pilot-engagement-letter template.

**Path E — Founding team and capitalization plan.**
This design as documented requires a team. Working backwards from the build phasing: at least one senior product engineer who's built investigation tools before, one ML/AI lead, one platform/security engineer who understands sovereign deployment, one frontend/UX lead, one founding-engineer-flex who can do BYOK connectors + Math Service work. Plus a domain advisor (a retired federal LE investigator or a current expert witness). Capitalization plan and runway estimate to get to Phase 2 launch.

My recommendation has stabilized: **start with Path B (UI mockups)** because they crystallize the product story for every other path. A and C and D all become better with mockups in hand. E becomes possible with mockups because the visual artifact is what compels the founding team.

But you know your situation better than the documents do. What's next?
