# ChainSight v0.8 — Gap Incorporation

> This addendum closes the gaps surfaced in the v0.7 gap analysis. It is organized to mirror that analysis: operational gaps, domain gaps, and business/lifecycle gaps.
>
> Eight items are locked as **Phase 0 / pre-code** requirements. The rest are placed into the right phase with explicit design commitments.
>
> This addendum extends every prior document. Where a prior decision is being revised or expanded, the prior position is referenced explicitly.

---

## Part 1 — Operational additions

### F26 — Expert Witness Profile

A first-class module attached to each investigator who serves as an expert witness.

```typescript
ExpertWitnessProfile {
  id: uuid
  investigator_id: investigator_id
  display_name: string
  current_title: string
  agency_id: uuid

  qualifications: Qualification[]    // degrees, certifications, training
  certifications: Certification[]     // CCI, CCFC, Chainalysis Reactor cert, TRM cert, etc.
  publications: Publication[]
  prior_testimony: PriorTestimony[]   // every case they've testified in
  daubert_history: DaubertEvent[]     // any prior challenges to their admissibility

  methodology_preferences: {
    preferred_methodologies: enum[]   // FIFO | LIFO | LIBR | pari_passu | rolling_charge | spec_id
    rationale_per_methodology: text
    default_confidence_threshold: float
    custom_report_template_refs: TemplateRef[]
  }

  cv_pdf: DocumentRef                 // auto-attached to expert declarations
  cv_last_updated_at: timestamp
  visibility: enum                    // private | team | agency_wide

  cross_exam_prep_library: CrossExamEntry[]   // anticipated questions + prepared answers
}

PriorTestimony {
  case_id_external: string             // not necessarily a ChainSight case
  court: string
  jurisdiction: string
  date: date
  capacity: enum                       // expert_witness | fact_witness | lay_witness
  methodologies_used: string[]
  outcome: enum                        // admitted | excluded_daubert | settled_pre_testimony | withdrawn
  notes: text
  is_public_record: bool
}
```

What it does for the platform:

- **Auto-attaches the expert's CV** to any expert declaration report they author
- **Pre-populates methodology defaults** when this investigator opens a new case (they prefer LIBR; the platform applies LIBR-first defaults; case-level overrides still possible)
- **Tracks Daubert history** — when defense counsel asks "have you ever been excluded?" the expert has an instant authoritative answer
- **Cross-exam prep library** — a per-methodology library of likely questions and prepared responses, editable by the expert, citing the platform's methodology disclosure boilerplate
- **Certification tracking** — when an expert's Chainalysis Reactor cert is approaching expiration, the platform reminds them; expired certs are flagged on declarations

Integration with locked features:

- **Reports**: expert declaration template now requires an ExpertWitnessProfile reference; the CV and qualifications section auto-populates
- **Court Mode**: the presenter's view shows their own profile data so they can answer qualifications questions without breaking from the presentation
- **Belief State (Pillar 1)**: court-grade BeliefAtoms record which expert signed off; the expert's profile is part of the provenance chain

**Build phase: Phase 0** — small effort, high credibility impact for the LE and private-investigator markets.

### F27 — Supervisor Mode

A workflow layer for the chain of command above the line investigator.

```typescript
SupervisoryRole {
  id: uuid
  investigator_id: investigator_id
  scope: enum                          // team | squad | division | agency
  scope_ref: uuid
  permissions: SupervisoryPermission[]
}

SupervisoryPermission {
  permission: enum                     // view_active_cases | view_caseload_metrics |
                                       // approve_freeze | approve_seizure |
                                       // approve_expert_declaration | reassign_case |
                                       // close_case | audit_actions
  scope: enum                          // all_in_scope | specific_cases | specific_investigators
}

ReviewCheckpoint {
  id: uuid
  case_id: uuid
  checkpoint_type: enum                // initial_intake | tracing_complete | report_draft |
                                       // pre_freeze | pre_seizure | pre_court | case_close
  required_approvers: SupervisoryRole[]
  status: enum                         // pending | in_review | approved | sent_back | escalated
  reviewer_comments: ReviewerComment[]
  approved_by: investigator_id | null
  approved_at: timestamp | null
}
```

What supervisors see:

**Supervisor Dashboard**
- All active cases in span of control with risk-tier indicators (sanctions exposure, freeze opportunities open, SLA clocks, dormant >N days)
- Caseload balancing — who's overloaded, who has capacity
- Pending reviews — checkpoints waiting for the supervisor's approval
- Cross-case patterns — addresses appearing in multiple subordinates' cases (deconfliction prompts at the supervisor level)

**Review sidebar (non-destructive)**
- Supervisor can comment on any belief atom, mark, path, or report draft without polluting the working case
- Comments visible to the line investigator with thread structure
- Supervisor can issue "send back" decisions with required-rework notes
- "Approve" decisions promote checkpoints; "Escalate" routes to the next level

**Sign-off workflows for high-impact actions**
- Freeze request (already a one-pager in v0.3 G4) gains an optional "supervisor approval required" gate — agency configures which actions need which level of approval
- Seizure recommendation always requires supervisor approval
- Expert declaration requires supervisor approval before the report is finalized for court

**Build phase: Phase 1** — without it, the platform sells one investigator at a time, not one agency at a time.

### F28 — Case Transfer / Handoff Workflow

```typescript
CaseTransfer {
  id: uuid
  case_id: uuid
  initiated_by: investigator_id
  transfer_type: enum                  // internal_reassignment | cross_team |
                                       // cross_agency | retirement_handoff | tdy_temporary
  from_investigator: investigator_id
  to_investigator: investigator_id
  effective_date: timestamp

  handoff_artifacts: HandoffArtifact[]
  open_threads: OpenThread[]           // pending subpoenas, pending MLATs,
                                       // outstanding promises to other investigators,
                                       // scheduled court dates
  cooperating_investigators: CooperatingRef[]   // pulled from Deconfliction tab

  knowledge_transfer_doc: DocumentRef  // auto-generated transfer briefing
  acknowledged_by_recipient: bool
  acknowledged_at: timestamp | null

  audit_trail: EventLog[]
  approval_status: enum                // pending | approved | denied
  approved_by: SupervisoryRole | null
}

HandoffArtifact {
  type: enum                           // case_summary | trace_summary | suspect_summary |
                                       // pending_actions | relationships | classification_notes
  content_ref: DocumentRef
  auto_generated: bool
  reviewed_by_outgoing: bool
}
```

What happens at handoff:

1. **Auto-generated transfer briefing** — Narrative Agent produces a structured handoff doc (status summary, what's been done, what's open, who to call, what's next), Verifier-gated
2. **Continuity of audit trail** — every prior investigator's contributions remain attributed; the new investigator's work builds on top with no rewriting of history
3. **Notification cascade** — cooperating investigators on the Deconfliction tab are notified of the handoff with the new lead's contact info
4. **Pending actions inheritance** — open subpoenas, MLATs, scheduled court dates all transfer to the new lead's task queue
5. **Cross-agency variant** — when transferring to another ChainSight tenant, the case exports as a Reproducibility Pack with consent confirmation and MOU citation; the new agency imports and the case continues with full chain-of-custody preservation

**Build phase: Phase 2.** Not critical for v1 (can be done manually) but a frequent ask once the platform is used by real teams.

### F29 — Chain of Custody as a First-Class System

Promoting chain-of-custody from "implicit in audit trail" to first-class.

```typescript
ChainOfCustodyRecord {
  id: uuid
  case_id: uuid
  artifact_ref: ArtifactRef            // any evidence: document, wallet, report, belief_atom,
                                       // trace_path, finding, transaction_analysis
  artifact_content_hash: sha256

  events: CustodyEvent[]
  current_custodian: investigator_id | system_actor
  classification: enum                 // unclassified | LES | confidential | classified

  // tamper-evident chain
  prior_record_hash: sha256 | null     // hash-chained to the previous CoC event
  this_record_hash: sha256
  timestamping: TimestampRef | null    // optional cryptographic timestamp (RFC 3161 or
                                       // public-chain anchor per G2)
}

CustodyEvent {
  event_type: enum                     // collected | viewed | exported | printed | shared |
                                       // signed | modified | sealed | unsealed | destroyed |
                                       // produced_in_discovery
  actor: investigator_id | system_actor
  timestamp: timestamp
  authority: enum                      // warrant | subpoena | court_order | mlat |
                                       // voluntary | internal_authority | none
  authority_ref: DocumentRef | null
  rationale: text
  recipient: actor_id | null           // for shares/exports
  hash_at_event: sha256                // hash of the artifact at this event
}
```

What this changes:

- **Every** view, export, print, share, or modification of evidence is logged to the CoC chain — not just to the audit trail
- **Hash-chained** so any tampering is detectable (any modification to a prior event invalidates every subsequent event's hash)
- **Optional cryptographic timestamping** (RFC 3161 TSA, or G2 public-chain anchoring at case-close)
- **Court-ready chain-of-custody report** as a standard exhibit type — produced at one click, includes every event with its actor, authority, rationale, and hash
- **Barcode-able evidence labels** for physical evidence integration (when an investigator prints a screenshot for the physical case file, the printout carries a QR code that points back to the CoC record)
- **Discovery production** — when evidence is produced to opposing counsel, the production event is logged with the recipient identified; the platform produces a discovery manifest

**Build phase: Phase 0** — too painful to retrofit. The cost of adding it now is small; the cost of bolting it on later is enormous.

### F30 — Mobile & Field Workflow

Three distinct mobile surfaces, prioritized:

**F30a — Mobile read-only case viewer (Phase 1)**
- Responsive design (web-based, no separate app required for v1)
- Read-only access to case data, marks, memos, paths, reports
- Push notifications for watchers and deconfliction alerts
- Lock-screen-friendly: investigators glance, don't type

**F30b — Mobile Court Mode driver (Phase 1)**
- The investigator's tablet drives the courtroom display
- All hot keys mapped to touch gestures
- Optimized for one-handed operation while standing at counsel table
- Frozen Reproducibility Pack means no network calls required (consistent with v0.5 F3)

**F30c — Field IOC capture (Phase 2)**
- At a search warrant execution, investigator photographs a written wallet address on a sticky note or whiteboard
- App OCR extracts the address, validates checksums, normalizes
- One-tap "add to case as IOC"
- Pre-shoot wallet QR codes scan natively into the case
- Geo-tag and timestamp the capture event (with consent for the chain-of-custody log)

**Never: full mobile authoring.** Court-defensible work on a phone keyboard is asking for trouble. Read, view, present, capture IOCs — yes. Write reports, finalize paths, sign declarations — desktop only.

### F31 — Training & Sandbox Environment

```typescript
SandboxTenant {
  id: uuid
  parent_agency_id: uuid               // production tenant this sandbox is attached to
  type: enum                           // training | demo | red_team | research
  seeded_datasets: SeededDataset[]
  isolated_from_production: bool       // always true; no data leakage
  storage_backend: StorageBackendRef
  permitted_users: investigator_id[]
}

SeededDataset {
  id: string                           // "bybit_2025_hack" | "ronin_bridge_2022" |
                                       // "mt_gox_cold_storage_trace" | "tornado_2024_sanctions"
  display_name: string
  description: text
  ground_truth_outcome: text           // documented historical resolution
  difficulty_level: enum               // intro | intermediate | advanced | expert
  expected_completion_time: duration
  required_features: FeatureRef[]      // platform features the dataset exercises
}

TutorialWalkthrough {
  id: string
  display_name: string
  topics_covered: FeatureRef[]
  steps: TutorialStep[]
  estimated_duration: duration
}

Certification {
  id: uuid
  awarded_to: investigator_id
  certification_name: string           // "ChainSight Investigator — Foundation"
  cases_completed: CaseRef[]
  quiz_score: float
  awarded_at: timestamp
  signed_by_agency_admin: investigator_id
  expires_at: timestamp                // typically 2 years
  renewal_path: text
}
```

What's in the box at launch:

- **Seeded canonical cases** — every major documented incident with public post-mortem becomes a training case: Bybit, Ronin, Mt. Gox cold-storage trace, Wormhole, Nomad, Poly Network, FTX, the Bitfinex 2016 hack and recovery, Tornado Cash sanctions cases, the Sky Mavis recovery
- **Progressive tutorials** — start with single-chain Bitcoin tracing, progress through cross-chain, then DeFi exploits, then privacy-coin boundaries
- **Quiz and certification mode** — agency can issue ChainSight Investigator Certifications signed by the agency admin
- **Sandbox tenant** strictly isolated from production — no leakage of seeded data into real cases, no leakage of real data into training

This is also how the platform amplifies its reach. Agencies will use ChainSight for internal training even when they're using other tools for casework — which is how ChainSight wins the seat. Phase 1 essential.

### F32 — Retraction Workflow

The graceful "I made a mistake" story that respects G5 path immutability.

```typescript
Retraction {
  id: uuid
  retracted_artifact: BeliefAtomId | TracePathId | AttributionId | MarkId
  retracted_by: investigator_id
  retracted_at: timestamp
  rationale: text
  supporting_evidence: EvidenceRef[]
  cascading_impact: CascadeAnalysis    // what downstream findings are affected

  supersedes_link: BeliefAtomId | TracePathId | null   // optional pointer to corrected version
  notification_recipients: investigator_id[]            // who needs to be told
  notification_status: enum            // pending | sent | acknowledged

  // for court-grade retractions
  supplemental_report_id: ReportId | null
  court_notification_required: bool
  court_notification_status: enum | null
}

CascadeAnalysis {
  affected_belief_atoms: BeliefAtomId[]
  affected_paths: TracePathId[]
  affected_reports: ReportId[]
  affected_external_actions: enum[]    // freeze_requests | subpoenas | court_filings
  remediation_recommendations: text
}
```

How retraction works:

1. Investigator decides an attribution, path, or finding was wrong
2. Right-click → "Retract this finding"
3. **Cascading impact analysis** runs immediately — which downstream BeliefAtoms, paths, reports, and external actions depend on the artifact being retracted?
4. Critic Agent reviews the retraction and the cascade
5. If the artifact was court-grade or referenced in a finalized report, a **supplemental report** is required — drafted by the Narrative Agent, gated by the Verifier, preserves the prior record but documents the correction
6. **Notification cascade** to anyone who relied on the original finding (cooperating investigators on the Deconfliction tab, attribution recipients on Personal Attribution shares, etc.)
7. The retraction is recorded as a first-class event in the audit log and the CoC record
8. The original artifact remains visible, but marked as **retracted** with a forward link to the retraction event

Crucially: **retraction does not delete**. Evidence integrity (G5) requires that the original record persist. The retraction is an additive event — "this was believed at the time; here is why it is no longer believed."

**Build phase: Phase 2.** Without this workflow, investigators won't trust the platform with mistakes that real casework inevitably produces.

---

## Part 2 — Domain additions

### F33 — Stablecoin Freeze, Burn, and Reissue Workflow

The single most important Phase-0 addition from the gap analysis. Stablecoin freezes are now routine in 2026 casework.

```typescript
StablecoinFreezeRequest {
  id: uuid
  case_id: uuid
  target_address: AddressRef
  target_chain: string
  stablecoin: enum                     // USDT | USDC | DAI | FDUSD | PYUSD | TUSD | etc.
  issuer: enum                         // tether | circle | makerdao | first_digital | paxos
  requested_amount: Decimal            // may be "freeze the entire balance"
  basis: enum                          // court_order | law_enforcement_request |
                                       // sanctions_compliance | exploit_response
  authority_doc: DocumentRef           // the warrant/order/request
  requesting_jurisdiction: string
  requesting_investigator: investigator_id
  supervisor_approval_id: SignoffId    // mandatory per F27

  evidence_package: EvidencePackage    // chain-of-custody trace, attribution report,
                                       // fund-flow diagram, methodology disclosure
  status: enum                         // drafted | submitted | acknowledged |
                                       // frozen | denied | partial
  submitted_at: timestamp | null
  issuer_acknowledgment: text | null
  freeze_confirmed_at: timestamp | null
  freeze_tx_hash: TxRef | null         // the on-chain blacklist transaction
}

StablecoinBurn {
  id: uuid
  freeze_request_id: uuid
  burn_tx_hash: TxRef
  burned_amount: Decimal
  burned_at: timestamp
  destination_for_reissue: AddressRef  // LE-controlled address
}

StablecoinReissue {
  id: uuid
  burn_ref: StablecoinBurn
  reissue_tx_hash: TxRef
  reissued_amount: Decimal
  reissue_recipient: AddressRef        // LE-controlled or victim restitution address
  reissued_at: timestamp
}

VictimRestitution {
  id: uuid
  case_id: uuid
  recovery_source: enum                // stablecoin_reissue | exchange_freeze |
                                       // wallet_seizure | civil_recovery
  total_recovered: Decimal
  distribution_methodology: enum       // pro_rata | tracing_based | statutory_order |
                                       // first_in_first_out_victims
  victim_claims: VictimClaim[]
  distribution_complete: bool
  distribution_audit_doc: DocumentRef
}
```

The full lifecycle the platform supports:

1. **Freeze opportunity detected** — Watcher Agent or Inspector identifies that traced funds are now at a freezable stablecoin address
2. **Freeze package auto-drafted** — investigator clicks "Request freeze"; the platform generates the structured evidence package (chain-of-custody trace, address attribution report, methodology disclosure, fund-flow diagram) tailored to the issuer's documented requirements
3. **Supervisor approval** (F27) before submission
4. **Submission** through issuer-specific BYOK integrations — Tether's blacklist API, Circle's freeze workflow, Paxos, etc.
5. **Status tracking** — submitted → acknowledged → frozen, with timestamps and any issuer correspondence
6. **Burn detection** — when the issuer burns the frozen tokens (Tether's destroy function, Circle's blacklist+burn pattern), the platform automatically detects via on-chain monitoring and links the burn event to the original freeze request
7. **Reissue tracking** — when issuer mints replacement tokens to LE-controlled or victim-controlled wallets, the platform detects the mint, links it to the burn, and updates the case
8. **Victim restitution accounting** — when recovery exists, the platform computes distribution under the selected methodology (pro rata across victim claims, tracing-based attribution to specific victim deposits, statutory order, etc.) and produces a distribution audit document

Issuer integrations as BYOK capabilities:

| Issuer | Capability |
|---|---|
| Tether | Blacklist API; freeze + destroy + reissue via Tether ops |
| Circle | Blacklist API; freeze + burn + reissue workflow |
| Paxos (USDP, USDG) | Freeze + burn workflow |
| First Digital (FDUSD) | Freeze + burn workflow |
| PayPal (PYUSD) | Freeze workflow |
| TrueUSD | Freeze workflow |
| MakerDAO (DAI) | Limited — only sanctions-list-based blocks via Circle USDC backing |
| GENIUS Act-conforming issuers | Statutory freeze workflow |

**Build phase: Phase 1** — this is one of the highest-frequency investigator workflows in 2026.

### F34 — L2 / ZK Rollup Tooling Foundations

```typescript
RollupContext {
  chain_id: string
  rollup_type: enum                    // optimistic | zk_validity | validium | sovereign
  parent_l1: string                    // typically "ethereum"
  sequencer: SequencerInfo
  prover_network: ProverInfo | null    // for ZK rollups
  data_availability: enum              // l1_calldata | l1_blobs | external_da |
                                       // off_chain_committee
  withdrawal_delay: duration
  forced_inclusion_supported: bool
  l2beat_stage: enum                   // stage_0 | stage_1 | stage_2 | not_assessed
  finality_model: enum                 // probabilistic | deterministic | hybrid
}

L1ToL2Batch {
  l1_chain_id: string
  l1_block_height: int
  l1_tx_hash: TxRef                    // the batch-posting tx on L1
  l1_batch_data_hash: sha256
  l2_chain_id: string
  l2_first_tx: TxRef
  l2_last_tx: TxRef
  l2_tx_count: int
  proof_type: enum                     // fraud_proof | validity_proof | none
  proof_status: enum                   // pending | submitted | finalized | challenged
}

ForcedInclusion {
  l2_chain_id: string
  initiated_via_l1_tx: TxRef           // the L1 forced-inclusion tx
  l2_tx_included: TxRef
  inclusion_delay: duration
  rationale: text                      // typically "sequencer censorship"
}
```

What the foundation provides:

- **L2s as first-class chains** in the chain registry — not "Ethereum but smaller," distinct sequencer/prover/finality contexts
- **L1-batch-to-L2-tx correlation** — when investigating an L2 transaction, the platform identifies which L1 batch posted it, the batch's status (pending / proven / finalized), and the L1 tx hash of the posting
- **Sequencer awareness** — every L2 tx has a sequencer-of-record; investigators see who ordered it and what censorship-resistance properties apply
- **Withdrawal-delay timeline visualization** — for optimistic rollups, the 7-day withdrawal window appears on the timeline view; for ZK rollups, the near-instant finality is shown
- **Forced-inclusion detection** — when a tx was forced onto L2 via L1, the platform marks it (rare but evidentially significant — typically used when sequencers are non-cooperative)
- **Privacy-L3 boundary detection** — analogous to privacy-coin boundary; the platform marks the boundary and routes follow-up to specialist workflows

L2s covered at Phase 1 launch: Base, Arbitrum (One and Nova), Optimism, Polygon (PoS and zkEVM), zkSync Era, Starknet, Scroll, Linea, Mode, Blast, Mantle, Optimism Superchain ecosystem. Phase 2: Cosmos rollups (dYdX, Berachain), Bitcoin L2s (Stacks, BoB, Citrea), specialized rollups (Eclipse, Hyperliquid).

**Build phase: Phase 0 architecture foundations, Phase 1 first L2s wired, Phase 2 deeper L2-specific tooling.**

### F35 — Privacy-Coin Boundary Handlers

```typescript
PrivacyChainBoundary {
  chain: string                        // "monero" | "zcash" | "aleo" | "iron_fish"
  boundary_type: enum                  // mandatory_privacy (XMR, Aleo) |
                                       // optional_privacy (ZEC, BCH CashFusion) |
                                       // mixer (Tornado, Sinbad) |
                                       // zkrollup_privacy (Aztec, Penumbra, Railway)
  investigative_options: InvestigativeOption[]
}

InvestigativeOption {
  option: enum                         // viewing_key_compelled |
                                       // timing_correlation |
                                       // amount_correlation |
                                       // exchange_endpoints |
                                       // atomic_swap_detection |
                                       // dust_analysis
  applicability_conditions: text
  expected_confidence: ConfidenceRange
}

ZcashViewingKeyResolution {
  case_id: uuid
  authority_basis: enum                // warrant | subpoena | voluntary | court_order
  viewing_key_artifact: SecureCredentialRef  // never persisted; in-memory only
  resolved_shielded_txs: TxRef[]
  resolved_at: timestamp
  resolved_by: investigator_id
  audit_log_ref: CustodyEventRef
}
```

What it does:

**For Zcash specifically** — viewing keys are an investigative primitive in 2026. When an investigator obtains a viewing key (via warrant, subpoena, or voluntary disclosure), the platform can:
- Ingest the viewing key in-memory only (same handling as private-key derivation in F21 G13)
- Resolve all transactions visible to that viewing key
- Render the resolved shielded transactions on the canvas
- Treat them as T2 evidence (document-attested deterministic) with the warrant/subpoena as provenance
- Log the use of the key to the CoC record without persisting the key material

**For Monero** — the platform cannot crack Monero. What it can do:
- **Timing correlation** when investigators have both entry and exit points (typically exchange deposit on one side and withdrawal on the other) — the platform proposes likely linkages with explicit confidence bounds and the honest acknowledgment that they're statistical, not deterministic
- **Amount correlation** with FCMP++ awareness — post-FCMP++, amount correlation is increasingly weak; the platform reflects this in confidence
- **Exchange-endpoint analysis** — even without on-chain trace through Monero, the exchanges' off-ramp records (via subpoena) often close the loop
- **Atomic-swap detection** — BTC ↔ XMR atomic swaps via Thorchain, Maya, atomic-swap wallets — these have detectable signatures on the transparent legs

**For Aleo, Iron Fish, and other privacy chains** — boundary marking and routing to specialist workflows; no claims to trace through them.

**For privacy DeFi (Aztec, Penumbra, Railway)** — same handling: mark the boundary, identify entry and exit transactions, route the in-between to "untraceable on-chain without additional evidence."

The platform's posture is **honest about limits**. Overclaiming "we can trace Monero" is the kind of overpromise that gets ChainSight excluded under Daubert when defense counsel calls a Monero developer as a witness.

**Build phase: Phase 2.**

### F36 — DeFi Exploit Forensics

```typescript
DeFiExploitClassification {
  case_id: uuid
  exploit_type: enum                   // flash_loan | reentrancy | oracle_manipulation |
                                       // governance_attack | logic_bug | access_control |
                                       // signature_replay | sandwich_mev | jit_mev |
                                       // private_key_compromise | rug_pull |
                                       // smart_contract_vulnerability_cve_class
  affected_protocol: ProtocolRef
  exploit_tx: TxRef                    // the atomic exploit transaction (often singular)
  pre_exploit_state: StateSnapshot
  post_exploit_state: StateSnapshot
  attacker_extracted_value: Decimal

  cve_reference: string | null         // if a known CVE class
  protocol_post_mortem: DocumentRef | null   // auditor / team post-mortem
  audit_history: AuditHistoryRef[]    // prior audits that missed this vulnerability

  decoded_attack_sequence: AttackStep[]   // the internal call tree as a narrative
}

AttackStep {
  step_index: int
  internal_call_ref: InternalCallRef
  action_description: text             // "borrowed 10000 ETH via Aave flash loan"
  state_delta: StateDelta
  is_exploit_pivot: bool               // marks the critical exploit step
}
```

What the platform provides for DeFi exploit cases:

**Atomic exploit reconstruction** — flash-loan attacks are typically a single transaction with a tree of dozens of internal calls. The Transaction Inspector's decoded-action capability extends to render the full attack sequence as a step-by-step narrative ("step 1: borrowed 10000 ETH via Aave flash loan; step 2: deposited as collateral in protocol X; step 3: manipulated oracle Y; step 4: withdrew 12000 ETH; step 5: repaid Aave loan; net extraction 2000 ETH")

**Oracle manipulation detection** — patterns where an attacker uses one DEX pool's price to manipulate a lending protocol's oracle; the platform identifies the manipulation hop and the dependent state read

**Governance attack detection** — proposal-execution patterns that drain treasuries (Beanstalk-style attacks, voting-power flash-loan attacks)

**Vulnerability classification against CVE catalog** — the platform maintains a CVE-class catalog (reentrancy, integer overflow, access control, signature replay, etc.) and classifies the exploit against it; this matters for court because "the defendant exploited a known CVE-class vulnerability" is a different evidentiary structure than "the defendant stole funds"

**MEV-extraction forensics** — sandwich attacks, JIT liquidity, frontrunning detected and classified; the platform distinguishes "MEV as the crime" (targeting victims) from "MEV as the symptom" (showing the attacker's funds path)

**Auditor / post-mortem ingestion** — major exploits have public post-mortems from Trail of Bits, Spearbit, OpenZeppelin, Code4rena, etc.; the platform ingests these as Documents (per v0.5 F2) and links them to the case

**Build phase: Phase 2.** Critical for the financial-crime-investigator and compliance-team market segments.

### F37 — NFT, Ordinals, and Non-Fungible Asset Tracing

```typescript
NonFungibleAsset {
  id: uuid
  asset_type: enum                     // erc721 | erc1155 | bitcoin_ordinal |
                                       // bitcoin_rune | solana_nft | tezos_fa2
  chain: string
  contract: AddressRef | null          // null for ordinals/runes
  token_id: string                     // chain-canonical token identifier
  collection: string | null
  metadata_ref: DocumentRef | null
  current_holder: AddressRef
  custody_history: NFTCustodyEvent[]
  market_history: NFTMarketEvent[]     // listings, sales, offers
  wash_trade_indicators: WashTradeFinding[]
}

NFTMarketEvent {
  marketplace: enum                    // opensea | blur | magic_eden | tensor |
                                       // sudoswap | solanart | etc.
  event_type: enum                     // listed | sold | offered | accepted_offer |
                                       // canceled | royalty_paid | royalty_avoided
  buyer: AddressRef | null
  seller: AddressRef | null
  price_native: Decimal
  price_fiat_at_time: Decimal
  royalty_paid: Decimal
}
```

What the platform tracks for non-fungible assets:

- **Per-asset custody trace** — unlike fungible tracing, an NFT trace is "this exact JPEG / Ordinal / Rune moved through these addresses" — the trace follows the unique asset, not value
- **Wash-trade detection** — patterns where the same asset cycles between related wallets at inflated prices, often a money-laundering signal
- **Hidden royalty siphons** — marketplaces that route royalty payments to attacker-controlled addresses
- **Collection-spam detection** — large mints of low-value NFTs used for dust attacks or attribution-pollution
- **Marketplace-specific decoders** — OpenSea (Seaport), Blur (BlurExchange), Magic Eden (M2 protocol), Tensor (Solana), Sudoswap (constant-product NFT AMM), etc.
- **Bitcoin Ordinals and Runes** — inscriptions and BRC-20 / Runes tokens have their own indexing and tracing requirements; the platform handles them as a distinct chain context

**Build phase: Phase 2 for basic NFT support; Phase 3 for marketplace-specific decoders.**

### F38 — Lightning Network and Off-Chain Awareness

The honest acknowledgment of off-chain layers:

- **Channel open/close detection** on Bitcoin — the platform identifies the funding tx (channel open) and the settlement tx (channel close) as a Lightning context
- **Routing-node attribution** — commercial Lightning routing nodes (LNBig, ACINQ, Bitrefill, Wallet of Satoshi, Cash App's Lightning) have distinctive patterns; the platform attributes them
- **Channel partner inference** — when the on-chain channel-close happens, the platform identifies the channel partner if attribution exists for either party
- **Custodial-Lightning service awareness** — services like Wallet of Satoshi, Cash App, and Strike have Lightning custodial models with subpoenable user records; the platform identifies them and surfaces the subpoena path
- **Honest boundary marking** — in-channel Lightning hops are not traceable from on-chain data alone; the platform marks the boundary and notes which subpoenas would be required to close the gap

**Build phase: Phase 3.** Not high-volume yet but growing.

### F39 — Emerging Asset Roadmap (track only, not built)

The platform's catalog tracks these as roadmap items; specs land when case volume justifies:

- **Real-world asset tokenization (RWA)** — tokenized treasuries, real estate, equities; creates bridges between on-chain forensics and traditional financial-crime forensics
- **CBDC integration** — central bank digital currencies launching in multiple jurisdictions; the platform's chain registry is structured to absorb them
- **ZK-DeFi privacy primitives** — Aztec, Penumbra, Railway, future Ethereum L2 privacy layers — all handled under F35's privacy-boundary framework
- **Account abstraction (ERC-4337) smart wallets** — recovery wallets, social recovery, gasless transactions, paymasters — change attribution heuristics; the platform's attribution layer is designed to absorb new wallet patterns
- **Restaking and liquid restaking (EigenLayer ecosystem)** — adds value-flow complexity that the methodology engine needs to handle
- **Intent-based protocols (Across, CowSwap, dYdX intents)** — already designed for in v0.5 F7 bridges; same primitive extends to general intent execution

---

## Part 3 — Business and lifecycle additions

### F40 — Dependency-Risk and In-House Heuristics Tier

The BYOK story is incomplete without provider-independent fallbacks. Every layer gets an open or self-hosted alternative the platform ships with.

```typescript
InHouseCapability {
  capability: string                   // matches the BYOK capability identifier
  implementation: enum                 // platform_native | bundled_open_source | self_hostable
  description: text
  quality_vs_byok: enum                // primary_recommended | strong_fallback |
                                       // baseline_only | last_resort
  enabled_by_default: bool
  configuration: ConfigSchema | null
}

ProviderRiskDashboard {
  agency_id: uuid
  capabilities_with_single_provider: CapabilityRef[]  // exposure
  capabilities_with_no_external_provider: CapabilityRef[]  // running on in-house only
  capabilities_with_redundancy: CapabilityRef[]       // healthy
  recommendations: RiskRecommendation[]
}
```

What ships in the in-house tier at Phase 1:

| Capability | In-house implementation |
|---|---|
| Chain data | Self-hostable archive nodes (Erigon, Reth, Geth, Bitcoin Core, Solana validators, etc.); platform ships configuration recipes |
| Address clustering (UTXO) | Native CIH + change detection ensemble (F24) — always available, no provider required |
| Address attribution | Baseline ingestion of public sources (OFAC SDN, OpenSanctions, OFSI, Etherscan public tags, known-entity lists) — platform-native attribution that works with zero commercial providers |
| Token metadata | Bundled token list from CoinGecko/TrustWallet (open licenses); on-chain symbol/decimals fallback |
| Price data | Time-weighted-average from Uniswap V3 pools; CoinGecko free tier; Chainlink price feed history |
| Contract decoding | Sourcify + 4byte.directory + OpenChain function-selector database (all free / open) |
| LLM (orchestrator) | Self-hostable Llama 3.x / Qwen 2.5 / Mistral / DeepSeek — fine-tuned for forensics workflows |
| Embeddings | BGE / E5 self-hostable models |
| Document intelligence | Tesseract OCR + open-source layout models for low-classification work; bumps up to commercial Document AI for high-quality needs |
| Document storage | MinIO / Ceph / NFS / local filesystem |
| Vector store | pgvector (Postgres-native) |
| Graph store | Memgraph (open-core) as a TigerGraph alternative |

This means:

- **An agency with zero commercial subscriptions can still run the platform** — at reduced capability, but with real baseline attribution, real tracing, real reports, real court-defensibility
- **Single-provider failure does not stop the platform** — capability router falls back to in-house implementations
- **Air-gapped deployments are genuinely possible** — every dependency in the critical path has a self-hostable form
- **Customer leverage in vendor negotiations** — agencies can credibly threaten to drop a commercial provider, knowing the platform will still function

The Provider Risk Dashboard:

- Shows the agency's exposure: "you have only one provider for entity attribution — fallback to in-house baseline would reduce attribution coverage by ~60%"
- Surfaces recommendations: "consider adding a second attribution provider for redundancy"
- Reports vendor-diversity metrics over time

**Build phase: Phase 1.** Core to the BYOK trust story.

### F41 — Bias, Fairness, and Civil-Rights Architecture

The platform's posture on civil liberties, in writing, in code.

**Methodology audits**

- The platform's heuristics (clustering, change detection, obfuscation detectors, attribution scoring) are independently audited annually by an external third party
- Audit reports are published (redacted as needed for security but with methodology fully transparent)
- Any heuristic that produces statistically significant disparate impact across demographic or jurisdictional lines is flagged for review and revision

**Published false-positive rate targets**

| Detector / Heuristic | Public FPR target |
|---|---|
| CIH clustering (UTXO) | < 1% (industry baseline) |
| Change-output detection | < 5% |
| Mixer attribution | < 0.5% |
| Sanctions-list matching | < 0.1% (exact match required) |
| Peel-chain detection | < 3% |
| ML-based attribution | < 2% |
| AI-generated path suggestions | < 5% (gated by Critic) |

These are commitments. Quarterly reports show actual measured FPR vs. target; misses trigger remediation.

**Adversarial testing program**

- Permanent red team that probes the platform for misuse vectors
- Annual external penetration test scoped to both security and methodology misuse
- Public bug bounty for security; coordinated disclosure for methodology issues

**Civil-Liberties Review Board (CLRB)**

- For federal customers, a formal review board including civil-liberties advocates (ACLU, EFF, Brennan Center, or equivalent)
- Reviews high-impact features before release (attribution promotion to court-grade, watcher rules, mass-clustering features, predictive elements if any)
- Has veto authority over features that fail civil-rights review

**Transparency reports**

- Annual public reporting on aggregate platform usage:
  - Number of investigations supported (range, not exact)
  - Number of freeze requests assisted
  - Number of seizure recommendations
  - Number of methodology disclosure exhibits produced
  - Daubert outcomes for cases that went to motion
  - Retractions issued and their resolution
- Published in machine-readable form

**Methodology disclaimer in every report**

Every report produced by the platform includes a methodology disclaimer section that includes, as a standard paragraph:

> *The analysis in this report was produced using the ChainSight platform's heuristic and machine-learning techniques as documented in the Methodology Disclosure section. These techniques are probabilistic and subject to known false-positive rates as publicly reported. The conclusions in this report are technical findings, not legal conclusions. The decision to act on these findings — including freeze requests, seizure recommendations, or charging decisions — is the responsibility of the human investigators, prosecutors, and adjudicators involved, not the platform.*

This is the "Proportionality" requirement from the [TRM published guidance](https://blockeden.xyz/blog/2026/04/11/blockchain-evidence-courtroom-trm-labs-on-chain-analytics-legal/) — separating technical conclusions (these addresses exchanged funds) from legal conclusions (therefore this person committed a crime).

**Anti-feature commitments (in writing)**

The platform will not ship:

- **Predictive policing features** — no "this address looks suspicious based on patterns alone without evidence of a specific crime"
- **Demographic correlation features** — no surfacing of address activity correlated with demographic, geographic, or political signals
- **Mass surveillance modes** — no "monitor all addresses in this jurisdiction" workflows
- **Untargeted dragnet features** — every watcher requires a case context with a documented investigative predicate
- **Generative attack-pattern speculation** — the platform detects known patterns and learns from confirmed cases; it does not speculate about novel attack types without ground-truth backing

**Build phase: commitments documented in Phase 0; CLRB convened by Phase 2; first annual audit and transparency report by end of Phase 3.**

### F42 — Certification and Accreditation Roadmap

Explicit milestones, not aspirational language.

| Certification | Target | What it requires |
|---|---|---|
| **SOC 2 Type 1** | End of Phase 2 | Policy and control design audit |
| **SOC 2 Type 2** | End of Phase 3 | 6-12 month operating effectiveness audit |
| **ISO 27001** | End of Phase 3 | Information security management system |
| **CJIS conformance** (US state/local LE) | Phase 3 | Documented conformance, not a formal cert |
| **FedRAMP Moderate** | Phase 4 (sponsor identified in Phase 3) | 12-18 month process |
| **FedRAMP High** | Post-Phase 4 | Additional 6-12 months on top of Moderate |
| **CMMC Level 2** | Phase 4 | If DoD contractor work pursued |
| **CMMC Level 3** | Post-Phase 4 | If sensitive DoD work pursued |
| **IL5 / IL6** | Post-Phase 4 | GovCloud or equivalent infrastructure |
| **Common Criteria EAL4+** | Post-Phase 4 | If intelligence community pursued |
| **UK Cyber Essentials Plus** | Phase 4 (with UK expansion) | Required for UK gov work |
| **EU GDPR Article 27 representation** | Phase 4 | If EU customers pursued |
| **Australia IRAP** | Post-Phase 4 | If Australian gov pursued |

Investment, not aspiration. These cost real money and engineering capacity:

- SOC 2 Type 2: ~$50-150K plus 6-9 months of engineering effort
- FedRAMP Moderate: ~$500K-2M plus 12-18 months, requires a sponsoring agency
- FedRAMP High: additional ~$500K-1M plus 6-12 months
- CMMC Level 2+: ~$100-300K plus ongoing operating costs

The roadmap is structured so each certification builds on the prior. SOC 2 → ISO 27001 → FedRAMP is the standard path; CMMC slots in alongside if DoD work is pursued.

**Build phase: Phase 0 — the commitments and milestones are part of the v1 deployment posture.**

### F43 — Insurance, Liability, and Legal Architecture

What the founding company carries before any customer deployment:

**Insurance**

- **Errors and Omissions (E&O)** — minimum $5M per occurrence / $10M aggregate; scaled with customer count and case-value exposure
- **Cyber liability** — minimum $10M per occurrence; covers breach response, regulatory fines, customer notification
- **Tech professional liability** — covers methodology disputes and software defects
- **Directors and officers** — standard governance protection

**Master Services Agreement (MSA) provisions**

The standard customer MSA includes:

- **Limitation of liability** capped at fees paid in the prior 12 months (industry standard)
- **Indemnification for IP claims** (the platform indemnifies the customer if a third party claims platform IP infringement)
- **Methodology disclaimer** as a binding provision (consistent with F41 disclaimer)
- **Customer responsibility for legal use** — the customer warrants that their use of the platform complies with the applicable jurisdiction's laws, including civil-rights laws
- **Data ownership** — customer owns all case data; vendor has zero ownership claim
- **Termination data portability** — on termination, the customer can export all case data as Reproducibility Packs at no additional charge
- **Vendor support access governance** — explicit, scoped, audited, revocable per v0.7 deployment model
- **Suspension of service** — vendor reserves right to suspend service for use that violates the civil-rights commitments in F41; suspension is not a unilateral data destruction event

**Outside counsel engagement before Phase 0**

- Federal contracting attorney (for GSA Schedule, SEWP, government MSA structures)
- Civil-rights attorney (for the F41 commitments and review board structure)
- IP / privacy attorney (for the BYOK passthrough structures and data handling)
- Litigation counsel-on-retainer (because eventually a customer's case will become a contested matter and the platform will be subpoenaed)

**Build phase: Phase 0.**

### F44 — End-of-Life and Data Portability Guarantees

Customer protection from vendor failure.

**Reproducibility Pack as canonical export**

Already designed (Pillar 2). The Pack is the vendor-neutral export format. Every case can be fully reconstructed from a Pack on any system that can read the open format.

**Open Pack format documentation**

The Pack format specification is published openly so third parties can build importers, exporters, and viewers. This means:

- A customer leaving the platform can move their cases to any compliant tool
- A receiving agency in a cross-agency handoff can import without needing ChainSight on the receiving end
- A court can request a Pack and inspect it with neutral tooling
- Future forensics platforms can interop with ChainSight artifacts

**Perpetual on-prem license**

For On-Premises Sovereign customers, the license terms include a perpetual right to use the deployed version even if the vendor ceases operations. The customer can continue running the software indefinitely; only support and updates would end.

**Source-code escrow** (enterprise tier)

For enterprise and government tier customers, the platform's source code is held in escrow with a neutral third party (Iron Mountain, NCC Group Escrow). Triggering events that release the source to the customer:

- Vendor bankruptcy or dissolution
- Vendor abandonment of the product (defined as no commercially reasonable maintenance for >12 months)
- Vendor acquisition by an entity the customer reasonably determines to be a hostile actor (foreign adversary, etc.) — subject to dispute resolution
- Vendor material breach of the MSA

Escrow release includes:

- Full source code
- Build instructions and tooling
- All trade secrets necessary to build, deploy, and maintain
- Limited license to use the source for the customer's own operations and continued maintenance

**Customer-funded community fork option**

In the event of vendor failure with escrow release to multiple customers, a customer-funded community fork is contractually permitted. This is the "the open-source world will outlive any vendor" insurance policy.

**Build phase: Phase 0 documented; Phase 2 source-code escrow program launched for enterprise tier.**

### F45 — Community, Network Effects, and Sustainability

The compounding value flywheel.

**Federated Personal Attribution Network (consent-gated)**

Already designed in v0.6 F25. The value scales with participation. Cross-agency federation uses privacy-preserving primitives (Bloom filters, hashed indicators, differential privacy).

**Open Detector Library**

A first-class submodule of the platform:

- Agencies and researchers can publish detectors for new obfuscation patterns
- ChainSight curates, validates against ground-truth datasets, and ships approved detectors in the catalog
- Detector authors get attribution (their detector is signed and credited)
- Quarterly review and inclusion cycle

**Shared Ground-Truth Datasets**

- Anonymized, hash-only sharing of "we saw this pattern, here's the outcome" across consenting customers
- Differential privacy ensures no agency's specific cases are derivable from the aggregate
- Feeds the B7 ground-truth flywheel across the customer base

**ChainSight User Community**

- Annual conference (mirrors Chainalysis Links, TRM Talks)
- Online forum scoped by classification level (public, customers-only, LE-only)
- Certification program tied to the F31 training module
- ChainSight Investigator Certification, ChainSight Expert (advanced), ChainSight Trainer (train-the-trainer)

**Academic and Research Partnerships**

- Research data access program — academic researchers can request access to anonymized, aggregated platform data
- Publication credit and citation requirements
- Annual research grants in blockchain forensics
- University partnerships for curriculum development

**Open-source the periphery**

- Connectors (chain explorers, attribution providers, document intelligence) are open-source — community contributions accepted
- Detectors are open (per F45 detector library above)
- Pack viewers and importers are open
- Core platform (Belief State Service, Math Service, Critic, etc.) remains proprietary

**Vendor sustainability via opt-in detailed telemetry**

For customers who opt in:

- Detailed feature usage telemetry (no case content) so the vendor can prioritize roadmap
- Crash reports and performance diagnostics (no case content)
- A/B test participation for new features (no case content)
- Customer Advisory Board membership

Customers who do not opt in see zero impact on functionality. Opt-in customers may receive pricing benefits or early access — but never preferential support or security.

**Build phase: Phase 2 onward; CAB convened in Phase 2; first community conference Phase 4.**

### F46 — Pricing and Packaging Framework

Detailed pricing is deferred to the Go-to-Market document. The packaging framework is locked here:

**Deployment tiers**

| Tier | Target | Deployment | Pricing model |
|---|---|---|---|
| **Investigator** | Solo private PI, forensic accountant | SaaS Blind only | Per-seat monthly |
| **Team** | Small firm, small task force (up to 25 seats) | SaaS Blind or On-Prem | Per-seat monthly + setup |
| **Department** | State/local LE department, mid-size compliance team | SaaS Blind or On-Prem | Annual contract + seats |
| **Agency** | Federal LE field office, large bank compliance, large investigation firm | On-Prem preferred; SaaS Blind available | Annual contract + seats + support |
| **Classified** | Federal agency HQ, intelligence community, national-level financial-crime units | On-Prem Sovereign only; air-gapped variant | Annual contract; site license; deep support |

**Feature gating**

- Core investigation features (case, IOC, trace, single-chain) — all tiers
- Multi-chain, cross-chain, all detectors — Team+
- Wallet History Analyzer — Team+
- Court Mode + reproducibility packs — Department+
- Supervisor Mode — Department+
- Federated personal attribution — Agency+
- Cross-agency deconfliction federation — Agency+
- Custom detectors and skill library — Agency+
- Air-gapped deployment — Classified only
- Source-code escrow — Agency+ optional

**BYOK provider pass-through**

- Agencies pay providers directly (their existing contracts)
- ChainSight does not mark up or broker provider data in v1 (consistent with G8 lean and v0.7 sovereignty)
- ChainSight ships connector integration and capability routing as part of the platform fee
- Cost telemetry (F9.8) gives the agency full visibility into their provider spend

**Government contracting vehicles**

- GSA Schedule (Phase 3)
- SEWP V/VI (Phase 4)
- CIO-SP4 (Phase 4)
- OASIS+ (Phase 4)
- State and local contracting through NASPO ValuePoint, NCPA, OMNIA Partners

**Pilot / POC structure**

- 90-day pilot at reduced cost or no-cost for qualified agencies
- Pilot includes platform + reasonable training + support
- BYOK provider keys are the pilot customer's responsibility (real costs even in pilot)
- Conversion to paid follows the standard tier structure

**Build phase: pricing model finalized in the GTM document; packaging framework documented in Phase 0.**

### F47 — Localization and Internationalization Foundations

Architecture readiness now; full international expansion in Phase 4+.

**What's built into the architecture from Phase 0:**

- All UI text routed through i18n string tables (no hardcoded English in components)
- All currency handling uses ISO 4217 codes; agency picks the default fiat reporting currency
- All date/time stored as UTC; displayed in agency's configured timezone
- All numeric formatting respects locale (1,000.00 vs 1.000,00 vs 1 000,00)
- Methodology engine parameterized by jurisdiction (not just "US default")
- Sanctions list ingestion supports multiple sources from Phase 0 (OFAC, EU, UN, OFSI minimum)

**What expands in Phase 4:**

- Multi-language UI (English, Spanish, French, German, Portuguese, Japanese, Mandarin at minimum)
- Jurisdiction-specific document templates (UK SAR ≠ US SAR ≠ FinCEN 314(a) ≠ EU MLD reporting)
- Jurisdiction-specific methodology defaults (US criminal: LIFO + FIFO; US civil: LIBR; UK: pari passu + rolling charge + Section 104 pool; EU: TFR/MiCA-aware)
- Multi-currency fiat conversions in reports
- Local certification paths (UK Cyber Essentials, Australian IRAP, Singapore IMDA, etc.)
- Local provider integrations (jurisdiction-specific OSINT, sanctions, attribution feeds)
- Data residency enforcement per jurisdiction (already enabled by the storage abstraction)

**Build phase: Phase 0 architecture readiness; Phase 4 full expansion.**

---

## Part 4 — The eight Phase-0 lockdown items (confirmation)

From the v0.7 gap analysis, the eight items I committed to closing before code is written. Status:

| # | Item | Spec'd as | Status |
|---|---|---|---|
| 1 | Stablecoin freeze + reissue workflow | F33 | ✅ Spec'd, Phase 1 build |
| 2 | Chain-of-custody as a first-class system | F29 | ✅ Spec'd, Phase 0 build |
| 3 | L2-specific tooling foundations | F34 | ✅ Spec'd, Phase 0 architecture / Phase 1 first L2s |
| 4 | Dependency-risk and in-house heuristics tier | F40 | ✅ Spec'd, Phase 1 build |
| 5 | Supervisor mode | F27 | ✅ Spec'd, Phase 1 build |
| 6 | Expert witness profile | F26 | ✅ Spec'd, Phase 0 build |
| 7 | Bias and fairness commitment in writing | F41 | ✅ Spec'd, Phase 0 documented / Phase 2 CLRB |
| 8 | Certification roadmap | F42 | ✅ Spec'd, Phase 0 commitments / phased delivery |

All eight closed.

---

## Part 5 — Anti-feature commitments (locked in writing)

Things the platform will deliberately not do, captured as commitments:

- **No predictive policing.** No "this address looks suspicious based on behavioral patterns alone." Every watcher requires a documented investigative predicate.
- **No generative attack-pattern speculation.** Detectors fire on known patterns confirmed against ground truth; the AI does not speculate about novel attack types.
- **No demographic correlation.** Address activity correlated with demographic, geographic, or political signals is not a feature.
- **No mass surveillance modes.** No "monitor all addresses in jurisdiction X" workflows.
- **No untargeted dragnet features.** Every watcher requires a case context.
- **No crypto trading or personal-portfolio features.** Different product; conflict of interest with investigative integrity.
- **No vendor-managed key escrow.** Breaks the sovereignty story; never offered, never temporarily-allowed-then-removed.
- **No silent telemetry.** Every byte documented; opt-in toggles real, not theater.
- **No vendor-as-broker for customer data.** Pure BYOK in v1; vendor-as-broker possible in v2 only with strict separation and full disclosure.
- **No "trust us" privacy claims.** Every privacy guarantee is enforceable by the customer through technical controls they own.

These commitments are in the MSA, in marketing collateral, in the founding company's published values, and in the platform's anti-feature test suite (a CI check that fails the build if any of these features creep in).

---

## Part 6 — Updated build phasing (consolidated through v0.8)

| Phase | Months | What ships |
|---|---|---|
| **Phase 0** | 1-2 | Case model, intake, evidence vault; **Capability Router + Provider Marketplace stub**; **Belief State Service stub**; **Transaction-centric graph data layer (G10)**; **Cache layer foundation**; **Personal Attribution data model + basic apply**; basic single-chain Ethereum trace; FIFO accounting; API key entry (all three modes); **both deployment modes (On-Prem + SaaS Blind)**; **offline license validation, signed releases, Sigstore-backed transparency log**; minimal-by-default telemetry; **Chain of Custody as first-class system (F29)**; **Expert Witness Profile (F26)**; **L2 architecture foundations (F34)**; **anti-feature commitments and bias/fairness documentation (F41 commitments)**; **certification roadmap published (F42)**; **MSA and insurance in place (F43)**; **EOL and source-code-escrow framework documented (F44)**; **localization foundations (F47 architecture readiness)**; **packaging framework documented (F46)** |
| **Phase 1** | 3-4 | Bitcoin UTXO engine; **first L2s (Base, Arbitrum, Optimism, Polygon, zkSync Era, Starknet, Scroll, Linea)**; CCTP + LayerZero + Wormhole bridges; visual canvas v1; LIFO + LIBR; **full Math Service**; **Reproducibility Pack v1**; **Path styling (F19)**; **Wallet data model + manual CRUD**; **UTXOCluster v1 (F24 CIH + optimal-change)**; **Full cache tier system + refresh button + last-refresh badge**; deconfliction tab data model; CaseDocument data model + platform-managed storage; investigator markup system; **air-gapped hardening (signed packages, no outbound paths required)**; **audited support access workflow**; **reproducible builds verified externally**; **Stablecoin Freeze + Burn + Reissue workflow (F33)**; **Supervisor Mode (F27)**; **In-House Heuristics Tier (F40)**; **Mobile read-only and Court Mode driver (F30a, F30b)**; **Training & Sandbox Environment (F31)** |
| **Phase 2** | 5-7 | AI agent layer; memory stack; **PSR + Suggestion Agent**; skill library; **Transaction Inspector**; **Wallet History Analyzer**; **full UTXO clustering ensemble + CoinJoin exclusion**; **Refresh cost estimator**; **Document Extraction Agent**; on-prem storage; manual deconfliction tab UI; **Obfuscation Detection v1**; **Personal Attribution sharing (specific users + team + org) + library view**; **"Where did the money go?" overlay**; **Confidential computing pilot (Nitro Enclaves first)**; **per-tenant pinned versions in SaaS**; **verifiable-build verification tooling**; **Case Transfer / Handoff Workflow (F28)**; **Retraction Workflow (F32)**; **Field IOC capture mobile (F30c)**; **Privacy-Coin Boundary Handlers (F35)**; **DeFi Exploit Forensics (F36)**; **NFT/Ordinals/Runes basic tracing (F37 basics)**; **Civil-Liberties Review Board convened**; **SOC 2 Type 1**; **Customer Advisory Board convened**; **Open Detector Library v1 (F45)** |
| **Phase 3** | 8-10 | Court-readiness; **PSR multi-path + observer-mode + NL-select**; **G7 case-level math + variance disclosure**; pari passu + rolling charge; **G5 path immutability at DB layer**; **Present in Court Mode (all four views + accounting-follows-the-frame panel)**; **Court Export Bundle (portable viewer)**; **Obfuscation Detection v2**; document types expansion; **auto-detected deconfliction within tenant**; **Inspector obfuscation + Critic sections; compare-two-transactions; saved-analysis persistence**; **seed-phrase derivation (warrant attestation)**; **incremental wallet delta re-analysis**; **cross-wallet clustering**; **ML-augmented change detection (T3)**; **counter-attribution flow**; **provider webhook cache invalidation**; **chain-reorg listeners**; **sanctions-list invalidation**; **Obfuscation Detection v3 (ML-based with Critic gating)**; **Confidential computing across SaaS Blind hot path**; **SOC 2 Type 2**; **ISO 27001**; **CJIS conformance**; **FedRAMP Moderate work begun (sponsor identified)**; **First annual methodology audit and transparency report (F41)**; **Lightning Network awareness (F38)**; **NFT marketplace decoders (F37 marketplace)**; **Source-code escrow program for enterprise tier (F44)** |
| **Phase 4** | 11-14 | Watcher Agent + rule DSL; real-time CRDT canvas; collaboration on paths; **cross-agency deconfliction federation**; **cross-agency Personal Attribution federation**; audio transcription; compliance handoff workflow; **FedRAMP Moderate authorization**; **FedRAMP High work begins**; expanded Provider catalog; **admin-level cache governance**; advanced cluster analytics; long-running wallet watch mode; Inspector personalization; voice-assistant Court Mode; **CMMC Level 2**; **UK Cyber Essentials Plus**; **Multi-language UI (English, Spanish, French, German, Portuguese, Japanese, Mandarin)**; **Jurisdiction-specific methodology defaults and document templates (F47 full)**; **Annual ChainSight user community conference**; **Academic research data access program**; **Government contracting vehicles (GSA Schedule, SEWP)** |
| **Post-Phase-4** | 15+ | **FedRAMP High authorization**; **CMMC Level 3**; **IL5/IL6 path**; **Common Criteria EAL4+**; **Australia IRAP**; **EU expansion (GDPR Article 27 representation)**; **Emerging asset support (RWA, CBDC, account abstraction, ZK-DeFi privacy)** per F39 |

---

## Part 7 — Updated open questions

| ID | Topic | Status |
|---|---|---|
| **G2** | Public anchoring of reproducibility hashes | ⏳ Open; default off, opt-in per case at case-close when going to court |
| **G3** | Cross-agency learning consent model | ⏳ Open; DP-within-tenant default-on, opt-in cross-tenant |
| **G8** | Reseller economics with providers | ⏳ Open; vendor-neutral in v1, optional v2 revenue share |
| **G21** | Air-gapped update path | ⏳ Open; likely both physical media and one-way diode, confirm with first pilot |
| **G22** | Confidential computing for SaaS Blind v1 | ⏳ Open; lean ship with envelope encryption + audited support as v1 floor, add confidential computing in Phase 3 |
| **G23** | Verifiable build infrastructure | ⏳ Open; lean Sigstore from start |

No new opens introduced by v0.8.

---

## Part 8 — Document index update

Fifteen documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md`
2. `chainsight_schema.md`
3. `chainsight_merged_v0_2.md`
4. `chainsight_v0_3_addendum.md`
5. `chainsight_v0_3_byok_addendum.md`
6. `chainsight_v0_4_consolidated.md` (superseded by v0.6 consolidated)
7. `chainsight_v0_4_canvas_ux_addendum.md`
8. `chainsight_v0_4_api_key_entry_addendum.md`
9. `chainsight_v0_5_addendum.md`
10. `chainsight_v0_5_addendum_2.md`
11. `chainsight_v0_5_addendum_3.md`
12. `chainsight_v0_6_addendum.md`
13. `chainsight_v0_6_consolidated.md` (superseded by v0.8 consolidated)
14. `chainsight_v0_7_deployment_model_addendum.md`
15. `chainsight_v0_7_gap_analysis.md`
16. `chainsight_v0_8_addendum.md` *(this file)*

The v0.8 consolidated reference follows separately.

---

## Closing

The eight Phase-0 items are closed. Twenty-two new features (F26 through F47) are spec'd, phased, and integrated with the four pillars. Ten anti-feature commitments are locked in writing. The certification roadmap, liability architecture, and EOL guarantees are explicit. The bias and civil-rights architecture is documented as commitments with measurable targets and external oversight.

The platform you've designed is excellent. The institution that ships it is now designed at the same level of care.

This is the state I'd want before any engineer writes the first line of production code.
