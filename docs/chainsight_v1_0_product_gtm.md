# ChainSight v1.0 — Product Go-to-Market Design

> **Document type:** Product GTM design — deep pass  
> **Status:** Phase 0 reference  
> **Locked decisions referenced:** F46 (packaging), F45 (community), F44 (EOL/escrow), F43 (legal/insurance), F42 (certifications), F41 (bias/fairness), F40 (in-house heuristics), F33 (stablecoin freeze), F29 (chain-of-custody), F27 (supervisor mode), F26 (expert witness), G1 (human-in-the-loop), G5 (path immutability), G8 (BYOK neutrality), G9 (BYOK scope), G10 (transaction-centric graph), G22 (SaaS Blind)  
> **Build posture:** Solo developer + AI agents; SaaS Blind first; On-Prem Sovereign as fast-follow  
> **Infrastructure (SaaS Blind v1):** Supabase (Postgres + pgvector + storage) + Fly.io (application tier, scale-to-zero) + GitHub (CI/CD, Actions) — all existing founder accounts. Phase 0 infrastructure burn: under $300/month at zero customers. AWS migration planned for Phase 2 alongside SOC 2 Type 1 work.

---

## Section 1 — The Competitive Landscape

This section doesn't just list competitors. It analyzes them as sales conversations — what procurement teams say about them, where their contracts live, where they're vulnerable, and where ChainSight sits relative to each.

### 1.1 Chainalysis

**Target customer:** Federal law enforcement (FBI, DEA, IRS-CI, HSI, Secret Service, FinCEN, OFAC), large exchanges, Tier-1 banks, national-level financial-crime units. Reactor is the investigation product; KYT is the compliance monitoring product.

**Pricing model:** Opaque, enterprise-negotiated. Best available data: Reactor starts around $40,000 per seat per year for law enforcement; average contract across all customers is approximately $185,000 per year (Vendr benchmark); enterprise deployments with Reactor + KYT + Kryptos run $500K–$5M+ annually. Chainalysis KYT is volume-based (transaction count), so fast-growth exchanges face escalating costs. UK G-Cloud lists Reactor with Data Solutions at £55,000 per license per year.

**Strengths:**

- The deepest attribution database in the market — 134,000+ entity labels, 325 million+ swaps, 300+ bridges, 75+ supported chains. This is a genuine moat, built over eight years of proprietary data accumulation.
- Incumbent relationship with over 110 government agencies across 70+ countries. The IRS, DOJ, and FBI buy Chainalysis on sole-source authority. This is not an open competition in most federal procurement — it is a monopoly by bureaucratic inertia.
- Reactor's certification program ($699–$1,349 per certification) has trained a generation of investigators. Those investigators advocate for Reactor on budget requests.
- Active LINKS conference (1,000+ attendees), creating community and loyalty.
- FedRAMP-authorized path for cloud deployment.

**Weaknesses:**

- The SaaS model means the vendor has full visibility into every investigation. Chainalysis _could_ read your case data. It operates on a policy prohibition, not a technical guarantee. This is a real objection from federal and intelligence-community customers who've tried to get more restrictive terms.
- Pricing excludes nearly every buyer below the $50,000/year threshold — solo investigators, small task forces, local LE units, private-sector compliance teams at smaller firms cannot access the product. This is a large underserved market.
- Attribution data is a black box. When Reactor says "this address belongs to Exchange X," it doesn't explain its methodology. The [ChainArgos non-determinism problem](https://medium.com/chainargos/blockchain-tracing-determinism-5a690a95ca5f) is real: provider labels drift over time, and a Reactor-based finding from 2023 may no longer reproduce identically today.
- No BYOK architecture. Agencies cannot bring their existing TRM or Elliptic subscriptions and route them through Reactor. Chainalysis wants to be the only data source.
- AI features are being added (Hexagate for threat intelligence, KYT v2 with ML risk scoring), but the accuracy of AI outputs is not provenanced to the same court-defensible standard ChainSight builds to.
- No genuine on-prem option below the highest enterprise tiers.

**Where ChainSight differentiates:** Court defensibility (Reproducibility Pack replays bit-for-bit; Chainalysis cannot offer this). BYOK (agencies bring their Chainalysis Reactor data _into_ ChainSight — the positioning is "ChainSight + your Chainalysis subscription," not "ChainSight instead of Chainalysis"). Sovereignty (technical guarantee, not a policy). Accessible pricing (Phase 0 Investigator tier puts the platform within reach of buyers Chainalysis ignores). Bias/fairness commitment in writing (F41).

**The key sales insight:** Chainalysis is not the enemy. Chainalysis is a BYOK provider. An agency that already pays Chainalysis can add a ChainSight subscription to get court-defensible workflow, AI orchestration, reproducibility, and sovereign deployment — all running on top of the Chainalysis data they're already paying for. The objection "we already pay Chainalysis" is best answered: "Good. Connect your Chainalysis key to ChainSight in two minutes. You just bought an AI agent and a court-mode interface for your existing investment."

---

### 1.2 TRM Labs

**Target customer:** Fintechs, crypto-native firms, DeFi protocols, exchanges, banks — and increasingly federal law enforcement via Orion (a Palantir-style intelligence platform overlaid on TRM Forensics). TRM's Forensics product is the investigation tool; Orion is a proactive threat-intelligence layer. Strong presence in Australia, UK, EU financial-crime units.

**Pricing model:** Enterprise contract, custom. UK G-Cloud lists TRM Forensics Premium at £33,272–£41,590 per license per year. Third-party estimates put average enterprise at $693,000 per year (Vendr), with contracts up to $1.3M. Small teams are estimated at $15,000–$50,000 per year. No public list pricing.

**Strengths:**

- Genuinely innovative product design. TRM invented "glass-box attribution" — their labels include source and methodology, not just a raw label. This is real differentiation over Chainalysis's black-box model.
- Orion is the most ambitious product in the market: an intelligence fusion layer that crosses crypto, open-source, and dark-web signals. No other vendor has built this at scale.
- Strong compliance team market penetration — TRM is the default for mid-to-large exchanges and fintechs who need API-based risk scoring at volume.
- Active in policy and advocacy (regular government testimony, white papers). Strong regulatory credibility.
- Deep coverage of DeFi protocols, NFTs, cross-chain bridges.

**Weaknesses:**

- Orion's intelligence layer means TRM is a data broker for its customers' investigation content. An agency using Orion is feeding its intelligence into TRM's proprietary graph. For classified or sensitive investigations, this is disqualifying.
- No sovereignty story. TRM's architecture is SaaS-native. An agency cannot deploy TRM on-premises without a custom contract that may not exist.
- Pricing is opaque and high — the same barrier as Chainalysis for smaller customers.
- The investigation UX is built for compliance analysts, not forensic investigators. Court mode, methodology disclosure, expert witness workflow — these aren't TRM's design priorities.
- No reproducibility guarantee. If TRM changes an attribution label six months after a case is closed, the original finding does not replay the same way.

**Where ChainSight differentiates:** ChainSight embraces TRM's glass-box approach and extends it — every attribution carries full provenance to the specific provider response, frozen at case-close (F46 BYOK). Sovereignty is the decisive differentiator for federal customers currently struggling to get Orion through sensitive program restrictions. The Reproducibility Pack solves the non-determinism problem that glass-box attribution partially but not fully addresses.

---

### 1.3 Elliptic

**Target customer:** Banks, large exchanges, crypto custodians, EU financial institutions. Strong in UK and EU regulatory markets. Navigator is transaction monitoring; Lens is wallet screening; Investigator is the forensics product. Elliptic Discovery is newer intelligence layer.

**Pricing model:** Not published. Industry estimates: Lens entry tier ~$299–$800/month; Navigator API access ~$500–$2,000/month; enterprise tier $2,000+/month ($24,000–$100,000+ annually). AWS Marketplace lists tiers at $50,000 and $100,000 per 12 months.

**Strengths:**

- Strongest EU/UK regulatory compliance posture. When UK/EU regulators ask for blockchain evidence, Elliptic is often the tool they're familiar with.
- Deep financial-institution orientation — Navigator is built for compliance teams, not just investigators.
- Strong coverage of DeFi and NFT ecosystems.
- Published research and policy engagement builds credibility with regulators.
- Some on-premises deployment options.

**Weaknesses:**

- US market share is notably weaker than Chainalysis or TRM. Federal LE is not Elliptic's home turf.
- Discovery (the intelligence layer) suffers from the same privacy concerns as TRM Orion — investigation content feeds into a vendor-operated graph.
- No reproducibility guarantee. Same attribution-drift vulnerability as Chainalysis.
- Court Mode, methodology disclosure, and expert witness support are not Elliptic's design priorities.
- Complex modular pricing leads to customers paying for multiple products to get full coverage — a common complaint in G2 reviews.

**Where ChainSight differentiates:** Court-mode and methodology engine (F26, F27, F29, F41). Sovereignty. Reproducibility Pack. BYOK — bring your Elliptic Lens key to ChainSight and route it through the capability router for attribution enrichment.

---

### 1.4 Crystal Intelligence

**Target customer:** EU/CIS exchanges, compliance teams, law enforcement in European jurisdictions, smaller organizations that need professional-grade analytics. Owned by B2Broker group (Luxembourg). Products: Crystal Expert (investigation), Crystal Business (compliance/KYT), Crystal Go (entry-level, ~$1,200/year).

**Pricing model:** Partial transparency. Crystal Go is documented at approximately $1,200/year — the only major platform with an accessible price tier for individuals and small teams. Crystal Expert and Business are custom-quoted but positioned below the top three.

**Strengths:**

- Crystal Go at $1,200/year is the only published accessible price point in the professional-grade market. This creates a real wedge in the SMB and solo-investigator segment.
- Strong coverage of CIS/Eastern European chains and exchanges — important for ransomware and darknet market cases.
- On-premises deployment available.
- EU law enforcement subsidy programs in several jurisdictions.

**Weaknesses:**

- Attribution depth below Chainalysis and TRM for US-based entity labels.
- AI capabilities are nascent compared to Chainalysis's Hexagate or TRM's ML scoring.
- No Reproducibility Pack. No court mode. No methodology disclosure in the Chainalysis sense.
- Community/certification program weaker than Chainalysis Links.
- B2Broker ownership creates opaque governance questions for US federal customers.

**Where ChainSight differentiates:** Court-defensibility, AI orchestration, and sovereignty are all gaps Crystal doesn't fill. At the pricing level, ChainSight's Investigator tier competes directly with Crystal Go — but with a fundamentally superior technical posture for investigators who need their work to hold up in court. Crystal is an acceptable data source as a BYOK provider for ChainSight.

---

### 1.5 Arkham Intelligence

**Target customer:** Individual researchers, traders, DeFi analysts, open-source intelligence practitioners. Recently expanded toward institutional/enterprise with Intel Exchange and API. Not primarily a law enforcement or compliance tool.

**Pricing model:** Core platform free. Premium via ARKM token holdings (token price ~$0.10 as of April 2026, down 97% from ATH). Paid tiers: Standard $149/month, Pro $390/month, API $999/month (third-party estimates, not vendor-confirmed). Intel Exchange bounty mechanics for buying/selling attribution data.

**Strengths:**

- 3 million registered users as of February 2026. By far the largest user base in this space. Most of it built on accessibility and free access.
- Entity labeling with crowd-sourced bounty model — the Intel Exchange creates an economic incentive to contribute attribution data, a model no other platform has built.
- Best consumer-facing UX in the market. The visualizer is genuinely well-designed.
- No procurement barrier for researchers, journalists, and small-scale investigators.

**Weaknesses:**

- Not a law enforcement product. The Intel Exchange model — where attribution data is bought and sold publicly — is deeply problematic for sensitive investigations. An investigator cannot risk their attribution data becoming tradeable intelligence.
- ARKM token-gated premium tiers create unpredictable cost exposure and are impossible to get through government procurement.
- No court mode. No methodology disclosure. No Reproducibility Pack. No chain-of-custody. The platform is built for research and trading intelligence, not court proceedings.
- Attribution data sourced from crowd contributions is unvetted. In court, opposing counsel will dismantle any finding built on anonymous crowd-sourced labels.
- No on-premises option.

**Where ChainSight differentiates:** Everything related to court-defensibility, sovereignty, and institutional-grade methodology. Arkham is a completely different product serving a different user. Not a primary competitor. Arkham data could be a BYOK source — their API provides labeled entity data that can be imported through the capability router and tagged as T2 attribution.

---

### 1.6 Merkle Science

**Target customer:** Mid-market exchanges, banks, VASPs in Asia-Pacific and Southeast Asia. Growing US presence with compliance-team products. Focuses on "predictive risk intelligence" — identifying suspicious behavior before transactions settle.

**Pricing model:** Not published. Third-party positioning at $16,000–$100,000/year, described as more flexible than Chainalysis/TRM for mid-market.

**Strengths:**

- Predictive risk engine is a real product differentiator — not just retrospective tracing, but forward-looking detection.
- Strong APAC market position where Chainalysis is less dominant.
- Emerging US federal presence.
- More flexible pricing and faster sales cycles than top-tier vendors.

**Weaknesses:**

- Attribution depth below the top three for US-based entity coverage.
- No court mode, reproducibility, or methodology disclosure.
- Predictive engine (the main differentiator) raises the predictive policing concerns ChainSight commits against — building toward this capability would violate F41's anti-feature commitments.
- No sovereign deployment option.

**Where ChainSight differentiates:** Court-defensibility and sovereignty. Merkle Science, like Crystal, is a plausible BYOK attribution provider rather than a direct competitor.

---

### 1.7 NOMINIS

**Target customer:** Law enforcement, financial institutions, regulatory compliance. Positioning as a transparent, scalable platform — published pricing model (no hidden lock-ins, per their website). European player with professional forensics tooling.

**Pricing model:** Listed as transparent and scalable with "no hidden lock-ins" — but specific numbers not widely published. Positioned as accessible, likely in the Crystal/Scorechain price range.

**Strengths:**

- Transparent pricing posture is a real differentiation in a market defined by opaque enterprise pricing.
- Multi-chain coverage.
- Law enforcement focus.

**Weaknesses:**

- Brand recognition significantly below the top four.
- Attribution data depth unknown.
- No reproducibility or methodology disclosure features documented.

**Where ChainSight differentiates:** Technical depth, court-defensibility, BYOK architecture, and sovereign deployment — none of which NOMINIS positions on. NOMINIS is plausible as a BYOK attribution provider.

---

### 1.8 Scorechain

**Target customer:** Small-to-mid crypto service providers, VASPs, exchanges needing AML compliance at accessible price points. EU-focused, public pricing.

**Pricing model:** Documented at EUR 500/month (~EUR 6,000/year), confirmed on Capterra and their website. This is the lowest published price point for a full-featured compliance platform.

**Strengths:**

- Most transparent pricing in the market. EUR 500/month is genuinely accessible for smaller teams.
- Full platform at the base tier — no tiered feature stripping.
- Strong EU compliance orientation.
- Pay-as-you-go screening option (no annual commitment).

**Weaknesses:**

- Compliance monitoring product, not primarily a forensics investigation product.
- No court mode, no methodology disclosure, no expert witness tools.
- Attribution depth for US federal investigation use cases is below the top three.
- No sovereign deployment.

**Where ChainSight differentiates:** Same as Crystal — at the pricing level, ChainSight's Investigator tier competes head-to-head with Scorechain on accessibility, but with a completely different technical depth oriented toward court-defensible investigation rather than transaction monitoring.

---

### 1.9 Smaller players (AnChain.AI, Coinfirm, CipherTrace, Solidus, OnChainRisk)

These are either niche products, regional players, or acquisition targets that have been absorbed. AnChain.AI (Mastercard subsidiary) targets financial institutions. CipherTrace (Mastercard) was absorbed for enterprise FI compliance. Coinfirm (EU-focused, partial public pricing, recent funding struggles). Solidus (DeFi-specialized). OnChainRisk (cheap/fast at $49–$249/month for compliance checking).

**Collective weakness:** None of them build toward court-defensibility, sovereign deployment, or a BYOK model that respects the investigator's operational independence.

**ChainSight's opportunity:** These players together define the $15K/year-and-below price tier. ChainSight's Investigator tier competes in this space but out-features all of them on the court-critical workflow layer.

---

### 1.10 Competitive landscape summary table

| Vendor                  | Primary market        | Price floor        | On-prem         | Reproducibility | BYOK         | Court mode   |
| ----------------------- | --------------------- | ------------------ | --------------- | --------------- | ------------ | ------------ |
| **Chainalysis**         | Federal LE, large FIs | ~$40K/seat/yr      | Enterprise only | ❌              | ❌           | Partial      |
| **TRM Labs**            | Fintechs, FIs, LE     | ~£33K/license/yr   | Limited         | ❌              | ❌           | Partial      |
| **Elliptic**            | Banks, EU FIs         | ~$50K/yr           | Some tiers      | ❌              | ❌           | Partial      |
| **Crystal**             | EU LE, SMB            | ~$1,200/yr (Go)    | Yes             | ❌              | ❌           | ❌           |
| **Arkham**              | Researchers, traders  | Free               | ❌              | ❌              | ❌           | ❌           |
| **Merkle Science**      | APAC, mid-market      | ~$16K/yr           | ❌              | ❌              | ❌           | ❌           |
| **NOMINIS**             | LE, FIs               | ~Transparent tiers | Unknown         | ❌              | ❌           | ❌           |
| **Scorechain**          | VASPs, EU SMB         | ~EUR 6K/yr         | ❌              | ❌              | ❌           | ❌           |
| **ChainSight (target)** | LE, PI, compliance    | $149/seat/mo       | ✅ (Phase 0)    | ✅ (Phase 0)    | ✅ (Phase 0) | ✅ (Phase 2) |

The competitive gap ChainSight fills: **no existing platform offers the combination of (a) accessible pricing, (b) court-defensible reproducibility, (c) BYOK architecture, and (d) sovereign deployment.** Every incumbent trades away at least two of these four. ChainSight is designed to hold all four simultaneously.

### 1.11 The infrastructure cost advantage

This is not a marketing claim — it is a structural reality worth understanding for sales conversations about pricing and sustainability.

Chainalysis, TRM, and Elliptic are each operating multi-hundred-engineer organizations on cloud infrastructure that costs millions of dollars per month to run. Their minimum contracts ($20,000–$40,000/year per seat) are priced to cover that cost structure, plus sales teams, plus investor return expectations. When they price a single investigator seat at $40,000/year, that price reflects a legacy cost structure built for a different era of cloud infrastructure.

ChainSight's Phase 0 SaaS Blind stack — Supabase (Postgres + pgvector + object storage) + Fly.io (application tier with scale-to-zero) + GitHub (CI/CD) — runs under $300/month at zero customers. The marginal cost per additional Investigator-tier customer, once the base infrastructure is provisioned, is approximately $15–$40/month in additional Supabase usage, Fly.io compute, and provider API calls from the in-house baseline. That is the structural reason ChainSight can price the Investigator tier at $199/month and operate profitably from customer 1 — not as a subsidized loss-leader, but as a genuine unit-economics win.

The BYOK + cache layer compounds this. The cache layer (G20, locked) means that provider API calls — which are the primary per-customer variable cost in any blockchain forensics platform — are paid by the customer (BYOK) and served from cache for subsequent reads. ChainSight's infrastructure doesn't pay for the expensive data; it pays for the workflow on top of the data the customer is already paying for.

**What this means for sales conversations:** When a prospect says "how can you charge $199/month when Chainalysis charges $3,300/month ($40K/year)?" the honest answer is: "Our infrastructure stack is 10–20x cheaper to operate per customer than platforms built five years ago on a different cost structure. We pass that efficiency to you. We don't have a 500-person sales organization to support."

**The caveat:** The Supabase + Fly.io stack is the right Phase 0 infrastructure, but it is not the right Phase 2+ infrastructure for government customers who require SOC 2 Type 2 or FedRAMP. The AWS migration at Phase 2 is a real cost event (see Section 9). Build it into the capitalization plan — do not surprise investors or customers with it.

---

## Section 2 — The Positioning Statement

### 2.1 The one sentence

> **ChainSight is the blockchain investigation platform that turns any investigator's existing data subscriptions into court-defensible findings — deployable on your infrastructure, never readable by the vendor.**

Tested against each competitor:

- vs. Chainalysis: "Unlike Chainalysis, ChainSight works _with_ your Chainalysis data, not instead of it — and every finding replays bit-for-bit in court, with methodology disclosed."
- vs. TRM: "Unlike TRM Orion, ChainSight is architecturally blind to your investigation data — the vendor cannot read your cases by design, not by policy."
- vs. Elliptic: "Unlike Elliptic, ChainSight runs on your infrastructure with your data providers, producing court-defensible Reproducibility Packs that hold up under Daubert challenge."
- vs. Crystal/Scorechain: "Unlike Crystal, ChainSight is built for investigators who have to testify — not just compliance teams who have to file reports."
- vs. Arkham: "Unlike Arkham, ChainSight is a professional investigation platform for law enforcement, not a research dashboard for traders."

### 2.2 The 30-second version

> You're a blockchain investigator. You already pay for data. You spend hours tracing manually, writing reports that opposing counsel can attack on methodology, and worrying whether your notes are defensible if the case goes to trial.
>
> ChainSight connects to every data source you already use — Chainalysis, TRM, Etherscan, your own RPC nodes — and adds AI agents that trace, annotate, and draft in seconds. Every finding is provenanced. Every number is reproducible. Export a Reproducibility Pack and replay the exact same analysis on any machine, two years from now, in front of a jury.
>
> And unlike every other platform in this market, ChainSight runs inside your infrastructure. The vendor cannot read your cases. Not by policy — by design.
>
> That's ChainSight. Your data. Your infrastructure. Court-defensible findings.

### 2.3 The 2-minute version

> Modern blockchain investigations require three things that no existing platform provides together: accuracy, reproducibility, and operational privacy.
>
> Accuracy means knowing which methodology produced which number, which provider labeled which address, and what confidence level applies to each conclusion. Today, investigators using Chainalysis Reactor or TRM Forensics get a black box — they see an attribution label and a risk score, but they cannot explain to a judge exactly how the platform reached its conclusion. Defense counsel knows this, and they attack it every time.
>
> Reproducibility means that a finding made today can be reconstructed bit-for-bit eighteen months from now, in court, on any machine. This is not possible with any incumbent platform because provider data changes — Chainalysis updates its entity labels, TRM revises its risk scores, and yesterday's finding doesn't replay the same way. ChainSight solves this with the Reproducibility Pack: a cryptographically sealed bundle of every provider response, every rule version, every model card, and a replay script. Two years later, in the courtroom, run `replay.sh`. The same output emerges.
>
> Operational privacy means the vendor cannot read your investigation data. Not with a court order. Not with a support request. The architecture prevents it: your data is encrypted with keys you control, on infrastructure you choose. If you want to run ChainSight on your own servers, with your own AI models, with no outbound connections whatsoever — air-gapped, on-premises, no vendor visibility — ChainSight is the only platform designed for that from day one.
>
> And we don't compete with your existing data subscriptions. If you have a Chainalysis seat, a TRM license, or an Etherscan Pro key — connect them to ChainSight in two minutes. Your existing investment becomes the data layer. We are the AI orchestration layer, the methodology engine, and the court-defensibility layer on top of the data you're already paying for.
>
> That is why ChainSight exists.

---

## Section 3 — Pilot Customer Profiles (Phase 0)

Three archetypes to evaluate for Phase 0. Analysis follows.

### 3.1 Solo private investigator / forensic accountant (Investigator tier)

**Who they are:** A licensed private investigator, a CPA with a forensic accounting practice, or a former law enforcement agent who opened a solo practice. They work crypto-related cases: civil litigation support, insurance fraud, divorce proceedings involving hidden crypto, asset tracing for attorneys, victim recovery cases. They may also consult with law enforcement under contract.

**The pain they have:**

- They're doing this manually — Etherscan, block explorers, spreadsheets. The work that takes ChainSight twenty minutes takes them two days.
- They have no reproducibility discipline. When opposing counsel asks "how did you reach that conclusion?", they produce a PDF and hope the judge doesn't ask follow-up questions.
- They can't afford Chainalysis ($40K/year is more than their per-case revenue). They know Crystal Go (~$1,200/year) exists but it doesn't give them court-mode workflow.
- They carry their methodology in their head, not in a system. If they die or are incapacitated, the case dies with them.
- They desperately need to be certifiable as an expert witness but have no structured way to build that profile.

**Why ChainSight wins:**

- Accessible pricing (Investigator tier, see Section 5) — within their budget.
- The Expert Witness Profile (F26) is a feature built exactly for them. It auto-attaches their CV to declarations, tracks their prior testimony, manages methodology defaults, and builds a cross-examination prep library.
- The Reproducibility Pack transforms their methodology from "trust me" to "here is the deterministic replay." This is what wins Daubert challenges.
- BYOK means they can use their existing Etherscan Pro key or the free Chainalysis Freemium tier and still get court-defensible workflow.
- SaaS Blind deployment requires zero IT procurement. They sign up, connect their keys, and start a case.

**Contract size:** $149–$299/month (Investigator tier, annual = $1,788–$3,588). They are unlikely to pay more than $300/month without a team context.

**Sales cycle:** 1–3 weeks. No procurement committee. No IT approval. Credit card transaction. Trial conversion driven by product quality.

**What they'll need:**

- A free trial or heavily reduced pilot (30 days) to experience the workflow before committing.
- Simple documentation — they are not IT people.
- Possibly a 15-minute video walkthrough rather than a live demo.
- Clear court-admissibility language they can cite in declarations.

---

### 3.2 Small private compliance team (Team tier)

**Who they are:** A crypto exchange, a fintech, a digital asset hedge fund, or a broker-dealer with a 3–12 person compliance team. They are usually running TRM or Elliptic for transaction monitoring, and they need an investigation tool on top for cases that escalate beyond rule-based screening.

**The pain they have:**

- They're paying $50K–$150K/year for TRM or Elliptic and still doing forensic investigation manually when a SAR or internal incident requires deeper tracing.
- Their compliance director worries that if a regulator or DOJ lawyer asks how they traced a specific fund flow, they can't produce a defensible methodology record.
- They have no court-mode tooling because they're a compliance team, not a LE unit — but regulatory enforcement has increasingly moved to adversarial proceedings where methodology gets challenged.
- They can't add another $50K/year platform without board approval. They can add a $3,000/month team subscription.

**Why ChainSight wins:**

- BYOK makes ChainSight "works with our existing TRM key" — immediate procurement objection resolved.
- The Reproducibility Pack is a compliance governance artifact: it proves, after the fact, exactly how an investigation reached its conclusion. This satisfies regulatory documentation requirements.
- Team tier provides multi-seat collaboration, Supervisor Mode (Phase 1), and shared case management — the compliance team workflow, not the solo PI workflow.
- Pricing fits a "department tool" budget rather than an enterprise platform budget.

**Contract size:** $1,000–$3,000/month (3–10 seats). Annual = $12,000–$36,000. Likely paid as an annual contract.

**Sales cycle:** 3–8 weeks. Requires sign-off from compliance director and possibly CFO. IT review of SaaS Blind security posture is likely. SOC 2 Type 1 (Phase 2) will be the blocker for some — document our F42 roadmap explicitly and get it signed before worrying about the cert.

**What they'll need:**

- A structured pilot agreement (90 days, reduced pricing).
- Security questionnaire response — prepare a standard DDQ (Data Protection Questionnaire) covering the SaaS Blind architecture, key management, and the lack of vendor access.
- References from the first 1–2 customers (this is the Phase 1 problem, not Phase 0).
- Integration documentation for existing TRM/Chainalysis BYOK connection.

---

### 3.3 Small task force or local LE unit (Department tier)

**Who they are:** A state or local LE financial crimes unit (5–25 investigators), a regional HIDTA task force, a state AG cybercrime unit, or a county sheriff's financial crimes division. They investigate wire fraud, ransomware, pig butchering, drug proceeds, and NFT fraud. They submit cases to federal prosecutors.

**The pain they have:**

- They're using free tools — Etherscan, limited free tiers — or sharing a Chainalysis Reactor seat that costs $40K/year and is often a bottleneck.
- Their court filings are getting increasingly challenged by defense counsel who hire expert witnesses to attack blockchain methodology. They are losing cases or settling when they should be winning.
- Their investigators have uneven skills — the two-person team that knows blockchain retires and the knowledge dies with them.
- They have no case management system designed for blockchain investigations — they're using Excel and Outlook.
- FedRAMP and CJIS compliance are requirements for any new software. They know they'll have to go through IT procurement, which takes months.

**Why ChainSight wins:**

- The platform provides court-defensible methodology disclosure built-in, which directly addresses the "our cases are getting challenged" problem.
- Training & Sandbox Environment (F31, Phase 1) enables department-wide training on historical cases — they can train new investigators without endangering live cases.
- Supervisor Mode (F27) provides chain-of-command workflow that matches LE organizational structure.
- The BYOK model means they can use free or low-cost data providers (Etherscan, OpenSanctions) and gradually add commercial providers as budget allows.
- On-Premises deployment (Phase 0) addresses their CJIS data residency concerns even before formal certification.

**Contract size:** $2,000–$8,000/month (10–25 seats + annual contract). Annual = $24,000–$96,000. This is a real department-level budget item.

**Sales cycle:** 3–9 months. Government procurement, IT security review, possibly a solicitation or sole-source justification. CJIS compliance documentation required. Legal review of MSA.

**What they'll need:**

- A formal pilot agreement with defined success criteria.
- CJIS compliance documentation (this is a legal architecture question before the code question).
- SOC 2 Type 1 (Phase 2) for most; some can accept an on-prem deployment for Phase 0.
- Reference from another LE unit or a positive court ruling citing the platform.
- A government-accessible procurement vehicle (even pre-GSA, a direct-award sole-source is possible for Phase 0 pilots under the Simplified Acquisition Threshold).

---

## Section 4 — Recommended Phase 0 Pilot Target

### 4.1 The pick

**Phase 0 pilot target: Solo private investigator / forensic accountant, Investigator tier.**

**Rationale:**

1. **No procurement barrier.** The solo PI doesn't have an IT department, a procurement committee, or a security review process. They can sign up, pay with a credit card, and start working tomorrow. For a solo developer who cannot yet support a 9-month government procurement cycle, this is the only viable Phase 0 customer type.

2. **Fastest feedback loop.** The PI works a real case immediately. Within two weeks you learn what the platform needs to do in practice. A government procurement cycle gives you no feedback for six months.

3. **Authentic validation.** When a working PI signs a real case in ChainSight and produces a court-filed exhibit using a Reproducibility Pack, that is a reference that closes the next deal. The first LE unit that asks "do you have a customer reference?" gets an answer.

4. **Certification value.** A solo PI who uses ChainSight and earns their ChainSight Investigator Certification (F31) becomes an ambassador. Their certifications appear on their CV. Defense counsel researches them. Judges see them. This is how ChainSight builds credibility before it has 50 LE customers.

5. **Economics are real.** $149–$299/month is a small number, but a solo developer needs ten paying customers to have meaningful market signal. Closing ten PIs is achievable in 90 days. Closing one LE task force takes nine months and might not happen.

**The risk:** Small customers give you small signal. A PI's case volume and complexity is much lower than a task force's. Features that matter at scale (Supervisor Mode, cross-case deconfliction, air-gapped on-prem) won't be tested by solo PI customers.

**Mitigation:** Deliberately recruit pilot PIs who are also consultants to LE — former FBI, DEA, or IRS-CI agents who now run their own practices AND consult back to their former agencies on crypto cases. These customers give you both the easy procurement path AND the LE signal.

### 4.2 Three Phase 0 prospect archetypes

**Archetype 1: The former federal agent turned PI**  
A retired FBI, DEA, IRS-CI, or HSI special agent with a crypto specialty who opened a private practice. They know the Daubert standard intimately. They know what Chainalysis Reactor looks like — and they know its limitations. They want to produce better court exhibits than they could with government tools. They can also consult back to their former agency's cases, creating a backdoor to LE adoption.  
_Outreach channel:_ LinkedIn (search: "blockchain" + "FBI" or "IRS-CI" + "CFE" or "CCI"). ACFE conferences. Fraud Defense Network. InfraGard.

**Archetype 2: The forensic accountant at a boutique litigation support firm**  
A CPA or CFE at a 2–5 person firm that handles civil litigation support — divorce cases, asset tracing, business valuation disputes, insurance fraud. They get crypto asset cases because no one else at the firm handles them. They're billing $300–$500/hour but spending half their time on manual blockchain work.  
_Outreach channel:_ ACFE (Association of Certified Fraud Examiners) — specifically the Crypto/Digital Assets SIG. CPA society digital asset working groups. LinkedIn (search: "forensic accountant" + "cryptocurrency" + "litigation support").

**Archetype 3: The crypto-specialized private investigator**  
A licensed PI who specifically markets crypto recovery and crypto fraud investigation. They work with victim attorneys, civil plaintiffs, and sometimes small LE agencies under contract. They are likely already using Etherscan Pro and possibly Crystal Go. They want to upgrade.  
_Outreach channel:_ NAPPS (National Association of Professional Process Servers) and NALI (National Association of Legal Investigators) have crypto-focused members. AML crypto investigation LinkedIn communities. ACFE Digital Assets forum.

### 4.3 Outreach approach

Do not start with a sales email. Start with a content play.

**Week 1:** Publish a 1,500-word technical article: "Why the Chainalysis Black Box Loses Daubert Challenges (and How to Fix It)." Post to your personal LinkedIn, ACFE forum, and the r/cryptoforensics subreddit. This establishes credibility and surfaces self-selected prospects.

**Week 2:** Respond to every person who engages with the article. Offer a 30-minute demo. Do not pitch — ask them to show you their current workflow and tell you what frustrates them.

**Week 3:** From the demos, identify 3–5 candidates who are (a) working real cases, (b) have a court filing coming, and (c) expressed a specific pain the platform solves. Offer a 90-day pilot at $49/month (reduced from the $199/month standard Investigator rate). Frame it explicitly: "I need real cases to validate the platform. You get 90 days at a steep discount. I get feedback on real case workflows. After 90 days, convert to the standard rate or cancel — no hard feelings."

_Why $49 instead of free:_ The $49/month is a commitment signal, not a revenue event. At the Phase 0 infrastructure cost of $15–$40/month marginal per customer on Supabase + Fly.io, the founder is covering costs. More importantly, a customer who pays $49 has made a real decision to engage. A customer who pays nothing churns the moment the workflow gets frustrating.

**Week 4–12:** Provide white-glove support for pilot customers. Every time they get stuck, fix it or document it as a Phase 0 bug. When a pilot customer produces a court exhibit using a Reproducibility Pack, ask for a one-paragraph written testimonial.

---

## Section 5 — Pricing Model (Full)

### 5.1 Philosophy

The pricing model follows four principles:

1. **Every tier must be accessible to the market segment it serves.** Investigator tier prices like a professional software subscription, not an enterprise contract. Department tier prices like a government department budget line, not a six-figure consulting engagement.

2. **BYOK is pass-through, not a markup.** Consistent with locked decision G8 (vendor-neutral in v1) and F46, ChainSight does not mark up provider data. The agency pays providers directly. ChainSight charges for the platform — the AI orchestration, the methodology engine, the reproducibility infrastructure, the court workflow. Provider cost is the customer's problem; platform cost is ChainSight's charge.

3. **Pilots are paid, not free.** Free pilots produce no feedback — the customer doesn't invest, so they don't use it hard enough to find the real problems. Pilots at reduced rate with a written conversion plan create real engagement.

4. **The founder's low infrastructure burn rate enables aggressive early pricing.** The Phase 0 stack — Supabase Pro + Fly.io scale-to-zero + GitHub — costs under $300/month at zero customers. The marginal cost of adding an Investigator-tier pilot is roughly $15–$40/month in incremental compute and database usage. This means ChainSight can offer pilot pricing that would be economically unsustainable for any incumbent — and still operate with positive unit economics. Use this structural advantage deliberately in Phase 0 to acquire reference customers. Do not use it as an excuse to underprice permanently: pricing discipline at the standard tier matters for the commercial story investors and government procurement officers will evaluate.

**The infrastructure reality in plain terms:** Chainalysis charges $40,000/year per seat because they built their platform on a cost structure that requires it. ChainSight runs on Supabase and Fly.io with scale-to-zero billing. The same quality of blockchain investigation workflow costs a fraction of what it costs the incumbents to deliver. That structural advantage, not venture subsidy, is what makes the Investigator tier pricing honest.

### 5.2 Tier pricing

**Tier 1 — Investigator**  
_Target:_ Solo private investigator, solo forensic accountant, solo compliance analyst, independent researcher  
_Deployment:_ SaaS Blind only  
_Seats:_ 1  
_Features:_ Core case, IOC, trace (single-chain Ethereum Phase 0; multi-chain Phase 1), Transaction Inspector, Reproducibility Pack, Expert Witness Profile (F26), Chain of Custody (F29), BYOK data providers (up to 3 installs), BYOK LLM (bring your own Anthropic/OpenAI key)  
_Price:_ **$199/seat/month, billed annually** ($2,388/year)  
_Monthly billed:_ $249/month  
_Pilot price:_ $49/month for 90 days, converting to full rate

Rationale: $199/month annual is below the Crystal Go annualized cost ($100/month), signals professional-grade while remaining within a solo practitioner's discretionary budget. The $2,388/year full price is exactly what an expert who bills one additional hour per month on cases (at $200/hour billable) can justify instantly.

---

**Tier 2 — Team**  
_Target:_ Small compliance team, small investigation firm, boutique forensic accounting practice, private-sector task force (2–25 seats)  
_Deployment:_ SaaS Blind or On-Premises (Phase 1 on-prem)  
_Seats:_ 2–25  
_Features:_ All Investigator features + multi-chain (Phase 1), cross-chain trace, Wallet History Analyzer (Phase 2), Supervisor Mode (F27) (Phase 1), Training & Sandbox (F31) (Phase 1), Stablecoin Freeze workflow (F33) (Phase 1), BYOK providers (unlimited installs), BYOK LLM (all providers), Reproducibility Pack export/import  
_Price:_ **$149/seat/month, billed annually (2–10 seats); $129/seat/month, billed annually (11–25 seats)**  
_Setup fee (On-Prem):_ $5,000 one-time  
_Pilot:_ 90-day pilot at $49/seat/month, 2-seat minimum ($98/month minimum)

Rationale: Per-seat decline as seats add reflects team adoption economics. The $5,000 on-prem setup fee covers the cost of the installer, documentation, and the migration-path support.

---

**Tier 3 — Department**  
_Target:_ State/local LE department, regional task force, mid-size compliance organization, financial intelligence unit (25–200 seats)  
_Deployment:_ SaaS Blind or On-Premises  
_Features:_ All Team features + Court Mode + methodology toggle (Phase 3), Court Export Bundle (Phase 3), Retraction Workflow (F32) (Phase 2), Case Transfer/Handoff (F28) (Phase 2), Mobile read-only + Court Mode driver (F30a, F30b) (Phase 1), cross-case deconfliction within tenant (Phase 3), source-code escrow (optional add-on), SOC 2 Type 2 compliance attestation  
_Price:_ **Annual contract; pricing on request; indicative range $3,000–$12,000/month (25–200 seats)**  
_Equivalent:_ ~$36,000–$144,000/year annual contract  
_Volume floor:_ Minimum $3,000/month (25-seat minimum)  
_Setup fee (On-Prem):_ $15,000–$25,000 depending on deployment complexity

Rationale: Department pricing moves to annual contract model consistent with government procurement cycles. The per-seat effective rate at 25 seats ($120/seat/month) represents a meaningful discount from Team tier while keeping minimum contract value above $36K/year — required to justify the sales cycle length.

---

**Tier 4 — Agency**  
_Target:_ Federal LE field office, large financial institution compliance, large-scale investigation firm (200+ seats or enterprise-grade case volume)  
_Deployment:_ On-Premises preferred; SaaS Blind available  
_Features:_ All Department features + Federated Personal Attribution (Phase 4), cross-agency deconfliction federation (Phase 4), CRDT real-time collaboration (Phase 4), custom detectors, extended provider catalog, custom integrations, dedicated implementation support, Annual Business Review, source-code escrow included  
_Price:_ **Custom annual contract; indicative range $150,000–$600,000/year**  
_Government contracting vehicle:_ Phase 3 GSA Schedule; Phase 4 SEWP VI  
_Pilot:_ 90-day POC at cost; structured POC plan required

---

**Tier 5 — Classified**  
_Target:_ Federal agency HQ, intelligence community, national-level financial crime units, classified programs  
_Deployment:_ On-Premises Sovereign only; air-gapped variant available  
_Features:_ All Agency features + air-gapped deployment, offline license validation, physical-media update path, no outbound network requirements, NVIDIA NIM integration for classified AI inference, IL5/IL6 path (Phase 4+), CMMC Level 2 (Phase 4), Common Criteria (Phase 4+), custom SLA, dedicated CTO-level engineering contact  
_Price:_ **Site license; indicative $400,000–$2,000,000/year**  
_Contracting path:_ SEWP VI, CIO-SP4, OASIS+, direct GSA Schedule IT, defense-specific vehicles  
_Notes:_ This tier is Phase 3+ in practice — the certifications and security posture required take 12–18 months from Phase 0 to achieve.

---

### 5.3 BYOK passthrough mechanics

Consistent with locked decision G8 (vendor-neutral in v1) and F46:

- **The agency pays providers directly.** Etherscan, Chainalysis, TRM, Allium, Anthropic — all billed directly to the agency's account. ChainSight does not appear on those invoices.
- **ChainSight does not take a cut of provider spend.** The platform fee covers the capability router, the AI orchestration layer, the Belief State Service, the Reproducibility Pack infrastructure, and the workflow. It does not include a markup on data costs.
- **Cost telemetry is the agency's property.** Per-case, per-provider API cost tracking gives the agency full visibility into their provider spend. This is a feature, not an operational telemetry mechanism — the agency can export it, report on it, and use it to negotiate better rates with providers.
- **In-house heuristics (F40) are included at all tiers.** An agency with zero commercial data subscriptions still gets baseline address attribution, UTXO clustering (CIH), sanctions list matching (OFAC/EU/UN), price data (CoinGecko free tier), and contract decoding (Sourcify + 4byte.directory).

### 5.4 Discount policy

- **Annual commitment discount:** 2 months free relative to monthly billing (baked into the annual price above).
- **Multi-year commitment:** 10% off year 2, 15% off year 3+ for Department and Agency tiers.
- **Government academic/non-profit:** 20% off listed pricing for verified academic institutions, non-profit organizations, and qualifying government agencies operating below the Department tier.
- **Law enforcement referral:** 1 month free credit for successful referral of a paying customer (at Investigator or Team tier). Credit applied at second-year renewal.
- **No discounts on pilots.** Pilot pricing is already discounted. Stacking a pilot discount on top of a referral credit sets a bad precedent and trains the market to negotiate from the pilot number.

### 5.5 Pilot pricing structure

The Supabase + Fly.io infrastructure stack means ChainSight's marginal cost per pilot customer is $15–$40/month — low enough to absorb aggressive pilot pricing without margin risk at Phase 0 scale. Use this window deliberately: the goal of Phase 0 pilot pricing is reference customers and workflow validation, not revenue. Standard pricing discipline resumes at Phase 1.

- **Investigator tier pilot:** $49/month for 90 days. No setup fee. No contract. Cancel at any time. At day 85, conversion conversation: what worked, what didn’t, are you ready to move to annual? Conversion to annual = $199/month (³/₃ the pilot rate, reflecting real ongoing infrastructure and support cost). Conversion incentive: first month of annual subscription free if they convert before Day 91.

  _Rationale for $49:_ At $15–$40 marginal infrastructure cost, ChainSight still covers its costs on every pilot customer. At $49/month, a solo PI has made a real commitment (they’ll actually use it) but the barrier is low enough that a 30-minute demo will close it. $99/month is not wrong, but $49 removes the last hesitation from a solo practitioner evaluating an unknown platform. The standard rate of $199/month is maintained clearly so the discount is visible and the conversion conversation is straightforward.

- **Team tier pilot:** $49/seat/month for 90 days. 2-seat minimum ($98/month minimum). Signed pilot agreement required (2-page document, not a full MSA). Conversion follows Team standard pricing ($149/seat/month annual). Pilot incentive: 2 months free if they convert to an annual contract before Day 91.

- **Department/Agency/Classified tier:** POC structured as a 90-day engagement with defined success criteria (e.g., “close one case using ChainSight and produce a Reproducibility Pack exhibit”). POC priced at cost — equivalent to 2 months of standard pricing paid upfront. Full MSA required before POC begins. Government customers: help them budget the conversion in the next fiscal year; provide a budget quote letter at Day 30 so they can initiate procurement before Day 90.

---

## Section 6 — The Demo Script

A 15-minute demo from cold open to ask. Designed for any of the three Phase 0 pilot archetypes. Adjust language for audience: "investigator" for PI/LE, "analyst" for compliance team.

### 6.1 Structure overview

| Segment                        | Time        | What you show           | What you say                  |
| ------------------------------ | ----------- | ----------------------- | ----------------------------- |
| Cold open — the problem        | 0:00–1:30   | Nothing yet             | State the problem they know   |
| The IOC drop                   | 1:30–3:00   | Paste a tx hash         | Instant graph                 |
| Transaction Inspector          | 3:00–6:00   | Click a tx              | Full structured breakdown     |
| Where-Did-The-Money-Go overlay | 6:00–8:30   | Fund flow visualization | AI narration                  |
| Methodology toggle             | 8:30–10:00  | Switch FIFO/LIFO/LIBR   | Live recalculation            |
| Reproducibility Pack           | 10:00–12:30 | Export and replay       | "This holds up in court"      |
| The sovereignty pitch          | 12:30–14:00 | Settings > Deployment   | "The vendor cannot read this" |
| The ask                        | 14:00–15:00 | Nothing technical       | One question, one offer       |

### 6.2 The full script

**0:00–1:30 — Cold open (no screen sharing yet)**

"Before I show you the platform, let me ask you one question. The last time you had a blockchain finding challenged in court — or in a regulatory proceeding — how did it go? Not the outcome, but the methodology part. Did opposing counsel say your analysis was reproducible? Did they say it was transparent? Or did they say: 'We don't know how this tool reached this conclusion, and neither does the witness'?"

_(Pause. Let them answer or react.)_

"That's exactly the problem ChainSight was built to solve. Every finding reproducible. Every methodology disclosed. Every number traceable back to a specific provider response. Let me show you what that looks like in practice."

_(Share screen. Open ChainSight to a blank case.)_

---

**1:30–3:00 — The IOC drop**

"I have a transaction hash from a public pig-butchering case. It's been reported in multiple news articles, so I can use it without any confidentiality concern."

_(Paste the tx hash into the IOC intake field. The graph populates: address nodes, a transaction node in the center, edges showing value flow. This happens in about 3 seconds.)_

"That's the transaction-centric graph. Every ChainSight case puts transactions in the center — not addresses. The reason is that transactions are facts: they happened, they have hashes, they're immutable. Addresses are inferences — who controlled them is something we need to prove. Starting from the transaction means we start from what we know."

---

**3:00–6:00 — Transaction Inspector**

"Let me click on this transaction."

_(The Transaction Inspector panel opens on the right. Show: the raw facts first — block height, timestamp, fee — then the decoded actions: ETH transferred, ERC-20 transfers, internal calls, contract interactions. Then show the AI summary.)_

"This is the Transaction Inspector. The top section is deterministic: block height, timestamp, fee — these are blockchain facts, they don't require any AI. The middle section decodes the contract interactions — what the transaction actually did. The bottom section is an AI-generated plain-language summary."

_(Point to the citation tokens in the AI summary.)_

"And here's what makes this different from other platforms. Every sentence in the AI summary has a citation token — a reference to the exact BeliefAtom that backs it. If the Critic Agent found no supporting evidence for a claim, the sentence isn't in the summary. This is what allows the platform to say 'every claim is provenanced.' Click any citation, you see exactly which data source said what."

---

**6:00–8:30 — Where-Did-The-Money-Go overlay**

"Let me trace this transaction forward."

_(Trigger the AI trace. As the agent runs, the canvas populates with additional nodes — address hops, a token swap, a bridge crossing. A "Where-Did-The-Money-Go" overlay renders a Sankey-style fund flow diagram over the canvas.)_

"This overlay answers the question a prosecutor always asks: where did the money actually go? From this wallet, through this DEX swap, across this bridge to a different chain, and into this exchange. The color coding shows each distinct flow. The numbers are fiat-converted at the exact block timestamp using the Math Service — not approximated, not copied from an LLM."

_(Point to an address that's been attributed.)_

"This address is attributed to [Exchange Name] — that attribution came from the Chainalysis key I connected to this demo account. If I had a TRM key, the attribution would route through TRM. If they disagreed, the platform would surface a Critic challenge and ask me to resolve it before promoting the attribution to court-grade."

---

**8:30–10:00 — Methodology toggle**

"The accounting methodology is where cases get attacked. Did you use FIFO? LIFO? The Lowest Intermediate Balance Rule? Different jurisdictions and different cases call for different approaches."

_(Click the Methodology menu. Toggle from FIFO to LIBR. Watch the value-attribution on the canvas recalculate live.)_

"ChainSight's math service runs all six major methodologies simultaneously. When you're ready to finalize your trace, you pick the methodology appropriate to your jurisdiction and your case theory. The platform shows the values under each methodology so you can make an informed decision. And when you export the Reproducibility Pack, it records exactly which methodology was used, why, and what the values would have been under alternative methodologies — so you can defend any challenge pre-emptively."

---

**10:00–12:30 — Reproducibility Pack**

"This is the most important feature in the platform for court work."

_(Click Export > Reproducibility Pack. A progress bar fills as the system bundles the case.)_

"This Pack contains: every provider API response cached at the time of this trace. Every rule version used. The model card for every LLM call. The complete BeliefAtom event log. And a shell script: `replay.sh`."

_(The download completes. Open a terminal.)_

"Watch what happens when I run the replay script."

_(Run `./replay.sh`. The system reconstructs the case output. Show that the trace, the values, and the AI summaries are bit-for-bit identical to the original.)_

"Two years from now, in a courtroom, opposing counsel hands your Pack to their expert and says 'run this.' Their expert runs it. They get the same output. There's nothing to attack on methodology — the methodology is transparent, deterministic, and replays identically."

"No other platform in this market does this."

---

**12:30–14:00 — The sovereignty pitch**

_(Navigate to Settings > Deployment.)_

"One more thing. Every other platform you've looked at is a cloud SaaS product. The vendor can read your case data. Some of them use it to improve their AI. Some of them have legal exposure if a counterparty serves them a subpoena. Your investigation data is potentially accessible by people who are not you."

"ChainSight is architecturally blind. This key management section shows you that your data is encrypted with a key that ChainSight the company never holds in cleartext. When I — the developer — log into the infrastructure to check on a server, I see ciphertext. I see no addresses. I see no transactions. I see no findings. Technically blind."

"And if you want to run this entirely on your own servers — your own Kubernetes cluster, your own KMS, your own AI models, air-gapped from the internet — I ship the on-premises installer. Same code, same features, zero vendor connectivity. The vendor is never a counterparty to your investigation."

---

**14:00–15:00 — The ask**

"I have one question for you: do you have a case right now that I could help you work through on ChainSight? A real case — doesn't have to be active, could be something you recently closed or something you're currently stuck on."

_(Wait for the answer. If yes: "Great. Let's set up a 90-day pilot. I'll walk you through the onboarding personally and be available every time you hit a problem. The pilot rate is $49/month. The only thing I ask is that you give me honest feedback on what works and what doesn't.")_

_(If they need more time: "Completely understandable. I'll send you a recording of this demo and a link to the pilot signup page. The pilot is 90 days, $49/month, cancel at any time. The only thing I ask is that you use it on a real case — not a test. Real cases reveal what the platform actually needs to do.")_

---

## Section 7 — Sales Objection-Handling Guide

### 7.1 "We already pay Chainalysis"

**Correct response:** Good. Connect your Chainalysis API key to ChainSight in two minutes. ChainSight routes your capability needs through the Chainalysis API the same way a web browser routes HTTP requests through your network. You keep your Chainalysis relationship. Your Chainalysis attribution data populates ChainSight's BeliefAtom graph automatically. What ChainSight adds to your existing Chainalysis investment: AI orchestration that does the tracing work, the Reproducibility Pack that makes your findings court-defensible, and an interface built for investigators rather than compliance analysts.

The positioning is: ChainSight + your Chainalysis key > Chainalysis alone. Not instead of — on top of.

**What not to say:** Do not say "we're better than Chainalysis." You aren't — their attribution database is larger, their federal relationships are deeper, and their certification program has more alumni. Your advantage is complementary, not substitutional.

---

### 7.2 "We can't run AI on case data"

**Correct response:** You control exactly which AI providers touch your case data, and under what conditions. If you run ChainSight on your own infrastructure with locally hosted models — Llama 4, DeepSeek V4, Qwen 3.5 — no case data ever leaves your network. Not one token. If you use the cloud SaaS deployment and bring your own Anthropic key, your prompts go to Anthropic under your organization's API agreement, not through ChainSight's account. The BYOK architecture ensures the vendor never intermediates the AI relationship.

Additionally, you can disable specific AI features on a per-case or per-investigation basis. If a case is too sensitive to use any external LLM, turn off AI for that case — the deterministic tracing, the math engine, and the reproducibility infrastructure still work with zero AI involvement.

**Technical depth (if needed):** Every AI feature has an on/off toggle at the agency level, the case level, and the individual agent level. The platform works — tracing, math, chain-of-custody — with AI entirely disabled. AI is an accelerant, not a dependency.

---

### 7.3 "We've never heard of you"

**Correct response:** "I know. We're in Phase 0 — we launched [X weeks] ago, and I'm building the reference base right now. Here's what I'd ask you to consider: every tool you're using today was once a platform no one had heard of. The question isn't whether you've heard of us — it's whether the platform solves the problem you have. Let me show you [15-minute demo]. If it doesn't solve a real problem, don't use it. If it does, you get the advantage of being an early adopter."

**The founder's card to play explicitly:** This platform is built by someone who has read every court filing, every Daubert motion, every academic paper on blockchain forensics methodology. The technical depth is real. The court-defensibility features are real. You don't have to take our word for it — run the replay script yourself and see that the output is bit-for-bit identical.

---

### 7.4 "How do we know your math is right?"

**Correct response:** Three ways. First, the Math Service is deterministic — run the same transaction through it twice, get the same number. You can verify this yourself by running the Reproducibility Pack replay. Second, the methodology selection is explicit — the platform applies FIFO, LIFO, LIBR, pari passu, rolling charge, and specific identification by the book, documented in our methodology disclosure. We publish our methodology, including the edge-case handling, so your own experts can review it. Third, the platform runs all methodologies simultaneously and shows you the delta between them — if FIFO gives $1.2M and LIBR gives $900K, you see both numbers and can make an informed decision about which applies to your case.

**What we don't claim:** We claim mathematical correctness for the accounting. We do not claim that AI attributions are always right — those are T2 or T3 confidence tier, not T0 deterministic facts, and the platform is explicit about the distinction. The Math Service is owned by one module; the AI is owned by a different module; they don't mix.

---

### 7.5 "What if you go out of business?"

**Correct response:** Two layers of protection. First, every case produces a Reproducibility Pack — a self-contained bundle that can replay the case on any machine, using the open Pack format specification we publish. If ChainSight disappears tomorrow, your cases continue to replay forever using the Pack, without any ChainSight infrastructure. Second, for Department and Agency tier customers, we offer source-code escrow (F44) through an independent third party (Iron Mountain or NCC Group). If ChainSight is acquired by a hostile actor, goes bankrupt, or abandons the product, the escrow releases the full source code to you under a continued-use license.

**For On-Premises customers:** You have a perpetual license to the version you deployed. It doesn't stop working when the vendor stops operations. Updates end, support ends, but the software keeps running.

---

### 7.6 "We need SOC 2 / FedRAMP / CJIS to even talk to you"

**Correct response:** We are on the roadmap to those certifications — explicitly, with milestone dates. SOC 2 Type 1 by end of Phase 2 (approximately 6 months from now), SOC 2 Type 2 by end of Phase 3 (approximately 12 months), FedRAMP Moderate sponsor identification by Phase 3, FedRAMP Moderate authorization by Phase 4.

For CJIS specifically, documented conformance — not a formal cert, but written evidence that our architecture complies with CJIS Security Policy requirements — is achievable at Phase 1 for On-Premises deployments. The on-prem deployment model (agency-controlled data, agency-controlled KMS, no vendor access) is structurally aligned with CJIS requirements.

**The honest offer for customers who need SOC 2 now:** Deploy on-premises. You own the data. You control the keys. The vendor's SOC 2 posture is irrelevant when the vendor cannot access your data at all.

**What not to do:** Don't promise certifications on timelines you cannot hit. The F42 roadmap is realistic; don't accelerate it to close a deal you're not ready to support.

---

### 7.7 "Our IT won't approve another tool"

**Correct response:** What specifically does IT need to see? Nine times out of ten, IT's concern is one of three things: data residency, vendor access to case data, or security certifications. Let me address each:

Data residency: On-Premises deployment eliminates the question — all data stays in your infrastructure. SaaS Blind with your KMS gives you contractual data residency.

Vendor access: We are architecturally blind. The technical architecture guarantees no vendor access, not a contractual prohibition. Your IT team can inspect the encryption architecture.

Security certifications: We provide our security whitepaper, our penetration test results (as they're completed), and our SOC 2 roadmap. For On-Premises deployment, your IT team deploys and controls the infrastructure — our security posture is essentially irrelevant.

**Alternative:** Offer a small-scale On-Premises pilot that IT can approve as a server application rather than a SaaS vendor relationship. For state/local LE, this is often a faster procurement path than a SaaS vendor approval.

---

### 7.8 "Where does our data live?"

**This is the new objection in Phase 0** — one that didn't exist for prior generations of enterprise software because the answer was always "AWS us-east-1" and the customer accepted that. With law enforcement and compliance customers who have data-residency requirements, the answer matters.

**The honest answer for SaaS Blind v1:** Your case data lives on Supabase (Postgres database, US region by default) and Fly.io (application tier, also US-hosted by default). Supabase and Fly.io are established infrastructure providers used by thousands of production applications. Your data is encrypted at rest and in transit, with encryption keys you control — neither Supabase nor Fly.io nor ChainSight can read your case data in cleartext.

**The important nuance:** Supabase and Fly.io are not SOC 2 Type 2 certified at the same level as AWS GovCloud. This matters for customers who need SOC 2 or higher certifications — which is why the Phase 2 AWS migration is planned before SOC 2 Type 1 audit work begins. The honest timeline: SaaS Blind v1 on Supabase + Fly.io is the Phase 0 and Phase 1 infrastructure. Phase 2 moves to AWS with SOC 2 Type 1 certification. Phase 3 achieves SOC 2 Type 2.

**What to say when a prospect raises this:**

_For Investigator-tier customers (solo PI, forensic accountant):_ "Your data is on Supabase US-region, encrypted with keys you control. Same infrastructure as many enterprise SaaS products you use today. If you need air-gapped or on-premises for a specific sensitive case, I can deploy an on-premises instance for you."

_For Team-tier customers:_ "Supabase US-region with your encryption keys. Our SOC 2 Type 1 audit is planned for Phase 2 — here's the roadmap document if you need to show it to your IT team. For customers who cannot accept the timeline, we offer on-premises deployment today."

_For Department-tier customers (state/local LE):_ "I'll be direct: for CJIS-sensitive workloads, the on-premises deployment is the right answer for you today — your data stays entirely on your infrastructure. SaaS Blind will be SOC 2 compliant in [projected Phase 2 date], which may also satisfy your requirements."

**What not to say:** Do not present Supabase or Fly.io as equivalent to AWS GovCloud, FedRAMP-authorized infrastructure, or SOC 2 Type 2 platforms. They are not, yet. Overstating the compliance posture of the Phase 0 stack is the kind of misrepresentation that destroys trust permanently when discovered during IT review.

**The on-premises escape valve:** For any prospect where "Supabase + Fly.io" is a deal-stopper, the on-premises Sovereign deployment is the answer. From Phase 0, the platform ships an on-premises installer (Docker Compose + Helm chart per the engineering doc). The customer deploys on their own infrastructure. Supabase and Fly.io are irrelevant to their deployment. ChainSight's infrastructure posture is irrelevant to their data residency. This is the architectural design point from v0.7 that makes the Phase 0 infrastructure stack a commercial asset rather than a liability: the sovereignty option was built first, so no SaaS infrastructure limitation blocks a deal.

---

### 7.9 "What if our investigators don't adopt it?"

**Correct response:** The platform is built with investigator adoption as a first-class design constraint — the top-level product principle is "So Easy a Caveman Can Do It." Every interaction is one click, one keystroke, or one drag. We have a built-in training environment (F31) with seeded cases from public incidents — investigators can practice on the Bybit hack, the Bitfinex recovery, or the Ronin Bridge case before they work a live case.

Additionally, investigators learn by passing cases. When your senior investigator closes a case with a ChainSight Reproducibility Pack and the judge cites it positively, every other investigator in the department asks "how did she do that?"

**The harder answer:** Adoption is a change management problem, not a product problem. The best strategy is to identify the one or two most technically confident investigators — ideally the ones who are already frustrated by manual tracing — and give them access first. They become internal champions. Buy-in from respected peers is more powerful than any vendor-led training.

---

### 7.10 "Show me a customer reference"

**The honest answer (Phase 0):** "I'm building the reference base right now. My first two pilots are working cases and I expect their first court filings using ChainSight exhibits to come in the next 60 days. What I can offer you today is: (a) the Reproducibility Pack replay — run `replay.sh` yourself and verify the methodology; (b) the methodology documentation, which you can send to your own expert for review; and (c) a 90-day pilot where you're the first to evaluate it in your context. If it doesn't perform, you cancel. If it does, you become the reference."

**After first two pilot customers close a case:** This objection is handled with a one-paragraph testimonial from a real investigator who closed a real case using the platform. Get that testimonial within the first 90 days of each pilot customer's use.

---

### 7.11 "Why should we trust the AI?"

**Correct response:** You shouldn't trust it blindly — and ChainSight is specifically designed so you don't have to. Every AI-generated claim has a citation token linking it to its evidentiary basis. Every BeliefAtom has a confidence tier: T0 is blockchain-deterministic (the AI can't affect it), T1 is math-deterministic (the AI can't affect it), T2 is attribution-snapshot deterministic (the AI suggests, you verify), T3 is AI-inferred (requires your sign-off before it can be court-graded). The Critic Agent independently reviews every AI claim and raises challenges when the evidence is weak.

The platform is explicit about AI limitations in the same way a good expert witness is explicit about the limits of their methodology. The goal is not AI you trust blindly — it's AI that shows its work and lets you verify it before you put your name on the result.

**The bias/fairness commitment (F41):** We publish false-positive rate targets for every detector and heuristic, and we publish quarterly reports of actual FPR vs. target. If our AI over-flags specific communities or patterns, we're contractually committed to fixing it. That commitment is in the MSA, not just in the marketing materials.

---

## Section 8 — BYOK Partnership Outreach List

The goal of BYOK partnerships in Phase 0–1 is not revenue — it's credibility and connector quality. An agency that tries to connect Chainalysis to ChainSight and gets a clean, fast, well-documented integration will tell other agencies. A clunky integration kills adoption.

### 8.1 Data provider partnerships

**Etherscan (and the Etherscan family: BscScan, Arbiscan, Basescan, etc.)**
_Relationship type:_ Integration partner, no revenue share needed  
_What to ask for:_ API documentation access, a partner/developer API key at a favorable rate, listing on their developer partner page  
_Who to approach:_ Developer relations team at etherscan.io — open documentation at docs.etherscan.io makes this a self-service integration, but a formal partnership listing raises credibility  
_Timeline:_ Phase 0 — this is the first connector, already in the build plan

**Blockchair**
_Relationship type:_ Integration partner  
_What to ask for:_ Developer API key, partner documentation, potential listing on their ecosystem page  
_Approach:_ business@blockchair.com; they have an explicit API partnership program with partner discounts

**Allium**
_Relationship type:_ Strategic data partner — this is the single highest-leverage data partnership in Phase 1  
_Why it matters:_ Allium provides fast, indexed multi-chain data via SQL and APIs. An agency that needs to query "all transactions involving this address over the last 3 years" gets the answer in seconds from Allium vs. hours from live RPC calls. This is a critical capability for deep-trace investigations.  
_What to ask for:_ Integration partnership, developer access, co-marketing (listed as a supported BYOK provider on their partner page)  
_Who to approach:_ Allium has a partners page (allium.so/partners); contact through official partner inquiry form; also accessible through LinkedIn  
_Timeline:_ Phase 1

**Alchemy**
_Relationship type:_ RPC provider integration partner  
_What to ask for:_ Partner developer access, listing in their dapp directory (they have an existing ChainSight-adjacent listing structure)  
_Approach:_ Alchemy's certified infrastructure alliance (alchemy.com/amplify) — this provides a credibility badge and marketing support for platforms built on Alchemy infrastructure  
_Timeline:_ Phase 0–1

**Chainalysis**
_Relationship type:_ BYOK connector — this is potentially the most important commercial relationship  
_Strategy:_ Do not approach Chainalysis about a commercial partnership in Phase 0. Their business development team will ask questions that create complexity before you have customers. Instead: build a clean, well-documented connector; publish it; let early customers who have Chainalysis seats test it. Once 3–5 customers are using the Chainalysis connector successfully, approach their API team about a formal integration partnership.  
_What to eventually ask for:_ Partner listing on their developer ecosystem page; API documentation access; introduction to their government accounts team once you have LE reference customers  
_Red line:_ Never position as "Chainalysis alternative." Always position as "workflow layer that connects to your Chainalysis subscription." This keeps the door open.

**TRM Labs**
_Relationship type:_ BYOK connector  
_Strategy:_ Same as Chainalysis — build the connector first, approach formally after customer validation. TRM has an API and an ecosystem program.  
_What to eventually ask for:_ Partner listing, potential co-sell with TRM for customers who want investigation tooling above TRM's standard compliance offering

**OFAC SDN / OpenSanctions / EU Restrictive Measures**
_Relationship type:_ Free public data source — integrate directly, no partnership required  
_Notes:_ OpenSanctions is open-source and ships as a self-hostable data feed. Perfect for the in-house baseline (F40). Integrate at Phase 0. No business development required.

---

### 8.2 AI provider partnerships

**Anthropic**
_Relationship type:_ BYOK LLM provider; potential partner  
_What to ask for:_ Access to the Anthropic developer partner program; potential listing as a verified integration; potentially a law enforcement-specific API tier or terms  
_Who to approach:_ Anthropic's enterprise and partner team (anthropic.com/enterprise). Focus the conversation on the court-defensibility angle — Anthropic has publicly discussed their commitment to responsible AI deployment in high-stakes contexts  
_Why this matters:_ The Verifier Agent architecture (every AI claim is citation-gated) is a model for responsible deployment that Anthropic actively wants to showcase. Pitch it as a case study in trustworthy AI deployment, not just as a reseller relationship.  
_Timeline:_ Phase 1

**OpenAI**
_Relationship type:_ BYOK LLM provider  
_Approach:_ Same pattern — focus on the court-defensibility and provenance architecture as a model for responsible enterprise AI. OpenAI has an enterprise partner program.  
_Timeline:_ Phase 1

**Voyage AI**
_Relationship type:_ Embedding provider (default per engineering doc)  
_What to ask for:_ Partner/developer access; potential featured listing in their use-case gallery (forensic search over large evidence corpora is a strong showcase case for embedding quality)  
_Approach:_ Voyage AI is a smaller company (founded 2023); direct outreach to their team via LinkedIn or hello@voyageai.com is likely to land

**AWS (Textract)**
_Relationship type:_ Document intelligence BYOK provider  
_What to ask for:_ AWS ISV Partner Program listing — this is the standard mechanism for "works on AWS" partner certification  
_Why it matters:_ Many government customers are AWS GovCloud shops. An AWS ISV Partner listing signals that the platform has been vetted for AWS deployment, which reduces IT friction in federal procurement  
_Timeline:_ Phase 1–2

---

### 8.3 Approach strategy

For Phase 0–1, the outreach sequencing is:

1. **Build the connector first.** Approaching a company with "we'd like to be your partner" before you have a working integration is noise. Approach with "we have a working integration that 3 customers are using" — that's a partnership conversation.

2. **Lead with customer value, not business development.** When you call Etherscan or Allium, the pitch is: "We have customers who are trying to connect your API to their blockchain investigation workflow. We've built the connector. Can we get it listed on your developer partner page so investigators can find it more easily?" This is a much easier conversation than "we'd like a revenue-share deal."

3. **Public GitHub repo for connectors.** Per F45, connectors are open-sourced. A public GitHub repo of connectors (even with the core platform proprietary) makes partner conversations easier — "here's the open-source connector your customers can use" is more credible than a pitch deck.

4. **Conference presence is the alternative to cold outreach.** ACFE Annual Conference. CypherCon. Chainalysis LINKS (attend, don't exhibit in Phase 0). TRM Talks. These are where the right conversations happen in person.

---

## Section 9 — Founding-Team Capitalization Framework

### 9.1 The reality of a solo Phase 0

A solo developer in Phase 0 is operating from savings, freelance income, or a day-job overlap. The capitalization framework below is designed around a realistic solo founder, not a venture-backed startup.

**Phase 0 financial floor — revised with actual stack costs:**

The Phase 0 infrastructure is Supabase + Fly.io + GitHub — all existing founder accounts. This changes the financial floor materially compared to a greenfield infrastructure build:

| Item                                 | Monthly cost at launch                                      | Notes                                                 |
| ------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| Supabase Pro                         | $25/month                                                   | Includes Postgres, pgvector, object storage, auth     |
| Fly.io (scale-to-zero)               | $0–$50/month                                                | Scales with actual usage; zero when no traffic        |
| GitHub (Actions)                     | $0–$21/month                                                | Free tier covers most Phase 0 CI usage                |
| Etherscan V2 API (in-house baseline) | $0–$49/month                                                | Free tier sufficient for pilot use                    |
| Anthropic API (Tier C, BYOK default) | Pilot customers bring their own key; founder pays for demos | Budget $50–$100/month for demo and development calls  |
| Domain + DNS                         | ~$50/year                                                   | One-time plus annual renewal                          |
| Business insurance (E&O + cyber)     | ~$400–$700/month                                            | Most significant Phase 0 cost; non-negotiable per F43 |
| Legal (entity, MSA, trademark)       | $5,000–$8,000 one-time                                      | Clerky entity + attorney-reviewed MSA + USPTO filing  |
| **Total infrastructure**             | **< $300/month**                                            | Excluding insurance and one-time legal                |
| **Total with insurance**             | **~$700–$1,000/month**                                      | All-in monthly burn including E&O/cyber coverage      |

**What this means for runway:** A founder with $30,000 in personal savings has 30+ months of operational runway at this burn rate, before accounting for any customer revenue. A founder with $60,000 has 60+ months. This is not a venture-capital-or-bust situation — it is a bootstrappable product. Capital accelerates, but it is not required to keep the lights on.

**The funding narrative shift:** The story to investors is not "we need capital to survive Phase 0." It is: "We built Phase 0 on existing accounts with personal runway. We have paying customers. We need capital to (a) fund the AWS migration and SOC 2 Type 1 audit at Phase 2, (b) hire the first engineer, and (c) accelerate sales into Department-tier LE accounts." This is a much stronger position than raising pre-revenue because the server bills are due.

### 9.2 Phase 1 — 3 months post-Phase 0 launch

**Revenue milestone:** 10 paying customers at average $199/month = $1,990/month MRR. This is roughly 2x the monthly infrastructure burn (including insurance), meaning the founder is covering costs and beginning to accumulate cash. Still not paying themselves a market salary from the product, but the business is self-sustaining at the operational level.

**Infrastructure at Phase 1:** Still Supabase + Fly.io. At 10 customers, Supabase usage scales modestly — expect $100–$200/month in Supabase costs as data volume grows. Fly.io scales with traffic. Total infrastructure (not counting insurance) remains well under $500/month. No AWS migration yet.

**Team:** Still solo, or first contractor hire. The right first contractor is not an engineer — it's a part-time customer success person who handles pilot onboarding, answers questions, and keeps pilots from churning. This can be a 10-hour/week contractor ($30–$50/hour, $1,200–$2,000/month). Fundable from product revenue at the 10-customer milestone.

**Minimum viable team at Phase 1:** Founder + 1 part-time CS contractor.  
**Optimal team at Phase 1:** Founder + 1 CS contractor + 1 part-time sales engineer (can be the same person as CS if technical enough).  
**Capital need:** $0 in external capital if founder has personal runway. Bootstrap through Phase 1 entirely is feasible. The decision to raise pre-seed capital should be driven by acceleration opportunity (a Department-tier customer who wants to sign if you can demonstrate SOC 2 intent), not by survival need.

### 9.3 Phase 2 — 6 months post-Phase 0 launch

**Revenue milestone:** 30 paying customers across Investigator and Team tiers = ~$8,000–$12,000/month MRR. First Department-tier contract signed or in late-stage negotiation.

**The AWS migration — the planned Phase 2 cost event:**

The Supabase + Fly.io stack cannot support SOC 2 Type 1 directly. SOC 2 auditors evaluate the full infrastructure stack, and Supabase (while excellent for Phase 0) doesn't carry the compliance certifications that a SOC 2 auditor reviewing a law enforcement platform will want to see. The migration path:

1. **AWS RDS (Postgres)** replaces Supabase's managed Postgres. Data migration via pg_dump/pg_restore or Supabase's export tooling. RDS Aurora Postgres is drop-in compatible with the application layer (same Postgres wire protocol).
2. **AWS ECS or EKS** replaces Fly.io for the application tier. Fly.io's Dockerfile-based deployment translates directly to ECS task definitions.
3. **AWS S3** replaces Supabase Storage for object storage. Same S3-compatible API — already abstracted in the engineering doc.
4. **AWS KMS** replaces the Phase 0 KMS arrangement for SaaS Blind customers requiring AWS-native key management.

**Migration cost estimate:**

- Engineering time: 2–3 weeks of focused migration work (founder + first engineer)
- AWS infrastructure vs. Supabase + Fly.io: expect monthly infrastructure costs to increase to $800–$2,000/month at 30-customer scale (AWS is more expensive but more auditable)
- SOC 2 Type 1 audit: $25,000–$60,000 total (auditor fees + policy documentation + tooling like Vanta or Drata at $500–$1,500/month)
- Legal support for federal contracting prep: $5,000–$15,000

**Total Phase 2 capital requirement for AWS migration + SOC 2:** approximately $50,000–$100,000. This is the primary driver for the pre-seed raise.

**Team:** First engineer hire. The right first engineer hire is someone who can own the frontend (the founder is likely stronger on backend/infrastructure). The wrong first hire is a generalist who needs ramping — hire someone who can take ownership of a specific subsystem on day 1.

**Capital event:** At 30 customers and first Department-tier contract, a pre-seed raise of $500K–$1.5M is credible. Use a SAFE with a $6M–$10M valuation cap — appropriate for a solo-founder SaaS at this stage with LE customers. Allocate the raise: (a) AWS migration + SOC 2 Type 1 ($50K–$100K), (b) first engineer hire (12-month salary: $120K–$180K), (c) 6 months of founder salary at a sustainable rate ($60K–$90K), (d) legal + federal contracting prep ($20K–$30K), (e) reserve ($50K–$150K).

**Minimum viable team at Phase 2:** Founder + 1 engineer + 1 CS/Sales Engineer.  
**Optimal team at Phase 2:** Founder + 2 engineers + 1 CS/Sales + 1 part-time government affairs consultant.  
**Capital need:** Pre-seed $500K–$1.5M.

### 9.4 Phase 4 — 12 months post-Phase 0 launch

**Revenue milestone:** 5+ Department-tier customers, first Agency-tier customer signed or near-closed = $50,000–$150,000 MRR. ARR in the $600K–$1.8M range.

**Team:** 6–10 people. Product organization: Founder (CEO/CPO), VP Engineering or lead engineer (must have cleared government customers), 2–3 engineers, 1 government affairs / federal sales professional (former LE or IC with a network in the target customer base), 1 CS/implementations lead, 1 finance/operations.

**Capital event:** Seed round of $3M–$8M at a $15M–$30M pre-money valuation. Lead investor should be a firm with federal tech portfolio experience (Paladin Capital, Lockheed Martin Ventures, In-Q-Tel if eligible, Shield Capital, Point72 Ventures). The pitch is: "Court-defensible blockchain investigation platform. $1.5M ARR. 5 LE customers. SOC 2 Type 1. On-prem sovereign deployment. Competing with platforms that start at $40K/seat."

**Pre-seed → seed → A roadmap:**

- Pre-seed ($500K–$1.5M): Bridge to first LE contracts; SOC 2 Type 1; first engineers
- Seed ($3M–$8M): Scale sales team; SOC 2 Type 2; GSA Schedule application; FedRAMP Moderate sponsor identification
- Series A ($15M–$30M): FedRAMP Moderate authorization; SEWP / CIO-SP contracting vehicle; international expansion; CMMC Level 2

---

## Section 10 — Community and Content Plan

### 10.1 The Phase 0 content foundation (what the founder writes personally)

The founder is the content strategy in Phase 0. This is not a full-time marketing job — it is 3–5 hours per week of writing that builds the authority required to close the first ten customers.

**Publishing cadence:** 2 pieces per month minimum. Quality over frequency — one deeply researched piece beats five shallow posts.

**Content types and topics:**

_Technical authority pieces (most valuable for conversion):_

- "Why Blockchain Attribution Fails Daubert — and What Would Pass" — references specific case outcomes, names the problem, positions the Reproducibility Pack as the solution
- "The Non-Determinism Problem in Blockchain Forensics" — explains ChainArgos's documented issue, shows how frozen provider responses solve it
- "Six Methodologies, One Transaction: Why the Accounting Method Changes the Number" — FIFO vs LIBR walkthrough with a real transaction, shows methodology disclosure
- "How to Prepare a Blockchain Expert Witness for Cross-Examination" — practical guide citing the Expert Witness Profile (F26) features

_Positioning pieces (for credibility with decision-makers):_

- "The Case for Sovereign Blockchain Forensics: Why Federal LE Needs On-Prem" — references CJIS, FedRAMP, and the gap between policy-level privacy claims and technical guarantees
- "BYOK Blockchain Forensics: Why Your Data Subscriptions Should Work Together" — explains the BYOK model, names Chainalysis and TRM explicitly as data sources (not competitors)

_Community-building pieces (for peer networking):_

- Training case walkthroughs using public incidents (Bybit, Ronin, Bitfinex) — these double as marketing for the sandbox environment (F31)
- Methodology writeups on specific investigation patterns (pig butchering fund flow, ransomware layering, DeFi exploit reconstruction)

**Publishing channels:** LinkedIn (primary for LE/compliance audience), personal website/blog (SEO foundation), ACFE Forum (community credibility), Medium (technical audience), targeted subreddits (r/blockchainforensics, r/cryptoforensics if they exist; create them if they don't).

_Important note on case studies:_ Never publish a real customer case study without explicit written permission from the customer. Even with permission, anonymize all identifying details unless the customer explicitly requests attribution. A single confidentiality violation destroys the entire trust story.

### 10.2 Phase 1–2 community investments

**Customer Advisory Board (CAB):** Convene at Phase 2 with 5–8 founding members from early pilot customers. CAB members get early access to new features, direct line to the roadmap, and a formal consulting relationship (small equity or retainer — whatever they're allowed to accept given their employment). CAB members become the most powerful sales references because they can speak with specificity about features they shaped.

**ChainSight Investigator Certification (F31):** Launch with the Training & Sandbox environment at Phase 1. Publish the certification criteria publicly. Make the certification meaningful — require passing a structured case walkthrough using the platform, verified by the agency admin. Investigators who earn the certification add it to their CVs. Their CVs go in front of judges. Judges ask opposing counsel "why doesn't your expert have this certification?"

**User community forum:** Start with a Slack or Discord channel for paying customers at Phase 1. Classification-scoped: public discussion group (product feedback, general questions), customers-only group (case workflow discussion — no actual case content), LE-only group (requires verification, closed). The LE-only group becomes the most valuable because investigators share methodology knowledge peer-to-peer.

### 10.3 Phase 4 community investments

**Annual ChainSight Conference (per F45):** Launched at Phase 4 when there are enough customers to fill a room. Modeled on Chainalysis LINKS — one day, 200–500 attendees, technical sessions + methodology sessions + government keynote. Location rotates between Washington DC and a second city. Certification exams offered at the conference. Academic panel on blockchain forensics research.

**Academic partnerships:** Research data access program — academic researchers can apply for anonymized aggregate data access. Publication credit requirements. Annual research grants in blockchain forensics methodology ($25,000–$50,000 annually by Phase 3). University curriculum partnerships (three or four schools with strong forensic accounting or cybercrime programs — Fordham, Carnegie Mellon, UMBC, George Washington).

**Open Detector Library (F45):** Launch at Phase 2. Investigators and researchers submit detection heuristics for new obfuscation patterns. ChainSight validates against ground-truth datasets and ships approved detectors in the catalog. Detector authors get attribution and a small bounty (the community-funding model). The open library is the primary mechanism for covering new attack patterns faster than any solo team could.

---

## Section 11 — Channel and Partnership Strategy

### 11.1 Government contracting vehicles

_Phase 3:_

- **GSA Multiple Award Schedule (MAS)** — specifically the IT Schedule 70 and the Security & Protection Category (NAICS 541511, 541512, 541519). The GSA Schedule is the broadest government procurement vehicle — 90%+ of federal agencies can order from it. Application takes 6–12 months. Start the application at Phase 2; target listing at Phase 3. Cost: $25,000–$75,000 in legal/consulting fees for the first listing.
- **NASPO ValuePoint / NCPA / OMNIA Partners** — state and local government procurement vehicles. Broader reach than federal for the Department tier state/local LE customers. Easier to get listed than federal vehicles.

_Phase 4:_

- **SEWP V/VI (NASA Solutions for Enterprise-Wide Procurement)** — NASA-administered vehicle used by all federal agencies. Strong for IT products. High-value contracts ($250K+). Requires a current GSA Schedule or similar.
- **CIO-SP4** — HHS-administered, all-agency IT services vehicle. Particularly strong for healthcare-adjacent and biodefense customers; also used widely for cybersecurity.
- **OASIS+** — GSA-administered professional services vehicle. Relevant if ChainSight begins offering professional services (training, implementation, forensic consulting) alongside the product.

### 11.2 Reseller and channel partners

**The Phase 0–1 position:** Do not build a reseller channel yet. Every dollar of customer revenue in Phase 0 needs to go toward product improvement, not channel margin. A reseller partner who closes a customer and then hands off support creates churn — the product isn't ready to support at arm's length.

**Phase 2–3 channel strategy:**

_Systems integrators (SIs) who serve government LE:_  
Booz Allen Hamilton, Leidos, SAIC, Peraton, ManTech — these firms have deep relationships with every federal LE agency and regularly bid on vehicle contracts that include software tools. The right relationship is "reseller + implementation partner" — they bundle ChainSight into their LE modernization proposals and provide implementation services. This requires:

- A commercial listing on a government contracting vehicle (GSA Schedule minimum)
- A formal channel partner agreement with defined margin (typically 15–20% of annual contract value for SIs)
- A ChainSight-certified implementation track (a 3-day certification program for SI consultants)

_Digital forensics training firms:_  
Telos, Cyber Readiness Institute, SANS (for training-adjacent distribution), HTCIA (High Technology Crime Investigation Association) — these organizations train investigators. A ChainSight integration with their training curriculum makes ChainSight the "platform the certified investigator knows" — which is how Chainalysis Reactor built its dominant position.

### 11.3 Integration partnerships

**Maltego:** Graph intelligence platform widely used by LE and private investigators. A ChainSight → Maltego transform (Maltego calls ChainSight's API to populate graph entities) is a 1–2 week build and creates a natural distribution channel among investigators who are already in the Maltego ecosystem. Approach: Maltego has a public transform API and partner program.

**i2 (IBM Analyst Notebook):** Legacy graph analysis tool still widely used in federal LE. An i2 data import from ChainSight's Reproducibility Pack (export to i2-compatible XML format) adds value for agencies that are standardized on i2 for broader analysis. Approach: IBM has an i2 partner program; entry requires an existing government LE customer reference.

**Palantir:** More complex. Palantir competes at the Agency/Classified tier but does not natively do blockchain forensics. A Palantir connector that imports ChainSight Reproducibility Packs as Palantir objects (datasets, objects, properties) would allow Palantir customers to correlate blockchain evidence with their broader Palantir investigations. Approach: Palantir has a partner program called Palantir Connect; entry requires a mutual customer (an agency that uses both). Target this at Phase 3+.

**Case management systems (Axon, Tyler Technologies, Mark43):** Many LE agencies use one of these case management systems. A ChainSight integration that pushes Reproducibility Packs, case summaries, and exhibits directly into the existing case management system reduces the friction of adding a new tool. Approach: all three have API integration programs. The Axon relationship is particularly valuable — Axon dominates US law enforcement and their Evidence.com platform is the standard for digital evidence management.

---

## Section 12 — Brand and Naming

### 12.1 The naming decision

"ChainSight" is the working codename. The real naming decision factors:

**Keep "ChainSight" if:**

- The domain chainsight.com or chainsight.io is available at a reasonable price (< $10,000)
- There are no existing trademarks in the cybersecurity / software / SaaS space that would create infringement risk
- No competitor's product name is close enough to create confusion (Chain-anything is common in crypto; "sight" as a suffix is used in cybersecurity — check specifically for any OSINT or security tools with similar names)

**Change the name if:**

- The domain is taken at an unreasonable price
- A trademark conflict exists in the IC 042 (Software as a Service) or IC 045 (Security/Investigation) classes
- Advisors with federal procurement experience flag it as "sounds too crypto-generic" for government buyers

**Alternative names to consider if renaming:**

- Names that emphasize the methodology/court angle: _Provenance_, _TraceRecord_, _AuditChain_
- Names that emphasize the sovereignty angle: _Sovereign Forensics_, _Fortaleza_ (fortress in Spanish)
- Names that are more neutral and professional for government context: _Meridian_, _Veridian_, _Stratum_

### 12.2 Domain acquisition

Whether keeping ChainSight or rebranding:

- Register the .com first, even if imperfect (chainsight.io or chainsight.co as fallback)
- Register common misspellings (.net, .org as defensive registrations — $12/year each)
- Do not use a domain that could be confused with an existing company (chainalysis.com exists; chainsight.com would not create confusion, but verify)
- Preferred registrar: Cloudflare Registrar (at-cost pricing, no upsell, includes WHOIS privacy by default)
- Privacy: WHOIS privacy on all registrations until brand is public

### 12.3 Trademark filing

File USPTO trademark applications in Classes 42 (Software as a Service) and 45 (Security, Investigation) before public launch. Cost approximately $350 per class (basic TEAS application). Do not proceed without a trademark attorney's clearance search — a $1,500–$3,000 clearance search before filing is worth 10x the cost relative to the risk of building a brand on a contested name. File in Phase 0, before public launch.

### 12.4 Brand guidelines — Phase 1 work

Brand guidelines are not Phase 0 work — they require customer validation first. Phase 1 design investments:

- Logo (hire a professional designer at $1,000–$3,000 — do not use an AI generator for a logo going into government procurement)
- Color palette and typography (must be accessible, professional, and functional in dense UI layouts — think less "crypto startup" and more "precision instrument")
- Brand voice guidelines: plain English, no jargon, no marketing superlatives, transparent about limitations, specific rather than vague. The methodology transparency of the platform should be reflected in the brand voice.
- Do not use "AI" as a primary marketing term. The market is oversaturated with "AI-powered" claims. Use "autonomous" and "agent-based" and "provenanced" — these are more specific and more credible.

---

## Section 13 — The 90-Day Phase 0 Commercial Plan

A solo founder doing both engineering and commercial work in 90 days is a real constraint. This plan is designed for a founder spending 25–30% of their time on commercial work and 70–75% on engineering.

### 13.1 What gets done in 90 days

**Days 1–14: Foundation**

- Incorporate the entity (Delaware C-Corp via Stripe Atlas or Clerky — $500–$800 total). Do this first. Contracts, bank accounts, and AWS tax exemptions all require it.
- Open a business bank account (Mercury is the standard for startups; no fees, no minimum balance, wire and ACH support).
- Register the domain. File trademark applications (hire a trademark attorney — use a flat-fee service like Trademark Engine or a solo practitioner referral, budget $2,000–$4,000 including legal fees).
- Obtain basic business insurance: E&O ($5M minimum, ~$2,000–$4,000/year for a startup), Cyber liability ($10M minimum, ~$3,000–$6,000/year). Engage an insurance broker who specializes in tech professional liability — the requirements in F43 are the minimum; don't go below them.
- Draft the MSA template. Use a tech startup MSA as a base and add the ChainSight-specific provisions from F43: vendor-access limitation, methodology disclaimer, BYOK data ownership, Reproducibility Pack portability at termination. Have a lawyer review it — budget $2,000–$4,000 for a one-time startup legal package.
- Draft the Pilot Agreement: 2 pages, plain English, covers the 90-day terms, the conversion plan, and the feedback obligation.

**Days 15–30: Outreach foundation**

- Write the first technical content piece ("Why Blockchain Attribution Fails Daubert") and publish it
- Create a personal LinkedIn post announcing the platform (not a full launch — a "building in public" post that describes the problem and invites interested investigators to talk)
- Direct message the first 20 prospective pilot candidates using the archetype profiles in Section 4
- Build a simple demo-ready environment: one Ethereum case with a realistic transaction set (use a publicly documented incident like a public pig-butchering case or Ronin Bridge), pre-loaded so the 15-minute demo in Section 6 works cleanly every time

**Days 31–60: First conversations and pilot conversions**

- Conduct 10–15 demos for interested prospects from the outreach
- Close 3–5 pilot agreements at the $49/month pilot rate (Investigator tier)
- Pilot customers begin active use — provide weekly check-in calls (30 minutes) to understand what's working and what isn't
- Start the website: a single-page site with the positioning statement, a demo video (record the 15-minute demo script), a pilot signup form, and a link to the technical blog

**Days 61–90: Feedback integration and first conversion**

- First 60-day check-in with pilot customers: what would prevent them from converting to a paid annual subscription?
- Complete at least one major product improvement driven by pilot feedback (this signals to pilots that their input is taken seriously)
- Target: first pilot customer produces a usable work product (a Reproducibility Pack, a trace exported for a client report, or a court exhibit) using ChainSight
- Begin preparation for Day 91: conversion conversation with pilot customers

### 13.2 What is explicitly deferred

These are real commercial needs that are NOT Phase 0 work:

- **Full sales deck (beyond the demo):** The demo script is the sales tool in Phase 0. A full sales deck comes after you have 3–5 slides worth of real customer evidence to include.
- **PR and media coverage:** Don't seek press coverage until you have real customers and a real story. A TechCrunch article about a platform with zero customers creates interest you can't convert.
- **Conference exhibiting:** Attend conferences as a participant, not an exhibitor, in Phase 0. A booth costs $5,000–$15,000 and requires collateral you don't have. Attend, have conversations, collect business cards.
- **Channel partnerships:** Premature in Phase 0 — see Section 11.
- **Hiring a sales rep:** You are the sales rep until you have 20+ paying customers and a repeatable sales process documented. An AE hired before you have a repeatable process will fail and cost you $150K.
- **GSA Schedule application:** This is Phase 3 work and takes 6–12 months. Don't start it now.

---

## Section 14 — The Metrics That Matter (Commercial)

### 14.1 Phase 0 KPIs

Track these weekly from Day 1. No dashboard required in Phase 0 — a simple spreadsheet works. The discipline of tracking is more important than the tool.

**Top-line commercial:**

- **Pilot conversion rate:** Percentage of demo calls that convert to a pilot agreement. Target: >25%. If below 15%, the demo or the pricing is wrong.
- **Pilot-to-paid conversion rate:** Percentage of 90-day pilots that convert to a paid subscription at 90 days. Target: >60%. Below 40% means the pilot customer didn't achieve enough value.
- **MRR by week:** Running weekly calculation of monthly recurring revenue. Target trajectory: $0 → $1,000/month by Day 60 → $2,500/month by Day 90.

**Product engagement (leading indicators of conversion):**

- **Time-to-first-case:** How many days from pilot start until the pilot customer creates their first case and runs their first trace. Target: <3 days. A pilot customer who hasn't opened a case by Day 7 is at serious churn risk.
- **Weekly active investigators:** Number of pilot accounts that logged in and ran at least one operation in the past 7 days. Target: >80% of pilot accounts are weekly active.
- **Cases closed per pilot per month:** How many cases are pilot customers closing (marking as completed) in a month. Target: at least 2–3 cases per pilot per month. Cases closed = work product delivered = value received.
- **Reproducibility Pack exports per pilot per month:** How many Packs are being exported (used as actual work product). Target: >1/month per active pilot by Day 60. This is the clearest signal that the platform is being used for real work, not just exploration.

**AI and BYOK health:**

- **AI utilization rate:** Percentage of case traces that use at least one AI agent call vs. manual-only. High AI utilization = the AI is adding value. Low AI utilization = either the AI is unreliable or the UX isn't surfacing it clearly.
- **BYOK provider attach rate:** Percentage of pilot accounts that have connected at least one BYOK data provider (beyond the free defaults). Target: >70% by Day 60. Low attach rate means the BYOK setup process is too complex.
- **Provider error rate:** Percentage of capability router calls that fail (provider API error, rate limit, quota exhaustion). Target: <2%. Higher indicates the capability router's fallback logic or the provider health check isn't working.

### 14.2 What not to track in Phase 0

- **Churn rate:** You don't have enough customers for churn rate to be statistically meaningful. Track individual account health instead.
- **CAC (Customer Acquisition Cost):** Too early. In Phase 0, every customer acquisition is fundamentally different. Start tracking this formally at 30+ customers.
- **NPS scores:** Premature. Ask for direct feedback in pilot check-in calls instead.
- **Organic search traffic:** Your SEO foundation doesn't exist yet. Track it after 6 months of publishing.

---

## Section 15 — Risks and Tradeoffs

### 15.1 Where the BYOK pitch lands hardest

**Best-fit BYOK scenarios (where the pitch is immediate and compelling):**

- Customers who already have Chainalysis or TRM contracts. "Connect your existing key" removes the procurement objection entirely. These customers get additional value from their existing spend at a marginal cost.
- Agencies with multi-provider environments (TRM for API screening + Chainalysis for investigation, for example). ChainSight unifies these through the capability router, with corroboration as the default.
- Air-gapped or highly classified customers who cannot use a vendor-operated data pipeline. BYOK is the only model that works for them.

**Weak-fit BYOK scenarios (where the pitch is harder):**

- Customers with _zero_ data subscriptions. They hear "BYOK" and think "so I have to buy everything separately." The in-house heuristics baseline (F40) answers this — "you can run with zero providers and still get real value" — but this requires demonstrating the baseline, not just describing it.
- Customers whose procurement team controls all vendor relationships. Connecting a new platform to Chainalysis's API may require IT approval of the new platform — it doesn't simplify procurement, it adds a step.
- Solo investigators with budget constraints. They'll ask whether the in-house tier (free providers, no commercial subscriptions) is powerful enough for their cases. The honest answer: for simple cases, yes. For complex attribution-heavy investigations, you'll want at least one commercial attribution provider.

### 15.2 Where the sovereignty pitch is wasted

**Low-impact sovereign deployment audiences:**

- Small solo investigators. They don't have the infrastructure to run on-premises. For them, SaaS Blind with strong encryption guarantees is "sovereign enough."
- Small private compliance teams at Series A–B fintechs. They're already running on AWS/GCP. Adding another self-hosted service to their stack is burden, not benefit.
- Any customer whose IT department won't budget for an on-premises server infrastructure.

**High-impact sovereign deployment audiences:**

- Federal LE at any level — the CJIS requirements and classification sensitivity make data residency and vendor-access limitations critical.
- Intelligence community (when they can even talk to you).
- Large financial institutions with strict data governance (Tier-1 banks, large insurance companies with financial crime units).
- International customers in jurisdictions with strict data sovereignty laws (EU GDPR, China CSL, etc.) — but this is Phase 4.

**The tradeoff:** Sovereign deployment is a Phase 0 investment that pays off at Phase 3+. In Phase 0, you're spending engineering time on the on-prem installer and the SaaS Blind encryption architecture that will not close a single deal in the first 90 days. The payoff is real — it's what closes the federal deals — but it's a deferred payoff. Manage this investment accordingly.

### 15.3 Where the AI is a liability

**The false-positive in court risk is real.** If an AI agent suggests an attribution that an investigator promotes to court-grade without sufficient independent verification, and that attribution turns out to be wrong, the case suffers a Daubert defeat and ChainSight gets cited as a contributing factor. This is the Catch-22: the AI is the product's most visible differentiator, but it's also the most fragile under adversarial scrutiny.

**Mitigation in the architecture (already locked):** G1 (human sign-off required for court-grade attribution), the Critic Agent (adversarial review of every AI claim), the Verifier Agent (citation-token enforcement), and the Belief State tiering (T0–T3 explicit confidence levels). These are real architectural mitigations. But they're only effective if the investigators actually use them correctly — which is a training and UX problem as much as a technical problem.

**The practical risk:** A pilot customer who doesn't understand the tiering system will take an AI-suggested attribution at face value, put it in a court filing, and get burned. When they get burned, they blame ChainSight. The demo script (Section 6) and the pilot onboarding must hammer the tiering system explicitly.

**Marketing implication:** Don't lead with "AI-powered" in any sales context. The word "AI" raises the question of reliability before you've had a chance to explain the Critic/Verifier architecture. Lead with "court-defensible" and "reproducible." Let the AI features be discovered by the investigator as they use the product.

### 15.4 The SOC 2 migration timing risk

The Supabase + Fly.io Phase 0 stack is a deliberate, defensible choice — but it creates a specific commercial risk that must be managed proactively.

**The scenario:** A Team or Department-tier prospect completes due diligence and asks for a current SOC 2 Type 2 report. ChainSight doesn't have one. The prospect says they can proceed with a SOC 2 Type 1 commitment letter and a 6-month timeline. ChainSight is currently on Supabase + Fly.io, which means the SOC 2 Type 1 audit cannot begin until after the AWS migration. The migration takes 2–3 weeks of engineering time. The audit takes 3–4 months after that. Total timeline from conversation to SOC 2 Type 1: approximately 5–6 months.

**Why this creates friction:** A Department-tier prospect with a 6-month fiscal year procurement window has essentially no margin for error. If ChainSight is in the middle of the AWS migration when the customer's procurement window opens, the deal slips a fiscal year.

**Mitigation strategy:**

1. **Start the AWS migration at Phase 1, not Phase 2.** Don’t wait until a customer demands it. Begin the migration as soon as 5–10 Investigator-tier customers are stable on the Supabase stack — use those customers as the validation that the application layer is stable, then migrate the infrastructure beneath them.

2. **SOC 2 compliance tooling (Vanta/Drata) from Phase 0.** Vanta and Drata automate the evidence collection that SOC 2 auditors require. At $500–$1,500/month, they are affordable even on Phase 0 economics. Starting evidence collection before the AWS migration means the audit can begin immediately after the migration completes, not months after.

3. **The on-premises escape valve is the immediate answer.** Any Department-tier customer who raises SOC 2 as a current blocker gets a direct offer: "Deploy on-premises on your own AWS infrastructure. Your SOC 2 posture covers your own AWS. Our SOC 2 audit doesn’t enter into it." This is not a workaround — it is the designed sovereign deployment model.

4. **Honest communication beats overpromising.** When a customer asks about SOC 2 timing, give them the specific timeline: "Phase 0 runs on Supabase and Fly.io. We begin the AWS migration at Phase 1 [approximate date]. SOC 2 Type 1 audit starts immediately after migration. Target completion: [date]." A customer who chooses on-prem in the interim is not a lost sale — they are a paying customer who will convert to SaaS Blind when the certification lands.

---

### 15.5 Where competitors will copy

**What incumbents can copy easily:**

- The BYOK pattern — Chainalysis or TRM could announce "connect your other providers to our platform" within a year if ChainSight demonstrates market traction. This is real risk. The response: by the time they copy, ChainSight has been in production with LE customers for 12+ months, and institutional inertia favors the incumbent of the new pattern.

**What incumbents cannot copy quickly:**

- The Reproducibility Pack format (an open specification with replay infrastructure). Building this into a legacy codebase that wasn't designed for it would require 2–3 years of refactoring.
- The sovereign deployment architecture. Every incumbent's codebase is SaaS-native. Adding genuine on-prem sovereignty (not "we'll run it on your AWS account") to a SaaS-native architecture is architectural surgery, not a feature sprint.
- The court-defensibility culture. Chainalysis's product culture is built around compliance (AML monitoring) and LE relationships. ChainSight's culture is built around court proceedings and methodology disclosure. These are fundamentally different orientations that affect every product decision.

---

## Section 16 — The "What Would Kill Us" Exercise

Three commercial risks with credible mitigation paths.

### 16.1 Chainalysis bundles AI agents for free

**The scenario:** Chainalysis announces "Chainalysis Copilot" — an AI agent layer built into Reactor that does automatic tracing, drafts narrative summaries, and exports exhibits. They offer it at no additional charge to existing subscribers. Their incumbent position, their attribution database, and their existing customer relationships mean that every Chainalysis customer evaluates their AI layer before evaluating ChainSight.

**Why this is the most credible kill risk:** Chainalysis has the resources ($100M+ in annual recurring revenue, well-capitalized), the customer relationships, and the API access to build this. They've been hiring AI engineers since 2023. Some version of this is likely.

**Why it wouldn't necessarily be fatal:**

1. Chainalysis's AI layer will not have a Reproducibility Pack. The non-determinism problem exists because Chainalysis's attribution data changes. They cannot solve this without fundamentally changing their data architecture — a multi-year project.
2. Chainalysis's AI layer will not have sovereign deployment. It will be a SaaS-only feature, which excludes the federal LE customers who require on-prem.
3. Chainalysis's AI layer will not support other attribution providers as BYOK. An investigator who wants to corroborate Chainalysis attribution with TRM will still need ChainSight.

**Mitigation strategy:** Win the reproducibility and sovereignty story before Chainalysis builds AI. Get 5–10 LE customers using Reproducibility Packs in court. When Chainalysis's AI announcement happens, the response is: "Great. Connect your Chainalysis AI findings to ChainSight to make them reproducible and court-defensible."

---

### 16.2 Federal customer requires FedRAMP High on Day 1

**The scenario:** The first federal LE customer ChainSight approaches — the one the founder has a relationship with — says they can't proceed without FedRAMP High. Not Moderate. High. The process for FedRAMP High takes 2–4 years after Moderate and requires a sponsoring agency. The customer has a 6-month procurement window.

**Why this is credible:** FedRAMP High is the requirement for systems that process Controlled Unclassified Information (CUI) at the highest sensitivity level. Many federal LE systems handle information at this level. If the first federal target is at this level, the company is prematurely boxed out.

**Why it's not necessarily fatal:**

1. The on-premises sovereign deployment is a real alternative for agencies that require data sovereignty but cannot wait for FedRAMP. CJIS conformance documentation can be produced before Phase 1 ends for on-prem deployments.
2. Not all federal LE operates at CUI/FedRAMP High requirements. State-level fusion centers, HIDTA task forces, and many local LE units can operate under more permissive authorization.
3. The certification roadmap (F42) is explicit: FedRAMP Moderate by Phase 4, not Day 1. Customers who need FedRAMP High are Phase 4+ and Post-Phase-4 customers.

**Mitigation strategy:** In Phase 0–1, deliberately target state/local LE and private-sector customers where FedRAMP is not a hard requirement. When a federal customer's procurement team says "FedRAMP," route them to the on-premises deployment as the immediate solution and document the FedRAMP roadmap. Get the first non-FedRAMP federal customer (there are many) before pursuing the high-classification federal path.

---

### 16.3 An early high-profile false-positive in court

**The scenario:** A pilot customer uses a ChainSight AI-suggested attribution to support a criminal charging decision. The attribution is wrong. Defense counsel hires a blockchain expert who demonstrates the error. The case is dismissed or the attribution is struck. A legal reporter covers it. "AI Blockchain Tool Gives Wrong Answer in Criminal Case" is the headline.

**Why this is the highest-consequence kill risk:** Unlike the other two risks, this one is not recoverable quickly. A single high-profile false-positive in a criminal case creates a media narrative and a judicial perception problem that could take years to reverse. It also creates liability exposure under the E&O insurance structure.

**Why the architecture helps — but doesn't fully prevent it:**

- The tiering system (T0–T3) is designed to keep AI suggestions separate from court-grade conclusions.
- The Critic Agent and Verifier are designed to prevent unverified AI claims from reaching reports.
- But a pilot customer who bypasses the human-in-the-loop requirement (G1) by clicking "promote to court-grade" without actually verifying the attribution can still produce a wrong court filing.

**Mitigation strategy — pre-emptive:**

1. The MSA methodology disclaimer (F43) is non-negotiable. Every report contains language explicitly stating that the platform's findings are technical conclusions, not legal conclusions, and that the human investigator bears responsibility for their use.
2. Pilot onboarding must include explicit training on the tiering system. A pilot customer who has been shown, in writing, that T2 attribution requires human verification before court-grade promotion has less ability to blame ChainSight when they skip that step.
3. Phase 0 pilot target selection should prioritize civil investigation work (asset recovery, civil litigation support) over criminal prosecution support. Civil proceedings have more error tolerance — an erroneous finding gets corrected in discovery rather than triggering a criminal acquittal.
4. E&O insurance is in place before the first pilot signs (F43). Budget for it.

**Response strategy — if it happens:**
Issue a clear, direct statement: what the platform shows about the specific interaction (did the investigator follow the human-in-the-loop workflow?), what the architectural safeguards are, and what specific improvements are being made. Do not be defensive. Transparency in error response is the exact behavior the platform's anti-feature commitments (F41) require.

---

### 16.4 SOC 2 timing mismatch blocks the first Department-tier deal

**The scenario:** The first serious Department-tier prospect — a state AG unit or a HIDTA task force — is ready to sign. Their IT security review requires SOC 2 Type 1 before any new SaaS vendor can be approved. ChainSight is mid-migration from Supabase to AWS. The SOC 2 audit hasn't started. Their procurement window closes in 60 days. The deal misses the fiscal year.

**Why this matters:** A Department-tier deal is the proof of concept for the commercial model. It unlocks the reference customer that closes the next five Department-tier deals. Missing it by one procurement cycle can mean a 12-month delay in the LE market trajectory.

**Mitigation:**

1. **Lead the on-premises offer proactively** before the SOC 2 question is raised. Frame it positively: "For CJIS-sensitive workloads, we recommend on-premises deployment — your infrastructure, your controls, your SOC 2 posture." Many LE customers will prefer this anyway. Removing the SaaS Blind stack from their IT review path eliminates the Supabase/Fly.io concern entirely.

2. **Begin the AWS migration as early as possible in Phase 1.** The migration is 2–3 weeks of engineering time. Do it at the beginning of Phase 1, not the end. Run Vanta/Drata from Phase 0 so that when the migration completes, evidence is already 6 months old and the SOC 2 audit can begin immediately.

3. **Negotiate conditional purchase orders.** A procurement-savvy Department-tier customer can sign a conditional PO: "We will pay $X upon SOC 2 Type 1 certification, with deployment commencing on [date]." This is a real procurement mechanism that bridges the timing gap. Get a government contracting attorney to draft the language.

4. **Accelerate with capital if necessary.** If a large Department-tier deal is contingent on SOC 2 timing, an angel investment of $75K–$150K specifically to fund the AWS migration + audit cycle is worth raising — the deal's contract value justifies it. A $50K/year Department-tier contract justifies $75K in audit costs. Do the math with investors.

---

## Section 17 — Phase 0 Commercial Deliverables

Concrete artifacts the founder must produce in 90 days. Estimated effort per artifact.

| Artifact                                  | Description                                           | Estimated effort                            | When needed                                      |
| ----------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| **Corporate entity**                      | Delaware C-Corp via Stripe Atlas/Clerky               | 4 hours + $500–$800                         | Day 1                                            |
| **Business insurance**                    | E&O + cyber liability (F43)                           | 8 hours (broker engagement) + $5K–$10K/year | Day 10                                           |
| **Domain registration**                   | chainsight.com or equivalent, defensive registrations | 2 hours + $50–$200/year                     | Day 1                                            |
| **Trademark filing**                      | USPTO Classes 42 + 45 with attorney clearance         | 8 hours + $2,000–$4,000 legal               | Day 10                                           |
| **MSA template**                          | Based on F43 provisions, attorney-reviewed            | 16 hours + $2,000–$4,000 legal              | Day 20                                           |
| **Pilot agreement**                       | 2-page simple pilot terms                             | 4 hours                                     | Day 10                                           |
| **Demo environment**                      | One pre-loaded Ethereum case with public data         | 8 hours                                     | Day 20                                           |
| **Demo video (15 min)**                   | Screen recording of the Section 6 script              | 6 hours                                     | Day 30                                           |
| **One-page website**                      | Positioning statement, demo video, pilot signup       | 16 hours                                    | Day 30                                           |
| **Pricing sheet**                         | One page, tiers and pilot pricing                     | 4 hours                                     | Day 15                                           |
| **Outreach scripts**                      | LinkedIn DM, email outreach for each archetype        | 6 hours                                     | Day 15                                           |
| **Technical blog post 1**                 | "Why Blockchain Attribution Fails Daubert"            | 10 hours                                    | Day 20                                           |
| **Security questionnaire response**       | Standard DDQ covering SaaS Blind architecture         | 12 hours                                    | Day 45 (needed when first Team/Dept pilot signs) |
| **F42 certification roadmap** (published) | External-facing version of the internal F42 table     | 4 hours                                     | Day 30                                           |
| **Pilot feedback log**                    | Simple spreadsheet for tracking pilot feedback        | 2 hours                                     | Day 30                                           |

**Total estimated commercial effort in 90 days:** ~110 hours = roughly 4–5 hours per week. This is achievable alongside engineering work. The items with the highest leverage are the MSA/pilot agreement (required to close any deal), the demo environment (required for any demo), and the outreach scripts (required for any outreach).

---

## Section 18 — Open Questions

Specific questions for the founder that affect commercial decisions. These are not hypothetical — they change the GTM plan.

### Q1: Pre-existing customer relationships

Does the founder have any existing professional relationships with potential pilot customers? A former colleague who is now at an LE unit, a forensic accountant they know personally, a compliance professional from a previous job?

_Why it matters:_ The Phase 0 outreach plan assumes cold outreach. If the founder has warm relationships, the pilot recruitment timeline compresses from 60–90 days to 2–3 weeks. Knowing these relationships exist also changes which pilot archetype to prioritize — a warm Department-tier contact may be worth pursuing even if the sales cycle is longer, because the reference value is higher.

### Q2: Willingness to relocate (or travel) for federal work

Federal LE sales in the US are heavily concentrated in Washington DC, Quantico, and the suburban Virginia/Maryland federal corridor. A founder located outside this geography faces a real disadvantage in building the LE relationships that lead to Department and Agency tier contracts.

_Why it matters:_ If the founder is willing to spend 2–3 days per month in DC for the first 12 months, the federal LE pipeline becomes significantly more accessible. If not, the initial focus should be private-sector and state/local LE, with federal sales deferred to Phase 2–3 when a government affairs hire can carry the DC relationship-building.

### Q3: Runway

How many months of personal runway does the founder have before the platform needs to generate income? This sets the urgency of the commercial timeline.

_Why it matters:_ If runway is 6 months, the Phase 0 commercial plan needs to close paying customers by month 3, which means the demo environment and outreach need to start on Day 1 of engineering, not after 8 weeks of build. If runway is 18 months, there is more time for product quality to develop before commercial pressure kicks in.

### Q4: Legal entity formation status

Has the founding company been formally incorporated? Is there outside capital already committed? Are there cofounders?

_Why it matters:_ If there are cofounders, the equity split, IP assignment, and vesting schedule all need to be documented before the first customer conversation. If there's existing capital, the pre-seed raise timing and structure changes. If the entity isn't formed, the MSA and pilot agreement are legally unenforceable.

### Q5: Specific prospect in mind

Does the founder have a specific person — by name, not archetype — who they believe would be the first Phase 0 pilot customer? A specific prosecutor, a specific PI, a specific compliance director?

_Why it matters:_ If yes, optimize the demo, the pilot pricing, and the onboarding experience for that specific person's workflow first. The platform built around one real user is more valuable than the platform built around three imagined users.

### Q6: Network in the LE/compliance/PI world

Beyond direct relationships, does the founder have any indirect network in these communities? A former law school classmate who is a prosecutor, a family member in LE, a previous employer with LE connections?

_Why it matters:_ The first 5 pilot customers are almost always sourced from the founder's network — not from cold LinkedIn outreach. Understanding the actual network allows the commercial plan to be targeted rather than generic.

### Q7: Technology transfer or prior IP

Is any component of ChainSight built on prior employer IP, open-source code with restrictive licenses, or code from a previous company where the founder had IP assignment obligations?

_Why it matters:_ IP cleanliness is a diligence item in every investor round and every government contract award. A question about this at Series A or at a GSA Schedule award is much worse to answer retroactively than to address proactively. The answer should be documented by counsel before the first investor pitch.

### Q8: Conference and community presence

Does the founder currently attend, speak at, or participate in any of the relevant conferences and communities? ACFE Annual Conference? HTCIA? DefCon? BSides? Crypto-specific events?

_Why it matters:_ The fastest path to the first 5 pilot customers is through in-person relationships at the two or three conferences where the target customers congregate. If the founder isn't yet present in those communities, the commercial plan should budget for conference attendance in months 1–3.

### Q9: Comfort with public visibility

Building a forensics platform for law enforcement and the courts requires the founder to be visible and credible — publishing content, doing demos, speaking at events. Some technical founders are uncomfortable with this visibility.

_Why it matters:_ If the founder is uncomfortable with personal brand building, the content strategy in Section 10 needs to be adapted (fewer bylined pieces, more anonymous technical documentation) and a part-time content/marketing collaborator should be budgeted earlier than Phase 2.

### Q10: Revenue targets for investor readiness

At what revenue level does the founder want to raise external capital? $100K ARR? $500K ARR? $1M ARR? Different investors (angels, pre-seed funds, seed funds) have different revenue expectations at first check.

_Why it matters:_ If the target is angel investment at $0 ARR, the commercial story needs to be early and compelling — the investor is buying vision. If the target is seed at $500K ARR, the first 12 months of commercial execution are entirely about hitting that ARR number. These are different time horizons and different strategies.

---

## Closing Note

This document is the commercial counterpart to the engineering document and the eight discipline design outputs. It is opinionated because the founder needs decisions, not options.

The core commercial thesis is simple: ChainSight exists in a market where every incumbent is either too expensive for the investigator who needs court-defensibility, or too architecturally compromised to serve the sovereign customer who needs data privacy. The four pillars — Belief State, Reproducibility, BYOK, and Sovereign Deployment — are not features. They are the answer to specific procurement objections that every potential customer has already encountered with every existing platform.

The work in Phase 0 is to find the three to five investigators who feel those objections most acutely and let them experience the answer firsthand. Everything else — pricing, channels, certifications, community — follows from that initial validation.

The platform is real. The differentiators are locked. The commercial path is buildable.

---

_Document generated:_ June 2026  
_Supersedes:_ No prior commercial document; extends F46 (packaging), F45 (community), F44 (EOL/escrow), F43 (legal/insurance), F42 (certifications), F41 (bias/fairness), F40 (in-house heuristics), G8 (BYOK neutrality)  
_Next commercial artifacts:_ Pilot Agreement template, MSA template, Demo script recording, Outreach scripts per Section 4  
_This document references:_ chainsight_v1_0_engineering.md, chainsight_v0_8_addendum.md, chainsight_v0_7_deployment_model_addendum.md, chainsight_v0_3_byok_addendum.md, chainsight_v0_8_consolidated.md, chainsight_v0_9_ai_strategy.md, chainsight_v0_7_gap_analysis.md
