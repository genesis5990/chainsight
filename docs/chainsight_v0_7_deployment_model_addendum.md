# ChainSight v0.7 — Deployment Model & Sovereignty

> **Founding decision (locked):** ChainSight ships from day one in two deployment modes — **On-Premises (Sovereign)** and **Managed SaaS (Blind)** — both BYOK, both with the agency maintaining complete operational privacy from ChainSight the vendor.
>
> This is not a v2 enterprise feature added on top of a SaaS-first product. It is the founding deployment posture from Phase 0. Every other architectural decision in the design pack must remain compatible with both modes.

This addendum supersedes any prior text that implied a SaaS-first or cloud-first default. Pillar 3 (BYOK Provider & Storage Marketplace) is now joined by a fourth principle: **Sovereign Deployment**.

---

## Part 1 — The two deployment modes

### 1.1 Mode A — On-Premises Sovereign

The agency downloads ChainSight as a self-contained software package and runs it entirely within their own infrastructure. The vendor (ChainSight) has zero operational visibility into their work.

**What "self-contained" means:**

- Full backend stack delivered as containerized services (Docker / OCI images) or VM images
- Agency provides their own compute, storage, network, identity, and key management
- All databases (Postgres, Redis, vector store, graph store) run on agency infrastructure
- All AI model inference runs on agency infrastructure (local Llama/Qwen on agency GPUs, or BYOK API calls to commercial LLMs through the agency's own keys)
- All BYOK provider integrations route through the agency's network egress
- The agency owns all logs, telemetry, audit trails, evidence storage
- ChainSight the vendor cannot reach the deployment over the network

**What leaves the agency's control:**

- Only the **outbound BYOK API calls** the agency themselves configured (Etherscan, Chainalysis, TRM, etc.) — through the agency's own commercial keys, on the agency's own egress
- Nothing else. No telemetry to the vendor. No usage stats. No error reporting. No license phone-home (see Part 4 for licensing).

**Air-gapped variant:**

- For classified or fully sovereign deployments, the agency disables all outbound network paths
- Tracing uses the agency's own mirrored blockchain nodes and on-prem attribution data
- AI inference is 100% local (no commercial LLM API calls)
- Software updates arrive as signed offline packages on physical media

### 1.2 Mode B — Managed SaaS Blind

The agency uses ChainSight's hosted backend. The vendor runs the infrastructure but is **architecturally blind** to the agency's case data, queries, and findings.

**What "blind" means:**

The vendor operates a multi-tenant service, but the system is designed so the vendor's operations team cannot read any agency's case data, even with full infrastructure access. This is a technical guarantee, not a policy promise.

How it works:

- **Per-agency encryption keys** held in the agency's own KMS/HSM (the agency provisions and controls them — the vendor never sees the keys in cleartext)
- **Client-side envelope encryption** — case data is encrypted on the investigator's device or in the agency's auth-token-scoped session before it reaches the vendor's storage
- **Searchable encryption / encrypted indexes** where possible (so query patterns are also opaque to the vendor)
- **Confidential computing where applicable** — sensitive workloads run inside Intel TDX / AMD SEV-SNP / AWS Nitro Enclaves so even vendor infrastructure operators cannot inspect process memory
- **Vendor support access is opt-in, time-boxed, and audited by the agency** — when an agency requests support, they grant a scoped, expiring access token; every action the vendor takes is logged to the agency's audit trail in real time; the agency can revoke at any moment
- **Telemetry minimized and opt-in** — by default the vendor sees only what's required to bill (count of active seats, aggregate uptime/error rate, gross billing-relevant API volume — none of it tied to case content)

**What the vendor sees (deliberately minimal):**

- Service health metrics (latency, error rates, resource consumption — at aggregated tenant level)
- Billing-relevant counters (seat count, billing-tier feature usage)
- Software version + region (for support routing)
- Nothing about cases, addresses, transactions, findings, attributions, paths, reports, or investigators' work

**What the vendor cannot see:**

- Case names, IOCs, addresses, transactions, attributions, paths, reports, memos, marks, documents, deconfliction entries, personal attributions, query logs, Belief State contents, Reproducibility Pack contents, investigator identities, suspect identities, victim identities, or any provider responses

### 1.3 Migration between modes

The two modes are **architecturally identical above the persistence layer**. An agency can:

- **Start on Managed SaaS** for a pilot or low-classification work
- **Migrate to On-Premises Sovereign** as their classification or scale demands change
- **Run both simultaneously** — different cases in different deployments, with case-export portability via the Reproducibility Pack format

The migration path is documented and supported as a first-class workflow, not an afterthought.

---

## Part 2 — The trust architecture

### 2.1 What "blind" requires technically

Building a Managed SaaS that the vendor genuinely cannot read is harder than it sounds. Most SaaS products that claim end-to-end encryption either lie about it or break it silently. We commit to doing it correctly, which requires specific technical choices:

**Encryption hierarchy:**

- Agency KMS root key (never leaves agency control)
- Per-tenant DEKs derived from the root key (envelope-encrypted)
- Per-case DEKs derived from the tenant DEK (also envelope-encrypted)
- Per-document DEKs for evidence-grade artifacts (also envelope-encrypted)

Every encryption operation traces back to a key the agency controls. The vendor's database contains ciphertext only.

**Encrypted indexes:**

- Searchable symmetric encryption (SSE) schemes for keyword search over case data
- Order-preserving encryption (OPE) where needed for range queries
- Bloom-filtered indexes for deconfliction (already designed this way in v0.5 F1)
- Acknowledged tradeoffs: encrypted search leaks some access patterns; we document what does and doesn't leak

**Trusted execution:**

- Hot-path operations that _must_ touch plaintext (e.g. Belief State Service reads/writes during active investigation) run in confidential computing enclaves
- The enclave attests its code to the agency before receiving the data-encryption key
- The agency can verify the attestation and refuse if it doesn't match the published code hash

**Verifiable builds:**

- Every release is built reproducibly from public source
- Release binaries are signed
- The signing certificate's public key is committed to a transparency log
- Agencies (or third parties) can rebuild from source and verify the binary matches what they're deploying — for both On-Prem and SaaS

### 2.2 What "sovereign" requires architecturally

On-Premises deployment requires every component to run without vendor connectivity:

- **No mandatory phone-home** for license validation (see Part 4)
- **No mandatory update channel** — updates arrive as signed packages; agency chooses when and whether to apply
- **No mandatory telemetry** — every observability signal is local; opt-in transmission only with explicit agency consent
- **No mandatory cloud services** — every dependency has a self-hostable form
- **No mandatory third-party SaaS** in the critical path — the platform works with only the BYOK providers the agency chose to wire

Where vendor connectivity _would_ add value (auto-update channels, telemetry-driven support, federated deconfliction, cross-agency Personal Attribution networks), it remains **strictly opt-in** with the agency in full control of the toggle.

### 2.3 What "blind support" means in practice

When an agency on Managed SaaS needs support, the workflow is:

1. Agency contacts vendor support describing the issue (without sharing case data)
2. Vendor support requests a scoped access grant
3. Agency admin reviews the request and grants a time-boxed, capability-scoped token
4. Vendor support performs only the actions covered by the scope
5. Every action by the vendor is logged in real time to the agency's audit trail (the agency sees what the vendor is doing as the vendor is doing it)
6. Access token expires automatically; vendor cannot extend without a new grant
7. Agency can revoke instantly at any point

This is structurally similar to how the better cloud providers handle "customer-managed support access" — the difference is that ChainSight commits to it as the default support model from day one, not as an enterprise upgrade.

---

## Part 3 — Pillar 4: Sovereign Deployment

Adding to the three pillars locked in v0.6:

### Pillar 4 — Sovereign Deployment

ChainSight ships in two modes from day one. **On-Premises Sovereign** runs entirely inside the agency's infrastructure with no vendor connectivity. **Managed SaaS Blind** uses vendor-operated infrastructure with architectural guarantees that the vendor cannot read agency case data. Both modes are BYOK. Both modes give the agency full operational privacy. Migration between modes is a first-class workflow.

**The four pillars together** — Belief State (accuracy), Reproducibility Pack (court-defensibility), BYOK Provider & Storage Marketplace (commercial leverage), and Sovereign Deployment (trust) — define why ChainSight exists when Chainalysis, TRM, and Elliptic already do.

Each addresses a real gap none of the incumbents solve well. Sovereign Deployment in particular is the gap that matters most to federal LE, intelligence community, and high-classification financial-crime customers — the same customers that drive the highest contract values and the longest renewals.

---

## Part 4 — Licensing model

Sovereign deployment changes how licensing works.

### 4.1 The two license families

**On-Premises Sovereign License**

- Perpetual license for the version delivered, plus a support/update subscription
- Offline license activation (cryptographic license certificates signed by the vendor, validated locally — no phone-home required)
- License keys carry feature flags and seat counts the agency provisions internally
- Update subscription gates access to new versions; expiration does not break running deployments
- Air-gapped update path: signed packages delivered via physical media or one-way diode

**Managed SaaS Blind License**

- Subscription model (per-seat / per-case / per-tier)
- Billing telemetry is the absolute minimum — count of active seats, billing-tier flag, gross volume buckets for capacity planning
- No usage-data resale, ever. Codified in the master agreement.
- Customer can request a "billing audit pack" showing exactly what billing data the vendor has on them

### 4.2 What we deliberately do NOT do

These are anti-patterns common to enterprise software that we commit against in writing:

- **No silent telemetry.** Every byte of telemetry is documented; opt-in toggles are real, not theater.
- **No mandatory cloud features.** No "this feature only works if you're on our cloud" except where the feature is intrinsically multi-tenant (e.g. cross-agency federation).
- **No usage-driven sales targeting.** The vendor sales team does not see which features an agency uses heavily and email them with upsells based on that data — because the vendor does not have that data.
- **No "trust us" claims about access.** Every privacy guarantee is enforceable by the agency through the technical controls (encryption, attestation, audit logs they own).
- **No phone-home for licensing.** Licenses validate locally with signed certificates.
- **No dark patterns in support access.** Vendor support requests are explicit, scoped, audited, revocable.

---

## Part 5 — Implications for the design pack

This decision touches almost every prior addendum. The most important downstream implications:

### 5.1 BYOK Provider & Storage Marketplace (Pillar 3)

Already designed for both modes. No changes required — the capability router, the agency-held credentials, the encrypted-storage abstraction, and the storage backend interchangeability (cloud / on-prem / hybrid) were all built with sovereignty in mind. **G9** (BYOK + Storage) and Pillar 4 are mutually reinforcing.

### 5.2 The Cache Layer (Feature 9)

Already designed per-agency-scoped, with case-level isolation. On-Premises: cache lives in agency infrastructure (Redis on agency hardware). SaaS Blind: cache lives in vendor infrastructure but encrypted with per-tenant DEKs the vendor cannot read. No design changes required.

### 5.3 Belief State Service (Pillar 1)

On-Premises: runs on agency hardware. SaaS Blind: runs in confidential computing enclaves with per-tenant DEKs. The schema doesn't change; the deployment surface does.

### 5.4 Reproducibility Packs (Pillar 2)

Both modes produce identical Reproducibility Packs. The Pack format itself is deployment-neutral — that's why a case can migrate between modes. No changes required.

### 5.5 AI orchestration

On-Premises: BYOK LLM calls through the agency's keys (Anthropic, OpenAI, etc.) OR fully local inference on agency GPUs (Llama, Qwen, fine-tuned variants). Air-gapped: local-only. SaaS Blind: BYOK LLM calls through the agency's keys, brokered through the vendor's enclave layer so the vendor still doesn't see the content. The architecture supports all of this — the prompt orchestrator was already capability-routed (Pillar 3).

### 5.6 Document storage (v0.5 F2)

Already designed with swappable storage backends. On-Premises: agency picks MinIO / Ceph / NFS. SaaS Blind: vendor-managed object storage with per-tenant envelope encryption the vendor cannot read. No changes required.

### 5.7 Cross-agency federation (deconfliction, personal attribution sharing)

These are inherently multi-deployment features. The federated index uses privacy-preserving primitives (hashed indicators, Bloom filters, differential privacy) so even cross-agency information exchange respects sovereignty. On-Premises agencies can opt into the federation through dedicated outbound endpoints; SaaS Blind agencies participate through the vendor's federation service, which still cannot read case content because the exchanged indicators are hashed.

### 5.8 Court Mode (v0.5 F3)

Already designed to run from the frozen Reproducibility Pack with no network calls during presentation. Identical in both modes. The Court Export Bundle is portable to any courtroom machine.

### 5.9 Personal Attribution (v0.6 F25)

Already designed with agency-scoped privacy. The four visibility tiers (private / specific users / team / org) work identically in both modes. Cross-agency federation is the only tier that differs in mechanism between On-Prem and SaaS Blind — the privacy-preserving primitives handle both.

### 5.10 Updates and maintenance

- **On-Premises**: agency-controlled update cadence; signed packages; verifiable builds; rollback supported
- **SaaS Blind**: vendor-managed but per-tenant pinned versions; agencies can defer updates; rollouts staged with explicit per-tenant opt-in

---

## Part 6 — Commercial framing (the updated elevator pitch)

> ChainSight is the autonomous, court-defensible blockchain investigation platform. It connects to **your existing data subscriptions** — Chainalysis, TRM, Elliptic, Etherscan, Allium, your own RPC nodes — and adds the AI agent layer, the multi-methodology accounting engine, the reproducibility-guaranteed reporting, and the cross-investigator collaboration that turn raw data into court-grade evidence.
>
> **Deploy it your way.** Run it entirely inside your own infrastructure, with zero vendor visibility into your work. Or use our hosted backend, where we operate the service but cannot read your case data, by design. Both modes are BYOK. Both modes give you complete operational privacy. The vendor is never a counterparty to your investigation.
>
> **You bring your data deals. You bring your sovereignty. We bring the engine.**

This is what closes the federal and intelligence-community deals that the incumbents struggle with — and it does so without sacrificing the smaller customers who can't host their own infrastructure but still want privacy guarantees.

---

## Part 7 — Open questions

**G21 (new).** Air-gapped deployment update path: physical media (USB / DVD) acceptable to the federal customer profile, or do we need to support one-way diode network paths (NIPR ↔ SIPR style transfers)? Likely both — diode for the largest customers, physical media for everyone else. Confirm with first pilot.

**G22 (new).** Confidential computing dependency: do we require Intel TDX / AMD SEV-SNP / AWS Nitro Enclaves for SaaS Blind from launch, or do we ship with strong envelope encryption as the v1 guarantee and add confidential computing as a v2 enhancement? My lean: ship with envelope encryption + audited support access as the v1 floor; add confidential computing as a Phase 3 hardening milestone, before federal certification work. Aggressive customers (intelligence community, financial crime units of major banks) will wait; everyone else gets a privacy posture better than any incumbent on day one.

**G23 (new).** Verifiable build infrastructure: do we run our own transparency log or use an existing one (Sigstore, Rekor, OpenPubkey)? Lean: use Sigstore from the start; lower friction, broader adoption, no need to operate our own log.

---

## Part 8 — Updated pillars (the four)

Locked through v0.7:

| #     | Pillar                                            | What it guarantees                                                                            |
| ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **1** | Belief State Service                              | Accuracy — every AI claim is provenanced, tiered, challengeable                               |
| **2** | Reproducibility Pack                              | Court-defensibility — every report replays bit-for-bit forever                                |
| **3** | BYOK Provider & Storage Marketplace + Cache Layer | Commercial leverage — agencies use their existing data deals; spend is controlled and visible |
| **4** | Sovereign Deployment (On-Prem + SaaS Blind)       | Trust — agencies retain operational privacy regardless of deployment mode                     |

The top-level product principle ("So Easy a Caveman Can Do It / Uncompromising sophistication beneath") still sits above all four as the design tiebreaker.

---

## Part 9 — Updated phasing

Sovereign Deployment is not a Phase 4 feature. It is Phase 0.

| Phase       | Sovereignty additions                                                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | **Both deployment modes ship from day one**. On-Premises installer (Docker Compose + Helm chart for Kubernetes); SaaS Blind backend with per-tenant envelope encryption + agency-held KMS root keys; offline license validation; signed releases with Sigstore-backed transparency log; minimal-by-default telemetry with opt-in toggles. |
| **Phase 1** | Air-gapped deployment hardening (signed package update path, no outbound paths required); audited support access workflow (scoped time-boxed tokens, real-time agency-visible action logs); reproducible builds documented and verified by an external auditor.                                                                           |
| **Phase 2** | Confidential computing pilot in SaaS Blind (Nitro Enclaves first because broadest cloud availability); per-tenant pinned versions in SaaS so each agency controls their own update cadence; verifiable-build verification tooling shipped to customers.                                                                                   |
| **Phase 3** | Confidential computing across the SaaS Blind hot path (Belief State, Math Service, Inspector orchestration); SOC2 Type 2 completed; FedRAMP work begun in earnest now that the architecture supports both Moderate and High.                                                                                                              |
| **Phase 4** | FedRAMP High; CJIS conformance; IL5/IL6 path for the most sensitive federal customers; cross-deployment federation primitives (privacy-preserving deconfliction + personal attribution sharing between On-Prem and SaaS Blind tenants).                                                                                                   |

---

## Part 10 — Document index update

The thirteen documents in the design pack now include this addendum:

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
13. `chainsight_v0_6_consolidated.md`
14. `chainsight_v0_7_deployment_model_addendum.md` _(this file)_

The v0.7 consolidated reference will follow when the next batch of locked decisions warrants it. Until then, this file is the canonical statement of the deployment model.

---

## Closing

This is the decision that turns ChainSight from "good blockchain forensics platform" into "the only blockchain forensics platform a sovereign customer can deploy without compromise."

The incumbents (Chainalysis, TRM, Elliptic, Crystal, Arkham) are all SaaS-first. They have on-prem options at the highest enterprise tiers, but those are afterthoughts built on a SaaS-native architecture, not first-class deployment targets. Their "blind support" claims are policy, not technical guarantees. Their telemetry is opaque to customers.

ChainSight starts where they end up. That posture, more than any single feature, is what makes a federal LE deal closable.
