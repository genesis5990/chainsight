# ChainSight v1.0 — Integrated Index

> The launchpad. Read this when you sit down to build.
>
> Eight discipline agents have produced ~1.18 MB of cross-validated design across backend, AI/ML, data, frontend, security, devops, compliance, and GTM. This document is the bridge between all of them: it tells you what's in each, where they agree, where they conflict and how I've resolved it, what still needs decisions, and how to use them to start the work.
>
> If you read only one document on a given morning, read **`chainsight_v1_0_engineering.md`** first (the north star). If you're starting the day's work, read this index second.

---

## Part 1 — The complete pack (27 documents)

### Design pack (the journey, v0.1 → v0.9)

1. `chainsight_mindmap.md` — Mind map of 14 domains (v0.1)
2. `chainsight_schema.md` — Module-by-module spec (v0.1)
3. `chainsight_merged_v0_2.md` — Accuracy spine, four pillars first articulated (v0.2)
4. `chainsight_v0_3_addendum.md` — Path Selection → Report (v0.3)
5. `chainsight_v0_3_byok_addendum.md` — BYOK Marketplace (v0.3)
6. `chainsight_v0_4_consolidated.md` — First consolidation, locked G1-G8 (v0.4, superseded)
7. `chainsight_v0_4_canvas_ux_addendum.md` — Investigator markup, iconography (v0.4)
8. `chainsight_v0_4_api_key_entry_addendum.md` — `.env`-easy key entry (v0.4)
9. `chainsight_v0_5_addendum.md` — Deconfliction, documents, court mode, obfuscation (v0.5)
10. `chainsight_v0_5_addendum_2.md` — Path styling, transaction-centric graph G10, wallet analyzer (v0.5)
11. `chainsight_v0_5_addendum_3.md` — Transaction Inspector (v0.5)
12. `chainsight_v0_6_addendum.md` — Cache layer, UTXO clustering, personal attribution (v0.6)
13. `chainsight_v0_6_consolidated.md` — Second consolidation (v0.6, superseded)
14. `chainsight_v0_7_deployment_model_addendum.md` — Sovereign + SaaS Blind dual mode (v0.7)
15. `chainsight_v0_7_gap_analysis.md` — Frank gap surfacing (v0.7)
16. `chainsight_v0_8_addendum.md` — Eight Phase-0 lockdowns + 22 new features + anti-feature commitments (v0.8)
17. `chainsight_v0_8_consolidated.md` — Third consolidation, four pillars locked, 61 features (v0.8)
18. `chainsight_v0_9_ai_strategy.md` — Heterogeneous AI tier strategy, BYOK LLMs, AI toggles (v0.9)

### Engineering v1.0 (the build pack)

19. **`chainsight_v1_0_engineering.md`** — Canonical engineering north star ⭐
20. **`chainsight_v1_0_backend_architecture.md`** — Backend deep design (3,725 lines, 180 KB)
21. **`chainsight_v1_0_ai_ml_engineering.md`** — AI/ML deep design (3,548 lines, 142 KB)
22. **`chainsight_v1_0_data_engineering.md`** — Data layer deep design (3,719 lines, 156 KB)
23. **`chainsight_v1_0_frontend_architecture.md`** — Frontend deep design (2,757 lines, 140 KB)
24. **`chainsight_v1_0_security_sovereignty.md`** — Security deep design (2,600 lines, 129 KB)
25. **`chainsight_v1_0_devops_deployment.md`** — DevOps deep design (153 KB)
26. **`chainsight_v1_0_compliance_legal.md`** — Compliance / legal architecture (142 KB)
27. **`chainsight_v1_0_product_gtm.md`** — Product & GTM (135 KB, $49/mo pilot anchor locked)
28. **`chainsight_v1_0_integrated_index.md`** _(this file)_ — The launchpad

---

## Part 2 — The single biggest stack constraint locked mid-flight

Mid-build of the discipline outputs, you confirmed: **SaaS Blind v1 uses your existing Supabase, GitHub, and Fly.io accounts.** That change was pushed to all eight agents while they ran. They folded it in. The integrated stack picks now stand as:

| Concern         | SaaS Blind v1                                 | On-Prem                        | Phase 2+ SaaS migration   |
| --------------- | --------------------------------------------- | ------------------------------ | ------------------------- |
| Database        | Supabase managed Postgres 16+                 | Self-hosted Postgres           | AWS RDS Aurora Postgres   |
| Vector store    | pgvector in Supabase                          | pgvector self-hosted           | pgvector in RDS           |
| Auth            | Supabase Auth (TOTP + WebAuthn)               | Ory Kratos self-hosted         | Ory Kratos or AWS Cognito |
| Object storage  | Supabase Storage                              | MinIO / Ceph / NFS             | AWS S3                    |
| Realtime        | Supabase Realtime (alerts/presence)           | Self-hosted Soketi             | Soketi or AWS API GW WS   |
| Cache           | Upstash Redis or Fly.io Redis                 | Self-hosted Redis              | AWS ElastiCache           |
| Graph store     | Memgraph on Fly.io volumes                    | Memgraph on customer infra     | Memgraph on EC2           |
| App hosting     | Fly.io                                        | Customer infra (Docker / K8s)  | AWS ECS Fargate / EKS     |
| Source / CI     | GitHub + GitHub Actions                       | Same                           | Same                      |
| Release signing | Sigstore (keyless OIDC via Actions)           | Same                           | Same                      |
| KMS             | AWS KMS (independent of Supabase)             | HashiCorp Vault / customer KMS | AWS KMS                   |
| Encryption      | libsodium app-layer; ciphertext into Supabase | libsodium app-layer            | Same                      |

The application code is identical between SaaS Blind v1 and On-Prem — only the underlying infrastructure differs. **The Phase 2 migration from Supabase + Fly.io to AWS is now a hard commitment**, not a vague aspiration, because SOC 2 / FedRAMP paths are easier on AWS. Every discipline doc has a concrete migration runbook.

---

## Part 3 — What each discipline doc contains (the map)

### `chainsight_v1_0_engineering.md` — The North Star

- Four pillars, locked
- Technology stack picks (Supabase / Fly / GitHub / TypeScript / Fastify / Memgraph / Sigma.js / Claude Opus 4.6 BYOK)
- Eight-week Phase 0 sequence
- The ten cross-cutting open questions for your input
- Top-of-mind daily reminders (Belief State is foundation, Math Service owns numbers, cache from day one, etc.)
- **When to use it:** every morning, to remember what you're building. Read first.

### `chainsight_v1_0_backend_architecture.md` — Backend (180 KB, 3,725 lines)

**Highlights:**

- §0 (new): Stack reality + Supabase integration map for Auth, Postgres, Storage, Realtime, Vault
- §0.3: Concrete `StorageBackend` interface with Supabase and MinIO implementations
- §0.4: Auth abstraction with JWKS-generic plugin, PKCE flow diagram
- §0.5: 12-step Supabase → AWS RDS migration procedure with DEK re-encryption risk flagged
- §0.6: Fly.io topology (4 apps + Supabase + Upstash + GitHub) with inter-service DNS
- §0.7: GitHub Actions CI/CD YAML skeleton
- §1.10: Supabase Realtime explicitly bounded to deconfliction + supervisor dashboard
- §2: 30-50 API endpoints/procedures with Zod schemas
- §5.2a: Full Supabase RLS policy set with `auth.agency_id()` helper, service-vs-anon split, performance notes
- §6: PgBouncer transaction-mode connection budget, `prepare: false` constraint
- §10: Week-by-week Phase 0 plan updated for Supabase
- §11: Open backend questions (BQ1-BQ14), four already closed

**When to use it:** when writing any backend code, API endpoint, or designing a new module's persistence pattern.

### `chainsight_v1_0_ai_ml_engineering.md` — AI/ML (142 KB, 3,548 lines)

**Highlights:**

- Heterogeneous Tier A/B/C stack with model picks per agent role
- §5.0: pgvector inside Supabase + Voyage AI (1536-dim) default + BGE-M3 (768-dim) for On-Prem
- §5.0: `rag_agency_isolation` RLS policy explicitly preventing cross-tenant retrieval bleed
- §4: Fine-tuning pipeline with Supabase Storage for LoRA adapter artifacts, `model_registry` table
- §9: Evaluation harness on GitHub Actions with self-hosted runners; `eval_run_results` table
- §12: Cost telemetry per agent / case / role / provider
- Complete agent specifications (Intake, Scope, Tracer, Bridge, Swap, Attribution, OSINT, Accounting, Narrative, Watcher, Critic, Suggestion, Verifier, Inspector specialists, Extraction)
- Hallucination mitigation stack — ten techniques layered
- AI toggle implementation at four granularities
- Phase 0: BYOK frontier APIs only; self-hosted vLLM/Ollama on Fly.io = Phase 2+

**When to use it:** when wiring any LLM call, designing an agent, configuring fine-tuning, evaluating model swaps.

### `chainsight_v1_0_data_engineering.md` — Data (156 KB, 3,719 lines)

**Highlights:**

- §4: Full Postgres DDL with `auth.uid()`-based RLS policies on every table
- §5 (the key section): **Supabase RLS Policy Patterns** — agency isolation, case scoping, supervisor scoping, append-only enforcement, AWS portability
- `SECURITY DEFINER` helper functions (`current_agency_id()`, `user_has_case_access()`) prevent recursive RLS loops
- `AS RESTRICTIVE` policies on `audit_log_entries` and `belief_atoms` for append-only
- No `SELECT` policy on `case_dek_refs` — only `service_role` can read encryption key refs
- §6: Belief State event store with hash chaining
- §7: Cache layer F23 — Redis + Postgres tiers
- §8: Reproducibility Pack format with replay.sh
- §10: UTXO clustering F24 algorithm
- §11: pgvector HNSW with RLS, embedding strategy
- §12: Supabase Realtime publications, frontend subscriptions, Broadcast for cache delta
- §13: Supabase → AWS RDS migration via pglogical
- §15: Performance benchmarks including RLS overhead analysis
- libsodium encrypted `_enc` BYTEA columns provide defense-in-depth on top of RLS

**When to use it:** when writing any schema migration, RLS policy, query, or thinking about data flow.

### `chainsight_v1_0_frontend_architecture.md` — Frontend (140 KB, 2,757 lines)

**Highlights:**

- §1.4: SSR-friendly Supabase client setup with `createSupabaseServerClient()`, browser singleton, `middleware.ts` session refresh
- §1.5: `useMFAGate()` hook wrapping high-impact mutations (TOTP + WebAuthn)
- §1.6: Multi-tenancy via `app_metadata.agency_id` + RLS policy examples
- §2: Four-layer state architecture (Zustand / React Query+Supabase / Supabase Realtime / Yjs)
- Six Realtime channel patterns; presence via Broadcast; signed-URL Storage uploads
- Yjs CRDT for canvas only, with JWT auth — Supabase Realtime explicitly not used for CRDT
- Component sketches for the canvas, PSR selection modes, Court Mode, Inspector popup, Provider Marketplace, Personal Attribution library
- Phase 0 frontend weeks updated for Supabase
- Open questions Q-FE-1 through Q-FE-14 — including RLS performance, TOTP enforcement timeline, multi-tab subscription deduplication

**When to use it:** when designing any UI component, configuring data fetching, planning a new screen.

### `chainsight_v1_0_security_sovereignty.md` — Security (129 KB, 2,600 lines)

**Highlights:**

- §1: 4-party threat model; "Supabase as compelled adversary" first-class threat
- §2: Agency KMS Root → Tenant DEK → Case DEK → Document DEK envelope hierarchy
- All Postgres encrypted columns use `encrypted_payload + nonce + key_version` pattern
- §3: AWS KMS envelope flow; libsodium XSalsa20-Poly1305 calls; key rotation mechanics
- §4: What each provider (Supabase, Fly.io, GitHub, Agency) can and cannot see — honesty section
- §5: Break-glass audited support access flow with per-access re-encryption
- §6: Supabase Auth with custom JWT claims hook for `agency_id`/`role`
- §7: HMAC-SHA256 hash chain audit log with genesis hash
- §9: Cosign + Rekor + GitHub Actions keyless OIDC signing (G23 closed)
- §13: On-Prem hardening checklist with HashiCorp Vault integration
- §17: Three non-deferrable Phase 0 items (encryption layer, audit chain, CoC from first INSERT)
- §18: Open security questions Q-SEC-1 through Q-SEC-9

**When to use it:** when touching anything involving keys, secrets, encryption, audit, or trust boundaries. **Read this before writing the first encryption code.**

### `chainsight_v1_0_devops_deployment.md` — DevOps (153 KB)

**Highlights:**

- §1: Local dev environment using `supabase start` + Docker Compose for Memgraph/Redis/services
- RLS policies as migration files, never ad hoc
- `supabase db lint` in pre-commit hooks
- `supabase gen types typescript` with CI type-drift check
- §2: CI/CD — per-PR ephemeral Supabase preview branches + Fly.io review apps
- Per-merge: `supabase db push --linked` before `flyctl deploy`
- Per-tag: Sigstore signing + GitHub Release
- §3: SaaS Blind v1 cost model — ~$30-35/month at zero customers; ~$110-185/month at pilot scale
- Fly 6PN private networking between services
- §4: Migration to AWS now a 10-week runbook (pglogical replication, GoTrue → Ory Kratos, Realtime → Soketi, Fly.io → ECS Fargate)
- DEK preservation: AWS KMS keys used in Phase 0 carry forward unchanged through migration
- Phase 2 cost model (~$315-430/month pilot, ~$800-1,270 at 20+ customers)

**When to use it:** when configuring infrastructure, CI/CD pipelines, deployment, or planning the Phase 2 migration.

### `chainsight_v1_0_compliance_legal.md` — Compliance / Legal (142 KB)

**Highlights:**

- §1: SOC 2 Type 1 with **explicit callout that Fly.io and Supabase hosted tier are not sufficient for SOC 2 audit surface** — AWS migration is a hard Phase 2 prerequisite, not an option
- Supabase Enterprise (AWS-hosted) named as acceptable Supabase path if you want to retain Supabase post-migration
- §2: MSA Section 5A (Subprocessors) — 30-day subprocessor change notice, customer termination right, Supabase compelled-disclosure architecture as contractual commitment
- Exhibit I: Live subprocessor list (Supabase, Fly.io, GitHub)
- §12: Data residency tied to Supabase regions (US-east-1 default; EU regions for Phase 4)
- §15.2A: Subpoenas directed at subprocessors — each analyzed individually (Supabase, Fly.io, GitHub)
- §18: Phase 0 [REQUIRED] task — subprocessor DPAs for Supabase / Fly.io / GitHub before first customer onboards
- §18.6: Phase 2 mandatory legal milestones (AWS migration, CLRB convening, first escrow deposit)
- §19: Subprocessor registry and management with migration workflow + customer notification template
- Two new open questions: OQ-8A (Supabase Enterprise vs. self-managed when migrating) and OQ-8B (Fly.io/GitHub account ownership)

**When to use it:** when drafting MSA language, scoping a certification, responding to a security questionnaire, or making a vendor disclosure decision.

### `chainsight_v1_0_product_gtm.md` — Product / GTM (135 KB, 1,407 lines)

**Highlights:**

- Competitive landscape: Chainalysis, TRM, Elliptic, Crystal, Arkham, Merkle Science — analyzed, not just listed
- Positioning statement at three lengths (one sentence / 30 sec / 2 min)
- **Pilot pricing locked at $49/month Investigator tier**, 2-seat min for Team tier ($98/month)
- 90-day commercial plan with weekly milestones
- Demo script with the headline moments (Transaction Inspector, Where-Did-The-Money-Go overlay, Court Mode methodology toggle, Reproducibility Pack replay, sovereignty pitch)
- Sales objection-handling — 11 prepared responses for the most common objections
- Founding-team capitalization framework with $X cost milestones
- **Section 15.4 / 16.4: SOC 2 timing mismatch flagged as top-three commercial risk** (consistent with compliance doc)
- BYOK partnership outreach list with concrete companies for Phase 0-1

**When to use it:** when talking to a prospect, drafting outreach, finalizing pricing, planning a fundraise, or making any commercial decision.

---

## Part 4 — Cross-discipline alignment check

The eight documents were produced in parallel against the same source pack. Here's where they agree, where they conflict, and how I resolve the conflicts.

### Where they fully agree (no resolution needed)

- **The four pillars** — Belief State, Reproducibility Pack, BYOK + Cache + In-House, Sovereign Deployment
- **The transaction-centric graph model (G10)** — every doc respects address→tx→address
- **The Phase 2 AWS migration** — backend, data, devops, compliance, security all align on the timing, the trigger conditions, and the technical approach
- **AWS KMS independent of Supabase** — security and data both make this explicit
- **Application-layer encryption before Supabase writes** — security, data, and backend all enforce this
- **Sigstore via GitHub Actions keyless OIDC** — security, devops both pick this
- **G22 (confidential computing) deferred to Phase 3** — security and devops both confirm

### Where they fill different aspects of the same decision (no conflict)

- **Auth:** Frontend writes Supabase Auth client integration; backend writes JWKS-generic plugin; security writes JWT claims hook; data writes RLS using `auth.uid()`. All four point at the same Supabase Auth but cover different layers cleanly.
- **MFA gates:** Frontend writes `useMFAGate()` hook; backend writes server-side enforcement; security writes the policy of which actions require which factor. Three views, one truth.
- **Audit log:** Security writes the cryptographic structure; data writes the schema; backend writes the API; devops writes the observability hookup. All consistent.
- **Phase 0 sequence:** Engineering doc has the eight-week shape; each discipline doc has a discipline-specific Phase 0 plan. They reference the same weeks.

### Conflict 1: Realtime use cases — RESOLVED

- **Frontend** initially suggested some watcher/alert flows via Supabase Realtime
- **Backend** §1.10 explicitly bounds Realtime to deconfliction alerts + supervisor dashboard
- **Data** §12 confirms Realtime publications match backend's scope
- **Resolution:** backend §1.10 wins. Supabase Realtime is for: (a) deconfliction alerts, (b) supervisor dashboard feed, (c) presence indicators in the canvas. **Not for:** job progress (use polling against API), canvas CRDT (use Yjs WebSocket), or any high-frequency stream. Frontend has been updated in §22.

### Conflict 2: Per-PR ephemeral databases — RESOLVED

- **DevOps** §2 specifies Supabase branches for PR previews
- **Backend** §0.7 GitHub Actions CI matches devops
- **Data** §13 references the same pattern
- **Resolution:** consistent. Use Supabase preview branches per PR with `supabase branches create pr-N` lifecycle.

### Conflict 3: Storage encryption layer — RESOLVED

- **Frontend** §22 plans signed-URL direct browser → Supabase Storage uploads
- **Security** §2/4 requires encryption _before_ Supabase Storage sees the bytes
- **Backend** §0.3 `StorageBackend` interface owns encryption
- **Resolution:** browser does **not** upload directly to Supabase Storage. Browser uploads to a presigned API endpoint that runs in Fastify (on Fly.io); the API encrypts with the case DEK; only then writes to Supabase Storage. Frontend signed-URL pattern is for _download_ (with the API issuing time-limited signed URLs for already-encrypted blobs), not upload. Frontend doc needs a small clarification on this.

### Conflict 4: Cache layer location — RESOLVED

- **Backend** §0.6 puts cache on Upstash Redis OR Fly.io Redis
- **Data** §7 references Redis without specifying provider
- **DevOps** §3 picks Upstash for cost / managed simplicity
- **Resolution:** Upstash Redis for SaaS Blind v1. ~$10/month at pilot scale. Migrate to AWS ElastiCache during Phase 2.

### Conflict 5: SOC 2 path through Supabase — RESOLVED

- **Compliance** §1 says SOC 2 Type 1 requires AWS migration first
- **DevOps** §4 says AWS migration is a Phase 2 milestone
- **GTM** §15.4 / §16.4 flags SOC 2 timing mismatch as top-three commercial risk
- **Resolution:** consistent and serious. SOC 2 Type 1 target is **end of Phase 2** with AWS migration completed by **mid Phase 2**. If a customer demands SOC 2 Type 1 before Phase 2 ends, decline the deal or extend the engagement timeline. The GTM doc has prepared sales language for this.

### Conflict 6: AI on Fly.io — RESOLVED

- **AI/ML** §9 says no self-hosted inference on Fly.io until Phase 2
- **DevOps** §3 confirms Fly.io topology is API/worker/math/Memgraph only
- **Resolution:** Phase 0 and Phase 1 are BYOK-API-only for LLMs. Self-hosted vLLM/Ollama on Fly.io is a Phase 2+ option. On-Prem deployments self-host from day one.

### Conflict 7: Realtime for cache invalidation — UNRESOLVED, NEEDS YOUR DECISION

- **Data** §12 proposes Supabase Realtime Broadcast for cache delta notifications
- **Backend** §1.10 bounds Realtime to alerts/dashboard
- **Tension:** if we use Realtime for cache invalidation across multiple API instances on Fly.io, it's elegant. But it expands the Realtime surface beyond what backend wants. Alternative: use Redis pub/sub on Upstash for cache invalidation, leave Realtime tightly scoped.
- **Open question Q-INT-1:** Lean toward Redis pub/sub. Confirm.

---

## Part 5 — The complete open-questions registry

Aggregating from across the eight discipline docs and the engineering north star. **Bold** items need decisions before code is written. Others can wait.

### Cross-cutting (from engineering doc Part 7)

1. **Pilot customer profile** — Investigator tier (Solo PI / forensic accountant) is recommended by GTM
2. **First chain after Ethereum** — Bitcoin recommended (validates UTXO model early)
3. **Naming** — ChainSight as real name? GTM doc has alternative-naming considerations
4. **Hosting choice** — Locked: Supabase + Fly.io for v1; AWS in Phase 2
5. **Open-source posture** — Closed Phase 0, open periphery Phase 2 (consistent across docs)
6. **License model** — Open core + commercial license for the core in v1
7. **Pilot pricing** — **Locked: $49/month Investigator tier**, 2-seat min for Team at $98/month
8. **Founding entity status** — Compliance OQ-8B asks the same question
9. **Specific compliance hard requirements** — No pre-existing constraints known; F42 roadmap stands
10. **Twelve-month team picture** — GTM doc proposes Phase 1 hire (1 engineer), Phase 2 (3 engineers), Phase 4 (5-7)

### Backend (BQ1-BQ14)

- BQ1-BQ6: ✅ Closed (Supabase Auth, Supabase Vault for Phase 0, etc.)
- BQ7-BQ10: deferred design decisions on tracing API ergonomics
- **BQ11: Supabase Pro vs. Team plan timing** — Pro ($25/mo) is fine for Phase 0; upgrade to Team ($599/mo) when we need branching at scale and SLAs (probably during Phase 1)
- BQ12: Supabase Vault vs. app-layer encryption — answered (app-layer always, Vault for some auxiliary secrets)
- BQ13: Realtime OR-filter limitation — known constraint; documented
- BQ14: Supabase Edge Functions boundary — only for low-complexity webhooks, never for Belief State writes

### AI/ML (Q-AI-1 through Q-AI-12)

- Q-AI-1: Which BYOK LLM provider gets wired first? **Anthropic** (Claude Opus 4.6 as default orchestrator)
- Q-AI-2: Voyage vs. OpenAI embeddings? Voyage (better RAG benchmarks 2026)
- Q-AI-3 through Q-AI-12: domain-specific (fine-tuning data sources, evaluation harness scope, etc.)

### Data Engineering (8 items)

- DE-1: Supabase Pro vs. Team timing (same as BQ11)
- DE-2: Upstash vs. Fly.io Redis — **Upstash** for managed simplicity
- DE-3: KMS root key location — **AWS KMS** (resolved)
- DE-4: Supabase Edge Functions usage — none in critical path
- DE-5 through DE-8: schema evolution patterns

### Frontend (Q-FE-1 through Q-FE-14)

- Q-FE-11: Realtime reconnect strategy
- Q-FE-12: TOTP enforcement timeline (immediate vs. grace period)
- Q-FE-13: RLS performance at scale
- Q-FE-14: Multi-tab subscription deduplication

### Security (Q-SEC-1 through Q-SEC-9)

- Q-SEC-1: KMS key rotation cadence — recommend 90 days for tenant DEKs, 1 year for case DEKs
- Q-SEC-2 through Q-SEC-9: incident response specifics, customer notification templates

### Compliance (OQ-1 through OQ-8B)

- OQ-8A: Supabase Enterprise vs. self-managed Postgres at AWS migration — **Phase 1 decision**
- OQ-8B: Fly.io / GitHub accounts under company entity or personal — **Day 1 question**

### Integrated index (Q-INT-1)

- Q-INT-1: Cache invalidation via Supabase Realtime Broadcast vs. Redis pub/sub — **lean Redis**

---

## Part 6 — The Phase 0 build sequence (consolidated from all eight)

The eight discipline docs each have a Phase 0 plan. Here's the consolidated week-by-week with the highest-priority items from each. **This is the literal sequence you execute.**

### Week 1 — Foundations

- Monorepo scaffolding (Turborepo + TypeScript + base CI on GitHub Actions)
- Supabase project provisioned; local Supabase emulator via `supabase start`
- Fly.io organization configured; first Fly app for the API skeleton
- Memgraph + Redis (Upstash dev tier) via Docker Compose for local dev
- Postgres schema v0: agencies, users, cases, IOCs, audit_log_entries, belief_atoms (skeleton with hash chain)
- RLS policies v0 with `auth.uid()` patterns
- Sigstore release pipeline via GitHub Actions
- **Compliance: subprocessor DPAs initiated** for Supabase / Fly.io / GitHub (background task)

### Week 2 — Auth + Encryption foundation

- Supabase Auth wired in frontend (`@supabase/ssr` middleware)
- Backend Fastify with JWKS-generic auth plugin
- AWS KMS root key provisioned and tested
- Per-agency tenant DEK derivation
- Per-case DEK envelope encryption (libsodium)
- Encrypted column patterns for cases and belief_atoms
- Hash-chained audit log working end-to-end
- Belief State Service v0 — insert/query helpers with provenance

### Week 3 — Capability Router + first provider

- Capability Router pattern: `router.resolve(capability, args)`
- Etherscan V2 API as first BYOK provider (single key in encrypted credential store)
- Cache layer v0 — immutable chain data tier, Redis-backed
- Provider response logging for audit
- First end-to-end: pull tx by hash, encrypt, store, retrieve

### Week 4 — Graph + first canvas

- Graph data model: AddressNode and TransactionNode tables with edges
- Math Service skeleton (Python + FastAPI + gRPC); first endpoint `compute_value_at_block`
- Sigma.js canvas rendering an address→tx→address chain
- Click a transaction → fetch full data → render
- Begin chain-of-custody first-class system (F29) — every artifact view logs a CoC event

### Week 5 — Inspector + first LLM call

- Transaction Inspector popup (sections 1-2 only — structured facts)
- One LLM call wired: Inspector plain-language summary via Claude Opus 4.6 (BYOK)
- Verifier Agent v0 — citation-token enforcement check
- AgentCall logging with cost telemetry stub
- Model card recording for reproducibility

### Week 6 — Reproducibility Pack v0

- Pack builder service
- Manifest schema
- Frozen provider responses captured
- Rule version pins
- Model card embedding
- replay.sh script template
- Pack content hashing and signing

### Week 7 — Pilot customer-ready surface

- Polish the demo path end-to-end
- Provider Marketplace UI v0 (single key entry, no marketplace yet)
- Case CRUD UI complete
- Basic reporting (structured templates, no narrative AI yet)
- Domain procurement (chainsight.app or final name)
- Marketing site v0 deployed

### Week 8 — Phase 0 launch demo + pilot outreach

- End-to-end demo: paste an Ethereum tx hash → Inspector populates → Pack export → replay produces identical output → all signed and audited
- Compliance Phase 0 close-out: subprocessor DPAs signed; MSA template drafted; pilot agreement template
- Three pilot prospects identified and outreach started (per GTM doc archetypes)
- Demo video recorded
- Phase 0 retrospective

---

## Part 7 — Decisions still needed from you

In rough priority order, with my recommendations:

| #   | Decision                                                     | My recommendation                                                             | Why                                          |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Naming (ChainSight as real?)                                 | Acquire `chainsight.app` if not taken; do trademark search this week          | Locks brand before any external materials    |
| 2   | Fly.io / GitHub accounts under entity or personal? (OQ-8B)   | Move to company entity (LLC) before Week 8 launch demo                        | Liability separation                         |
| 3   | LLC formation timeline                                       | Delaware C-corp or LLC by Week 4 (before first BYOK pilot)                    | Required for MSA / E&O insurance             |
| 4   | First three pilot prospect archetypes (GTM doc has profiles) | Solo forensic accountant + small compliance team + small PI firm              | Spreads risk across three personas           |
| 5   | Cache invalidation: Realtime vs Redis pub/sub (Q-INT-1)      | Redis pub/sub                                                                 | Keeps Realtime tightly scoped                |
| 6   | Supabase Pro vs Team timing (BQ11/DE-1)                      | Pro until Phase 1; Team when branches-at-scale needed                         | Cost optimization                            |
| 7   | TOTP enforcement timeline (Q-FE-12)                          | Immediate for all users from day 1                                            | No grace period; matches court-defensibility |
| 8   | KMS root key rotation cadence (Q-SEC-1)                      | Tenant DEKs every 90 days; case DEKs annually                                 | Industry standard                            |
| 9   | Phase 1 hiring trigger (per GTM capitalization framework)    | Hire first engineer at month 4 if pilot closes by month 3                     | Conservative                                 |
| 10  | Outside counsel engagement                                   | Engage one federal-contracting attorney + one civil-rights attorney by Week 6 | Required for MSA / F41 commitments           |

None of these block Week 1 work. They become blocking around Weeks 3-6.

---

## Part 8 — What's next (per your original instruction)

You said: _"After that we can get started with a UI mockup and scaffolding."_

The path is clear. With this index in hand, the next two artifacts are:

### Next 1: UI mockups

A visual pass across the eight critical surfaces:

1. **Canvas** with markup (Marks / Memos / Icons / Tags / Path styling / value-split percentages / "Where did the money go?" overlay / Important sidebar)
2. **Transaction Inspector** popup with all eight sections streaming in
3. **PSR selection** — click, lasso, auto-pathfind, NL — and the resulting path-styled overlay
4. **Court Mode** — full-screen presenter view with the accounting-follows-the-frame panel
5. **API key entry** — single modal, bulk-paste, `.env` file drop
6. **Provider Marketplace** including the Model Configuration matrix (per role × installed models)
7. **Wallet History Analyzer** — wallet creation, progress, sub-graph rendering
8. **Supervisor Dashboard** — span-of-control cases, review checkpoints, non-destructive approval sidebar

Plus a brand pass on the marketing site v0.

### Next 2: Scaffolding

With mockups locked, scaffolding becomes a one-day push:

- Monorepo with Turborepo
- `supabase init` + first migration covering Week 1 schema
- Fastify API skeleton with the auth plugin from backend §0.4
- Next.js 15 App Router with the Supabase SSR setup from frontend §1.4
- Math Service skeleton (Python + FastAPI + gRPC)
- Worker skeleton (BullMQ + Redis)
- Local Docker Compose for Memgraph + Redis + Math
- GitHub Actions CI workflow from backend §0.7
- Fly.io app definitions for api, web, worker, math
- Pre-commit hooks (`supabase db lint`, lint, type-check)
- First commit pushed, first PR with preview branch tested, first deploy to a Fly review app

**Estimated effort:** Mockups = 1 day with AI-assisted Figma or v0-style generation. Scaffolding = 1 day after mockups close ambiguity. **Total: ~2 days from now to a deployed Phase 0 Week 1 skeleton.**

---

## Part 9 — How to read this pack going forward

If you're spending 30 minutes on the project today, read in this order:

1. The engineering north star (~15 minutes)
2. This integrated index (~10 minutes)
3. One discipline doc relevant to today's work (~variable)

If you're spending all day:

1. Engineering doc
2. Integrated index
3. Two relevant disciplines (e.g., backend + data on a database-design day; frontend + AI on a UX day)
4. The relevant v0.x source doc for the feature you're building

If you're onboarding a new collaborator (hypothetical future engineer):

1. Engineering doc (60 minutes)
2. Integrated index (30 minutes)
3. All eight discipline docs (one full day of reading)
4. The 18 v0.x source docs (one week of reading)

Total time from "never heard of ChainSight" to "can write code that fits the architecture": 1 week of reading. That's the cost of a comprehensive design pack — but it's a one-time cost for each engineer, and it eliminates entire categories of bugs and rework.

---

## Part 10 — Closing

This is the moment the design phase ends and the build phase begins. Twenty-seven documents, four pillars, 61 locked features, ten anti-feature commitments, a heterogeneous AI strategy, dual deployment model, full compliance roadmap, pricing locked, and an eight-week Phase 0 sequenced from day one to demo-ready end.

The platform you've designed is real, comprehensive, and buildable. The institution that ships it has been designed at the same level of care as the technology. The path is sequenced. The deferred work is honest about what's deferred. The risks are named.

You said: _"After that we can get started with a UI mockup and scaffolding."_

Ready when you are.
