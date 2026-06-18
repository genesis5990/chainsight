# ChainSight v0.7 — Gap Analysis

> A frank assessment of what's missing from the design pack as of fourteen documents in.
>
> The goal here is not to add features for the sake of adding features. It's to surface the gaps that would actually hurt the product if it shipped without them — operational realities investigators hit in real cases, domains the design has implicitly ignored, and lifecycle concerns that affect whether the platform survives beyond v1.

I'll organize this into three buckets and then make recommendations on which gaps to close before Phase 0 starts vs. which can wait.

---

## Bucket 1 — Operational gaps (what investigators actually do)

These are real workflows investigators run in 2026 that the design doesn't yet support.

### 1.1 The expert witness / Daubert lifecycle
**Gap:** The platform produces court-defensible reports but treats the *expert witness* as a passive consumer of those reports rather than a first-class user.

Real-world reality: in the US, blockchain forensic evidence enters court through expert testimony under [Daubert / FRE 702](https://blockeden.xyz/blog/2026/04/11/blockchain-evidence-courtroom-trm-labs-on-chain-analytics-legal/). The expert is a specific human with a CV, a publication record, and prior testimony that defense counsel will attack. The platform should help them:

- Maintain a CV/qualifications dossier that auto-attaches to expert declarations
- Track every prior case they've testified in (so they can answer "have you ever been ruled inadmissible?")
- Capture methodology preferences per expert (some prefer LIBR, some FIFO — their preference should pre-populate report templates)
- Manage Daubert challenge responses — a library of "questions you'll be asked on cross-examination and how to answer them" tailored to the methodologies used in the case
- Track their own training, certifications, and continuing education (Chainalysis Reactor cert, CCI, CCFC, etc.) — these get cited in their qualifications

**Recommendation:** Add an "Expert Witness Profile" module. Low complexity, high credibility impact for the LE and private-investigator markets.

### 1.2 The supervisor / case review workflow
**Gap:** The design assumes individual investigators work cases. In reality, every case has a chain of command — line investigator → squad supervisor → ASAC → SAC, or in private sector, analyst → senior analyst → manager → director.

Supervisors need:

- A dashboard showing every active case in their span of control with risk-tier indicators
- Review checkpoints (work-in-progress vs. ready-for-supervisor-review vs. supervisor-approved)
- The ability to challenge findings without polluting the working case (an "approval sidebar" rather than direct edits)
- Sign-off workflows for high-impact actions (freeze requests, seizure recommendations, expert declarations)
- Caseload balancing — see who's overloaded, who has capacity

**Recommendation:** Add a "Supervisor Mode" workflow layer in Phase 1. This is the difference between a tool individual investigators love and a tool agencies actually buy at scale.

### 1.3 The handoff / case transfer workflow
**Gap:** Investigators leave agencies. Cases get reassigned. Joint task forces hand cases between agencies. None of this is currently modeled.

What's needed:

- A first-class "Case Transfer" workflow — assigning a case to a new lead investigator within or across teams
- Knowledge transfer artifacts auto-generated at transfer (summary of what's been done, open threads, pending subpoenas, relationships with cooperating investigators)
- Continuity of audit trail — every prior investigator's contributions remain attributed; the new investigator's work builds on top
- Cross-agency transfer with MLAT/MOU support — case export to another ChainSight tenant with consent and chain-of-custody preservation

**Recommendation:** Phase 2. Not critical for v1 (a case can be reassigned manually) but a frequent ask once the platform gets used by real teams.

### 1.4 The chain-of-custody for digital evidence
**Gap:** The design captures evidence storage and the Reproducibility Pack, but the *chain of custody* — who handled what, when, with what authority — is implicit rather than explicit.

What's needed:

- Every action that touches evidence (view, export, share, print) logged to a tamper-evident chain-of-custody record
- Hash-chained log entries so tampering is detectable
- Optional cryptographic timestamping (anchored to a public chain, per G2)
- Court-ready chain-of-custody report as a standard exhibit type
- Integration with physical evidence systems (some agencies still print and bag — the platform should produce barcode-able evidence labels)

**Recommendation:** Bump from implicit-in-audit-trail to first-class in Phase 0. The cost of adding it later is high; the cost now is small.

### 1.5 The mobile / field workflow
**Gap:** Investigators sometimes need to see case data from the field — at a search warrant execution, at an exchange office, in a courtroom waiting room. The design assumes desktop.

What's needed (in priority order):

- Mobile-responsive read-only view of cases (Phase 1)
- Mobile-friendly Court Mode (so the investigator's tablet can drive the courtroom display)
- Field IOC capture — at a warrant execution, an investigator photographs a written wallet address; the app extracts the address (OCR), validates it, and adds to the case
- Push notifications for watchers and deconfliction alerts to the investigator's phone (already implied by v0.5 watcher alerts but not spec'd for mobile)

**Recommendation:** Mobile read-only in Phase 1; field capture in Phase 2; full mobile authoring never (too risky for a court-defensible workflow).

### 1.6 The training / sandbox environment
**Gap:** Investigators need to learn the platform. Agencies need to onboard new hires. Neither is addressed.

What's needed:

- A built-in training mode with seeded cases (the Bybit hack, the Bitfinex hack, the Ronin bridge, the Mt. Gox cold-storage trace — all public, all canonical training datasets)
- Tutorial walkthroughs that introduce features progressively
- Quiz/certification mode — the platform can issue a ChainSight Investigator Certification for completion, signable by the agency
- A sandbox tenant separate from production — investigators can experiment without polluting real cases

**Recommendation:** Phase 1 essential. This is also how the platform amplifies its reach — agencies will use ChainSight for their internal training even when they're using other tools for casework, which gets ChainSight into the seat.

### 1.7 The "I made a mistake" workflow
**Gap:** Investigators sometimes get things wrong — promote an attribution that turns out to be wrong, mark the wrong tx as important, build a path that turns out to be a dead end. The platform's immutability principles (G5) are correct but need a graceful retraction story.

What's needed:

- "Retract" workflow for any belief atom, attribution, mark, or path — does not delete, but adds a "retracted_by" event with rationale
- Cascading impact analysis — if I retract this attribution, which downstream findings are affected?
- Court-grade retraction reports if a finalized path is later determined to be incorrect (this is unavoidable in real casework and the platform should handle it gracefully rather than pretend it never happens)
- The ability to issue a "supplemental report" that supersedes prior conclusions while preserving the prior record

**Recommendation:** Add to Phase 2. This is also how the platform stays out of legal trouble itself — pretending mistakes never happen is a much worse posture than handling them well.

---

## Bucket 2 — Domain gaps (chains, assets, attack patterns)

These are areas of the crypto ecosystem the design has implicitly ignored.

### 2.1 The privacy-coin boundary
**Gap:** The design mentions Monero, Zcash, Aleo, and Iron Fish exist and treats them as "hard boundaries." It doesn't address what investigators actually do at those boundaries.

Real 2026 reality: privacy coins are [resurging](https://blockeden.xyz/blog/2026/01/28/privacy-coin-revival-zcash-monero-surge-regulatory-pressure/), Monero's FCMP++ upgrade makes it [statistically untraceable at scale](https://www.cryptotimes.io/2026/06/05/zcash-vs-monero-the-2026-privacy-coin-war-just-got-decided-in-one-week/), and Zcash's selective disclosure (viewing keys) creates a new investigative primitive: **a court order can compel a Zcash user to surrender viewing keys**, and the platform should know how to use them.

What's needed:

- Privacy-chain boundary handlers that explicitly mark where on-chain tracing ends
- Viewing-key ingestion for Zcash — when an investigator obtains a viewing key (via subpoena, search warrant, or voluntary disclosure), the platform can resolve shielded transactions and re-render them on the canvas
- Statistical-correlation tooling for Monero — the platform can't crack Monero, but it can do timing-correlation analysis when the investigator has both entry and exit points (typically an exchange deposit on one end and a withdrawal on the other)
- Atomic-swap detection for cross-privacy-coin hops (BTC ↔ XMR via Thorchain / Maya / Atomic Wallet)
- Dust analysis on transparent legs of Zcash transactions (t-addresses) to identify entities transacting at the privacy boundary

**Recommendation:** Phase 2. This is a credibility feature — being honest about what's possible at the privacy boundary differentiates the platform from competitors who oversell.

### 2.2 The L2 / ZK rollup landscape
**Gap:** The design lists "Base, Arbitrum, Optimism, Polygon, zkSync" but doesn't address what makes L2 forensics structurally different.

Real reality: by 2026, [ZK rollups exceed $70B TVL](https://degen0x.com/learn/zk-rollups-guide-2026/) with zkSync leading at $6.5B. L2s have:

- **Sequencer-controlled ordering** (no public mempool the way L1 has) — affects MEV analysis
- **Forced-inclusion mechanisms** for censorship resistance — investigators can use these to force a transaction onto an L2 even if the sequencer is hostile
- **Withdrawal delays** (7-day for optimistic rollups, near-instant for ZK rollups) — affects the timeline of any L2 → L1 trace
- **L1 batch posting** — the canonical L2 state arrives on L1 in batches; tracing requires understanding which L1 tx posted which L2 batch
- **Cross-rollup messaging** (Hyperlane, LayerZero on L2, native L2-to-L2 bridges) — a separate category from L1-to-L1 bridging
- **L3s and app-chains** — privacy-focused L3s on top of L2s are emerging and may be untrackable

What's needed:

- L1-batch-to-L2-transaction correlation as a first-class capability (decode L1 batch postings into the L2 txs they contain)
- L2-specific bridge handling — withdrawal/deposit through the rollup's canonical bridge looks different from third-party bridges
- Sequencer awareness — the platform should know which sequencer ordered which tx, who runs the sequencer, and what censorship-resistance properties apply
- Privacy-L3 boundary detection (analogous to privacy-coin boundary)

**Recommendation:** Phase 1 for the basics (treating L2s as first-class chains, not afterthoughts); Phase 2 for the deeper L2-specific tooling.

### 2.3 Stablecoin freeze + reissue workflows
**Gap:** [Stablecoin freezes are now routine](https://hodder.law/what-to-do-if-the-dea-seizes-your-usdt-or-usdc/) — USDT freezes [exceeded $25-30M in single-month destroyed-token spikes in 2025](https://blog.amlbot.com/stablecoin-freezes-2023-2025-a-data-backed-analysis-of-usdt-vs-usdc-by-amlbot/). The design mentions freezes but doesn't address the full freeze → burn → reissue → restitution lifecycle.

What's needed:

- Stablecoin-issuer integration as a first-class BYOK capability (Tether's blacklist API, Circle's freeze workflow, Paxos, FDUSD, etc.)
- Freeze request templates auto-populated from the case (address, evidence summary, requesting jurisdiction)
- Burn detection — automatically detect when a frozen USDT/USDC is burned (the "decrease total supply" event signature)
- Reissue tracking — when Tether mints clean replacement USDT to a LE-controlled address, the platform should detect this and link it back to the original frozen funds for restitution accounting
- Victim restitution accounting — when a freeze leads to recovery, distributing recovered funds across multiple victims requires its own methodology (pro rata vs. tracing-based vs. statutory order)
- Freeze-window detection — automated alerts when a watched address moves funds to a stablecoin (creating a freeze opportunity)

**Recommendation:** Phase 1 — this is one of the highest-frequency investigator workflows in 2026 and shipping without it is unacceptable.

### 2.4 NFTs, ordinals, runes, and non-fungible assets
**Gap:** The design treats every asset as a fungible token. NFTs (ERC-721, ERC-1155), Bitcoin Ordinals, Runes, and Solana non-fungibles are all evidentially important and have different tracing properties.

What matters:

- NFT theft / wash trading / market manipulation are real case types
- NFTs as money-laundering vehicles (sell at inflated price between conspirator wallets, "clean" funds appear)
- Identifiable individual asset tracing — every NFT has a unique ID; tracing a stolen NFT is more like tracing a stolen car than tracing money
- NFT-related obfuscation (collection-spam wash trading, hidden royalty siphons, marketplace exploits)
- Cross-marketplace tracking (OpenSea, Blur, Magic Eden, Tensor, Sudoswap, Solanart)

**Recommendation:** Phase 2 for basic NFT support; Phase 3 for marketplace-specific decoders. Lower priority than stablecoins, but real and growing.

### 2.5 DeFi-specific exploits and incident response
**Gap:** The design supports tracing through DEX swaps and bridges. It doesn't specifically address DeFi *exploits* (flash loan attacks, oracle manipulation, governance attacks, smart-contract vulnerabilities) — which are now a major share of crypto crime investigations.

What's needed:

- Flash-loan attack reconstruction — these are atomic, single-tx exploits with complex internal call trees; decoding them properly requires the Inspector's decoded-action capability extended significantly
- Oracle manipulation detection — patterns where an attacker manipulates a price oracle to extract value
- Governance attack detection (proposal-execution patterns that drain treasuries)
- Smart-contract vulnerability classification — when funds were extracted via a CVE-class vulnerability, the case has a different evidentiary structure than a wallet-compromise case
- MEV-extraction forensics — sandwich attacks, JIT liquidity, frontrunning — these are sometimes the *crime* (when targeting victims) and sometimes the *symptom* (showing the attacker's funds path)
- Auditor / post-mortem report ingestion — major exploits have public post-mortems from auditors (Trail of Bits, Spearbit, OpenZeppelin); the platform should ingest and link them

**Recommendation:** Phase 2 for the basics (flash-loan reconstruction, exploit classification); Phase 3 for the advanced detectors. Critical for the financial-crime-investigator and compliance-team market segments.

### 2.6 Lightning Network and off-chain layers
**Gap:** Lightning Network handles a non-trivial volume of Bitcoin payments. It's off-chain by design. The platform's tracing primitives stop at the channel-open and channel-close transactions on-chain, missing everything in between.

What's needed:

- Lightning channel open/close detection
- Lightning-related entity attribution (channel-routing nodes, custodial Lightning services like Wallet of Satoshi, Cash App)
- Routing-fee analysis (commercial Lightning routing nodes have distinctive patterns)
- The honest acknowledgment that off-chain Lightning hops are not traceable from on-chain data alone (analogous to privacy-coin boundary)

**Recommendation:** Phase 3. Not high-volume for casework yet but growing.

### 2.7 Newer asset classes that will matter
**Gap:** The design doesn't address asset classes that are emerging but will be significant by the platform's Phase 3 timeframe:

- **Real-world asset tokenization (RWA)** — tokenized treasuries, real estate, equities — these create complex bridges between on-chain forensics and traditional financial-crime forensics
- **CBDC integration** — when central bank digital currencies launch, they will have privacy and traceability properties unlike anything else
- **Privacy-preserving DeFi (Aztec, Penumbra, Railway)** — ZK-based privacy on Ethereum and Cosmos that creates new investigative boundaries
- **Account abstraction (ERC-4337)** smart wallet patterns — recovery wallets, social recovery, gasless transactions — change attribution heuristics

**Recommendation:** Track as roadmap items; spec when the case-volume justifies it. Not a v1 concern.

---

## Bucket 3 — Business / lifecycle gaps (does the platform survive?)

These are gaps that affect long-term viability, not just functionality.

### 3.1 The pricing and packaging model
**Gap:** v0.7 introduced the dual deployment model (On-Prem Sovereign + SaaS Blind) but the pricing model itself isn't spec'd.

Open questions:

- Per-seat or per-case or per-investigation-hour?
- Tiered by feature or unlimited?
- BYOK provider passthrough — does the agency pay providers directly or through us with a markup?
- Pilot / proof-of-concept terms — what does a 90-day pilot cost?
- Government contracting vehicles — GSA Schedule, SEWP, CIO-SP, OASIS+
- Reseller and channel partner economics (the G8 open question)

**Recommendation:** This is a Go-to-Market document, not a design document. Defer until that artifact is built (Option C in the v0.6 closing).

### 3.2 The vendor sustainability story
**Gap:** A sovereign on-prem product that the vendor cannot read raises a real question: how does the vendor know what features customers want, what's breaking, what to improve?

Without telemetry, the vendor flies blind on:

- Feature usage patterns
- Performance issues in specific customer environments
- Bug rates and severity
- Where investigators get stuck

This is fixable but requires deliberate design:

- **Opt-in detailed telemetry** with very clear "here's exactly what we'd see" disclosure — some customers will opt in for the benefit of improving the product
- **Aggregated diagnostic packs** that customers can review and submit manually when filing a support ticket
- **A customer advisory board** with hands-on agencies who agree to deeper engagement in exchange for influence on the roadmap
- **Open-source the non-secret parts** so the development community can contribute to detectors, decoders, and connectors (the "secret sauce" stays proprietary; the periphery is community)

**Recommendation:** Address explicitly in the v0.7 governance documentation. This is a credibility issue with technical buyers who have seen too many vendors hide behind privacy claims to avoid accountability.

### 3.3 The data-broker and reseller boundary
**Gap:** Agencies will sometimes ask the vendor to act as a data broker (e.g., "we don't have a TRM contract but we need TRM data for this case — can you get it for us?"). The vendor's posture on this needs to be explicit.

The trade-off:

- Vendor-as-broker: simpler for customers, adds revenue, but compromises the "vendor is never a counterparty" promise
- Pure BYOK: cleaner trust story, but creates friction for smaller customers without procurement budget for multiple data subscriptions

**Recommendation:** Pure BYOK in v1 (consistent with the sovereignty principle). Vendor-as-broker possible in v2 if customer demand is strong, with strict separation between brokered data and platform operations.

### 3.4 The certification and accreditation roadmap
**Gap:** Federal agencies require specific certifications. The current pack mentions FedRAMP and CJIS in passing but doesn't lay out the realistic timeline.

What's needed:

- **SOC 2 Type 2** — table stakes; 6–9 months from start
- **FedRAMP Moderate** — typical 12–18 month process with the right sponsor
- **FedRAMP High** — additional 6–12 months on top of Moderate
- **CJIS compliance** — required for any state/local LE use; not a formal cert but documented conformance
- **IL5 / IL6** — DoD impact levels for sensitive workloads; requires GovCloud or equivalent
- **CMMC** — Cybersecurity Maturity Model Certification for defense contractors
- **ISO 27001 / 27017 / 27018** — required for international (EU, UK, Asia) federal work
- **Common Criteria EAL** — required for some intelligence-community uses

These cost money and time. The order matters: SOC 2 → FedRAMP Moderate → FedRAMP High → CJIS conformance is the typical path for a US LE-focused product.

**Recommendation:** Explicit certification roadmap in the v0.7 deployment doc, with milestones tied to phases. SOC 2 Type 1 by end of Phase 2; SOC 2 Type 2 by end of Phase 3; FedRAMP Moderate sponsor identified by end of Phase 3.

### 3.5 The insurance and liability posture
**Gap:** A platform whose output is used to support seizures, freezes, and prosecutions carries real liability. The design doesn't address it.

What's needed:

- E&O (Errors and Omissions) insurance sized to expected case values
- Cyber liability insurance (the platform handles classified data; a breach is catastrophic)
- Master services agreement language that allocates liability appropriately (limitation of liability, indemnification for IP claims, etc.)
- "Methodology disclaimer" boilerplate in every report — the platform produces analyses; the human investigator (and the prosecuting attorney) bear legal responsibility for using them

**Recommendation:** Engage outside counsel before Phase 0 ships. The legal architecture matters as much as the technical architecture.

### 3.6 The dependency-risk story
**Gap:** Every BYOK provider is a potential single point of failure for an agency's casework. What happens when Chainalysis raises prices 3x? When TRM is acquired by a foreign company? When Etherscan deprecates a critical API? When the LLM provider rate-limits the agency mid-case?

What's needed:

- Multi-provider redundancy at every layer (already designed via the capability router)
- Provider risk dashboard — agency admins see "how exposed are we to single-provider failure?"
- Open-source fallbacks where possible (self-hostable RPC nodes, OFAC list ingestion direct from gov sources, local LLM for narrative drafting)
- Vendor diversity recommendations — when the agency installs only one attribution provider, the platform surfaces a "you have no fallback for entity attribution" warning
- An "in-house heuristics" tier so the platform has baseline attribution even with zero external providers (CIH for UTXO, behavioral patterns for account-model, sanctions matching from public lists)

**Recommendation:** Phase 1 — this is core to the BYOK trust story. Without it, BYOK becomes vendor lock-in by another name.

### 3.7 The end-of-life and data portability story
**Gap:** Agencies need to know that if ChainSight goes out of business or they choose to leave, their data is portable.

What's needed:

- **Reproducibility Pack is the canonical export format** (already designed) — every case can be exported in a vendor-neutral form
- **Open documentation** of the Pack format so third parties can build importers
- **A perpetual on-prem license escrow** option — if the vendor ceases operations, customers can continue using their version of the software indefinitely
- **Source-code escrow** for enterprise customers — the source goes into escrow with a neutral third party; on a triggering event (vendor bankruptcy, abandonment, acquisition by hostile entity), the customer gains release rights

**Recommendation:** Phase 0 documented; Phase 2 source-code-escrow option for enterprise tiers.

### 3.8 The bias, fairness, and civil-rights audit story
**Gap:** A platform that helps the government decide whose funds to seize and whose property to forfeit raises serious civil-liberties questions. The design has not addressed how it ensures the platform isn't producing biased outcomes.

What's needed:

- **Methodology audits** — independent third-party verification that the platform's heuristics don't disproportionately flag specific demographics, regions, or use cases
- **False-positive rate publication** — committed to a numerical FPR target for obfuscation detectors and attribution outputs, with public reporting
- **Adversarial testing program** — a permanent red team that probes the platform for ways it could be misused or produce wrong results
- **Civil-liberties review board** — for federal customers, a formal review board including civil-liberties advocates that reviews high-impact features (e.g. attribution promotion, watcher rules)
- **Transparency reports** — annual public reporting on platform usage patterns at the aggregate level (number of investigations, number of freezes supported, etc.)

**Recommendation:** Phase 2. This is not optional for a platform serving government customers in 2026; it's the difference between being seen as a tool of justice and a tool of overreach.

### 3.9 The localization and internationalization story
**Gap:** The platform is implicitly US-centric. Reports default to USD, methodologies default to US-friendly ones, attribution defaults to US providers, legal framing is US-centric.

For international sales, what's needed:

- Multi-jurisdiction methodology defaults (UK: pari passu + rolling charge + Section 104; EU: TFR + MiCA-aware; etc.)
- Multi-currency fiat conversions and reporting
- Multi-language UI (English, Spanish, French, German, Portuguese, Japanese, Mandarin at minimum)
- Local OFAC equivalents (UK OFSI, EU restrictive measures, UN sanctions, OFSI Switzerland, etc.)
- Jurisdiction-specific document templates (the UK SAR is different from the US SAR is different from FinCEN 314(a))
- Data residency requirements per jurisdiction (already enabled by the storage abstraction)
- Local certification paths (UK Cyber Essentials, Australia IRAP, Singapore IMDA, etc.)

**Recommendation:** Phase 3+. The US market alone can sustain v1 — v2 the international expansion.

### 3.10 The community / network effects story
**Gap:** The most valuable forensics platforms become more valuable as more people use them. The design doesn't address how the platform compounds.

What's needed:

- **Federated personal-attribution network** (already designed in v0.6) — the value scales with participation
- **Open detector library** — agencies can publish detectors for new obfuscation patterns; others can use them; ChainSight curates and validates
- **Shared ground-truth datasets** — anonymized, hash-only sharing of "we saw this pattern, here's the outcome" so the AI improves across customers
- **A user community** — annual conference, online forum, certification program — competing tools (Chainalysis Link, TRM Talks) do this; ChainSight should too
- **Academic and research partnerships** — give researchers access to anonymized data for blockchain forensics research; their papers cite the platform

**Recommendation:** Phase 3 onward. Community building takes time but compounds dramatically.

---

## Synthesis — what to add before Phase 0 ships

If I had to pick the absolutely-must-address-before-coding-starts items from the above, my list is:

1. **Stablecoin freeze + reissue workflow** (2.3) — too central to 2026 casework to defer
2. **Chain-of-custody as a first-class system** (1.4) — too painful to retrofit
3. **L2-specific tooling foundations** (2.2) — the architecture needs to know about L1-batch-to-L2-tx correlation from day one
4. **Dependency-risk and in-house heuristics tier** (3.6) — the BYOK story is incomplete without it
5. **Supervisor mode** (1.2) — without it, the platform is sold one investigator at a time, not one agency at a time
6. **Expert witness profile** (1.1) — small effort, large credibility impact
7. **Bias and fairness commitment in writing** (3.8) — even before there's code, the policy stance needs to exist
8. **Certification roadmap** (3.4) — explicit milestones in the deployment doc

The rest can wait — they're real but they're Phase 2+ work that benefits from real customer signal before being built.

---

## Things I'd push back on adding

Not every gap should be filled. A few things that have come up across the conversation that I'd argue against:

- **Generative AI for new attack patterns** — the platform should detect known patterns and learn from confirmed cases, but it shouldn't speculate about novel attack types without ground-truth backing. The risk of hallucinated patterns getting promoted to court is too high.
- **Predictive policing features** — "this address looks suspicious based on behavioral patterns alone" without supporting evidence is exactly the kind of thing that gets a platform sued under civil-rights challenges. Stay focused on investigating known crimes.
- **Crypto trading or DeFi-position features** — investigators sometimes ask "can I also see my own crypto holdings here?" The answer is no — that's a different product with different liability and the conflicts of interest are real.
- **Vendor-managed key escrow** — the temptation to offer "we'll hold your keys safely for you, just in case" is real, but it breaks the entire sovereignty story. Don't do it.

---

## Conclusion

The design pack as of fourteen documents is genuinely comprehensive across the core feature set. The gaps that remain are in three flavors:

- **Operational workflows** the design has implicitly assumed away
- **Domain coverage** that needs explicit treatment (privacy coins, L2s, stablecoins, DeFi exploits, NFTs)
- **Business and lifecycle concerns** that affect whether the platform survives long-term

None of these gaps are fatal. All are addressable. The eight items in the synthesis are the ones I'd lock down before any code is written. The rest are valid roadmap items but can mature through customer engagement.

You asked what you might be missing. I think the honest answer is: you have the product. What you're missing is the **non-product apparatus** — the supervisor workflows, the certification roadmap, the liability posture, the bias-audit commitment, the chain-of-custody discipline, the workflows for handing cases between investigators, the moment when an investigator realizes they made a mistake and needs to retract gracefully. The platform you've designed is excellent. The institution that ships it needs the same level of care as the technology.

That's the thing that's actually missing.
