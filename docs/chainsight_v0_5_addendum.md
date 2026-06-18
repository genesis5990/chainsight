# ChainSight v0.5 — Deconfliction, Document Ingest, Courtroom Presentation, Obfuscation Detection

> Four new first-class features. Each integrates with the three pillars (Belief State, Reproducibility, BYOK Marketplace) and the locked UX principles (Caveman-easy front, sophisticated back).

---

## Feature 1 — Deconfliction Notifications

### 1.1 The problem

Crypto crime is rarely investigated by one team in isolation. The same wallet, same suspect, same scheme is often:

- Worked by another field office of the same agency
- Worked by a different agency entirely (FBI vs. Secret Service vs. IRS-CI vs. state AG)
- Subject to a parallel civil action by victims
- Of interest to a foreign LE counterpart via MLAT
- Already known to a private-sector compliance team that hasn't reported it yet

Without deconfliction, investigators step on each other's operations: parallel subpoenas tip off the same exchange, undercover ops get burned, freeze races result in races to the wrong VASP. The current state of the art is a phone call to HSI HQ or a manual check against FinCEN 314(b) and EPIC — slow, voluntary, and incomplete.

The platform should turn this into a structured, ambient feature. Not a replacement for HQ deconfliction protocols, but a tool that surfaces conflicts the moment they're discoverable.

### 1.2 The Deconfliction tab

A dedicated tab in each case file, visible alongside Evidence, Reports, Watchers, and Documents. It contains:

**A) Known external investigators (manually entered)**

The investigator can record, per case:

```typescript
ExternalInvestigatorEntry {
  id: uuid
  case_id: uuid
  name: string
  agency: string                  // FBI, USSS, IRS-CI, FinCEN, DEA, state AG, foreign LE, private firm
  unit_or_squad: string | null
  contact_email: string | null
  contact_phone: string | null
  first_contact_date: date
  last_contact_date: date | null
  contact_method: enum            // phone | email | in_person | task_force | conference
  shared_indicators: IOC[]        // which addresses/txs/entities are the overlap
  scope_of_overlap: text          // "they're working the same suspect," "same victim pool," etc.
  data_shared_with: bool          // have we shared anything with them?
  data_shared_summary: text | null
  data_received_from: bool        // have they shared anything with us?
  data_received_summary: text | null
  agreement_in_place: enum        // none | 314(b) | MLAT | task_force_MOU | informal | formal_agreement
  agreement_reference: string | null   // case number, MOU title, etc.
  classification_level: enum      // unclassified | LES | confidential | classified
  notes_md: text                  // free-form running log
  attachments: AttachmentRef[]    // emails, MOUs, written correspondence
  status: enum                    // active | resolved | dormant
  created_by: investigator_id
  created_at: timestamp
  visible_to: AccessScope         // case_team | author_only | specific_users
  audit_trail: EventLog[]
}
```

Adding an entry is one button on the Deconfliction tab; the form is short and most fields are optional. The investigator only has to provide name, agency, and date — everything else is enrichment.

**B) Auto-detected overlaps (the AI layer)**

The platform continuously checks for overlap between this case and others **within the same agency tenant**, respecting access controls:

- An address in this case appears in another active case
- A tx hash in this case appears in another active case
- An entity attribution in this case overlaps with another case's attribution
- A subpoena to the same VASP is in flight on another case
- A watcher in this case fires on an address watched by another case

When detected, a `DeconflictionAlert` surfaces in the tab:

```typescript
DeconflictionAlert {
  id: uuid
  case_id: uuid                   // this case
  other_case_id: uuid             // the case we're overlapping with
  other_case_lead_id: investigator_id
  other_case_agency: string
  overlap_type: enum              // shared_address | shared_tx | shared_entity | shared_vasp_subpoena | shared_watcher
  overlap_details: text
  detected_at: timestamp
  status: enum                    // new | acknowledged | contact_initiated | resolved | escalated
  contact_method_chosen: enum | null  // platform_message | external_contact | escalate_to_supervisor
}
```

The investigator's options on an alert are:

- **Acknowledge** — note it, no action yet
- **Initiate contact through the platform** — sends a structured message to the other case's lead with a redacted summary of the overlap (sender controls what gets shared)
- **Initiate contact externally** — exports the contact info to use outside the platform
- **Escalate to supervisor** — kicks the conflict to a manager-level review
- **Mark resolved** — with a memo explaining the resolution

**C) Cross-agency deconfliction (consent-gated)**

For agencies that opt in, deconfliction can extend beyond the agency tenant to a federated deconfliction network. Each agency runs its own ChainSight instance (or tenant); a privacy-preserving exchange checks whether any of _their_ active cases touch addresses, txs, or entities in _your_ case **without revealing the other agency's case details**.

Technical approach: hashed/Bloom-filtered indicators exchanged through a federated index, with differential-privacy noise on aggregate statistics. When a match is found, the platform notifies both agencies that "an investigation in your jurisdiction overlaps with another agency's active matter — proceed to formal contact?" Neither agency learns the other's case content until they choose to engage.

This is the modern descendant of the EPIC + 314(b) phone-call protocol, structured for the velocity crypto cases require. It's an opt-in feature with explicit MOUs, never default-on.

### 1.3 Integration with the pillars

| Pillar                          | Touchpoint                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**     | Every ExternalInvestigatorEntry and DeconflictionAlert emits a BeliefAtom so the case's external-coordination posture is part of the record                                           |
| **Reproducibility (Pillar 2)**  | Deconfliction history is part of the Reproducibility Pack — court can see exactly when and how parallel investigations were managed                                                   |
| **BYOK Marketplace (Pillar 3)** | Optional connectors to FinCEN 314(b), Egmont Group exchange, EPIC, Interpol I-24/7 (BYOK where available)                                                                             |
| **PSR / Reporting**             | Deconfliction posture appears in the standard report template's methodology disclosure section — courts increasingly ask "what did you do to coordinate with parallel investigators?" |

### 1.4 What the investigator sees (practical)

A small badge on the case header — `🤝 3 deconfliction contacts, 1 unresolved alert` — that opens the tab. The tab itself shows the manual entries on the left, the auto-detected alerts on the right, and a timeline at the bottom showing all coordination activity. Adding a new contact is a single button. Acknowledging an alert is a single click.

---

## Feature 2 — Document Ingest & AI Rendering

### 2.1 Scope

The platform ingests subpoena returns, bank statements, exchange KYC packets, court orders, MLAT correspondence, victim narratives, suspect interviews (audio + transcript), forensic accountant reports, and any other document type a case generates. AI reads them, extracts structured evidence, attaches it to the case graph, and surfaces it in reports.

### 2.2 The document model

```typescript
CaseDocument {
  id: uuid
  case_id: uuid
  filename: string
  document_type: enum             // subpoena_return | bank_statement | kyc_packet | court_order |
                                  // mlat | victim_statement | suspect_interview | accountant_report |
                                  // exchange_records | osint_dump | screenshot | other
  source: enum                    // uploaded | email_in | api_pull | scanned
  classification: enum            // unclassified | LES | confidential | classified
  uploaded_by: investigator_id
  uploaded_at: timestamp
  storage_backend: StorageBackendRef   // see Feature 2.5
  storage_path: string            // backend-relative path
  content_hash: sha256            // for integrity
  encryption_ref: KMS_KeyRef      // case-scoped key
  page_count: int | null
  mime_type: string
  ocr_status: enum                // not_required | pending | complete | failed
  extraction_status: enum         // pending | extracting | complete | partial | failed
  extracted_entities: ExtractedEntity[]   // AI-extracted, investigator-reviewed
  extracted_tables: ExtractedTable[]      // structured data lifted from PDFs
  extracted_timeline: TimelineEvent[]     // dated events extracted from the doc
  cross_refs: BeliefAtomId[]      // belief atoms this document supports
  review_status: enum             // unreviewed | partially_reviewed | reviewed | finalized
  finalized_by: investigator_id | null
  finalized_at: timestamp | null
  audit_trail: EventLog[]
}

ExtractedEntity {
  raw_text: string                // what the document said
  normalized_value: string        // canonicalized
  entity_type: enum               // address | tx_hash | name | email | phone | account_number |
                                  // amount | date | jurisdiction | exchange | suspect_id
  page_number: int
  bounding_box: BBox | null       // for visual highlight in the doc viewer
  confidence: float
  reviewed: bool
  reviewer_id: investigator_id | null
  linked_belief_atom: BeliefAtomId | null
}
```

### 2.3 The ingest flow

1. **Drop a PDF (or any supported format) onto the Documents tab, or drag it onto an entity in the canvas.**
2. Document is encrypted with the case-scoped DEK and uploaded to the configured storage backend.
3. **Document intelligence service** (a BYOK capability — AWS Textract, Google Document AI, Azure Form Recognizer, Unstructured, or a self-hosted alternative) runs OCR + layout analysis if needed.
4. **Extraction Agent** (a specialized AI agent) reads the document and extracts:
   - Entities (addresses, tx hashes, names, account numbers, amounts, dates, exchange names)
   - Tables (account statements, transaction lists, balance histories)
   - Timeline events (dated activities described in the narrative)
   - Cross-references to other documents in the case
5. **Verifier Agent** double-checks every extraction against the source — bounding boxes confirm the raw text exists where claimed; numeric values are extracted as `Decimal` (not LLM-typed).
6. Extractions surface in a side panel with **document viewer on the left, extracted items on the right**. Each item has a "go to source" highlight. The investigator reviews and approves/rejects/corrects each extraction with one click per item.
7. Approved extractions become **BeliefAtoms** with the document as provenance (T2 — document-attested deterministic).
8. The document is now linked to whatever nodes in the case graph its extractions touch — node icons gain a `📎` badge, hover shows the document name.

### 2.4 Supported document types (with specialized handling)

**Subpoena returns from exchanges**

The most common case document. The Extraction Agent has dedicated playbooks for the major exchanges' return formats (Binance, Coinbase, Kraken, Bitstamp, Bitfinex, Bybit, OKX, Gate.io, KuCoin, Crypto.com, Gemini, etc.). It extracts:

- KYC identity data (name, DOB, address, government ID number)
- Linked accounts (bank, card, other crypto accounts)
- IP address history with timestamps
- Login history
- Deposit/withdrawal history (cross-referenced to on-chain txs)
- Communications with support
- Devices used

Each extracted field becomes a structured BeliefAtom. The "this exchange address belongs to John Smith" atom is upgraded from T3 (heuristic) to T2 (document-attested) with the subpoena as provenance. A subpoena return turns a guess into an evidence-grade attribution.

**Bank statements**

Extraction lifts every transaction row into a structured table. Crypto-relevant rows (wire to/from a known exchange, ACH to a payment processor) are flagged automatically and linked to on-chain candidates by amount and timestamp matching. The Math Service reconciles the bank-side and chain-side ledgers — discrepancies become Critic Challenges.

**Court orders, search warrants, freeze orders**

Extracted scope, target addresses/accounts, effective dates, issuing court, case number. Cross-linked to the entities they cover so the canvas can render a `⚖️` badge on any entity under an active legal instrument.

**MLAT correspondence**

Extracted requesting/requested countries, target VASPs, scope, status, dates. Linked to the SubpoenaRequest tracker so MLAT progress is visible alongside domestic process.

**Victim statements & suspect interviews**

Extracted indicators (wallets, handles, social profiles, payment instructions), timeline of events, named third parties. For audio interviews, automatic transcription (BYOK capability) plus speaker diarization. The Narrative Agent uses victim statements as primary source material for the case background.

### 2.5 Storage backend abstraction

The most important architectural detail: **the storage backend is interchangeable, just like the BYOK provider catalog**.

```typescript
StorageBackend {
  id: string                      // "aws_s3", "gcp_gcs", "azure_blob", "minio_on_prem",
                                  // "ceph_on_prem", "nfs_mount", "local_filesystem"
  display_name: string
  type: enum                      // cloud | on_premises | hybrid
  capabilities: StorageCapability[]   // encryption | versioning | object_lock | replication | lifecycle
  compliance_certs: string[]      // SOC2, FedRAMP, CJIS, HIPAA where applicable
  configuration_schema: JSONSchema    // what the agency admin fills in
  status: enum                    // available | beta
}

AgencyStorageInstall {
  id: uuid
  agency_id: uuid
  backend_id: string              // FK to StorageBackend
  display_label: string           // agency-set, e.g. "Main case storage — on-prem MinIO"
  configuration: EncryptedConfig  // bucket name, endpoint, region, credentials, etc.
  encryption_at_rest: enum        // backend_managed | kms_managed | hsm_managed
  encryption_key_ref: HSM_KeyRef | null
  default_scope: enum             // agency_wide | classification_tier_specific | case_specific
  retention_policy: RetentionPolicy
  legal_hold_supported: bool
  added_by: investigator_id
  added_at: timestamp
  active: bool
}
```

What this means in practice:

- **A federal LE agency** can configure ChainSight to use an **on-premises MinIO cluster** behind their firewall for all case documents. No data ever leaves their infrastructure.
- **A state task force** can use **AWS S3 in GovCloud** with KMS-managed encryption.
- **A private compliance team** can use **Google Cloud Storage** with their existing CMEK.
- **A small private investigator** can use **standard S3** out of the box with platform-managed keys.
- **Mixed mode**: an agency can route classified case documents to on-prem storage and unclassified ones to cloud storage, with the routing rule scoped to the case's classification field.

Switching backends is an admin operation: configure the new backend in the marketplace (using the same "easy as `.env`" entry flow from the API key addendum), set its scope, and new documents route there. **Existing documents stay where they are** unless explicitly migrated; the system supports live migration with a background job that copies-then-verifies before flipping the storage reference.

The encryption layer is always platform-managed even when the backend is changed. Documents are encrypted with the case DEK _before_ being written to any backend, so changing backends never decreases security.

### 2.6 What this gives investigators

A unified document workspace where:

- Subpoena returns auto-link to the addresses they cover
- Bank statements auto-reconcile against on-chain txs
- Court orders auto-render on the canvas as legal-instrument overlays
- Victim statements pre-populate the case narrative
- Every fact in every report cites back to a document with a page number and bounding box
- The whole document library can move between cloud and on-prem without disrupting active cases

---

## Feature 3 — Present in Court Mode

### 3.1 The problem

Investigators today walk into court with:

- A printed PDF report
- A binder of screenshots
- A USB stick of videos that may or may not play on the courtroom AV system
- A laptop running their forensics tool, hoping nothing crashes when defense counsel asks an unexpected question

The platform should be the laptop — but a laptop designed for the courtroom, not for daily investigation. Different audience, different needs.

### 3.2 The Present in Court button

From any case, the investigator clicks **Present in Court**. The platform enters a dedicated presentation mode:

- Full-screen view (no panels, sidebars, menus, alerts, notifications)
- High-contrast typography legible from the back of a courtroom
- Keyboard- and remote-clicker-friendly (`←` `→` `Space` to advance)
- All AI background activity paused (no surprise re-renders, no agent-generated overlays appearing mid-testimony)
- "Stage" indicator visible only to the presenter on a presenter's-view monitor
- Network calls disabled by default — the entire presentation runs from the frozen Reproducibility Pack so a courtroom Wi-Fi failure cannot derail testimony

### 3.3 The four primary views

The presenter picks any combination of these views and sequences them into the courtroom narrative:

**View A — Over Time (the timeline)**

A horizontal timeline of the case from incident T0 through the most recent activity. Events render as the playhead moves. The presenter scrubs forward and backward; the canvas re-renders the graph at each moment in time, showing only what existed by that timestamp.

Useful for: chronology testimony, "the defendant did X on date Y, then Z three weeks later," depicting the speed of money movement.

**View B — By Value (the money-flow Sankey)**

A Sankey diagram showing the original tainted value entering from the left, flowing through intermediate hops, and arriving at terminal destinations on the right. Width of each flow band represents value. Methodology toggle (FIFO / LIFO / LIBR / pari passu / rolling charge) re-renders the Sankey in real time, showing the same money under different legal lenses.

Useful for: "where did the money go" testimony, depicting commingling, showing the prosecutor's preferred attribution methodology side-by-side with the defense's preferred one.

**View C — By Trace Path (the PSR playback)**

A finalized TracePath plays back step by step. The presenter advances one hop at a time with the arrow keys. Each hop shows: the transaction details, the value at that hop, the cumulative percentage of original taint, the time elapsed, the chain it occurred on, and any memo the investigator attached during the original investigation.

Useful for: "let me walk you through how the money got from the victim's wallet to this defendant's exchange account" testimony. Probably the single most courtroom-effective view.

**View D — By Entity (the actor-centric view)**

A view focused on a single entity (suspect, exchange, intermediary). Shows all txs involving that entity, all attributions, all subpoena returns, all linked documents, all memos. Useful for cross-examination: defense counsel asks "what evidence connects my client to wallet 0xabc?" and the presenter switches to View D centered on the client's known wallet.

### 3.4 The accounting follows the presentation (the critical feature)

This is what you specifically asked for, and it deserves its own callout.

**As the presenter moves through the presentation — advancing a hop, scrubbing the timeline, switching methodologies, switching paths — the accounting panel updates in lockstep.**

A side panel (or, in dual-monitor setups, the presenter's-view monitor) always shows:

```
CURRENT FRAME
─────────────
Methodology:        FIFO
Frame type:         By Trace Path — Path A, Hop 7 of 14
Time:               2024-08-12 14:33:21 UTC
Chain:              Ethereum

VALUE AT THIS HOP
─────────────────
Native:             423.7184 USDT
Fiat at frame time: $423.72
Cumulative taint
  from source:      87.3%
Fees absorbed
  along this path:  $1,847.20

CASE-LEVEL CONTEXT
──────────────────
Total tainted input:  $1,000,000.00
Traceable at this
  frame:              $872,930.00 (87.3%)
Lost to mixers
  by this frame:      $124,180.00 (12.4%)
Off-ramped to
  fiat by this frame: $2,890.00 (0.3%)

NEXT FRAME
──────────
Hop 8 of 14 — bridge to Tron
Anticipated taint: 86.9%
```

When the presenter advances a frame, every number updates. When they switch methodology, every number updates. When they jump from a path view to a timeline view, the panel reframes to the new context but the **case-level math anchor remains canonical** (G7 lock).

The presenter can press a single key — `R` for "read aloud" — and the panel highlights the next claim to verbalize, so an investigator new to courtroom testimony has a teleprompter of sorts that keeps them accurate. The numbers on screen and the numbers in their mouth match, frame by frame.

### 3.5 Defense interaction handling

In real testimony, defense counsel will interrupt. The presentation mode supports:

- **Pause** — instantly stop the playback, hold the current frame
- **Jump to entity** — defense asks about wallet 0xabc; presenter types `J 0xabc` and the presentation jumps to a View D centered on that wallet
- **Show alternative methodology** — defense argues FIFO is wrong; presenter presses `M` and cycles through methodologies on the current frame to show the same trace under each
- **Show open Critic challenges** — defense argues a hop is uncertain; presenter presses `C` to surface the Critic's open challenges and confidence intervals for the current frame
- **Show source document** — defense argues an attribution is unsupported; presenter presses `D` to open the linked subpoena return at the exact page and bounding box that supports the attribution
- **Reset to opening frame** — `Esc Esc` returns to the start

These hot keys are printed on a one-page presenter's reference card and on the presenter's-view monitor.

### 3.6 Court export bundle

Whether the investigator presents live or hands off to a prosecutor, the **Court Export Bundle** is one click:

- Self-contained `.zip` (or alternatively a portable executable for offline courtrooms)
- Frozen Reproducibility Pack at its core
- Pre-built sequenced presentation (the frames the investigator chose, in order)
- All four views available
- All defense-handling hot keys functional
- No network calls required to play it back
- Opens in a stripped-down ChainSight Viewer (a free, redistributable client) on the courtroom machine
- Audit log of every frame shown, when, and to whom (useful for appellate record)

This is the artifact that goes into evidence custody before trial. Same numbers, same visuals, every time it's opened — that's the [D'Aloia mathematical-audit](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/) guarantee, applied to courtroom presentation.

### 3.7 Integration with the pillars

| Pillar                | Touchpoint                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State**      | Every frame is a structured query against the SBS — the presentation is literally a sequence of SBS reads, all reproducible             |
| **Reproducibility**   | The presentation bundle is the Reproducibility Pack with a presentation layer on top; opposing counsel can reconstruct everything shown |
| **BYOK Marketplace**  | None during playback — the bundle is self-contained, no live provider calls. The frozen attribution snapshot is what's shown            |
| **PSR**               | View C is the PSR module's observer mode                                                                                                |
| **Math Service (G7)** | The accounting panel is a real-time read from the Math Service's precomputed case-level results                                         |

---

## Feature 4 — Automatic Obfuscation Detection

### 4.1 The problem

Sophisticated launderers use repeatable patterns. Investigators learn to spot peel chains, chain hopping, swap-and-bridge sequences, and mixer routing by experience — but the patterns are programmatic and the platform should recognize them automatically. Existing tools surface some of these (Chainalysis flags peel chains, TRM flags chain hopping); none of them surface all of them with confidence scores and rich context.

This is also a Critic-Agent ally: when the AI detects "this looks like a peel chain," it becomes a structured BeliefAtom the investigator can confirm or reject, which feeds the ground-truth flywheel.

### 4.2 The patterns ChainSight recognizes (Phase 2 launch set)

**Peel chains** — long sequences of transactions where each tx sends a small amount to one address (the "peel") and the bulk of the value to a new change address. Classic Bitcoin laundering pattern. Detected by:

- Sequential txs with one consistent counterparty pattern
- Geometric value decay across hops
- Change-output addresses appearing only once
- Temporal regularity (often automated, so tx intervals cluster)

**Chain hopping** — moving funds across multiple blockchains to break visibility. Detected by:

- Cross-chain bridge usage within a short time window
- Multi-bridge chains (BTC → wBTC on ETH → bridged to BSC → bridged to TRX)
- Value preservation across hops (signaling pass-through, not legitimate use)
- Use of bridges with weak attribution (heuristic-matched, no message ID)

**Token swap obfuscation** — converting between tokens repeatedly to break value continuity. Detected by:

- Multiple swaps within a short time window
- Round-trip swaps (USDT → ETH → USDT)
- Swaps with abnormal slippage acceptance (paying to move, not to trade)
- Use of low-liquidity pools (paying premium slippage for privacy)

**Mixer entry/exit** — funds entering or leaving known mixing services. Detected by:

- Direct interaction with known mixer contracts (Tornado Cash, Sinbad, ChipMixer historical, Wasabi/Whirlpool, etc.)
- Temporal correlation between deposits and withdrawals across known mixer pools
- Standard mixer denomination patterns (Tornado's 0.1/1/10/100 ETH pools)

**CoinJoin participation** — Bitcoin-specific. Detected by transaction structure heuristics:

- Equal-value outputs in coordinated transactions
- Wasabi/Whirlpool/JoinMarket signature patterns
- Participant clustering breaks at CoinJoin boundaries

**Layered split-and-merge** — funds split across many addresses and re-merged at a downstream point. Detected by:

- Fan-out followed by fan-in within a graph window
- Roughly preserved total value across the layer
- Synthetic dust additions to break amount-matching heuristics

**Dusting** — small amounts sent to many addresses, then watching them coalesce. Detected by:

- Outbound transactions to large numbers of addresses with abnormally small values
- Follow-on consolidation patterns

**Round-tripping through CEXs** — funds sent to an exchange and withdrawn to a different address to break on-chain attribution. Detected by:

- Subpoena-confirmed deposit/withdrawal at the same VASP within a short window
- Net-zero net flow at the VASP for that account
- Amount preservation (minus exchange fees) suggesting pass-through, not trading

**Bridge front-running / spoofing** — using bridge contracts in unusual sequences to confuse correlation. Detected by:

- Multiple deposits to a bridge from related addresses within a short window
- Mismatched src/dst values that suggest the heuristic-matcher might pick the wrong destination
- Use of intent-based bridges (Across, Squid) in patterns that exploit relayer behavior

**Time-decay laundering** — letting funds sit dormant before moving, to break temporal correlation heuristics. Detected by:

- Long dormancy followed by sudden activity matching pre-dormancy value
- Dormancy windows aligned with known forensic-tool refresh cycles

**Smart-contract obfuscation** — moving funds through contracts whose only purpose is value pass-through. Detected by:

- Newly deployed contracts with no public source
- Single-purpose contracts (one function, called once, by one address)
- Self-destruct patterns after value pass-through

### 4.3 The detection architecture

Each pattern has its own detector, structured as:

```typescript
ObfuscationDetector {
  id: string                      // "peel_chain", "chain_hop", "token_swap_obfuscation", ...
  category: enum                  // utxo | account | cross_chain | mixer | exchange | contract
  pattern_description_md: text    // human-readable description of what the pattern looks like
  detection_method: enum          // rule_based | graph_neural_network | hybrid
  detection_logic_ref: string     // pointer to the actual detector implementation
  rule_version: string            // versioned for reproducibility
  ground_truth_examples: ExampleRef[]   // canonical real-world cases for regression testing
  false_positive_rate: float      // tracked over time
  true_positive_rate: float       // tracked over time
  current_confidence_threshold: float
  tier: enum                      // T1 (rule-based) | T3 (ML-based, requires corroboration)
}

ObfuscationFinding {
  id: uuid
  case_id: uuid
  detector_id: string             // FK to ObfuscationDetector
  affected_entities: EntityRef[]  // addresses, txs, paths involved
  span_start: timestamp
  span_end: timestamp
  confidence: float
  rationale_md: text              // detector-generated explanation
  evidence_links: BeliefAtomId[]
  status: enum                    // detected | acknowledged | confirmed | dismissed
  reviewer_id: investigator_id | null
  reviewed_at: timestamp | null
  reviewer_notes: text | null
}
```

When a finding fires:

1. A `BeliefAtom` is written with the detector as provenance and tier per detector type
2. The Critic Agent reviews — for ML-based detectors, the Critic requires corroborating evidence before the finding can be promoted to high confidence
3. The investigator sees a `🚨 Obfuscation pattern detected` badge in the case header
4. The Findings tab lists all current findings with their confidence and evidence
5. The canvas overlays the affected entities with a distinctive marker (the 🪤 icon from the canvas UX library, or a dashed boundary around the affected span)
6. The investigator can confirm / dismiss / annotate each finding; confirmations feed the B7 ground-truth flywheel

### 4.4 Why this matters

Three reasons.

First, **investigators don't always know what they're looking at**. A junior investigator might see a long sequence of small txs and not recognize a peel chain. The platform names it.

Second, **detection is a force multiplier for the Tracer Agent**. When the Tracer encounters a known obfuscation pattern, it switches into a specialized handler — peel chains get the haircut/poison methodology, mixer entries get a hard boundary marker with temporal-correlation downstream tracing, chain hops get bridge-specific resolution. Detection isn't just labeling; it's routing.

Third, **patterns are evidentially powerful**. A report that says "the suspect employed a peel chain (defined as: X), evidenced by the 14 transactions on this chart, each demonstrating the pattern's signature characteristics" is far stronger in court than "the suspect moved funds through a series of intermediate addresses." Naming the pattern with its programmatic detection rationale is the difference between accusation and demonstration.

### 4.5 Integration with the pillars

| Pillar                         | Touchpoint                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State**               | Every ObfuscationFinding emits a BeliefAtom                                                                                              |
| **Reproducibility**            | Detector rule versions pinned in the Reproducibility Pack — opposing counsel can re-run the detector on the frozen chain data            |
| **BYOK Marketplace**           | ML-based detectors may run as BYOK capabilities (some agencies will want their own models) or as platform-bundled models                 |
| **PSR / Reports**              | Findings inserted into report templates as a dedicated "Obfuscation methods identified" section                                          |
| **Canvas UX**                  | Affected spans rendered with the 🪤 icon and the dashed-boundary overlay                                                                 |
| **Court Mode (Feature 3)**     | Findings are first-class frame candidates — "let me show you the peel chain" jumps to a curated view of the affected hops                |
| **Critic Agent (B5)**          | Reviews every finding before it surfaces to the investigator; T3 ML detections require corroboration                                     |
| **Ground Truth Flywheel (B7)** | Confirmed/dismissed findings train the detectors; weekly regression runs against canonical examples block deploys on accuracy regression |

---

## Cross-feature interactions

These four features aren't independent. They reinforce each other:

- **Document Ingest → Deconfliction**: A subpoena return reveals that the same exchange already processed a freeze request for another case. The deconfliction tab surfaces it.
- **Obfuscation Detection → Court Mode**: A confirmed peel-chain finding becomes a one-click courtroom view ("let me show the jury how the peel chain worked").
- **Obfuscation Detection → Document Ingest**: A detected chain-hop pattern triggers an automatic MLAT request draft for the foreign bridge operator.
- **Deconfliction → Document Ingest**: A coordinating agency shares a subpoena return; ingest links it to our case automatically with their attribution as provenance.
- **Court Mode → Deconfliction**: The deconfliction history is a default appendix in the Court Export Bundle, so the judge can see the coordination posture.

---

## Build phasing

| Phase       | Additions from this addendum                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | Deconfliction tab data model; manual ExternalInvestigatorEntry CRUD; CaseDocument data model; document upload with platform-managed storage; storage backend abstraction with AWS S3 default                                                                                            |
| **Phase 1** | Document Extraction Agent (subpoena returns + bank statements first); on-prem storage backend (MinIO, NFS); manual deconfliction tab UI; obfuscation detection v1 (peel chains, mixer entry/exit, basic chain hopping — rule-based detectors only)                                      |
| **Phase 2** | Auto-detected deconfliction within agency tenant; document types expansion (court orders, MLAT, victim statements); Present in Court mode with all four views; accounting-follows-the-frame panel; obfuscation detection v2 (CoinJoin, token-swap obfuscation, layered split-and-merge) |
| **Phase 3** | Cross-agency deconfliction (federated, consent-gated); audio transcription for suspect interviews; obfuscation detection v3 (smart-contract obfuscation, time-decay, bridge front-running — ML-based detectors with Critic gating); Court Export Bundle with portable viewer            |
| **Phase 4** | Full federated deconfliction network with privacy-preserving exchange; full obfuscation detection library with quarterly catalog updates                                                                                                                                                |

---

## Updated three-pillars summary

The three architectural pillars are unchanged, but Feature 2 elevates **storage interchangeability** to a sub-pillar of BYOK Marketplace:

> **Pillar 3 — BYOK Provider & Storage Marketplace.** Every external data source AND every storage backend is interchangeable. Agencies bring their own data deals AND their own infrastructure. ChainSight ships the integration surface, the engine, and the encryption — the customer brings everything else.

This expansion is critical for the on-premises / classified-deployment customer profile. A federal LE agency with strict data-sovereignty requirements can now run ChainSight without a single byte of case data leaving their infrastructure.

---

## Where the design pack stands

Nine documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md` — Mind map (v0.1)
2. `chainsight_schema.md` — Module spec (v0.1)
3. `chainsight_merged_v0_2.md` — Accuracy spine (v0.2)
4. `chainsight_v0_3_addendum.md` — PSR module (v0.3)
5. `chainsight_v0_3_byok_addendum.md` — BYOK Marketplace (v0.3)
6. `chainsight_v0_4_consolidated.md` — Locked decisions (v0.4)
7. `chainsight_v0_4_canvas_ux_addendum.md` — Canvas UX (v0.4)
8. `chainsight_v0_4_api_key_entry_addendum.md` — API key UX (v0.4)
9. `chainsight_v0_5_addendum.md` _(this file)_ — Deconfliction, Document Ingest, Court Mode, Obfuscation Detection (v0.5)
