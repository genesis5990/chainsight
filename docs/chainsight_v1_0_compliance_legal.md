# ChainSight v1.0 — Compliance and Legal Architecture

**Document status:** Design architecture — not legal advice. This document is prepared by the compliance and legal architecture lead. It designs the structures, frameworks, timelines, and contractual hooks that outside counsel will fill with enforceable language. Where legal drafting is required, that is explicitly called out.

**Version:** 1.1  
**Date:** June 2026  
**Context:** Locked decisions through v0.8 plus stack confirmation. Build posture: solo developer + AI agents. SaaS Blind first; sovereign deployment as fast-follow. Phase 0 is pre-revenue, pre-code. Federal LE is the eventual high-value market; Phase 0 may pilot with private investigators or compliance teams.

**SaaS Blind v1 stack (locked):** Supabase (Postgres, Auth, Storage, Realtime) + GitHub (source, CI/CD) + Fly.io (hosting). Migration to AWS planned for Phase 2 as a concrete SOC 2 prerequisite, not a vague option. On-Premises Sovereign design is unchanged from v0.7.

---

## Table of Contents

1. Certification Roadmap
2. Master Services Agreement Skeleton
3. Methodology Disclaimer Language
4. Civil-Liberties Architecture (F41) — Operational Detail
5. Anti-Feature Commitments
6. Insurance Posture
7. Outside Counsel Engagement Plan
8. Government Contracting Vehicles
9. End-of-Life and Data Portability Program (F44)
10. Reproducible Build Verification Commitment
11. Daubert / FRE 702 Readiness
12. Privacy Law Compliance
13. AML/CFT Regulatory Hooks
14. Personal Attribution Legal Posture
15. Discovery Response Posture
16. Bias-Audit Framework — Operational Detail
17. Transparency Report Template
18. Phase 0 Implementation Plan (Weeks 1–8)
19. Subprocessor Registry and Management
20. Open Questions

---

## 1. Certification Roadmap

### 1.1 Framing

Certifications are investments, not badges. Each one unlocks a procurement gate: SOC 2 Type 1 is the minimum to get on a security questionnaire shortlist; FedRAMP Moderate is the minimum for most federal agency procurement. The roadmap is structured so each certification builds directly on the prior one's documented controls, avoiding redundant engineering work.

The roadmap is locked in writing as of Phase 0 (F42). Milestones are phase-bound, not calendar-bound, because the solo-developer build posture means phases will slip. What the founder commits to is: certification X will not be skipped, and certification X will be completed before the phase that requires it ends.

### 1.2 Certification Schedule

---

#### SOC 2 Type 1

**Target phase:** End of Phase 2  
**What it is:** An auditor's report that the company has designed controls consistent with the Trust Service Criteria (Security, Availability, Confidentiality, Processing Integrity, Privacy — select the criteria relevant to the customer profile). Type 1 is a point-in-time design opinion, not an operating effectiveness opinion.

**Scope:** SaaS Blind deployment. The audit covers: access controls, encryption at rest and in transit, vendor support access governance (per v0.7 "blind support" model), change management, logging and monitoring, incident response, and the physical/environmental security of the hosting infrastructure.

**Critical stack dependency:** SaaS Blind v1 runs on Fly.io + Supabase + GitHub. None of these three platforms holds a FedRAMP authorization or a standalone SOC 2 report scoped to the specific services ChainSight uses from them. This is acceptable for Phase 0 and Phase 1 (pilot customers, no government CJI). It is **not** acceptable as the audit surface for the Phase 2 SOC 2 Type 1 assessment.

**Concrete commitment:** Before the SOC 2 Type 1 assessment begins, SaaS Blind infrastructure migrates from Fly.io to AWS (ECS or EKS), and from Supabase's hosted offering to either (a) a self-managed Postgres/Auth stack on AWS or (b) Supabase's AWS-hosted Enterprise tier with a signed BAA/DPA from Supabase. AWS's SOC 2 Type 2 and FedRAMP High authorization provide the hosting-layer assurance the auditor needs. This migration is a Phase 2 engineering milestone, not optional. GitHub Actions remains as CI/CD; GitHub's own SOC 2 covers the CI/CD surface.

The On-Premises Sovereign deployment is scoped separately as "customer-managed infrastructure" — the customer holds the equivalent controls in that deployment.

**Prerequisites:**
- Written information security policy and access control policy (Phase 0 deliverable — see Section 18)
- Audit logging implemented and demonstrably append-only (Phase 0, already designed in v1.0 engineering: Postgres + S3 Object Lock)
- Encryption architecture documented and implemented (Phase 0: per-agency envelope encryption with per-tenant DEKs)
- Incident response plan tested at least once (Phase 1–2 tabletop exercise)
- Vendor support access governance workflow live and generating audit records (Phase 1, per v0.7 Part 2.3)
- Formal risk assessment completed (Phase 1–2)

**Cost estimate:** $20,000–$50,000 for a mid-market auditor (KPMG, EY, Prescient Assurance, Johanson Group, or a specialist like Schellman). Add $10,000–$20,000 in internal engineering time to document and demonstrate controls. Budget $30,000–$70,000 total.

**Timeline:** Auditor engagement 4–6 weeks before the end of Phase 2. Start readiness prep at the beginning of Phase 2.

**Sponsor requirements:** None — SOC 2 is vendor-initiated. The audit firm is the only external party required.

**Practical note for a solo developer:** The hardest part is not the controls themselves — most are already designed into the platform. It is the documentation. Every control needs a written policy and evidence of implementation. This is largely a founder-time investment, not an engineering investment.

---

#### SOC 2 Type 2

**Target phase:** End of Phase 3  
**What it is:** An auditor's report on operating effectiveness over a defined observation period (typically 6–12 months). This is what enterprise and government customers actually require — Type 1 only gets you partway.

**Scope:** Same as Type 1, conducted against the post-migration AWS infrastructure (not Fly.io/Supabase hosted). By the time the Type 2 observation period begins (Phase 3 start), the AWS migration must be complete and the stack must be stable. The observation period cannot begin on a stack the company is still actively migrating. Scope expands from Type 1 to include the full Phase 2–3 feature set: Supervisor Mode, cross-tenant deconfliction, BYOK provider routing, the training environment, retraction workflow, and the confidential computing pilot. GitHub Actions remains in scope as a change-management surface.

**Prerequisites:**
- SOC 2 Type 1 completed and no material control failures
- Minimum 6 months of continuous operation under the documented controls
- Formal change management process generating audit-ready evidence (change tickets, deployment records)
- Employee background checks policy (even as a solo company, document the policy for future hires)
- Annual penetration test (Phase 2 target)

**Cost estimate:** $50,000–$150,000 depending on scope and auditor. Add $20,000–$40,000 internal time. Budget $70,000–$190,000.

**Timeline:** Begin the observation period at the start of Phase 3. Auditor engagement at month 7–9 of Phase 3.

**Sponsor requirements:** None. Customer advisory board members may want to review the report; share under NDA.

---

#### ISO 27001

**Target phase:** End of Phase 3 (concurrent with SOC 2 Type 2)

**What it is:** An international information security management system (ISMS) certification. Required by many non-US enterprise customers and by some EU procurement frameworks.

**Scope:** The complete ISMS: risk management, asset management, access control, cryptography, physical/environmental, operations, communications, supplier relationships, incident management, business continuity, compliance.

**Prerequisites:**
- SOC 2 Type 1 completed — there is approximately 60–70% overlap in documented controls; the SOC 2 work is leverageable
- Formal ISMS scope statement
- Risk assessment and Statement of Applicability (SoA) covering all ISO 27001 Annex A controls
- Documented supplier/vendor risk management process (specifically relevant given BYOK structure — each external provider is a "supplier")

**Cost estimate:** $40,000–$80,000 for a UKAS-accredited certification body. Add $30,000–$60,000 in internal prep. Budget $70,000–$140,000. Combined with SOC 2 Type 2 prep, the marginal cost is lower because documentation overlaps.

**Timeline:** Begin ISO 27001 prep in parallel with the SOC 2 Type 2 observation period. Schedule the Stage 1 audit (document review) for Phase 3 mid-point; Stage 2 audit (controls effectiveness) for Phase 3 end.

**Sponsor requirements:** None.

---

#### CJIS Conformance

**Target phase:** Phase 3 (before federal LE pilot deployments)

**What it is:** The FBI's Criminal Justice Information Services (CJIS) Security Policy governs access to criminal justice information (CJI). It is not a certification in the formal sense — there is no "CJIS certified" credential. Conformance is a self-attestation and audited compliance with the CJIS Security Policy (currently v5.9+), typically validated by a state CJIS Systems Agency (CSA) or by a federal customer's own CJIS audit team.

**Why it matters:** Any US state or local law enforcement agency that uses ChainSight to process CJI — and the platform will process CJI the moment it ingests a case involving a CJIS-covered system (NCIC hits, FinCEN 314(a) data, etc.) — requires CJIS conformance from the vendor. Federal agencies may additionally require a CJIS audit before signing.

**Key CJIS requirements relevant to ChainSight:**
- Personnel security: fingerprint-based background checks for personnel with access to CJI. For a solo developer with access to production systems, this means the founder must pass a federal background check before any CJI is processed. This is non-negotiable and should be initiated in Phase 2 at the latest.
- Multi-factor authentication: already designed (TOTP minimum, WebAuthn; v1.0 engineering Part 3)
- Encryption in transit and at rest: already designed (envelope encryption, TLS)
- Audit logging: already designed (append-only Postgres + S3 Object Lock)
- Media protection and physical security: relevant to the On-Premises Sovereign deployment configuration guidance
- Incident response: must be documented and tested
- Vendor management: CJIS requires any subcontractors with CJI access to also be CJIS conformant; this is the BYOK provider risk — if a BYOK provider (e.g., an LLM provider) receives any CJI, they must be CJIS conformant or the architecture must prevent CJI from reaching them. The sovereign deployment model (air-gapped or on-prem) is the architectural solution; SaaS Blind must route CJI only through CJIS-conformant infrastructure.

**Cost estimate:** $20,000–$50,000 in consulting and internal documentation. The background checks are $50–$100 per person. Budget $30,000–$60,000.

**Timeline:** CJIS conformance documentation prepared in Phase 2; first conformance review by a state CSA or federal customer in early Phase 3.

**Sponsor requirements:** No formal sponsor required for documentation. A sponsoring federal or state LE agency may want to conduct their own audit before approving the deployment.

---

#### FedRAMP Moderate

**Target phase:** Phase 4 (sponsor identified in Phase 3)

**What it is:** The Federal Risk and Authorization Management Program. FedRAMP Moderate authorization means a cloud service provider has been assessed against NIST SP 800-53 Revision 5 moderate baseline controls and received an Authority to Operate (ATO) from a federal agency. Moderate covers controlled unclassified information (CUI) — the classification level of most federal LE financial crime data.

**Scope:** The SaaS Blind deployment running on AWS GovCloud (or equivalent). On-Premises Sovereign does not go through FedRAMP — customers control their own ATO for on-prem deployments.

**Prerequisites:**
- SOC 2 Type 2 and ISO 27001 completed — substantial control overlap
- AWS GovCloud (US-East/US-West) deployment operational — not Fly.io
- A federal agency sponsor willing to sign the ATO. This is the critical dependency: FedRAMP requires a sponsoring agency to either issue an ATO directly or accept a JAB authorization. Finding the sponsor is the business development task; this should be the active pursuit from Phase 3 onward.
- A FedRAMP-authorized Third Party Assessment Organization (3PAO) engagement
- Full System Security Plan (SSP) documented — this is a 200–300 page NIST-format document
- Penetration test by a 3PAO
- Continuous monitoring program stood up

**Cost estimate:** $500,000–$2,000,000 total. This includes: 3PAO engagement (~$200,000–$500,000), internal engineering to close control gaps (~$200,000–$700,000 in engineering time), legal and consulting (~$100,000–$300,000), and ongoing continuous monitoring costs (~$100,000–$200,000/year). FedRAMP is expensive. It is not worth pursuing without committed contract revenue in sight.

**Timeline:** 12–18 months from sponsor identification to ATO. Start Phase 3 by identifying and cultivating the sponsoring agency relationship. Begin 3PAO engagement in Phase 3 final months or Phase 4 opening.

**Sponsor requirements:** A specific named federal agency must agree to sponsor. The agency's ISSO (Information System Security Officer) will be the primary counterpart. This is a federal contracting attorney and business development function.

---

#### FedRAMP High

**Target phase:** Post-Phase 4

**What it is:** FedRAMP High covers the highest-impact federal systems — classified-adjacent CUI, law enforcement sensitive (LES), personally identifiable information in high volumes. This is the threshold for FBI, DEA, and intelligence-community-adjacent deployments.

**Scope:** Same as Moderate but with additional controls (approximately 421 controls vs. 325 for Moderate).

**Prerequisites:** FedRAMP Moderate authorization. Additional infrastructure hardening (dedicated compute, stronger isolation). Additional penetration testing.

**Cost estimate:** $500,000–$1,000,000 marginal to Moderate. Timeline 6–12 months additional.

---

#### CMMC Level 2

**Target phase:** Phase 4 (if DoD contractor work is pursued)

**What it is:** Cybersecurity Maturity Model Certification. CMMC L2 covers controlled unclassified information (CUI) in the defense industrial base. Required for DoD contracts involving CUI. Not required unless ChainSight pursues DoD financial crime or contractor oversight work.

**Scope:** 110 practices from NIST SP 800-171 Revision 3. Assessed by a C3PAO (Certified Third-Party Assessment Organization).

**Prerequisites:** SOC 2 Type 2 completed; CJIS conformance in place. Substantial overlap with FedRAMP Moderate controls.

**Cost estimate:** $100,000–$300,000. Timeline 6–9 months once prep begins.

**Decision gate:** Only pursue if there is an active DoD contract opportunity. Do not pursue CMMC on a speculative basis given the cost.

---

#### UK Cyber Essentials Plus

**Target phase:** Phase 4 (with UK expansion)

**What it is:** The UK government's baseline cybersecurity certification, required for UK government contracts handling sensitive information. "Plus" adds independent technical testing on top of the basic self-assessment.

**Scope:** Five technical controls: firewalls, secure configuration, user access control, malware protection, patch management. Assessed by a CREST-accredited certification body.

**Prerequisites:** None beyond basic security hygiene. Relatively lightweight compared to SOC 2.

**Cost estimate:** £5,000–£15,000 for a CREST-accredited assessor. Timeline 2–4 weeks.

**Timeline:** Begin when UK expansion is scoped (Phase 4).

---

#### Common Criteria EAL4+ / IRAP (Australia)

**Target phase:** Post-Phase 4

**What they are:** Common Criteria EAL4+ is a formal security evaluation used by intelligence community and allied government procurement in the US, UK, Canada, Australia, and New Zealand (the Five Eyes). Australia's IRAP (Information Security Registered Assessors Program) is required for Australian government work.

**Cost estimate:** Common Criteria EAL4+: $500,000–$2,000,000. IRAP: $100,000–$300,000. These are post-Phase-4 investments tied to specific contract opportunities.

---

### 1.3 Certification Investment Summary

| Certification | Phase | Budget Range | Engineering Impact |
|---|---|---|---|
| SOC 2 Type 1 | End Phase 2 | $30K–$70K | Low — controls already designed |
| SOC 2 Type 2 | End Phase 3 | $70K–$190K | Low — documentation + 6 months observation |
| ISO 27001 | End Phase 3 | $70K–$140K | Low — leverages SOC 2 |
| CJIS Conformance | Phase 3 | $30K–$60K | Medium — background checks, CJI routing architecture |
| FedRAMP Moderate | Phase 4 | $500K–$2M | High — AWS GovCloud migration, SSP, 3PAO |
| FedRAMP High | Post-Phase 4 | $500K–$1M | High — additional controls |
| CMMC L2 | Phase 4 (if DoD) | $100K–$300K | Medium — overlaps with FedRAMP |
| UK Cyber Essentials+ | Phase 4 (UK) | £5K–£15K | Low |
| Common Criteria / IRAP | Post-Phase 4 | $500K–$2M | Very High |

**Total pre-FedRAMP investment (through Phase 3):** $200K–$460K  
**FedRAMP adds:** $500K–$2M  
**Full-stack government posture (through Phase 4):** $700K–$2.5M+

---

## 2. Master Services Agreement Skeleton

### 2.1 Framing

This is an outline of provisions, not legal language. Outside counsel drafts the language. This section identifies what provisions must exist, what the platform's architecture enables, and which provisions are non-negotiable versus negotiable.

**Jurisdiction of formation:** Determined by outside counsel based on company incorporation. Delaware C-Corp is standard for a venture-backed US tech company, but confirmation is needed (see Section 19, Open Question OQ-1).

**Outside counsel task:** Draft the full MSA from this skeleton. Flag any provision where the platform's technical architecture does not yet support the contractual commitment (this document will note those).

### 2.2 Core Provisions

---

**Section 1 — Definitions**

Standard definitions plus ChainSight-specific terms: "Agency," "Case Data," "Reproducibility Pack," "BYOK Provider," "Deployment Mode," "Anti-Feature Commitments," "Civil-Liberties Review Board," "Court-Grade." The definitions section is load-bearing — civil-rights commitments and liability caps depend on precisely what "Case Data" includes.

*Outside counsel task:* Define "Case Data" carefully to include all investigator inputs, findings, attributions, reports, and case metadata, but to exclude billing counters and seat counts.

---

**Section 2 — License Grant**

- Non-exclusive, non-transferable license to use the platform
- For SaaS Blind: subscription license; access conditioned on payment and compliance with AUP
- For On-Premises Sovereign: perpetual license to the deployed version, plus support subscription for updates; the perpetual right survives support expiration and vendor cessation (F44)
- No sublicensing without prior written consent
- Agency may run the platform for the benefit of joint task forces and partner agencies under written cooperation agreements — outside counsel should define the scope carefully

*Outside counsel task:* Distinguish the On-Prem perpetual license from the SaaS subscription clearly. The perpetual license is a platform commitment from F44 and must survive vendor cessation.

---

**Section 3 — Acceptable Use**

- Customer warrants that all use of the platform complies with applicable law, including all civil rights laws, Fourth Amendment limitations, and the laws of the customer's jurisdiction
- Customer is solely responsible for ensuring that their investigative actions (freeze requests, seizure recommendations, charges, court filings) are legally authorized
- Customer warrants they will not use the platform for any purpose listed in the Anti-Feature Commitments (Section 8 of the MSA; see this document's Section 5)
- Customer warrants that any investigator using the platform has appropriate clearance and legal authority for the cases they work

*Non-negotiable:* The customer responsibility for legal use provision. ChainSight does not and cannot provide legal authority for any investigative action. This is architectural: the platform is a tool, not an investigative authority.

---

**Section 4 — Data Ownership and Processing**

- Customer owns all Case Data absolutely; vendor has no ownership interest in any Case Data
- Vendor may process Case Data solely to provide the contracted services
- Vendor may not: (a) sell, license, or otherwise transfer Case Data; (b) use Case Data for any purpose other than service delivery; (c) aggregate or de-identify Case Data for vendor's own commercial benefit; (d) use billing-tier data to drive sales targeting
- For SaaS Blind: data processing is subject to a Data Processing Addendum (DPA) that satisfies GDPR Article 28, UK DPA, and applicable US requirements
- For On-Premises Sovereign: vendor does not process Case Data at all; customer is the sole data controller and processor

*Outside counsel task:* Draft the DPA as a standalone exhibit to the MSA, covering all required GDPR, UK DPA, and state-law processor obligations. The DPA applies only to SaaS Blind.

---

**Section 5 — Privacy and Security**

- Vendor implements and maintains technical and organizational measures consistent with the platform's published security architecture
- For SaaS Blind: per-agency encryption keys held in customer KMS; vendor cannot read Case Data in plaintext (per v0.7 blind architecture)
- **Blind architecture scope:** The "architecturally blind" guarantee is scoped against both ChainSight personnel and ChainSight's infrastructure subprocessors. Application-layer envelope encryption (per-agency DEKs derived from customer-held KMS root keys) means that neither ChainSight nor any subprocessor — including Supabase, Fly.io, AWS, or any future hosting provider — can read Case Data in plaintext, regardless of a compelled disclosure demand directed at the subprocessor. The subprocessors hold only ciphertext. This is documented in Exhibit E (Security Architecture Summary).
- Vendor support access is opt-in, time-boxed, scoped, and audited — the vendor cannot access Case Data without the customer's explicit grant of a scoped token
- Vendor provides the customer with complete telemetry disclosure: what billing data is collected, where it goes, what it is used for
- Incident notification: vendor notifies customer within 72 hours of discovering a security incident that may affect Case Data (consistent with GDPR breach notification)

---

**Section 5A — Subprocessors**

- Vendor maintains a current, publicly accessible Subprocessor List identifying every third-party infrastructure provider that processes or stores Case Data (even in encrypted form) on behalf of ChainSight
- The Subprocessor List as of v1 SaaS Blind launch includes: **Supabase** (Postgres, Auth, Storage, Realtime; data at rest in Supabase-managed infrastructure), **Fly.io** (hosting and compute for application layer), **GitHub** (source code repository and CI/CD pipeline; does not process Case Data but does process release artifacts and build logs)
- Upon migration to AWS (Phase 2 prerequisite for SOC 2): **Amazon Web Services** replaces Fly.io as the hosting subprocessor; **AWS RDS/Aurora** and **AWS S3** replace the Supabase-hosted storage layer; Supabase may be retained as an AWS-hosted deployment (Supabase Enterprise on AWS), in which case it remains a subprocessor
- Vendor obtains a Data Processing Agreement (or equivalent) from each subprocessor that processes personal data, including Case Data in encrypted form
- Vendor maintains security questionnaire responses from each subprocessor on file, available to customers on request under NDA
- **Subprocessor changes:** Vendor provides customers with at least 30 days' written notice before adding a new subprocessor or replacing an existing one. Notice is published on the Subprocessor List page and sent directly to customer security contacts on file. Customers may object to a new subprocessor within 30 days; if the vendor cannot accommodate the objection, the customer may terminate the MSA without penalty
- **Supabase compelled disclosure risk:** If Supabase receives a compelled disclosure demand (subpoena, court order, national security demand) targeting ChainSight customer data, Supabase will produce only the ciphertext it holds. The application-layer encryption means the ciphertext is not useful to the demanding party without the customer's KMS root key. The vendor commits to publishing this architectural fact in customer-facing documentation (Exhibit E) so customers understand it before signing
- **GitHub compelled disclosure risk:** GitHub's source repository contains ChainSight source code, not Case Data. A subpoena to GitHub for ChainSight's repository would expose the source code (which is also available to On-Prem customers who triggered escrow release) but not any customer Case Data. This is disclosed here for completeness.

*Outside counsel task:* Review Supabase's DPA and Terms of Service to confirm they permit the subprocessor relationship and envelope-encryption architecture described here. Review Fly.io's DPA. Confirm that GitHub's ToS and data processing terms are consistent with the CI/CD subprocessor role. Obtain signed DPAs from all three before the first SaaS Blind customer is onboarded.

---

**Section 6 — Methodology Disclaimer**

A binding contractual provision, not just a report footer. This is the legal expression of F41's methodology disclaimer requirement. Key elements:

- The platform's analytical outputs are technical findings, not legal conclusions
- Conclusions are probabilistic and based on heuristic and machine-learning techniques with publicly documented false-positive rates
- The customer is solely responsible for all decisions to act on platform outputs, including freeze requests, seizure recommendations, and charging decisions
- The platform's methodology disclosures (published per F41) are incorporated by reference into the MSA as binding descriptions of the platform's capabilities and limitations
- The customer acknowledges they have read and understood the methodology disclosures

*Non-negotiable:* This provision exists specifically to withstand Daubert challenges and to clearly allocate responsibility for investigative judgments to the human investigators. It is both an integrity commitment and a liability management mechanism.

---

**Section 7 — Limitation of Liability**

- Vendor's total cumulative liability is capped at fees paid by the customer in the prior 12 months
- Exclusion of consequential, indirect, punitive, and special damages (with customary carve-outs)
- Mutual limitation (both vendor and customer bound by the cap, with appropriate carve-outs for IP indemnification and data breach obligations)

*Negotiation posture:* Government customers (especially federal) will push to remove or raise the cap. The 12-months-of-fees cap is a reasonable starting position. The vendor should not agree to uncapped liability, period. The methodology disclaimer in Section 6 is the companion protection: if the customer's investigative judgment led to a wrongful action, that is the customer's liability, not the vendor's.

*Outside counsel task:* Ensure the consequential damages exclusion is enforceable in the customer's jurisdiction. Some states (and the UK) have limitations on exclusion clauses in B2B contracts. Government contracts may require specific liability language under FAR or its state equivalents.

---

**Section 8 — IP Indemnification**

- Vendor indemnifies customer if any third party claims that the platform itself (not including BYOK data) infringes that party's intellectual property rights
- Customer indemnifies vendor for any third-party claims arising from customer's use of the platform in violation of the AUP or applicable law
- Standard carve-outs: indemnification does not apply if the infringement results from customer's modifications, use in combination with non-vendor software, or use in violation of the MSA

*Practical consideration:* The BYOK architecture is deliberately designed so that third-party data providers (Chainalysis, TRM, etc.) have no IP claim against ChainSight arising from the data they provide to the customer. The customer's BYOK credentials mean the customer has a direct license from those providers. Outside counsel should confirm this architecture eliminates IP passthrough risk.

---

**Section 9 — Suspension of Service**

- Vendor may suspend service (without terminating) if: (a) customer is 30+ days past due on fees; (b) customer is using the platform in violation of the Anti-Feature Commitments; (c) a security incident requires immediate containment
- Suspension is not a data destruction event — the customer retains access to their Case Data for export during any suspension period
- Vendor must provide notice before suspension except in genuine emergency security events, and must provide notice within 24 hours of emergency suspension

*Non-negotiable:* The "suspension is not data destruction" principle. Customer trust depends on this. Even if a customer is suspended for cause, destroying their case data would be a catastrophic breach of trust.

---

**Section 10 — Termination and Data Portability**

- Either party may terminate for material breach with 30 days' cure period
- Vendor may terminate immediately for AUP violations that constitute illegal use
- Upon termination for any reason:
  - Customer data remains accessible for export for 90 days
  - Customer may export all Case Data as Reproducibility Packs at no additional charge
  - Vendor deletes customer data from vendor infrastructure within 30 days after the export window closes (with certification)
  - For SaaS Blind customers converting to On-Prem: export and migration support is a standard service

*Outside counsel task:* Ensure the data export and deletion provisions satisfy GDPR Article 17 (right to erasure) and applicable state privacy laws. For government customers, coordinate with the DPA to ensure government records retention requirements are not inconsistent with termination data deletion.

---

**Section 11 — Transparency and Reporting**

- Vendor commits to publishing the annual Transparency Report (per Section 17 of this document) covering aggregate platform usage, Daubert outcomes, and retraction statistics
- Vendor commits to publishing annual bias audit results (per Section 16)
- Vendor commits to publishing false-positive rate reports quarterly (per F41)
- These commitments are binding — failure to publish on schedule is a material breach

---

**Section 12 — Government Contracting Addendum**

For government customers, a separate exhibit addressing:

- FAR compliance (for federal contracts)
- State procurement law compliance
- CJIS conformance (for state/local LE)
- FedRAMP authorization status and planned timeline
- No-debarment representations
- ITAR/EAR representations (see Section 19, OQ-6)

*Outside counsel task:* The government contracting addendum requires a federal contracting attorney, not a general commercial attorney. Do not attempt to draft this without specialist counsel.

---

### 2.3 Exhibits to the MSA

- Exhibit A: Service Level Agreement (uptime, support response times)
- Exhibit B: Data Processing Addendum (GDPR/UK DPA, state law)
- Exhibit C: Anti-Feature Commitments (verbatim from Section 5 of this document)
- Exhibit D: Methodology Disclosure (incorporates the published methodology disclosures by reference)
- Exhibit E: Security Architecture Summary — includes: encryption hierarchy, per-agency KMS model, audited support access workflow, and the blind architecture guarantee scoped against all subprocessors (Supabase, Fly.io/AWS, GitHub)
- Exhibit F: Acceptable Use Policy
- Exhibit G: Government Contracting Addendum (for government customers only)
- Exhibit H: Source Code Escrow Agreement (for Agency and Classified tier customers)
- Exhibit I: Subprocessor List (live document, updated on change; current version at chainsight.io/subprocessors)

---

## 3. Methodology Disclaimer Language

### 3.1 Purpose

Every report produced by the platform must include a methodology disclaimer section. This is both a transparency commitment (F41) and a Daubert-survivability tool. The language is calibrated to (a) be honest about probabilistic limits, (b) clearly separate technical conclusions from legal conclusions, (c) be defensible on cross-examination, and (d) avoid the boilerplate paralysis where a disclaimer is so long it undermines the report.

### 3.2 Universal Platform Disclaimer

The following language appears in every report generated by the platform (trace path reports, expert declarations, freeze request packages, and seizure recommendation packages). It is not waivable.

---

> **Methodology Disclosure and Disclaimer**
>
> This report was produced using the ChainSight blockchain analysis platform. The analytical conclusions herein are technical findings based on on-chain data, heuristic analysis, attribution data from the sources identified in the Citations section, and where noted, probabilistic machine-learning inference. They are not legal conclusions.
>
> **Determinism:** Conclusions designated Tier 0 (cryptographic) and Tier 1 (heuristic-deterministic) in the Citations section are reproducible from the inputs stated: the same on-chain data and the same rule versions will produce the same conclusion. The Reproducibility Pack accompanying this report enables independent verification. Conclusions designated Tier 2 (attribution-dependent) are reproducible given the pinned attribution snapshot included in the Reproducibility Pack. Conclusions designated Tier 3 (probabilistic) involve machine-learning inference and are disclosed as such; Tier 3 conclusions are never the sole basis for a court-grade finding in this report.
>
> **False-positive rates:** The platform's publicly documented false-positive rate targets for the heuristics used in this analysis are stated in the Methodology Details section below. Actual measured rates are published quarterly at [chainsight.io/transparency]. The investigator and the adjudicator should weigh each conclusion in light of the applicable rate.
>
> **Human oversight:** Every court-grade finding in this report required explicit investigator sign-off. No court-grade conclusion was generated autonomously. The signing investigator's Expert Witness Profile, including their qualifications, certifications, and prior testimony record, is attached as Exhibit A.
>
> **Limitations:** This analysis does not constitute advice regarding the legality of any transaction, the criminal or civil liability of any person or entity, or the sufficiency of evidence to support any legal action. The decision to seek a freeze, seizure, charging action, or any other legal action is the sole responsibility of the requesting investigator, the supervising authority, and the adjudicating court. The platform is a tool; it has no legal authority.
>
> **Jurisdiction:** This analysis was conducted at the direction of [Agency Name], under [investigative authority / legal basis stated by Agency]. ChainSight has not independently verified the existence or validity of the stated legal authority.

---

### 3.3 Per-Methodology Disclosure Paragraphs

Each report that uses a specific tracing methodology includes the applicable paragraph from this library. The platform auto-selects the relevant paragraphs based on which methodologies were actually used in the analysis.

---

**FIFO (First-In, First-Out)**

> **FIFO Methodology Disclosure:** This analysis applies the First-In, First-Out (FIFO) methodology to commingled cryptocurrency transactions. Under FIFO, the earliest-received funds at an address are treated as the first to be disbursed. This methodology is recognized by the IRS (Revenue Ruling 2023-14 and Notice 2014-21), is commonly applied in US criminal forfeiture proceedings (see *United States v. Approximately 69,370 Bitcoin*, N.D. Cal. 2023), and aligns with the FIFO approach applied by UK courts where a traceable funds regime applies. FIFO will tend to attribute earlier-vintage, potentially higher-value funds to the defendant's proceeds. The investigation team selected FIFO because [case-specific rationale to be completed by investigator]. Alternative methodologies are presented in the Appendix for disclosure purposes.

---

**LIFO (Last-In, First-Out)**

> **LIFO Methodology Disclosure:** This analysis applies the Last-In, First-Out (LIFO) methodology. Under LIFO, the most recently received funds at an address are treated as the first to be disbursed. LIFO is applied in US criminal proceedings in certain contexts where the prosecution can demonstrate it accurately reflects the defendant's conduct (e.g., rapid layering where newly received illicit funds are immediately forwarded). LIFO will tend to attribute more recent, potentially lower-value funds to the defendant's proceeds, which may produce a more conservative result than FIFO. The investigation team selected LIFO because [case-specific rationale]. Alternative methodologies are presented in the Appendix.

---

**LIBR (Lowest Input Balance Rule)**

> **LIBR Methodology Disclosure:** This analysis applies the Lowest Input Balance Rule (LIBR), also referred to in some jurisdictions as the "minimum balance" or "clean-hands minimum" approach. Under LIBR, the amount traceable through a wallet is limited to the lowest balance the wallet held at any point during the relevant period, on the theory that the defendant cannot have disbursed more of the illicit funds than they held at the lowest point. LIBR typically produces the most conservative (lowest) traceable amount and is therefore the most defendant-favorable standard methodology. US courts have applied LIBR where the evidence cannot support the tracing of specific funds. The investigation team selected LIBR because [case-specific rationale].

---

**Pari Passu**

> **Pari Passu Methodology Disclosure:** This analysis applies the Pari Passu (pro rata) methodology. Under pari passu, all funds in a commingled account are treated as proportionally tainted: if 40% of the funds in an account came from an illicit source, then 40% of every outflow from that account is attributed to that source. Pari passu is the default methodology applied by UK courts in civil proceedings (*Barlow Clowes International Ltd v Vaughan* [1992] 4 All ER 22) and is increasingly applied in US civil forfeiture proceedings. Pari passu produces an intermediate result between FIFO and LIBR in most cases. The investigation team selected pari passu because [case-specific rationale].

---

**Rolling Charge (Section 104 Pool)**

> **Rolling Charge / Section 104 Pool Methodology Disclosure:** This analysis applies the Rolling Charge methodology, analogous to the Section 104 pool calculation used in UK capital gains tax contexts and in UK Proceeds of Crime Act tracing. Under rolling charge, a running balance of tainted and clean funds is maintained; each outflow is apportioned between tainted and clean in the same proportion as the pool's composition at the time of the outflow. This methodology is particularly applicable to wallets used as long-term storage with multiple inflows of mixed purity over time. The investigation team selected Rolling Charge because [case-specific rationale].

---

**Specialist Identification (Specific ID)**

> **Specific Identification Disclosure:** In limited portions of this analysis, the investigation team applied specific identification methodology, tracing a specific, uniquely identifiable UTXO, NFT, or token ID directly from its origin to its current holder without reliance on any mixing heuristic. Specific identification is the highest-confidence tracing methodology and produces T0 (cryptographic) or T1 (heuristic-deterministic) conclusions where applicable. Where specific identification is used, it is noted in the hop-by-hop trace.

---

### 3.4 Daubert-Specific Language (for Court Filings)

When a report is designated for use in a Daubert motion context (either to support admissibility or in response to a challenge), the following supplemental section is added:

> **Daubert/FRE 702 Technical Disclosure**
>
> In response to Federal Rules of Evidence 702 and the standards articulated in *Daubert v. Merrell Dow Pharmaceuticals* (509 U.S. 579, 1993) and its progeny, the undersigned expert and the ChainSight platform provide the following technical disclosures:
>
> (1) *Theory or technique:* The analysis in this report employs blockchain transaction tracing methodologies that are documented in the public literature, applied consistently in this field, and implemented in the ChainSight platform's published methodology disclosure.
>
> (2) *Tested:* The platform's clustering heuristics, attribution algorithms, and accounting methodologies are subject to quarterly regression testing against documented ground-truth datasets. Testing results and false-positive rates are published quarterly. The Reproducibility Pack accompanying this report enables independent retesting.
>
> (3) *Peer review and publication:* The heuristics used (UTXO common-input ownership, change-output detection, FIFO/LIFO/LIBR/pari passu/rolling charge accounting) are methods documented in the peer-reviewed literature (see Citations). The platform's implementation follows publicly disclosed methodology.
>
> (4) *Known or potential error rate:* False-positive rates for each heuristic used in this analysis are stated in the Methodology Details section and are publicly published. The cumulative confidence interval for the overall trace is stated in the Executive Summary.
>
> (5) *General acceptance:* Blockchain transaction tracing using the methodologies identified herein is accepted and routinely applied by investigators and forensic experts in US federal criminal proceedings. The platform's approach is consistent with methodologies applied by Chainalysis, TRM Labs, and Elliptic, all of which have been accepted in federal courts.

---

## 4. Civil-Liberties Architecture (F41) — Operational Detail

### 4.1 Overview

The civil-liberties architecture is not a marketing commitment. It is the operational framework that makes the platform trustworthy enough to deploy in contexts with civil-rights implications — which is every context where a platform assists in law enforcement investigations. F41 established the commitments; this section specifies how they operate.

### 4.2 Annual Methodology Audit Framework

**What gets audited:**
- UTXO common-input heuristics (CIH): rules, thresholds, exception handling
- Change-output detection: algorithms, confidence assignments
- Obfuscation detectors: peel-chain, mixer attribution, dusting attack detection
- ML-augmented attribution (T3 tier): model cards, training data provenance, demographic analysis of outputs
- AI-generated path suggestions: Suggestion Agent behavior, Critic Agent catch rates
- Watcher rule evaluation engine: does the watcher system enable dragnet behavior? Are all watchers case-bound?

**Audit methodology:**
1. External auditor receives a copy of the full methodology documentation, the open-source portions of the implementation, and anonymized test datasets
2. Auditor attempts to reproduce published false-positive rates using the provided methodology
3. Auditor tests for disparate impact across the following dimensions: jurisdiction (US vs. non-US addresses), chain (Bitcoin vs. Ethereum vs. Solana), address type (exchange, DeFi, privacy-coin adjacent), and temporal cohort (pre-2023 vs. post-2023 transactions)
4. Auditor tests anti-feature commitments by attempting to construct scenarios that would trigger predictive policing, mass surveillance, or demographic correlation outputs
5. Auditor produces a written report; ChainSight produces a public response

**Auditor selection criteria:**
- Independent of ChainSight commercially
- Demonstrable experience in either algorithmic fairness auditing, digital forensics, or civil-liberties research
- Acceptable candidates: academic research groups (MIT Digital Currency Initiative, Stanford Center for Internet and Society, Berkman Klein Center), specialized audit firms (Algorithm Audit, BABL AI, Parity Consulting), or civil-liberties organizations with technical capacity (EFF, ACLU's Technology and Liberty Project)
- The CLRB (see 4.4) approves the auditor selection annually

**Publication standard:**
- Full audit report published within 90 days of completion, with redactions only for security-sensitive implementation details (e.g., specific detection thresholds that would help bad actors evade detection)
- The redaction log is published separately so the public can assess the extent of redaction
- ChainSight's response to findings is published simultaneously

**Phase:** First audit by end of Phase 3. Annual thereafter.

### 4.3 False-Positive Rate Publication

The platform publishes quarterly reports on measured false-positive rates for each heuristic, compared to published targets.

| Detector / Heuristic | Public FPR Target | Reporting Frequency | Remediation Trigger |
|---|---|---|---|
| CIH clustering (UTXO) | < 1% | Quarterly | Exceeding 1.5% triggers remediation within 60 days |
| Change-output detection | < 5% | Quarterly | Exceeding 7.5% triggers remediation within 60 days |
| Mixer attribution | < 0.5% | Quarterly | Exceeding 0.75% triggers remediation within 45 days |
| Sanctions-list matching | < 0.1% | Quarterly | Any breach triggers immediate review |
| Peel-chain detection | < 3% | Quarterly | Exceeding 4.5% triggers remediation within 60 days |
| ML-based attribution (T3) | < 2% | Quarterly | Exceeding 3% triggers remediation within 60 days |
| AI-generated path suggestions | < 5% | Quarterly | Exceeding 7.5% triggers remediation within 60 days |

**Measurement methodology:** Against the ground-truth datasets maintained by the B7 flywheel (v0.2, Phase 2+), supplemented by confirmed case outcomes as they become available. The measurement methodology itself is published.

**Publication location:** chainsight.io/transparency (public) and in the annual Transparency Report.

### 4.4 Civil-Liberties Review Board (CLRB) Charter

**Establishment phase:** Phase 2. The CLRB must be convened before the platform is deployed with any US government agency.

**Purpose:** The CLRB provides independent civil-liberties oversight of platform features with potential civil-rights impact. It has real authority, not advisory status alone.

**Composition (5–7 members):**
- One representative from a civil-liberties organization (ACLU, EFF, Brennan Center for Justice, or equivalent). Must be an organization with active litigation or advocacy experience in law enforcement technology.
- One academic with published research in algorithmic fairness, criminal justice technology, or civil rights law. Appointment requires CV review by the other members.
- One current or former federal judge, magistrate, or criminal defense attorney with federal experience. Provides the judicial process perspective.
- One representative from the law enforcement community — a current or former investigator or supervisor — who will advocate for operational effectiveness and will push back on restrictions that hamper legitimate investigation.
- One technical expert in machine learning fairness or algorithmic auditing.
- Two additional members selected by the above five, with preference for representing communities historically subject to disproportionate law enforcement scrutiny.

**Compensation:** CLRB members receive a stipend for their time. The stipend is disclosed publicly. Members do not hold equity or advisory shares in ChainSight.

**Authority:**
- The CLRB reviews and may veto new features before release in the following categories: (a) new attribution heuristics or ML models; (b) new watcher rule capabilities; (c) any feature that approaches the anti-feature commitment lines; (d) changes to the false-positive rate targets
- Veto requires a majority vote of CLRB members
- ChainSight may appeal a veto to an independent arbitrator once; the arbitrator's decision is final
- CLRB reviews and approves the external methodology auditor selection annually
- CLRB publishes its own annual report separate from ChainSight's transparency report

**Meeting cadence:** Quarterly scheduled meetings. Emergency meetings convened within 10 business days upon CLRB request.

**Independence mechanisms:**
- CLRB members may not be employed by or receive material compensation from ChainSight or any of its major commercial customers
- ChainSight funds the CLRB but cannot unilaterally disband it; dissolution requires a shareholder vote or unanimous CLRB consent
- CLRB minutes and voting records are public within 30 days of each meeting (with redaction only for non-public security matters)

**Enforcement:** The MSA commits customers to accepting CLRB oversight. If the CLRB vetoes a feature, that feature is not shipped to any customer regardless of individual customer preferences.

### 4.5 Adversarial Testing Program

**Red team scope:**
- Annually, a dedicated external security firm with civil-liberties expertise attempts to use the platform to produce predictive policing outputs, demographic correlation results, or mass surveillance scenarios
- The red team also probes for traditional security vulnerabilities relevant to the platform's sensitive data
- Results are provided to ChainSight and to the CLRB, with a public summary published in the annual audit

**Bug bounty for methodology issues:**
- Separate from the security bug bounty program
- Researchers who identify methodology behaviors that produce demographically disparate results, approximate banned features, or produce systematic false positives are eligible for public acknowledgment and a methodology bounty
- Coordinated disclosure: researcher notifies ChainSight; ChainSight has 90 days to remediate; then full disclosure

### 4.6 Phase Commitments for F41

| Deliverable | Phase |
|---|---|
| Anti-feature commitments published | Phase 0 |
| Methodology disclaimer in all reports | Phase 0 |
| CLRB charter documented | Phase 0 |
| CLRB convened | Phase 2 |
| First external methodology audit | End Phase 3 |
| First annual Transparency Report | End Phase 3 |
| Quarterly FPR publication begins | Phase 2 (when ground-truth measurement is operational) |
| Adversarial testing program | Annual from Phase 3 |

---

## 5. Anti-Feature Commitments

### 5.1 The Ten Commitments

These commitments are locked per F41 and the v0.8 consolidated document Part 5. They appear in three places: the MSA (as binding contractual prohibitions on the vendor), marketing collateral (as public trust commitments), and the CI test suite (as anti-feature test gates that fail the build if any commit introduces the forbidden behavior — the CI design is the engineering team's responsibility; this section specifies the policy they enforce).

---

**Commitment 1: No Predictive Policing**

> ChainSight will not implement, ship, or enable any feature that generates suspicion scores, risk assessments, or investigative leads for an address, entity, or person based on behavioral patterns alone, without a documented investigative predicate for a specific past crime. Every Watcher rule in the platform requires a case_id field populated with a specific active case. There is no "monitor this address for suspicious behavior in general" without a case context.

*MSA language:* "Vendor represents and warrants that the Platform does not and will not include any feature that generates suspicion assessments for blockchain addresses, entities, or associated persons in the absence of a documented specific investigative predicate. Customer's use of the Platform for purposes other than the investigation of specific past financial crimes or specific regulatory violations is a material breach of this Agreement."

*CI enforcement:* Any route or API endpoint that accepts a watch or monitor instruction without a case_id fails the anti-feature test. The test suite validates the enforcement at the data-model level (the WatcherRule schema requires case_id: uuid, non-nullable, foreign-keyed to an active Case).

---

**Commitment 2: No Demographic Correlation**

> ChainSight will not implement, ship, or enable any feature that surfaces, scores, or correlates on-chain address activity with demographic, geographic (below the national jurisdiction level), political, religious, or other protected-class signals. The platform traces transactions, not people. Attribution links on-chain addresses to named entities only through documented, evidence-based means — not through demographic inference.

*MSA language:* "The Platform does not and will not incorporate demographic, geographic at the sub-national level, political, religious, racial, ethnic, or other protected-class signals into any analytical output, attribution, scoring, or suggestion feature. Any Customer use that relies on or encourages such correlation is a material breach."

*CI enforcement:* Data schema validation: no field in the attribution, suggestion, or watcher models may accept or store demographic proxies. Model card review for any T3 model includes a bias audit confirming absence of demographic correlation in training features.

---

**Commitment 3: No Mass Surveillance Modes**

> ChainSight will not implement any feature that enables monitoring of all addresses in a jurisdiction, chain, or protocol without individualized case context. There is no "watch all Ethereum activity in California" mode.

*MSA language:* "Vendor represents that the Platform does not include bulk-monitoring capabilities targeting geographic jurisdictions, chains, or protocols in the absence of a specific investigative predicate. Any Customer attempt to configure the Platform for bulk jurisdiction-level monitoring constitutes a material breach."

---

**Commitment 4: No Untargeted Dragnet Features**

> Every Watcher in the platform requires a case context with a documented investigative predicate. Watchers that fire on addresses not already part of an active case generate deconfliction opportunities, not new investigations.

*MSA language:* Incorporated in Commitment 1 and Commitment 3 provisions.

---

**Commitment 5: No Generative Attack-Pattern Speculation**

> The platform's detectors fire on patterns confirmed against documented ground-truth cases. The AI does not speculate about novel attack typologies and present them as findings. Suggestions flagged as "investigative hypotheses" are always clearly labeled as T3 (probabilistic) and never as primary findings.

*MSA language:* "The Platform's analytical outputs are based on recognized and validated methodologies. Vendor does not represent that AI-generated investigative suggestions constitute reliable or verified findings independent of investigator review and sign-off."

---

**Commitment 6: No Crypto Trading or Portfolio Features**

> The platform is an investigative tool, not a financial services product. No feature that provides trading signals, portfolio optimization, tax-lot management for personal holdings, or personal wealth tracking will be added.

*Rationale:* Conflict of interest with investigative integrity. An investigator whose platform also manages their personal portfolio has a structural temptation to bias their investigative work.

---

**Commitment 7: No Vendor-Managed Key Escrow**

> The vendor will never hold, receive, or manage customer encryption keys in any form. The BYOK and sovereign deployment models are absolute. There is no "let ChainSight hold your keys for convenience" option, not even temporarily, not even for on-boarding.

*MSA language:* "Vendor represents that it does not and will not hold, receive, store, or manage Customer's KMS root keys or DEKs in cleartext form. Customer's KMS root key never leaves Customer's control."

*CI enforcement:* The key management code path is subject to automated review; any commit that introduces a vendor-side key storage path fails the build.

---

**Commitment 8: No Silent Telemetry**

> Every byte of telemetry the platform collects is documented in the published Telemetry Disclosure. Opt-in toggles are real: if a customer turns off telemetry, the platform emits zero telemetry to the vendor. There are no "minimum telemetry required for service" carve-outs beyond billing counters (seat count, tier flag).

*MSA language:* "Vendor will maintain a current Telemetry Disclosure document available to Customer, listing every data element transmitted from Customer's deployment to Vendor's systems. No telemetry not disclosed in the current Telemetry Disclosure will be collected without Customer's prior written consent."

---

**Commitment 9: No Vendor-as-Broker for Customer Data**

> The vendor will not receive, aggregate, or re-sell Case Data in any form. The BYOK model means the vendor is not a party to the data provider relationships. In any future scenario where ChainSight offers a data brokerage service (vendor-negotiated bulk data deals passed to customers), this is done with full disclosure and explicit opt-in, with strict separation from Case Data.

*MSA language:* "Vendor does not and will not sell, license, sublicense, transfer, or otherwise provide Customer's Case Data to any third party, including for the purpose of enriching third-party datasets or analytics products."

---

**Commitment 10: No "Trust Us" Privacy Claims**

> Every privacy guarantee in the platform architecture is technically enforceable by the customer through controls they own and operate. The vendor makes no privacy claim that requires the customer to take the vendor's word for it without technical verification.

*MSA language:* "Vendor's privacy and security representations are backed by technically verifiable controls as described in Exhibit E [Security Architecture Summary]. Customer's right to verify these controls through independent audit is preserved, subject to reasonable scheduling and NDA requirements."

---

### 5.2 How Anti-Feature Commitments Appear in Marketing Collateral

Every major marketing document (website, one-pager, RFP response, press release) includes a section titled "What ChainSight Does Not Do" that lists the ten commitments in plain language. The section is not buried in fine print — it is a top-level feature: the platform's trustworthiness is a selling proposition, not a compliance afterthought.

Template language for marketing:

> **What ChainSight does not do:**
> ChainSight is a tool for investigating specific, documented financial crimes and regulatory violations. By design, it does not include predictive policing features, mass surveillance capabilities, demographic correlation analytics, or bulk monitoring modes. These are not missing features — they are deliberate architectural choices, enforced in our codebase and contractually binding in every customer agreement. We believe investigative tools that avoid these features are more defensible in court, more trusted by the communities they operate in, and ultimately more effective at their actual purpose.

---

## 6. Insurance Posture

### 6.1 Overview

Insurance is purchased before the first customer deployment. There is no "we'll get insurance when we grow" — the platform's use in law enforcement contexts creates real liability exposure from day one.

The founder's first call to a broker should happen in Phase 0, weeks 3–4. Insurance takes time to bind, and some coverage (E&O for a pre-revenue company) requires specific structuring.

### 6.2 Coverage Requirements by Type

---

**Errors and Omissions (E&O) / Professional Liability**

*What it covers:* Claims that ChainSight's platform produced incorrect analysis that led to a harmful professional decision — e.g., a wrongful freeze, a flawed expert report that was excluded, or incorrect attribution that led to prosecution of the wrong person.

*Minimum coverage:*
- Phase 0 (pre-revenue, pilot only): $2M per occurrence / $5M aggregate — some insurers won't write below $1M for software, but $2M/$5M is achievable for a pre-revenue company
- Phase 2 (first paying customers): $5M per occurrence / $10M aggregate
- Phase 3 (first government contracts): $10M per occurrence / $20M aggregate
- Phase 4 (FedRAMP, federal LE): Re-evaluate; some government contracts specify minimum coverage

*Trigger for increase:* Milestone — not calendar — based. Coverage increases when the customer count crosses 5, 25, and 100 paying customers, and when first government contract is signed.

*Note on E&O for AI platforms:* Standard E&O policies increasingly include AI exclusions or limitations. Work with a broker who specializes in tech E&O and explicitly negotiate that AI-assisted analytical outputs are covered. The methodology disclaimer in the MSA (Section 6) and in every report is the companion legal structure — it reduces the vendor's legal exposure, but the insurance backstops what slips through.

---

**Cyber Liability**

*What it covers:* Data breach response costs, regulatory fines (GDPR, state privacy laws), customer notification, forensic investigation, third-party liability arising from a breach.

*Minimum coverage:*
- Phase 0: $5M per occurrence / $10M aggregate
- Phase 2+: $10M per occurrence / $20M aggregate
- Phase 4 (government): $20M per occurrence / $40M aggregate — some federal contracts may require higher

*Critical consideration:* Cyber liability for a law enforcement-adjacent platform insures assets of extraordinary sensitivity (case data, suspect identities, victim PII, pending investigations). Insurers may have questions about the sovereign deployment model — specifically whether the vendor's architectural blindness reduces or increases their exposure. The vendor's architectural blindness (SaaS Blind) does reduce breach surface because the vendor cannot read Case Data, but the vendor is still a target for supply-chain attacks. Document this architecture clearly for the underwriter.

---

**Technology Professional Liability**

*What it covers:* Claims arising from errors in the platform's software, including methodology disputes and defect claims. Often bundled with E&O but some underwriters separate them.

*Minimum coverage:* $5M per occurrence / $10M aggregate, increasing with Phase 3.

---

**Directors and Officers (D&O)**

*What it covers:* Personal liability of the company's officers and directors for management decisions, regulatory actions, investor claims.

*When to bind:* Before taking any outside investment (seed, angel, or institutional). For a solo founder at Phase 0 with no outside investors, D&O can wait until the first funding round is imminent.

*Minimum coverage:* $2M–$5M at seed stage. Scale with the company.

---

**General Commercial Liability**

Standard commercial liability. Required by most co-working spaces and office leases. $1M–$2M per occurrence; low cost; bind before Phase 0 operations begin.

---

### 6.3 Insurance Timeline Summary

| Coverage | When to Bind | Initial Minimum |
|---|---|---|
| General Commercial Liability | Phase 0 Week 1 | $1M/$2M |
| Cyber Liability | Phase 0 Week 3 (before any beta users) | $5M/$10M |
| E&O / Professional Liability | Phase 0 Week 3 (before any beta users) | $2M/$5M |
| Tech Professional Liability | Phase 0 Week 3 | $2M/$5M |
| D&O | Before first outside investment | $2M/$5M |

*Recommended broker:* Use a broker who specializes in tech company insurance, ideally with law-enforcement tech or legal-tech clients. Coalition, Corvus, and Cowbell are cyber-first. For E&O in the forensics or legal-tech space, a traditional tech broker (Woodruff Sawyer, Embroker, Founder Shield) with AI coverage experience is preferred.

---

## 7. Outside Counsel Engagement Plan

### 7.1 The Four Engagements

The platform needs four distinct types of legal counsel. These are not one engagement — they require different specialists who do not overlap. Attempting to have one generalist law firm cover all four will result in mediocre coverage in every area.

---

**Engagement 1: General Corporate / Privacy / IP Counsel**

*Role:* Company formation, IP ownership, employment agreements (for future hires), privacy law compliance (GDPR, state laws), open-source license management, the standard commercial MSA.

*When:* Phase 0 Week 1. Company formation and IP assignment happen before any code is written.

*Specific deliverables:*
- Company formation documents (Certificate of Incorporation, bylaws, initial stock issuance, IP assignment agreement — the founder assigns all relevant IP to the company)
- Standard MSA draft from this document's skeleton
- Privacy policy for the website and the platform
- Data Processing Addendum (DPA) for SaaS Blind customers
- Open-source license review for all dependencies (ensure BYOK connector code uses appropriately licensed components)
- GDPR Article 27 representative engagement planning (Phase 4)

*Engagement letter requirements:* Flat-fee or capped engagement for formation; hourly for ongoing. Require explicit IP assignment and work-for-hire provisions. Require conflict-of-interest check (no existing clients in the competing forensics space).

*Target firms:* Cooley, Gunderson Dettmer, Fenwick & West, Wilson Sonsini — these are standard startup firms with strong IP practices. For a solo founder on a budget, a boutique tech/startup firm is appropriate at Phase 0.

---

**Engagement 2: Federal Contracting Counsel**

*Role:* Government contracting vehicles (GSA Schedule, SEWP, CIO-SP4, OASIS+), FAR/DFARS compliance, federal acquisition regulations, government MSA addendum, FedRAMP counsel.

*When:* Phase 3 — when the first federal agency relationship begins to formalize. Do not engage federal contracting counsel before there is a real federal opportunity, because the engagement is expensive and the work is not time-critical before Phase 3.

*Specific deliverables:*
- Government contracting addendum to the MSA
- GSA Schedule application strategy and support
- Federal acquisition compliance review
- FedRAMP authorization legal framework
- CJIS conformance documentation review
- ITAR/EAR opinion letter (see Section 19, OQ-6)

*Engagement letter requirements:* Hourly with a retainer. Require the firm to identify specific government contracting attorneys (not generalists). Look for prior experience with tech platforms seeking initial GSA Schedule approval.

*Target firms:* Sheppard Mullin, DLA Piper, Jenner & Block, Arnold & Porter — all have strong federal contracting practices. Smaller boutique firms specializing in government contracts (Winstead, Crowell & Moring) may be more cost-effective.

---

**Engagement 3: Civil-Rights / Civil-Liberties Counsel**

*Role:* The F41 civil-liberties architecture needs legal backing. This counsel reviews the anti-feature commitments, CLRB structure, and methodology framework for civil-rights law compliance and drafts the civil-rights provisions of the MSA.

*When:* Phase 1–2 — before the CLRB is convened. The counsel helps design the CLRB charter and attends the inaugural CLRB meeting.

*Specific deliverables:*
- Review of anti-feature commitments against Fourth Amendment case law, Fourteenth Amendment equal protection principles, and relevant civil-rights statutes
- CLRB charter legal review and conflict-of-interest opinion
- Customer responsibility for legal use provision drafting
- Legal opinion on platform liability exposure under 42 U.S.C. § 1983 (civil rights statute) — if a customer misuses the platform to cause a civil-rights violation, what is ChainSight's exposure as the tool provider?
- Review of the methodology disclaimer for legal sufficiency

*Note on liability under § 1983:* This is a real exposure. If a law enforcement officer uses ChainSight to support a wrongful arrest or unconstitutional seizure, the victim may bring a § 1983 claim against the agency and potentially against the tool provider. The vendor's protection is: (a) the tool does not make arrests or seizures; (b) the customer responsibility for legal use clause places the legal authority decision squarely on the customer; (c) the methodology disclaimer separates technical conclusions from legal conclusions. Civil-rights counsel should opine on whether these protections are sufficient.

*Target firms:* Law firms with civil-rights defense experience, not plaintiffs' firms. Latham & Watkins, Gibson Dunn, and Sidley Austin have both civil-rights and technology law practices. The ACLU's Technology and Liberty Project is a potential non-profit resource for the CLRB design, not for legal representation.

---

**Engagement 4: Litigation Counsel on Retainer**

*Role:* Eventual subpoenas, government investigations, customer disputes, and expert witness support. This counsel is not engaged for specific work at Phase 0 — they are identified and a general retainer is established so that when a matter arises (and it will), the relationship is already in place.

*When:* Phase 2 — when the first paying customers are operational. Do not wait for a matter to arise.

*Specific deliverables at retainer establishment:*
- Review of the discovery response posture (Section 15 of this document)
- Advise on vendor-side subpoena response protocol
- Review the platform's "architectural blindness defense" for legal sufficiency
- Advise on customer notification before disclosure procedures

*Engagement letter requirements:* Monthly retainer (even a small one, e.g., $2,000–$5,000/month) to establish the conflict-of-interest clearance and the relationship. Hourly rates for actual matter work, pre-agreed.

*Target firms:* Firms with litigation practices in both technology and federal law. A firm with prior experience in digital evidence matters is a plus but not essential — this counsel needs to understand the subpoena response posture, not the blockchain technology.

---

## 8. Government Contracting Vehicles

### 8.1 Overview

Federal agencies and most state/local agencies cannot write a purchase order directly to a vendor they've never contracted with before. They need a vehicle — a pre-competed contract mechanism that provides price reasonableness, terms, and legal authority to buy. Getting onto the right vehicles is a 12–24 month investment that must begin in Phase 3.

### 8.2 Federal Vehicles

---

**GSA Multiple Award Schedule (MAS) — Schedule IT 70 or SIN 54151**

*What it is:* The General Services Administration's pre-competed contract vehicle. Being on GSA Schedule means federal agencies can buy directly from ChainSight using the GSA ordering procedures. This is the most broadly applicable federal vehicle and the prerequisite for most of the others.

*Who can use it:* All federal agencies, and many state/local governments (via the Cooperative Purchasing program).

*What ChainSight becomes as a contracting partner:* A GSA Schedule holder with approved products and pricing. The agency issues a task order against the Schedule. ChainSight invoices the agency.

*Application process:*
1. Register in SAM.gov (System for Award Management) — this is required before any federal contracting
2. Obtain a DUNS/UEI number (already required for SAM.gov)
3. Complete eOffer application through GSA's system
4. GSA reviews financials (two years preferred; waivable for startups under specific criteria), past performance, and technical capability
5. Negotiate pricing — GSA requires "most favored customer" pricing
6. Approval typically takes 4–9 months from application

*Timeline:* Begin Phase 3. Application submitted in Phase 3; approval expected in Phase 3–4 boundary.

*Federal contracting attorney requirement:* Yes. GSA Schedule applications have pitfalls — pricing disclosure, Trade Agreements Act compliance (TAA), past performance documentation — that benefit materially from specialist guidance.

*Cost to obtain:* $20,000–$50,000 in attorney fees; $0 in GSA fees. Ongoing compliance (Mass Modification processing, price updates) is minor ongoing work.

---

**SEWP (Solutions for Enterprise-Wide Procurement) V or VI**

*What it is:* A NASA-administered GWAC (Government-Wide Acquisition Contract) for IT products and services. SEWP is widely used for technology purchases and provides streamlined ordering.

*Who can use it:* All federal agencies.

*When to pursue:* Phase 4. SEWP requires existing past performance with federal customers — not viable until Phase 3 government customers have validated the platform.

*Process:* Apply to join a SEWP group through an existing SEWP prime contractor (many IT firms serve as primes). This is easier than a direct SEWP award.

---

**CIO-SP4 (Chief Information Officer Solutions and Partners 4)**

*What it is:* An NIH-administered GWAC for IT health and life sciences. Less directly relevant to blockchain forensics but potentially relevant if health-care financial crime work is pursued.

*When to pursue:* Phase 4.

---

**OASIS+ (One Acquisition Solution for Integrated Services Plus)**

*What it is:* A GSA-administered GWAC for professional services, including management consulting and IT services. More relevant if ChainSight evolves to include managed investigation services.

*When to pursue:* Phase 4 and beyond. Only relevant if the business model expands to services.

---

### 8.3 State and Local Vehicles

State and local law enforcement agencies — the primary Phase 2–3 market — use cooperative purchasing programs rather than direct procurement:

**NASPO ValuePoint:** The National Association of State Procurement Officials' cooperative purchasing program. Getting on a state's NASPO contract means other states can use it too. Focus on one large state contract first (California, Texas, Florida, or New York have the broadest reach).

**NCPA (National Cooperative Purchasing Alliance):** A cooperative purchasing program administered through TCPN and Region 14 ESC. Used by state and local agencies, educational institutions, and non-profits.

**OMNIA Partners:** A similar cooperative purchasing platform, particularly strong in law enforcement and public safety verticals.

*Process for state/local vehicles:* These typically require responding to an RFP issued by a lead agency (e.g., one state issues the RFP, and then all states can use the resulting contract). Phase 3 timing; federal contracting counsel advises on priority.

---

### 8.4 What the Agency Does to Become a Contracting Partner

This is the business development and legal task, not purely a technical one:

1. Register in SAM.gov and maintain active registration (annual renewal)
2. Obtain relevant certifications (8(a) small business, SDVOSB — Service-Disabled Veteran-Owned Small Business, HUBZone if applicable — these open preferential procurement pathways but require meeting specific criteria)
3. Begin GSA Schedule application no later than Phase 3 start
4. Identify one federal agency "champion" who will be the sponsoring customer for FedRAMP and ideally the first named government contract
5. Engage federal contracting attorney before any federal contracting activity

---

## 9. End-of-Life and Data Portability Program (F44)

### 9.1 The Guarantee

Customer protection from vendor failure is a first-class product commitment, not a legal afterthought. The architecture already supports it (Pillar 2, Reproducibility Pack). This section specifies the legal and operational framework.

### 9.2 Reproducibility Pack as Canonical Export

The Reproducibility Pack (Pillar 2) is the vendor-neutral export format for all case data. Every case in the platform, on any deployment mode, can be exported as a Reproducibility Pack. The Pack contains:

- All case data (IOCs, findings, attributions, paths, reports, memos)
- Complete chain of custody records
- Complete audit log
- Pinned chain data snapshots (all on-chain data used in the analysis)
- Attribution snapshots (pinned external attribution data at time of use)
- Rule version manifest (exact versions of all heuristics used)
- Model cards for any AI inference used
- Belief State history (append-only event log of all AI conclusions)
- replay.sh — a single command that reconstructs the entire analysis from the Pack contents

The Pack is self-contained: a customer who has exported their cases as Packs can read, replay, and present them without any ChainSight infrastructure running.

### 9.3 Open Pack Format Documentation

The Pack format specification is published as an open standard. What this means legally and practically:

- Third parties can build Pack viewers, importers, and exporters without a commercial relationship with ChainSight
- A court can request a Pack and inspect it with neutral tooling
- A receiving agency in a cross-agency handoff can import without needing ChainSight
- Future forensics platforms can commit to Pack interoperability

**Publication:** The Pack format specification is maintained in a public GitHub repository with a permissive open-source license (Apache 2.0 or MIT). Changes to the format are versioned with backward compatibility guarantees (minor versions add fields; major versions include migration tooling).

**Phase:** Pack format v1 specification published Phase 1 (when the first Reproducibility Packs are generated).

### 9.4 Perpetual On-Prem License

For On-Premises Sovereign customers, the license terms (Section 2.2, MSA Section 2) include:

- Perpetual right to use the deployed version even if the vendor ceases operations
- Update subscription gates access to new versions but does not revoke the right to run the current version
- The perpetual right survives: (a) vendor bankruptcy; (b) vendor acquisition; (c) product discontinuation; (d) customer's non-renewal of support

*Legal instrument:* This is a license grant, not a SaaS subscription. Outside counsel drafts it as a true perpetual license with a clear definition of what "perpetual right to use" means in the context of containerized software (the license runs with the customer's deployment, not with the vendor's infrastructure).

### 9.5 Source-Code Escrow Program

**For:** Agency and Classified tier customers.

**Escrow agent options:**
- Iron Mountain Intellectual Property Management — the market leader for source code escrow in enterprise software
- NCC Group Escrow Services — specialist with government and financial services experience
- Eide Bailly (for smaller-scale arrangements)

**What goes into escrow:**
- Complete source code as of the most recent release
- Build instructions and all tooling necessary to build and deploy from source
- Configuration documentation for all dependencies
- All trade secrets necessary to build, deploy, and maintain the platform
- Updated within 30 days of each major release

**Triggering events for release to customer:**
1. Vendor bankruptcy or dissolution
2. Vendor's failure to maintain the product for more than 12 consecutive months (measured by absence of commercially reasonable maintenance releases, security patches, or support)
3. Vendor acquisition by an entity that the customer's jurisdictional law identifies as a foreign adversary (subject to dispute resolution under the MSA)
4. Vendor's material, uncured breach of the MSA

**Scope of release license:**
- Customer may use the released source to operate and maintain their existing deployment
- Customer may engage contractors to maintain the software
- Customer may not resell, sublicense, or create derivative products for commercial sale

**Customer-funded community fork option:**
- If multiple customers receive simultaneous escrow release (e.g., vendor bankruptcy), they may collectively fund a community fork
- The community fork is permitted under the release license for the collective's own operational use
- Commercial redistribution of the fork requires negotiation with any surviving IP holders

**Phase:** Escrow program documentation Phase 0; first escrow deposits Phase 1 (when the first On-Prem deployments are live); escrow available to Agency-tier customers Phase 2.

**Cost:** Iron Mountain escrow costs approximately $5,000–$15,000/year per escrow arrangement. This is a vendor cost passed through to customers at the relevant tier, or absorbed as part of the annual contract.

---

## 10. Reproducible Build Verification Commitment

### 10.1 The Commitment

Every release binary is reproducibly buildable from public source. Any customer, auditor, or third party can independently verify that the binary they are running matches the source code the vendor published. This is not a marketing claim — it is a technical property that can be verified.

### 10.2 Implementation Architecture

**Reproducible builds:**
- The build process is deterministic: given the same source, the same build toolchain versions, and the same environment, the output binary is bit-for-bit identical
- This is achieved by: pinning all build tool versions, eliminating timestamps from build outputs, normalizing file ordering, and using hermetic builds (no filesystem state bleeds between builds)
- The build system (GitHub Actions + Docker) is configured for reproducibility and the configuration is public

**Signing:**
- Every release binary is signed with the vendor's release signing key
- The signing key's public key is committed to a transparency log
- The signing certificate chain is published and auditable

**Sigstore integration:**
- All release artifacts are signed using Sigstore (cosign), following the keyless signing workflow
- Sigstore's Rekor transparency log receives the signature record, creating a public, append-only record of every signature event
- The Sigstore OIDC workflow ties the signature to the GitHub Actions workflow that produced it, enabling "the binary was produced by this specific workflow run from this specific commit"

**Transparency log:**
- Every release event generates a Rekor entry containing: the binary's SHA-256 digest, the source commit hash, the build workflow URL, and the signing certificate
- The Rekor entry is publicly accessible and independently verifiable
- The customer can verify: (a) their binary's digest matches the Rekor entry; (b) the Rekor entry's source commit is the published source; (c) the build workflow is the official vendor workflow

### 10.3 Customer Verification Workflow

Documented and published in the platform's security documentation:

```
# Verify a ChainSight release binary
cosign verify \
  --certificate-identity https://github.com/chainsight/chainsight/.github/workflows/release.yml@refs/tags/v{version} \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  chainsight-{version}-{platform}.tar.gz

# Optionally rebuild from source and compare
git clone https://github.com/chainsight/chainsight
git checkout v{version}
./build.sh
sha256sum dist/chainsight-{version}-{platform}.tar.gz
# Compare with the published digest in the Rekor entry
```

This documentation is shipped with every release and is linked from the CLRB-approved security posture documentation.

**Phase:** Sigstore signing from Phase 0 (per v0.7 Part 4). Customer verification tooling documented in Phase 1. External auditor verifies the reproducible build claim in Phase 1.

---

## 11. Daubert / FRE 702 Readiness

### 11.1 The Legal Standard

Federal Rule of Evidence 702 (and its state equivalents) requires that expert testimony based on scientific or technical analysis be: (1) based on sufficient facts or data; (2) the product of reliable principles and methods; (3) the product of reliable application of the methods to the facts of the case.

*Daubert v. Merrell Dow Pharmaceuticals* (509 U.S. 579, 1993) provides the four-factor framework: (1) testability; (2) peer review and publication; (3) known or potential error rate; (4) general acceptance.

The platform is designed from the ground up to satisfy all four Daubert factors and all three FRE 702 requirements. This section specifies how.

### 11.2 How the Platform Produces Daubert-Survivable Output

**Testability:**
- The Reproducibility Pack enables independent retesting. Any party who receives a Pack can re-run the analysis on their own hardware. The replay.sh script produces bit-for-bit identical output.
- T0 conclusions (cryptographic) are directly testable against the public blockchain — any party with blockchain access can independently verify the transaction data.
- T1 and T2 conclusions are testable given the pinned rule versions and attribution snapshots included in the Pack.

**Peer review and publication:**
- The heuristics used (UTXO common-input ownership, change-output detection, FIFO/LIFO accounting) are documented in the public literature. The platform's methodology disclosures cite the relevant literature.
- The platform publishes its false-positive rate measurements quarterly — this is itself a form of published performance data subject to external scrutiny.
- The annual methodology audit (Section 4.2) is peer-equivalent review for the platform's methodology claims.

**Known or potential error rate:**
- Section 4.3 tables are the platform's published answer to this Daubert factor. Every heuristic has a public FPR target and a published quarterly measurement.
- The cumulative confidence interval in every report provides a specific quantitative statement of the analysis's aggregate error bound.
- The Tier system (T0–T3) communicates the determinism class of every conclusion.

**General acceptance:**
- Blockchain transaction tracing using the methodologies identified herein (UTXO CIH, FIFO, LIFO, pari passu, etc.) is routinely applied by Chainalysis, TRM Labs, and Elliptic, all of which have been accepted in federal and state courts. ChainSight's methodologies are consistent with the accepted field practice.
- The platform is designed for consistency with accepted methodologies, not novelty.

### 11.3 Expert Witness Profile Integration (F26)

The Expert Witness Profile (F26) is the platform's mechanism for connecting the expert's qualifications to the platform's output. For Daubert purposes:

- The expert's CV auto-attaches to every expert declaration. Defense counsel cannot claim they didn't receive it.
- Prior testimony is tracked: the expert can answer "have you ever been excluded" with a definitive, documented record
- Daubert challenge history is tracked: if the expert has previously survived or been excluded in a Daubert motion, that record informs preparation
- Cross-exam prep library: per-methodology libraries of likely cross-examination questions and prepared responses, drafted by the expert and stored in the platform. These are not lawyer work-product (the expert drafts them); they are preparation tools the expert uses independently.

### 11.4 Methodology Disclosure Templates

For each report generated for court use, the platform automatically includes the full per-methodology disclosure from Section 3.3. These disclosures are:

- Included in the report PDF as a mandatory section
- Attached separately as a stand-alone methodology exhibit
- Part of the Reproducibility Pack
- Referenced in the expert declaration template

### 11.5 Cross-Examination Prep Library

The platform's cross-examination prep library (part of F26) is organized by methodology and by common defense arguments. Key entries that must be pre-loaded:

| Defense Argument | Prepared Response Framework |
|---|---|
| "The AI made this analysis; you didn't" | Explain the Human-in-the-loop (G1) requirement: every court-grade finding required investigator sign-off with `signoff_id`. The AI assists; the investigator certifies. |
| "Different runs produce different results" | Explain T0/T1/T2 determinism and the Reproducibility Pack. Offer to demonstrate replay on defense's own hardware. |
| "The error rate is unacceptably high" | Cite published FPR targets and quarterly measurements. For this specific analysis, identify which heuristics were used and their FPRs. Distinguish the cumulative confidence interval from a simple error rate. |
| "Blockchain data can be manipulated" | T0 data is cryptographically verified. Explain immutability of blockchain data and the difference between T0 and T3 conclusions. |
| "The methodology was selected to benefit the prosecution" | Explain that methodology selection criteria are disclosed in the report, the platform presents results under all methodologies (per the appendix comparison), and the investigator's rationale for selection is documented. |
| "You don't know who controlled the private key" | Acknowledge the technical limit: the platform traces fund flows, not physical possession of private keys. Attribution to a specific person requires additional evidence (exchange KYC, device forensics, etc.) documented in the attribution sources. |

### 11.6 Prior Testimony Tracking and Daubert Outcome Registry

The platform maintains an aggregate, anonymized registry of Daubert outcomes for cases in which ChainSight-produced evidence was offered. This registry:

- Tracks: jurisdiction, court level, methodology challenged, outcome (admitted, excluded, not challenged)
- Is reported in the annual Transparency Report (aggregate only, no case-identifying information)
- Informs the cross-examination prep library updates — if a specific defense argument succeeds in one jurisdiction, the prep library is updated to address it

The registry also serves as a signal for methodology improvement: systematic Daubert exclusions in a specific area indicate a methodology gap that triggers the CLRB review process.

---

## 12. Privacy Law Compliance

### 12.1 The Structural Privacy Advantage

The sovereign deployment model (Pillar 4) and the architectural blindness of SaaS Blind are not just security features — they are the primary privacy law compliance mechanism. Because the vendor cannot read Case Data:

- The vendor is not a data controller under GDPR/UK DPA for the personal data in case files
- The vendor is a data processor (for SaaS Blind) or not involved at all (for On-Prem)
- The customer (the law enforcement agency) is the data controller and bears the data protection obligations toward data subjects

This structural fact dramatically simplifies ChainSight's compliance posture and should be understood by both the vendor's lawyers and the customer's lawyers.

### 12.2 GDPR Readiness (Phase 4 EU Expansion)

**The GDPR landscape for law enforcement:**

There is a critical distinction in EU data protection law: the General Data Protection Regulation (GDPR) applies to processing in a commercial context; the Law Enforcement Directive (LED, Directive 2016/680) applies to processing by competent authorities for law enforcement purposes. Most ChainSight customers in the EU will process Case Data under the LED, not GDPR. The practical implications:

- The LED has different legal bases for processing, different data subject rights, and different supervisory authority relationships
- ChainSight as a data processor to an EU law enforcement customer would be subject to LED-compatible processor obligations
- EU private sector compliance teams (AML/CFT) using ChainSight process under GDPR

**Phase 4 EU preparation tasks:**
1. Appoint an EU Article 27 GDPR representative (a natural or legal person established in the EU who can receive supervisory authority inquiries on ChainSight's behalf)
2. Conduct a Transfer Impact Assessment (TIA) for transfers of personal data from EU customers to any US infrastructure components in SaaS Blind
3. Implement Standard Contractual Clauses (SCCs) in the DPA for EU customers
4. Complete GDPR Article 30 Records of Processing Activities (RoPA) covering ChainSight's processing as a data processor
5. Implement GDPR Article 32 technical and organizational measures — largely already done by the encryption architecture
6. LED-specific DPA addendum for EU law enforcement customers

**Data residency — Phase 0–1 (Fly.io + Supabase):** Fly.io supports region selection at deployment time; Supabase supports regional Postgres instances (US East, EU West, and others). US customers are assigned to US-region Fly.io + US-region Supabase. The contractual commitment: no US customer's Case Data (even in ciphertext) is stored in EU or non-US infrastructure without prior written consent. This is documented in the MSA and the DPA.

**Data residency — Phase 2+ (AWS migration):** AWS provides granular region control (us-east-1, us-west-2, etc.) and AWS GovCloud for classified workloads. Post-migration, the data residency commitment is enforced at the AWS region level, which is more granular and more auditable than Fly.io/Supabase regions. EU customers (Phase 4) are provisioned in AWS eu-west-1 (Ireland) or eu-central-1 (Frankfurt) depending on customer preference.

**Data residency as a contractual term:** The DPA specifies the customer's designated region. Migration between regions requires 30 days' notice and customer consent. If ChainSight migrates infrastructure (e.g., the Phase 2 AWS migration) in a way that changes the physical storage region, customers are notified per the Subprocessor changes process in MSA Section 5A.

**On-Premises Sovereign:** Data residency is entirely the customer's concern. ChainSight makes no data residency representations for On-Prem deployments.

### 12.3 UK DPA 2018

The UK Data Protection Act 2018 implements both the GDPR (for commercial processing) and the LED (Part 3, for law enforcement processing) in UK law. Post-Brexit, the UK is an independent regime from the EU. Practical implications:

- UK GDPR adequacy decision: the EU has granted the UK adequacy status, so data flows from EU to UK are permitted. The reverse (UK to EU) requires assessment.
- UK Information Commissioner's Office (ICO) is the supervisory authority for UK data protection
- Same Phase 4 EU expansion preparation applies to UK, with UK-specific instruments (UK SCCs or UK IDTA for international transfers)

### 12.4 US State Privacy Laws

**CCPA/CPRA (California):**
The California Consumer Privacy Act and its amendment (CPRA) establish data subject rights (access, deletion, correction, opt-out) for California residents. The critical carve-out: CCPA does not apply to personal information collected and used pursuant to law enforcement investigations. However, it does apply to the personal information of ChainSight's own employees, job applicants, and website visitors. A privacy policy covering CCPA is required from Phase 0.

**Virginia VCDPA, Colorado CPA, Connecticut CTDPA, Texas TDPSA, and others:**
An expanding set of state privacy laws with similar structure to CCPA. The same law enforcement carve-out typically applies to ChainSight's case data processing. ChainSight's own-operations compliance (employees, website) requires monitoring and updating as new state laws take effect.

**Practical Phase 0 requirement:** Publish a CCPA-compliant privacy policy. Implement basic data minimization for website visitor data (use a privacy-respecting analytics tool or none at all).

### 12.5 The Police Directive vs. GDPR Distinction (Operational Detail)

When a law enforcement customer in the EU processes personal data through ChainSight, the applicable framework is:
- **LED** if the customer is a competent authority (law enforcement agency, prosecution service) processing for law enforcement purposes
- **GDPR** if the customer is a private sector entity (AML/CFT compliance team, exchange) processing for compliance purposes

ChainSight as a processor must support both:
- For LED customers: a DPA addendum referencing LED Article 22 (processor obligations) and confirming appropriate technical/organizational measures
- For GDPR customers: a standard Article 28 DPA

The DPA must clearly document what personal data is processed by category (blockchain addresses linked to individuals, transaction data associated with identified persons, investigator identity data) and for what purposes.

---

## 13. AML/CFT Regulatory Hooks

### 13.1 FinCEN 314(a) and 314(b)

**314(a) — Law enforcement to financial institution inquiries:**
FinCEN Section 314(a) allows law enforcement to submit lists of suspects to FinCEN, which distributes them to registered financial institutions. Institutions search their records and report back. ChainSight's role: 
- The platform can assist investigators in preparing the predicate information for a 314(a) request (on-chain analysis establishing reasonable grounds)
- The platform tracks 314(a) submissions as evidence actions in the case's deconfliction tab
- The platform ingests 314(a) responses as documentary evidence (via document ingest, F16)

**314(b) — Voluntary financial institution cooperation:**
Section 314(b) allows financial institutions to voluntarily share information about potential money laundering with each other. ChainSight's role:
- For compliance-team customers (VASPs, banks): the platform can support 314(b) information sharing workflows by helping structure the supporting analysis
- The platform does not itself participate in 314(b) as a financial institution; it is a tool used by participating institutions

**Legal design note:** FinCEN 314(b) sharing requires specific legal safeguards. Ensure the customer AUP makes clear that 314(b) sharing must comply with the customer's own 314(b) registration and FinCEN's guidance. The platform is not responsible for the customer's compliance with 314(b) procedures.

### 13.2 Travel Rule Integration

The FATF Travel Rule (and its implementations: FinCEN's proposed rule, VASP directive in the EU under MiCA, JVCEA in Japan, MAS in Singapore) requires VASPs to transmit originator and beneficiary information with cryptocurrency transfers above threshold. ChainSight's analytical role:

- Identify transfers that crossed a Travel Rule threshold
- Flag addresses that appear to be VASP-to-VASP transfers where Travel Rule data should have been transmitted
- Surface Travel Rule non-compliance as an investigative finding (the absence of Travel Rule data where it should exist is an indicator of structuring or evasion)
- Support customers who are themselves VASPs in verifying their Travel Rule compliance posture

The platform does not implement Travel Rule transmission — that is an operational function of VASPs. The platform is the analytical overlay that identifies compliance gaps.

### 13.3 MiCA (EU Markets in Crypto-Assets) Compliance

MiCA introduces a comprehensive EU regulatory framework for crypto-assets. Key provisions relevant to ChainSight:

- **CASPs (Crypto-Asset Service Providers)** are regulated and have AML/CFT obligations under MiCA + 6th AML Directive
- ChainSight is not itself a CASP; it is a forensics and compliance tool used by CASPs
- ChainSight can assist CASPs with their MiCA reporting obligations by providing structured evidence of transaction monitoring, suspicious activity documentation, and Travel Rule compliance analysis
- Jurisdiction-specific document templates for MiCA reporting will be part of Phase 4 localization (F47)

### 13.4 SAR/STR Templates

Suspicious Activity Report (SAR) in the US and Suspicious Transaction Report (STR) in many other jurisdictions are mandatory filings by financial institutions that detect suspected money laundering. ChainSight supports SAR/STR preparation:

- Platform output (trace paths, attribution findings, methodology disclosure) directly maps to SAR/STR narrative fields
- SAR templates for US FinCEN FinCEN 111 SAR (bank SAR form) and FinCEN 114 FBAR are supported in Phase 3–4
- UK NCA SAR online (SOCA SARs system replacement) template in Phase 4
- EU jurisdiction-specific STR templates in Phase 4 (jurisdiction-specific per F47)
- The Narrative Agent's report drafting capability is the primary mechanism; the investigator selects "SAR narrative" as the report template type

**Legal note:** SAR/STR filing is the customer's legal obligation, not the vendor's. The platform is a tool for preparing accurate SAR/STR narratives, not a compliance officer service. The customer-responsibility-for-legal-use provision in the MSA is the relevant protection.

---

## 14. Personal Attribution Legal Posture

### 14.1 What Personal Attribution Is

Personal Attribution (F25, v0.6) is the mechanism by which individual investigators build and maintain their own on-chain address attributions, independent of (and potentially disagreeing with) commercial attribution providers. These attributions are the investigator's professional judgment — analogous to an investigator's field notes or informant relationships.

### 14.2 Investigator-Owned Attributions

The legal posture on ownership is clear: personal attributions belong to the investigator (or their employing agency, depending on the employment relationship). ChainSight has no ownership claim.

**Four visibility tiers (per G19):**
1. Private (investigator only)
2. Specific users (named colleagues)
3. Team (investigator's team within the agency)
4. Agency-wide

The visibility tier controls access but does not affect ownership. An investigator who leaves an agency retains their private-tier attributions. Team and agency-wide attributions remain with the agency.

**Portability clause:**
An investigator who transfers between agencies (law enforcement careers involve transfers) can take their private-tier attributions. This is specified in the MSA's data portability provisions: individual investigator accounts have a personal attribution export right independent of the agency's data export rights.

**Conflict-of-interest considerations:**
An investigator's personal attribution that contradicts the platform's primary attribution creates a counter-attribution (per G19). The counter-attribution is preserved as a permanent record. This is the correct handling: it does not create a conflict — it creates a documented disagreement that survives for the court record. Defense counsel has access to the counter-attribution through the Reproducibility Pack.

**Survivability across agencies:**
When an investigator transfers agencies (common in federal LE), their personal attributions need to remain accessible to them while protecting the former agency's case data. The architecture handles this: personal attributions at the "private" tier travel with the investigator's account; case-linked attributions remain with the case (and thus the originating agency).

**Cross-examination note:** Defense counsel will ask about personal attributions, especially if they contradict commercial data. The investigator must be prepared to explain: (a) what evidence supports their personal attribution; (b) why it differs from commercial data; (c) whether the counter-attribution system has any entries. The cross-examination prep library should include entries on this.

---

## 15. Discovery Response Posture

### 15.1 When ChainSight Is Subpoenaed

At some point, a party in litigation or a government investigation will subpoena ChainSight directly — either for data about a customer's use of the platform or for data about a specific case. This will happen. The response posture must be designed before it happens.

### 15.2 The Architectural Blindness Defense

The most important aspect of the discovery response posture is that the sovereign deployment architecture substantially limits what ChainSight can produce, and this is by design.

For **On-Premises Sovereign** deployments:
- ChainSight holds no Case Data. Period. All case data is in the customer's infrastructure.
- A subpoena to ChainSight for On-Prem customer case data should receive a response: "ChainSight does not possess, and has never possessed, the requested information. The data exists in [Customer Agency]'s infrastructure."
- ChainSight can produce: the software license agreement, billing records (seat count, tier), and the published software artifacts.

For **SaaS Blind** deployments:
- Case Data is encrypted with per-agency keys held in the customer's KMS
- ChainSight holds encrypted ciphertext; producing ciphertext without the decryption key produces nothing useful to the requesting party
- A subpoena to ChainSight for SaaS Blind Case Data should receive: (a) the encrypted ciphertext (which is all ChainSight possesses), and (b) an explanation of the encryption architecture establishing that ChainSight is not the custodian of the plaintext
- The subpoena should be re-directed to the customer who holds the keys
- This is not obstruction — it is an accurate statement of what ChainSight possesses

**Outside counsel is required for all subpoena responses.** Do not respond to a subpoena without counsel review. This section provides the architectural context for counsel; it does not substitute for legal judgment.

### 15.2A Subpoenas Directed at Subprocessors

A sophisticated adversary (or a determined government) will subpoena not only ChainSight but also ChainSight's infrastructure subprocessors directly. This is the threat model the blind architecture is specifically designed to defeat.

**Supabase:** Supabase holds the ciphertext of the database tables (Case Data, Belief State, audit logs). A subpoena to Supabase produces ciphertext encrypted with per-agency DEKs that Supabase does not hold. The ciphertext is useless without the customer's KMS root key. ChainSight's response to a customer inquiry about a Supabase-directed subpoena: "Supabase holds only ciphertext encrypted with keys you control. They cannot produce your case data in readable form."

**Fly.io (Phase 0–1):** Fly.io runs the application containers. In-memory plaintext exists during active computation (inevitable in any computing architecture). At rest, all persistence flows through Supabase (encrypted). A subpoena to Fly.io for ChainSight application data would produce application logs (which are minimized by default and contain no Case Data per the anti-silent-telemetry commitment) and the container images themselves (which are public release artifacts). Case Data in plaintext is not persisted to Fly.io's storage.

**AWS (Phase 2+):** Same analysis as Fly.io but with additional AWS protections: AWS has a documented legal process response policy; AWS GovCloud adds jurisdictional protections for US government data; AWS KMS can be configured as customer-managed (BYOK) so even AWS cannot access the decryption keys.

**GitHub:** A subpoena to GitHub for ChainSight's source code repository would expose the source code. This is mitigated by: (a) the source code is already published to On-Prem customers who triggered escrow and is publicly documented in methodology; (b) source code exposure does not expose Case Data; (c) if the concern is trade secret exposure, Outside Counsel should advise on trade secret protections for specific proprietary algorithms. ChainSight's posture is that the methodology is the value, and the methodology is already disclosed in public reports.

**Practical preparation:** Before the first SaaS Blind customer, litigation counsel (Section 7, Engagement 4) should advise on: (a) the completeness of the ciphertext-defense for a US federal subpoena; (b) whether the architecture documentation is sufficient to present to a court on a motion to quash a subpoena directed at Supabase or Fly.io; (c) whether customer notification before Supabase/Fly.io-directed subpoenas is legally permissible.

### 15.3 What ChainSight Can Produce

Regardless of deployment mode, ChainSight can produce in response to a lawful subpoena or court order:

- MSA and addenda (with any confidential provisions appropriately protected)
- Billing records (seat counts, tier, contract dates)
- Software version and release history
- The published methodology documentation
- Published transparency reports
- Published false-positive rate reports
- Published CLRB reports

ChainSight cannot produce (and does not possess):
- Case data in plaintext (SaaS Blind) or at all (On-Prem)
- Investigator identities linked to specific cases
- The specific addresses, transactions, or findings in any case
- BYOK provider keys or provider responses (these flow through the customer's credentials, not ChainSight's)

### 15.4 Customer Notification Before Disclosure

When ChainSight receives a subpoena or legal process that may require disclosure of any customer-related information (even just billing records), the following notification procedure applies — except where prohibited by the legal process itself (e.g., a gag order, National Security Letter):

1. Upon receipt of legal process, counsel reviews immediately
2. If not prohibited, customer is notified within 24 hours with a copy of the process
3. Customer is given 7 days (or the court deadline if shorter) to move to quash before ChainSight responds
4. ChainSight assists the customer's legal effort to quash where that effort is reasonable
5. If the process cannot be quashed, ChainSight produces only what is legally required and no more
6. Customer is notified of the production

This procedure is documented in the MSA (Section 5 — Privacy and Security) so customers know before they sign that this is the vendor's posture.

### 15.5 Government Requests (FISA, NSL, Specific LE Requests)

If ChainSight receives a national security demand (FISA order, National Security Letter, or equivalent):

- ChainSight will comply with lawful process as required by law
- To the extent permitted, ChainSight will notify affected customers
- ChainSight will publish aggregate warrant canary-style statistics in the annual Transparency Report (number of government demands received, number complied with, number challenged) to the extent permissible under applicable law

This is a standard tech industry practice (Twitter, Apple, Google all publish this data). The Transparency Report template in Section 17 includes a government demands section.

---

## 16. Bias-Audit Framework — Operational Detail

### 16.1 Audit RFP Structure

The annual external bias audit is procured via a competitive Request for Proposals (RFP). The RFP specifies:

**Required auditor qualifications:**
- Independence: no commercial relationship with ChainSight or its major customers; no current engagement with a competitive blockchain forensics platform
- Technical capability: demonstrable experience with (a) machine learning fairness assessment, (b) digital forensics systems, or (c) both
- Civil-rights perspective: the auditor must include at least one team member with expertise in civil-rights law or civil-liberties research
- Proposed methodology: the RFP requires a specific proposed audit methodology (not just generic "we will audit your algorithms")

**Audit scope (annual):**
- Complete methodology documentation review
- Source code access (under NDA) for the specific algorithms being audited
- Test dataset access: auditor receives the same anonymized ground-truth datasets used for the platform's own regression testing
- Statistical testing for disparate impact across: jurisdiction, chain type, address type (exchange vs. DeFi vs. privacy-adjacent), temporal cohort
- Anti-feature commitment testing: auditor attempts to construct scenarios that trigger predictive policing, mass surveillance, or demographic correlation outputs
- Documentation review of CLRB decisions made during the audit period

**Audit output:**
- Full written report, structured as: findings, methodology, statistical results, recommendations
- Risk rating for each finding: Critical (requires immediate remediation), High (remediation before next audit), Medium (remediation plan required), Low (acknowledge and monitor)
- ChainSight public response to findings, delivered simultaneously with the report

### 16.2 Public Report Format

The public version of the audit report is published at chainsight.io/transparency with:

- Executive summary
- Full findings and methodology (with security-sensitive thresholds redacted; the redaction log states what was redacted and why)
- Statistical results tables
- ChainSight response and remediation commitments
- CLRB commentary (the CLRB reviews the audit report and publishes its own commentary)

### 16.3 Remediation Procedure for Disparate Impact Findings

If the audit finds statistically significant disparate impact across any dimension:

1. **Critical findings:** Immediate engineering triage; affected feature disabled or gated pending remediation; CLRB notified within 48 hours; public disclosure within 30 days
2. **High findings:** Remediation plan within 30 days; remediation implemented before next audit cycle; CLRB reviews the remediation
3. **Medium findings:** Acknowledged in the public report; remediation plan within 60 days; tracked in the quarterly FPR report
4. **Low findings:** Acknowledged; monitored in subsequent audits

For any finding that a feature is operating as a de facto demographic proxy (e.g., a geographic clustering heuristic that maps onto a racial or ethnic boundary):

- Feature is suspended pending CLRB review
- CLRB may approve a redesigned implementation or recommend permanent removal
- If CLRB recommends removal, the feature is removed regardless of customer impact

---

## 17. Transparency Report Template

### 17.1 Structure and Publication

The annual Transparency Report is published no later than March 31 of the year following the reporting period. It is available at chainsight.io/transparency as a human-readable HTML page and as a machine-readable JSON file.

### 17.2 What Is Included

**Section 1 — Platform Usage (aggregate)**
- Total number of active agency tenants (range, not exact, e.g., "25–50")
- Total number of active investigator seats (range)
- Number of cases opened during the reporting period (range)
- Number of Reproducibility Packs generated (range)
- Number of freeze request packages generated (range)
- Number of seizure recommendation packages generated (range)
- Number of expert declaration reports generated (range)

*Note:* Ranges rather than exact numbers because exact numbers, combined with public knowledge of customer identities, could reveal sensitive operational information about specific investigations.

**Section 2 — Court Outcomes**
- Number of cases in which ChainSight-produced evidence was offered at a Daubert or admissibility hearing, to the extent known
- Outcome breakdown: admitted, excluded, not challenged, pending, unknown
- Jurisdiction breakdown (federal/state; not case-specific)
- Methodology most commonly challenged
- Notes on reasoning cited in exclusion decisions (if publicly available)

**Section 3 — Retractions and Corrections**
- Number of retraction events during the reporting period
- Breakdown by type: investigator-initiated correction, court-prompted correction, post-conviction review correction
- Number of cases in which a retraction triggered a supplemental court filing
- Number of retractions that affected prior court outcomes (the most important metric)

**Section 4 — Methodology Audit**
- Name of external auditor and their organizational affiliation
- Audit period
- Summary of findings (Critical, High, Medium, Low counts)
- Link to full public audit report
- Summary of remediation actions taken
- CLRB response

**Section 5 — False-Positive Rate Performance**
- Quarterly FPR measurements vs. published targets for each heuristic
- Trend analysis: improving, stable, or degrading
- Remediation events triggered and resolved

**Section 6 — CLRB Activity**
- Number of CLRB meetings held
- Number of features reviewed
- Number of veto decisions
- CLRB membership composition (without personal identifying information beyond role title)
- CLRB's own annual statement (drafted by the CLRB, not by ChainSight)

**Section 7 — Government Demands**
- Number of legal process demands received (subpoenas, court orders, government requests)
- Number complied with in whole
- Number complied with in part
- Number successfully challenged
- Number pending
- Breakdown by demand type where permissible
- Notes on any demands where customer notification was prohibited (without disclosing the existence of a specific demand if legally required to maintain secrecy — standard warrant canary language)

**Section 8 — Security Incidents**
- Number of security incidents
- Nature and severity (without operational details that would assist future attacks)
- Customer impact
- Remediation actions
- Time to detection and time to containment (industry-standard metrics)

### 17.3 What Is NOT Included

- Any case-identifying information
- Any investigator-identifying information
- Any suspect or victim information
- Agency-specific statistics that could reveal information about specific ongoing investigations
- Methodological details that would assist bad actors in evading detection
- Non-public law enforcement sensitive information

### 17.4 Machine-Readable Format

The JSON version of the Transparency Report follows an open schema published at chainsight.io/transparency-schema. This enables:
- Journalists and researchers to parse and analyze multiple years of data
- Academic studies of blockchain forensics platform performance
- Comparison across multiple platforms (if others adopt the schema)
- CLRB's independent analysis of the data

---

## 18. Phase 0 Implementation Plan (Weeks 1–8)

### 18.1 Overview

Phase 0 is the critical window where the legal and compliance architecture is established before any customer code is shipped. The following tasks are the founder's responsibility in the first eight weeks. Tasks marked **[REQUIRED]** cannot be deferred; tasks marked **[PHASE 0 DEFAULT]** should be done in Phase 0 but can slip to early Phase 1 without catastrophic consequences.

### 18.2 Week 1–2

**[REQUIRED] Company Formation:**
Engage general corporate counsel. Incorporate the company in the selected jurisdiction. Complete: Certificate of Incorporation, bylaws, initial stock issuance, IP assignment agreement (founder assigns all pre-existing relevant IP to the company), and founder vesting agreement. This must be done before a single line of production code is written, because code written before IP assignment is not cleanly owned by the company.

*What to decide with counsel:* Jurisdiction (Delaware C-Corp is standard; explore alternatives only if there is a specific reason). Board composition. Initial cap table.

**[REQUIRED] SAM.gov Registration:**
Register the company in SAM.gov. This is the prerequisite for any federal contracting or grant activity. It takes 1–3 business days once initiated. Do it immediately.

**[REQUIRED] Insurance Consultation:**
Call an insurance broker (Embroker, Founder Shield, or equivalent) to begin the cyber liability and E&O application process. These policies take 2–4 weeks to bind. Begin immediately.

**[REQUIRED] Anti-Feature Commitments Published:**
Publish the ten anti-feature commitments (Section 5 of this document) on the company's website and in the product documentation repository. These are public commitments, not internal documents.

**[REQUIRED] Methodology Disclosure Drafting:**
Draft the universal platform disclaimer (Section 3.2) and the per-methodology disclosures (Section 3.3). These should be reviewed by general corporate counsel for clarity and incorporated into the report generation code before the first report is generated.

**[PHASE 0 DEFAULT] Basic Privacy Policy:**
Publish a privacy policy on the company website covering (a) website visitor data, (b) the company's own employee data policies, (c) the platform's data handling posture (short: the customer controls their own data; we don't read it). This is required for CCPA compliance and is expected by any sophisticated customer.

### 18.3 Week 3–4

**[REQUIRED] Insurance Binding:**
Bind cyber liability and E&O policies before any beta user or pilot customer accesses the platform. No exceptions.

**[REQUIRED] BYOK Provider Legal Review:**
Review the terms of service for every BYOK provider the platform will integrate (Chainalysis, TRM, Elliptic, Etherscan, OpenAI, Anthropic, etc.). With general counsel, confirm that the BYOK passthrough architecture (customer uses their own keys, ChainSight is not a party to the data relationship) is consistent with each provider's ToS. Some providers may have restrictions on "integrating their API into a platform sold to third parties" — this must be resolved before any BYOK connector ships.

**[REQUIRED] Subprocessor DPAs — Supabase, Fly.io, GitHub:**
Before the first SaaS Blind customer is onboarded, obtain signed Data Processing Agreements (or confirm existing DPAs are in place) from Supabase, Fly.io, and GitHub. Specifically:
- Supabase: their standard DPA is available at supabase.com/privacy; confirm it covers the envelope-encrypted-ciphertext-only scenario and that it includes sub-processor flow-down for any of Supabase's own infrastructure providers (they run on AWS)
- Fly.io: confirm their DPA covers application-layer processing and that they agree not to retain or analyze application logs in ways that could constitute Case Data processing
- GitHub: their DPA covers the CI/CD and source repository role; confirm they are not categorized as a Case Data processor (they are not, unless Case Data somehow appears in CI workflows — design CI workflows to prevent this)

Publish the Subprocessor List (chainsight.io/subprocessors) before the first customer onboards.

**[REQUIRED] MSA Drafting:**
Engage general counsel to begin drafting the MSA from the skeleton in Section 2. Target: a reviewable draft by end of Phase 0. The MSA must be in place before the first pilot customer signs on.

**[PHASE 0 DEFAULT] Information Security Policy:**
Document the company's information security policy. Even as a solo developer, a written policy is required for SOC 2. Covers: access controls (who can access production systems and with what authentication), encryption standards, incident response procedure, data classification, third-party vendor management. Templates are available from SANS Institute or security consultants; customize to match the platform's actual architecture.

**[PHASE 0 DEFAULT] Founder Background Check:**
If any prospect for Phase 1 is a law enforcement agency that may process CJI through the platform, the founder should initiate the fingerprint-based background check process required by CJIS. This takes 2–6 weeks to complete. Initiate now to avoid blocking the first government pilot.

### 18.4 Week 5–6

**[REQUIRED] MSA Review Round 1:**
Review draft MSA with counsel. Focus on: the methodology disclaimer provision (Section 2.2, Section 6), the customer-responsibility-for-legal-use provision, the data ownership provision, and the termination data portability provision.

**[PHASE 0 DEFAULT] Telemetry Documentation:**
Draft the Telemetry Disclosure document listing every data element that the platform transmits from a customer deployment to ChainSight infrastructure. Even at Phase 0, this list should be minimal (seat count, billing tier, error rate aggregates). Publish this document.

**[PHASE 0 DEFAULT] Source Code Escrow Planning:**
Contact Iron Mountain or NCC Group Escrow Services to understand the process and get a quote for the escrow program. No commitment required yet — just gathering information to present to Agency-tier customers who ask about it.

**[PHASE 0 DEFAULT] CLRB Charter Draft:**
Draft the CLRB charter (Section 4.4). This does not need to be finalized or the board convened yet (that is Phase 2) but the charter should be written and reviewed by civil-rights counsel before Phase 1.

### 18.5 Week 7–8

**[REQUIRED] MSA Finalized:**
Complete the MSA review process. The MSA must be ready before any pilot customer signs. Even for a no-cost pilot, a signed pilot agreement (or a short-form version of the MSA) is required.

**[REQUIRED] Certification Roadmap Published:**
Publish the certification roadmap (Section 1 of this document) as a committed public document on the company website. Sophisticated government and enterprise customers will ask about certifications in early conversations; having a public roadmap establishes credibility.

**[PHASE 0 DEFAULT] General Corporate Counsel Retainer:**
Establish an ongoing retainer with general counsel for day-to-day questions. Even a small monthly retainer ($1,000–$2,000) establishes the relationship and conflict-of-interest clearance.

**[PHASE 0 DEFAULT] Outside Counsel Engagement Plan:**
Prepare the engagement plan for the four counsel types (Section 7). Identify specific firms for each. Begin the federal contracting attorney search (they will not be formally engaged until Phase 3, but identifying them early avoids rushed selection later).

### 18.6 Phase 2 Mandatory Legal/Compliance Milestones (Preview)

These are not Phase 0 tasks but are flagged here because they must be planned and resourced in Phase 0, not discovered as surprises in Phase 2:

**[PHASE 2 REQUIRED] AWS Migration — SOC 2 prerequisite:**
The SaaS Blind infrastructure migration from Fly.io + Supabase (hosted) to AWS is a hard prerequisite for the SOC 2 Type 1 assessment. This is not a "nice to have" infrastructure upgrade — it is a compliance commitment with contractual implications for customers who signed up expecting the vendor to achieve SOC 2 Type 1 by end of Phase 2. The migration must be complete and stable for at least one month before the SOC 2 auditor begins fieldwork. Engineering resourcing for this migration should be planned in Phase 1.

Specifically:
- Choose AWS deployment model (ECS Fargate or EKS) in Phase 1
- Decide between Supabase Enterprise (AWS-hosted) and self-managed Postgres on AWS RDS
- If retaining Supabase Enterprise: negotiate enterprise agreement with Supabase; confirm their SOC 2 and data residency commitments at the enterprise tier
- Update the Subprocessor List to reflect the change; notify customers with 30 days' notice per MSA Section 5A
- Ensure the new DPA with AWS is in place before go-live on AWS
- The SOC 2 auditor will ask for the AWS infrastructure architecture diagram; prepare it as part of the migration

**[PHASE 2 REQUIRED] CLRB Convening:**
The CLRB charter (drafted in Phase 0) is activated in Phase 2. Civil-rights counsel (Engagement 3) must be engaged before the inaugural CLRB meeting. Allow 60 days from counsel engagement to inaugural meeting for charter finalization and member recruitment.

**[PHASE 2 REQUIRED] Source Code Escrow First Deposit:**
First escrow deposit at Iron Mountain or NCC Group when the first On-Premises Sovereign customer goes live in Phase 1–2. By Phase 2 the escrow should be operational and the escrow agreement signed.

---

### 18.7 What Is Deferrable

The following are explicitly deferrable beyond Phase 0 without catastrophic risk:

- Civil-rights counsel engagement (defer to Phase 1–2 when CLRB convening approaches)
- Federal contracting counsel engagement (defer to Phase 3 when federal customers become real)
- Litigation counsel retainer (defer to Phase 2 when first paying customers are live)
- GSA Schedule application (defer to Phase 3)
- Formal bias audit program (defer to Phase 3 when CLRB is convened)
- SOC 2 formal engagement (defer to Phase 2 start; preparation begins in Phase 2)
- Source code escrow deposits (defer to Phase 1–2 when On-Prem deployments are live)
- MiCA/EU legal readiness (defer to Phase 4)

---

## 19. Subprocessor Registry and Management

### 19.1 Purpose

This section establishes the operational framework for managing ChainSight's subprocessor relationships throughout the company's lifecycle. A subprocessor is any third-party entity that processes personal data (including Case Data in encrypted form) on behalf of ChainSight in the course of delivering the SaaS Blind service. This section does not apply to On-Premises Sovereign deployments, where ChainSight is not the data processor.

### 19.2 Current Subprocessor Registry (SaaS Blind v1)

| Subprocessor | Role | Data Processed | Region | DPA Status | SOC 2 |
|---|---|---|---|---|---|
| **Supabase** | Postgres (primary DB), Auth, Storage, Realtime | Case Data ciphertext, auth tokens, storage objects (encrypted), session data | US East; EU region for Phase 4 | Required before first customer | Yes (SOC 2 Type 2) |
| **Fly.io** | Application hosting and compute | Application logs (no Case Data); container execution | US regions; selectable | Required before first customer | Pursuing SOC 2 |
| **GitHub** | Source code, CI/CD, release signing | Source code, build artifacts, CI workflow logs (no Case Data) | US (GitHub.com) | GitHub standard DPA | Yes (SOC 2 Type 2) |
| **AWS** *(Phase 2+)* | Hosting, compute (ECS/EKS), RDS/Aurora, S3, KMS | Case Data ciphertext, application execution | us-east-1, us-west-2; GovCloud for Phase 4 | AWS Customer Agreement + DPA | Yes (SOC 2 Type 2; FedRAMP High) |

**Supabase's own subprocessors:** Supabase runs on AWS. The complete subprocessor chain is ChainSight → Supabase → AWS. Ciphertext protection applies at every level. Confirm this chain is accurately described in the DPA with Supabase and that Supabase's sub-processor relationship with AWS is disclosed.

### 19.3 Subprocessor Assessment Process

Before any new subprocessor is added:

1. Vendor completes a security questionnaire (CAIQ or equivalent) kept on file
2. Vendor's most recent SOC 2 Type 2 report is reviewed; material exceptions are noted
3. A Data Processing Agreement is signed before data processing begins
4. General corporate counsel reviews the DPA for GDPR Article 28 / UK DPA consistency
5. Customers are notified 30 days in advance per MSA Section 5A
6. The public Subprocessor List at chainsight.io/subprocessors is updated on the day the new subprocessor begins processing

### 19.4 Migration Event — Fly.io to AWS (Phase 2)

The Fly.io → AWS migration is the most significant subprocessor change in the platform's early lifecycle.

**Customer notification:** 30 days' written notice before migration. The notice includes: (a) what is changing; (b) the effective date; (c) the customer's right to object and, if not accommodated, to terminate without penalty.

**Data residency confirmation:** Confirm that the AWS region assigned to each customer matches their contracted data residency. US customers on us-east-1 or us-west-2; no change in residency without separate notice and consent.

**DPA:** Execute the AWS Customer Agreement DPA addendum before data flows to AWS.

**SOC 2 benefit:** Post-migration, ChainSight can represent to customers and to the SOC 2 auditor that the hosting infrastructure is AWS (SOC 2 Type 2, FedRAMP High, ISO 27001). This substantially strengthens the customer-facing security posture compared to Phase 0 Fly.io.

**Customer communication template:**

> *Subject: ChainSight Infrastructure Update — 30-Day Advance Notice*
>
> As part of our commitment to achieving SOC 2 Type 1 certification, ChainSight is migrating SaaS Blind hosting from Fly.io to Amazon Web Services (AWS), effective [date].
>
> What changes: your case data (encrypted with your KMS keys) will be stored and processed on AWS rather than Fly.io. Neither ChainSight, AWS, nor any other party can read your case data.
>
> What does not change: your data residency region ([region]), your encryption keys, your SLA, and your service terms are unchanged.
>
> If this change is unacceptable and we cannot accommodate your concerns, you may terminate your agreement without penalty per MSA Section 5A.

### 19.5 Source Code Escrow — GitHub vs. Iron Mountain Distinction

GitHub is the working source repository — the live codebase, development history, and CI/CD pipeline. It is not the escrow.

The F44 source code escrow program (Section 9) operates independently:
- Iron Mountain or NCC Group holds versioned static snapshots of the source code
- Snapshots are deposited within 30 days of each major release
- The escrow is independent of GitHub's availability: GitHub outage, acquisition, or account suspension does not affect the escrow
- Triggering events for escrow release are defined in the Escrow Agreement, not in GitHub's ToS

**GitHub ToS risk:** GitHub may suspend or terminate accounts. Mitigations: (a) maintain a mirror repository on a second host (GitLab self-hosted or Gitea) updated on every push; (b) the Iron Mountain/NCC Group escrow protects customers regardless; (c) On-Prem customers hold signed release binaries independently.

**GitHub source code compelled disclosure:** A subpoena to GitHub for ChainSight's repository would expose the source code but not Case Data. ChainSight's posture: methodology is already publicly disclosed; proprietary algorithm specifics should be protected as trade secrets under applicable law (advise outside counsel on which specific algorithms warrant trade secret protection).

---

## 20. Open Questions

The following questions require answers from the founder before critical compliance architecture decisions can be finalized. They are flagged here for the first outside-counsel meeting.

---

**OQ-1: Company Formation Status**

*Question:* Has the company been formally incorporated? If so: in what jurisdiction, and on what date? Has the founder's pre-existing intellectual property (all prior design documents, v0.1–v0.8, schema, etc.) been formally assigned to the company via an IP assignment agreement?

*Why it matters:* If the company is not yet incorporated, the IP assignment is the most time-critical task — any code written before assignment is ambiguous in ownership. Delaware C-Corp is strongly preferred for US-based venture; other structures require explanation.

*Required action:* Founder answers this question before any code is written.

---

**OQ-2: Jurisdiction of Incorporation and Operations**

*Question:* Where is the company incorporated, and where will it be physically based (principal place of business)? Are there any foreign jurisdiction considerations (e.g., founder residing outside the US)?

*Why it matters:* Affects: choice of law in the MSA, state privacy law compliance obligations, ITAR/EAR applicability (see OQ-6), the "US person" determination for export control, and the applicable employment law if contractors are engaged internationally.

---

**OQ-3: Founding Capital and Funding Structure**

*Question:* What is the source and structure of the founding capital? Is the company bootstrapped, angel-funded, or planning a seed round? Are there any existing investors, SAFEs, or convertible notes?

*Why it matters:* D&O insurance timing, board composition, anti-dilution provisions in the escrow and perpetual license terms, and the "material breach allowing escrow release" trigger may need to account for investor rights.

---

**OQ-4: Pre-Existing Customer or Partner Relationships**

*Question:* Are there any existing relationships with law enforcement agencies, compliance teams, private investigators, or other potential customers? Any letters of intent, MOUs, or informal commitments? Any BYOK providers with whom the founder has existing personal relationships that could constitute an informal agreement?

*Why it matters:* Pre-existing relationships may need to be formalized, restructured, or disclosed. A pre-existing relationship with a BYOK provider could create an appearance of non-neutrality that complicates the "vendor-neutral" positioning.

---

**OQ-5: ITAR/EAR Exposure**

*Question:* Does the platform, in its current design, incorporate or export any technology subject to the International Traffic in Arms Regulations (ITAR) or Export Administration Regulations (EAR)? Specifically: (a) any cryptographic technology beyond EAR99 or License Exception ENC; (b) any technology on the Commerce Control List; (c) any relationship with DoD-funded research?

*Why it matters:* Blockchain forensics software is likely EAR-controlled under ECCN 5D002 (information security software) given its encryption components. Export of the platform to non-US persons (including cross-border customer deployments) and to specific countries may require licenses. The sovereign deployment model (customer runs the platform internationally) is an export of the software. This is a federal contracting attorney question, but the preliminary answer affects Phase 0 operations.

*Required action:* Federal contracting counsel (or a specialist export control attorney) should provide a written opinion on EAR classification before international customers are onboarded.

---

**OQ-6: ITAR/EAR and Intelligence Community Customers**

*Question:* Does the founder intend to pursue intelligence community (IC) customers (NSA, CIA, DIA, etc.)? If so, are there ITAR implications beyond EAR that apply to the platform's use in a classified context?

*Why it matters:* IC customers often require ITAR-controlled product versions with export licenses. Building toward IC customers without proper export control counsel is a significant legal risk.

---

**OQ-7: Existing Conflicts of Interest**

*Question:* Does the founder have any existing relationships with blockchain analytics companies (Chainalysis, TRM Labs, Elliptic, Arkham, Crystal, etc.) — employment, advisory, equity, contractual? Any NDAs with prior employers that might cover the concepts in this design pack?

*Why it matters:* Prior employer IP claims and NDA violations are the most common legal risk for technology startups. A "freedom to operate" analysis is required before code is written.

---

**OQ-8: Insurance Broker Preference**

*Question:* Does the founder have an existing broker relationship? Any existing corporate insurance that should be transitioned to the new entity?

---

**OQ-8A: Supabase Enterprise vs. Self-Managed Postgres Decision**

*Question:* Has a decision been made on the Phase 2 AWS migration path — specifically, whether to use Supabase Enterprise (AWS-hosted) or migrate to self-managed Postgres on AWS RDS/Aurora?

*Why it matters:* The two paths have different legal and compliance implications:
- **Supabase Enterprise (AWS-hosted):** Supabase remains a subprocessor with their own DPA. Their Enterprise tier includes a signed BAA, dedicated infrastructure, and SOC 2 Type 2 coverage. This is lower engineering effort but adds a dependency on Supabase's enterprise pricing and terms. Confirm Supabase Enterprise DPA is compatible with CJIS requirements before committing.
- **Self-managed Postgres on AWS RDS:** No Supabase dependency; AWS is the only infrastructure subprocessor for the database layer. Cleaner compliance chain but requires more engineering work (connection pooling, Auth migration away from Supabase Auth, Storage migration away from Supabase Storage). This is the better long-term posture for a FedRAMP path.

*Recommended decision point:* Phase 1 (engineering must plan the migration before Phase 2 begins).

---

**OQ-8B: Fly.io Account and GitHub Organization Status**

*Question:* Are the Fly.io deployment and GitHub organization registered under the company entity, or under the founder's personal accounts?

*Why it matters:* Personal-account infrastructure creates two problems: (a) it is ambiguous whether the company owns the IP generated by that infrastructure; (b) subprocessor DPAs must be held by the company, not an individual. Before the first customer onboards, all infrastructure accounts must be transferred to or re-created under the company entity.

---

**OQ-9: Pilot Customer Profile**

*Question:* Who is the most likely Phase 0 pilot customer — a licensed private investigator, a compliance team at a cryptocurrency exchange, a state law enforcement agency, or something else? The CJIS requirements, MSA structure, and insurance minimums differ meaningfully depending on whether the first customer processes Criminal Justice Information.

*Why it matters:* A compliance team at a VASP does not trigger CJIS requirements; a state law enforcement agency does. This affects the timing of the founder's background check, the MSA addendum requirements, and the CJIS conformance preparation.

---

*End of Document*

---

**Document Maintenance:**
This document should be reviewed and updated at the start of each phase. Material changes to the platform architecture (new features, changed deployment modes, new BYOK providers, subprocessor changes) may create compliance gaps that require updates to this architecture. The owner of this document is the compliance and legal architecture lead working alongside outside counsel.

**Change log:**
- v1.0: Initial complete architecture document
- v1.1: Added SaaS Blind v1 stack specifics (Supabase + GitHub + Fly.io); added MSA Section 5A (Subprocessors); added Exhibit I (Subprocessor List); expanded data residency section with Fly.io/AWS regional specifics; updated SOC 2 scope and timeline to reflect concrete AWS migration prerequisite; added Section 15.2A (subpoenas directed at subprocessors); added Section 18.6 (Phase 2 mandatory milestones); added Section 19 (Subprocessor Registry and Management); added OQ-8A and OQ-8B to Open Questions

**Outside counsel should review:** Sections 2, 3, 5, 5A, 6, 7, 11, 12, 13, 14, 15 before any customer-facing document or MSA is issued. Specifically flag for review: the subprocessor DPA requirements (Section 5A), the Supabase compelled-disclosure defense language (Section 15.2A), and the Supabase-vs-AWS migration decision implications (OQ-8A). This is an architecture document, not a legal opinion. The lawyer fills in the enforceable language; this document specifies what must be covered.
