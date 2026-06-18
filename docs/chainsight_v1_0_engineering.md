# ChainSight v1.0 — Consolidated Engineering Document

> **Audience:** A single developer working with AI assistance, building toward a SaaS Blind first launch with On-Premises Sovereign as a fast-follow. This document is the canonical engineering reference. It consolidates the eighteen prior design documents into one buildable spec.
>
> **Build posture (locked):** SaaS Blind first; On-Prem Sovereign second; both architecturally compatible from day one; solo developer + AI agents executing.
>
> **Operating principle:** Every decision in this document is optimized for one person to ship. That means strong defaults, minimal premature abstraction, pragmatic technology picks, and clear "build this first, then this" sequencing. The deep architecture (four pillars, sovereignty, multi-methodology accounting, etc.) is preserved — but the *implementation path* assumes one developer, not a team.

---

## Part 1 — What we're building (in one paragraph)

ChainSight is an autonomous, court-defensible blockchain investigation platform. Investigators paste IOCs, drop documents, and click through a transaction-centric graph. AI agents handle tracing, attribution, swap/bridge decoding, obfuscation detection, and report drafting. Every claim is provenanced, every number deterministic, every output replayable. Agencies bring their own data subscriptions (BYOK) and run on their infrastructure (sovereign) or ours (blind). The vendor is never a counterparty to the investigation.

---

## Part 2 — The four pillars (the non-negotiables)

| # | Pillar | Implementation impact |
|---|---|---|
| **1** | Belief State Service | Postgres + event sourcing. Every AI/agent action emits BeliefAtoms. No private knowledge in any agent. |
| **2** | Reproducibility Pack | Content-hashed bundles per case. Frozen provider responses, rule versions, model cards, SBS history. `replay.sh` reconstructs identical output. |
| **3** | BYOK Provider & Storage Marketplace + Cache + In-House Heuristics | Capability router. No vendor names in business logic. Multi-tier cache. Baseline that works with zero external providers. |
| **4** | Sovereign Deployment | Same codebase ships SaaS Blind and On-Prem. Per-agency KMS keys, envelope encryption, audited support access, no phone-home. |

These cannot be deferred or shortcut for v1. Every other decision must check compatibility with them.

---

## Part 3 — The technology stack (locked picks)

Picking technologies upfront for a solo developer reduces decision fatigue. Each pick is justified, and each is replaceable later if needed.

### Backend
- **Language:** TypeScript (Node.js) for the application layer; **Python** for the math service and ML pipelines.
- **Runtime:** Node 22 LTS; Python 3.12.
- **Application framework:** Fastify (Node) — faster than Express, better TypeScript ergonomics, smaller surface to learn.
- **API style:** REST for public-facing; tRPC for internal browser↔backend (type-safe with zero schema duplication).
- **Job queue:** BullMQ (Redis-backed) — simple, well-documented, no separate broker.
- **Math service:** Python + FastAPI, communicating via gRPC for performance on hot-path math, REST for everything else.

### Storage
- **Primary database (SaaS Blind v1):** **Supabase** managed Postgres 16+ with heavy RLS for per-tenant isolation; per-case row-level encryption layered on top via libsodium so Supabase sees only ciphertext.
- **Primary database (On-Prem):** Self-hosted PostgreSQL 16. Same schema, same RLS, same encryption.
- **Vector store:** pgvector extension. Same Postgres instance until volume forces a split.
- **Cache:** Redis. Cache layer, BullMQ backing, session storage.
- **Graph store:** **Memgraph** (not TigerGraph). Memgraph is open-core, easier for a solo dev to operate, and benchmarks competitively with Neo4j/TigerGraph for the depth of traversal we need (<100 hops typical).
- **Object storage:** **Supabase Storage** for SaaS Blind v1; MinIO/Ceph/NFS for On-Prem. Both behind the same storage backend interface (v0.5 F2).
- **Auth:** **Supabase Auth** for SaaS Blind v1 (TOTP + WebAuthn); self-hosted Ory Kratos or equivalent for On-Prem.
- **Realtime:** Supabase Realtime for deconfliction/watcher/presence events; canvas CRDT stays on Yjs over WebSocket in Phase 2+.
- **Search:** Postgres full-text + pgvector for v1. Add OpenSearch only if/when needed.

### Frontend
- **Framework:** Next.js 15 (App Router) with React 19.
- **Styling:** Tailwind CSS + shadcn/ui components.
- **State:** Zustand for local state. React Query for server state. Yjs for CRDT collaboration (Phase 2+).
- **Canvas rendering:** **Sigma.js v3** (WebGL) for the graph canvas. Sigma is the right pick for solo dev — simpler than PixiJS, designed for graph visualization, handles 10k+ nodes.
- **Charts:** Recharts for standard charts; D3 for the Sankey value-flow view.
- **Forms & validation:** Zod schemas everywhere, react-hook-form for forms.

### AI/ML
- **Orchestrator default:** Claude Opus 4.6 (BYOK). Fallback: GPT-5.4, Gemini 3.1 Pro, DeepSeek V4 Pro Max.
- **Specialist SLMs:** Phi-4 (14B) and Qwen 3.5 8B, fine-tuned with LoRA via HuggingFace PEFT + Unsloth.
- **Agent framework:** Build directly on the Anthropic SDK and OpenAI SDK; do not adopt LangGraph/LangChain. They add abstraction without commensurate value for a solo dev. The Belief State Service is the agent coordination layer.
- **Inference runtime (self-hosted models):** Ollama for local dev; vLLM for production. NVIDIA NIM only if we hit a customer who requires it.
- **Embeddings:** Voyage AI default (BYOK); BGE self-hosted alternative.
- **Document intelligence:** AWS Textract default; Unstructured.io as the open fallback.
- **RAG framework:** Custom thin wrapper over pgvector. Not LlamaIndex; we want full control over chunking, retrieval, and grounding-check loops.

### Security & Sovereignty
- **Auth:** **Supabase Auth** for SaaS Blind v1 (founder's existing account); migrate to self-hosted (Ory Kratos or our own) before On-Prem ships. The On-Prem deployment never depends on Supabase Auth.
- **MFA:** TOTP minimum; WebAuthn for hardware-key support; required for high-impact actions.
- **KMS:** AWS KMS for SaaS Blind v1 (**independent of Supabase** — Supabase never sees the agency root keys); HashiCorp Vault for On-Prem and customer-provided KMS.
- **Encryption:** Envelope encryption with per-case DEKs. libsodium for application-layer crypto. **All sensitive case data is encrypted before being written to Supabase**, defending against compelled disclosure from Supabase, GitHub, Fly.io, or us.
- **Audit log:** Append-only Postgres table with hash-chained entries; mirrored to Supabase Storage with Object Lock semantics in SaaS Blind v1, S3 Object Lock in On-Prem; optional public-chain anchoring at case-close.
- **Signing:** Sigstore for release artifacts via GitHub Actions.
- **Trust boundary disclosure:** The MSA and customer-facing docs honestly disclose that SaaS Blind v1's infrastructure providers are **Supabase, GitHub, and Fly.io**. The encryption architecture defends against compelled disclosure from any of them, but the trust boundary is what it is. Customers requiring zero third-party trust deploy On-Prem.

### DevOps
- **Containerization:** Docker. Compose for local dev. Helm chart for K8s deployment.
- **CI/CD:** **GitHub Actions** (founder's existing account) with self-hosted runners for sensitive workloads. **Supabase preview branches** per PR; per-PR **Fly.io review apps**. Sigstore release signing.
- **Hosting (SaaS Blind v1):** **Fly.io** for Fastify API, BullMQ workers, Python Math Service, Memgraph (on Fly volumes). Scale-to-zero for low-usage cost efficiency.
- **Hosting (SaaS Blind v2 / Phase 2+):** Migrate to AWS (RDS + S3 + ECS Fargate or EKS) during Phase 2 for SOC 2 / FedRAMP readiness.
- **Observability:** OpenTelemetry traces; Grafana + Tempo + Loki stack. Self-hostable for sovereign deployments.
- **Infra-as-code:** Terraform for AWS; Helm + Kustomize for K8s.

### Monorepo structure
A single Turborepo monorepo. Justified for solo dev: one repo, one CI, one deploy pipeline, shared TypeScript types end-to-end.

```
/chainsight
  /apps
    /web              Next.js frontend
    /api              Fastify backend
    /worker           BullMQ workers
    /math             Python FastAPI service
  /packages
    /shared-types     TypeScript types shared everywhere
    /belief-state    Belief State Service client
    /capability-router  Provider routing
    /agents          Agent definitions
    /reproducibility Pack builder
    /math-client     gRPC client for math service
  /infra
    /docker
    /helm
    /terraform
  /tools
    /eval            ML evaluation harness
    /fine-tune       Training pipelines
```

---

## Part 4 — The build sequence (Phase 0, weeks 1-8)

Solo developer execution requires ruthless sequencing. Here's the literal week-by-week build path for Phase 0:

### Week 1-2: Foundations
- Monorepo scaffolding (Turborepo, TypeScript, base CI)
- **Supabase project provisioned**; local Supabase emulator (`supabase start`) for development; Memgraph + Redis via Docker Compose for local dev (these are not in Supabase)
- **Supabase Auth** wired with basic agency/user/case multi-tenancy; **RLS policies** for tenant isolation
- Empty Next.js app with a placeholder canvas, deployed to a **Fly.io review app**
- Fastify backend with `/health`, `/cases` endpoints, deployed to **Fly.io**
- Belief State Service v0: just the table schema and insert/query helpers

### Week 3-4: Capability Router + first chain integration
- Capability Router pattern (`router.resolve(capability, args)`)
- First provider: Etherscan V2 API (single key, no marketplace UI yet)
- Pull Ethereum tx by hash; render as a single TransactionNode + AddressNode pair
- Math Service skeleton (Python + FastAPI + gRPC); first endpoint: `compute_value_at_block`
- Cache layer v0: just immutable chain data, Redis-backed

### Week 5-6: Transaction-centric graph + Inspector skeleton
- Graph data model in Postgres (AddressNode, TransactionNode, Edge tables)
- Sigma.js canvas rendering an address→tx→address chain
- Transaction Inspector: click a tx, see structured facts (Section 1-2 only)
- One LLM call wired: plain-language summary via Claude Opus 4.6 (BYOK)
- Verifier Agent v0: citation-token enforcement check

### Week 7-8: Reproducibility + chain-of-custody foundation
- Reproducibility Pack v0: build a `.zip` from frozen Postgres rows + cached provider responses
- Chain-of-custody table with hash-chained events
- Audit log infrastructure
- Sigstore-signed release pipeline
- Phase 0 demo: paste an Ethereum tx hash, see Inspector populate, export Pack, verify hash chain

**Phase 0 deliverable:** A single-developer can demonstrate end-to-end: a tx hash → transaction-centric graph → AI summary → Reproducibility Pack export → replay produces identical output. Everything else builds on this skeleton.

---

## Part 5 — What's deferred and why

Solo developer means strict prioritization. The following are designed (in the prior 18 documents) but explicitly **not built in Phase 0**:

| Deferred to | Why |
|---|---|
| **Multi-chain (Bitcoin, Solana, etc.)** → Phase 1 | Get the Ethereum path perfect first; Bitcoin UTXO model is structurally different and deserves dedicated attention |
| **Real BYOK Provider Marketplace UI** → Phase 1 | Phase 0 uses one Etherscan key in env var; marketplace UI built once we have 2+ providers wired |
| **Full agent layer** → Phase 2 | Phase 0 wires one LLM call (Inspector summary). Critic, Tracer, Bridge, Swap agents follow once orchestrator pattern is proven |
| **Mobile** → Phase 1 (read-only) / Phase 2 (field capture) | Desktop-first; responsive design built into web from day one means mobile is mostly free later |
| **On-Prem installer** → Phase 1 | SaaS Blind ships first; On-Prem is the same code with different deployment config |
| **Confidential computing** → Phase 3 | Envelope encryption + audited support access is the v1 floor (per G22 lean) |
| **All certifications** → Phased per F42 | SOC 2 Type 1 by end of Phase 2 |

This deferral list is not aspiration; it's a contract with reality. Solo dev who tries to build Phase 4 features in Phase 0 ships nothing.

---

## Part 6 — The data model (canonical, simplified for v1)

This is the minimum viable data model that supports the four pillars. Full schemas are in the discipline addenda (Data Engineering).

```typescript
// === Tenancy ===
Agency { id, name, kms_key_ref, settings }
User { id, agency_id, email, role, mfa_enrolled_at }
SupervisoryRole { user_id, scope, permissions }

// === Case ===
Case { id, agency_id, codename, status, classification, created_by, ...narrative fields }
IOC { id, case_id, value, chain, type }

// === Graph (transaction-centric) ===
AddressNode { id, chain, address, normalized_address, first_seen_at, last_seen_at }
TransactionNode { id, chain, tx_hash, block_height, timestamp, status, fee }
Edge { id, from_node_id, to_node_id, edge_type, value, token, position_in_tx }

// === Belief State (event-sourced) ===
BeliefAtom {
  id, case_id, subject_type, subject_ref, predicate, object,
  confidence, tier, // T0|T1|T2|T3
  provenance_json, derivation_json,
  status, // asserted|challenged|retracted|court_grade
  signoff_id, // mandatory for court_grade attribution per G1
  superseded_by, retracted_by,
  created_by, created_at,
  content_hash, prior_event_hash
}

// === Provider layer ===
ProviderDefinition { id, category, capabilities, ... } // shipped catalog
AgencyProviderInstall { id, agency_id, provider_id, credential_ref, scope, budget }
CacheEntry { cache_key, capability, args_hash, payload, fetched_at, ttl_tier, scope, expires_at }
ProviderResolution { case_id, capability, resolved_install_id, ts } // audit

// === Documents & evidence ===
CaseDocument { id, case_id, filename, document_type, storage_ref, content_hash, encryption_ref, extraction_status }
ChainOfCustodyRecord { id, artifact_ref, events_json, prior_record_hash, this_record_hash }
CustodyEvent { event_type, actor, ts, authority, recipient, hash_at_event }

// === Tracing artifacts ===
TracePath { id, case_id, name, color, status, ordered_steps_json, content_hash, signoff_id, supersedes }
Wallet { id, case_id, name, addresses, analysis_status }
UTXOCluster { id, case_id, seed_address, member_addresses, change_detection_json, content_hash }
PersonalAttribution { id, attributor_id, target_ref, label, category, confidence, visibility }

// === Reports & reproducibility ===
Report { id, case_id, template, draft_md, finalized_at, signoff_id, repro_pack_ref }
ReproducibilityPack { id, case_id, content_hash, manifest_json, s3_ref, replay_script_ref }

// === AI ===
LLMProviderInstall { id, agency_id, provider_id, credential_ref, model_assignments_json }
ModelCard { id, model_id, version, prompt_template_hash, sampling_params_json }
AgentCall { id, case_id, agent_name, model_card_id, inputs_hash, outputs_hash, ts, cost }

// === Audit ===
AuditLogEntry { id, actor, action, target_ref, ts, prior_hash, this_hash }
```

Every table that holds case data is encrypted at the row level with the case DEK. The KMS root key is the agency's; we never hold it in cleartext.

---

## Part 7 — The questions that still need answering

Even after eighteen documents and this consolidation, there are decisions that benefit from explicit answers before code is written. The discipline agents will each surface more specific questions for their domain; here are the cross-cutting ones I need clarity on:

### Q1 — Pilot customer profile
The packaging framework (F46) defines five tiers, but Phase 0 builds against one. Given "SaaS Blind first, solo developer," which is the right Phase 0 target?

- **Solo private investigator / forensic accountant** (Investigator tier) — lowest bar to entry, fastest feedback loop, but lowest contract value
- **Small private compliance team** (Team tier) — moderate complexity, mid contract value, good signal for product-market fit
- **Small task force or local LE unit** (Department tier) — high credibility if landed, but longer sales cycle and procurement complexity

My instinct: **start with the Investigator tier** for v0 pilot — fastest iteration, most direct user feedback. The architecture supports scaling up. But you may have a specific prospect in mind already.

### Q2 — First chain after Ethereum
Phase 1 expands beyond Ethereum. Which is the second chain we wire?

- **Bitcoin** — most important for many investigation types, structurally different (UTXO), forces us to validate the unified graph model early
- **Tron** — high stablecoin volume; many pig-butchering and ransomware cases live here
- **Base / Arbitrum / Optimism** — all share Etherscan-family APIs with Ethereum; lowest engineering lift; biggest L2 footprint

My instinct: **Bitcoin second**, then the Etherscan-family L2s in a batch (they're nearly free). Tron in Phase 2.

### Q3 — Naming
"ChainSight" has been the working codename throughout. Is it the real name, or do we need a brand discovery?

If real, we lock domain acquisition, trademark filing, and brand assets now.

### Q4 — Hosting choice for SaaS Blind v1
The locked stack says Fly.io for Phase 0 (matches your existing infrastructure familiarity), AWS for Phase 2+. Is that right?

Alternative: **start on AWS from day 1.** Higher complexity but no migration later. SOC 2 work starts simpler.

My instinct: **Fly.io for Phase 0** to maximize shipping speed; **migrate to AWS during Phase 1** when SOC 2 prep starts. Fly.io is excellent for solo-dev velocity but isn't a SOC 2 / FedRAMP path on its own.

### Q5 — Open-source posture
F45 commits to "open-source the periphery" (connectors, detectors, Pack viewers) while keeping the core proprietary. Do we open-source from day 1, or build closed and open later?

My instinct: **build closed in Phase 0**, open the periphery at Phase 2 launch (when there's something for the community to use). Open-sourcing too early creates support burden before product-market fit.

### Q6 — License model
Closed-source SaaS Blind is straightforward. On-Prem licensing is more complex. Options:

- **Commercial license only** — On-Prem customers receive a binary + license certificate; source not provided except via the F44 escrow program
- **Source-available license** (BUSL-style) — On-Prem customers can read source, can modify for internal use, cannot redistribute or operate as a competing service. Converts to open source after N years.
- **Open core** — Periphery (per F45) is true open source; core remains commercial.

My instinct: **open core + commercial license for the core** in v1. Source-available for the core in v2 if customer demand drives it.

### Q7 — Pricing anchor for the pilot
F46 defers pricing to GTM, but Phase 0 pilot needs *some* number. What's the pilot's monetary structure?

- Free pilot, paid conversion at Phase 1
- Paid pilot at reduced rate (e.g., $500-2000/month for 90 days, converts to full price)
- Paid pilot at full price (proves willingness to pay; weeds out non-serious prospects)

My instinct: **paid pilot at reduced rate** with a written conversion plan. Free pilots get less feedback because the customer hasn't invested.

### Q8 — Founding entity status
Has the founding company been formed? Are there cofounders? Is there outside capital? This affects the legal architecture timing (F43), the certification roadmap (F42), and whether some of the deferred work is realistic.

My instinct (need your confirmation): solo developer building toward proof-of-concept; entity formation and capitalization decisions on the runway to Phase 1.

### Q9 — Specific compliance hard requirements
Are there any compliance/certification requirements from a specific customer or partner that we have to hit by a specific date? (e.g., a pilot prospect that requires SOC 2 Type 1 by Q4 2026?)

My instinct: none yet; certifications follow the F42 roadmap. But this is the kind of thing that, if exists, forces a re-sequence.

### Q10 — Founding team and capitalization (the elephant)
Eighteen documents of design implies eventually building a real team. What's the realistic 12-month picture: solo throughout? hire one engineer at Phase 1? raise seed at Phase 2?

This shapes how much of the deferred work needs to fit in the engineering doc vs. live as a future-team artifact.

---

## Part 8 — Discipline agent assignments

Eight discipline agents will run in parallel against this document plus the full design pack. Each will produce a deep-pass (~20-30 page) discipline-specific design. The eight:

1. **Backend Architecture** — service decomposition, API contracts, message schemas, persistence patterns, performance targets
2. **AI/ML Engineering** — agent orchestration, model routing, fine-tuning pipelines, RAG indexes, evaluation harness, Critic/Verifier
3. **Data Engineering** — chain ingestion, Parquet schemas, graph store schemas, Belief State event sourcing, cache invalidation
4. **Frontend & UX Architecture** — Next.js structure, canvas pipeline, state management, component library, accessibility
5. **Security, Sovereignty & Cryptography** — envelope encryption, KMS/HSM, confidential computing, audit hashing, key rotation
6. **DevOps & Deployment** — Docker/K8s, On-Prem installer, SaaS Blind ops, CI/CD, signed releases, air-gapped updates
7. **Compliance & Legal Architecture** — certification milestone backlog, MSA template, F41 bias-audit framework, F44 escrow, governance docs
8. **Product & GTM** — pilot customer profile, demo script, pricing/packaging finalization, partnership outreach, sales objection-handling

Each agent receives:
- This v1.0 engineering document
- The full eighteen-document design pack
- A discipline-specific brief covering scope, expected artifacts, and questions to answer
- The locked decisions from Part 7 above (once you've answered them)

Outputs from each agent feed into:
- The integrated index document
- The UI mockup pass (frontend + backend + AI agents inform mockups directly)
- The scaffolding work (backend + data + DevOps + security agents inform the monorepo bootstrap)

---

## Part 9 — Critical principles for the solo-dev build (the daily reminders)

Things easy to forget when working alone:

1. **The Belief State is the foundation.** Every feature writes BeliefAtoms. If a new feature doesn't have a clean BeliefAtom story, redesign the feature.

2. **The Math Service owns every number.** Never let an LLM type a value into a report. Never compute fiat conversion in TypeScript. Always call the Math Service.

3. **The cache exists from day one.** Even with one provider wired, the cache table exists, the first-touch-live rule is enforced, and the refresh button works. Building caching in later is the largest source of refactor pain.

4. **Reproducibility from day one.** Every case has a Pack. Even a one-tx case has a Pack. The Pack format becomes the canonical export and the canonical replay artifact.

5. **The capability router has no vendor names.** Never write `etherscan.getTx()`. Always `router.resolve("get_tx_by_hash", args)`. Switching providers is a config change, not a code change.

6. **No private agent knowledge.** Every agent reads from and writes to the Belief State. There is no agent memory outside the Belief State (other than the orchestrator's ephemeral working state during a single call).

7. **Verifier on every drafted sentence.** Reports, summaries, narratives — every drafted English sentence runs through the Verifier. No exceptions.

8. **Test against the ground-truth flywheel.** Even with one closed case, add it to the regression set. The set grows as cases close; the platform improves continuously.

9. **Sovereignty isn't bolted on later.** Even Phase 0 SaaS-Blind code paths must work without telemetry, without phone-home, with per-agency keys. The On-Prem deployment is a config change, not a fork.

10. **The investigator is the smartest sensor.** Every UI affordance respects that. AI proposes; the investigator decides. Personal attributions are first-class. Marks, memos, and tags are evidence.

---

## Part 10 — What this document is and isn't

**This document is:** the single canonical engineering reference for v1.0. It supersedes none of the prior eighteen documents — they remain valid for depth on specific topics — but it is the doc you (the solo developer) read first every morning to remember what you're building and why.

**This document is not:** a discipline-specific deep dive. The eight discipline agents produce those. After they run, the integrated index document will be the launchpad for the actual build.

The complete v1.0 reference is therefore:

- **This file** (the engineering north star)
- **The eight discipline outputs** (depth per domain)
- **The integrated index** (the launchpad)
- **The eighteen prior documents** (the source of truth on any specific feature)

Total: twenty-eight documents. All in `/home/user/workspace/`. All shared.

---

## Closing

This is the moment the design phase ends and the build phase begins. The next concrete artifacts are the discipline agent outputs and the UI mockup pass. After those, scaffolding begins — and you stop reading documents and start writing code.

The platform you've designed is real, comprehensive, and buildable. The decisions are locked. The path is sequenced. The deferred work is honest about what's deferred and why.

Let's spin up the agents.
