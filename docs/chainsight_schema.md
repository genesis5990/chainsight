# ChainSight — Architectural Schema (v0.1)

A working spec for an end-to-end, AI-augmented blockchain investigation platform. Designed to be edited. Every section has an **Open Questions** block — that's where we iterate.

---

## 0. Design constraints (the non-negotiables)

| # | Constraint | Why |
|---|---|---|
| C1 | Glass-box AI reasoning | Courts reject opaque tracing methods ([D'Aloia case](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/)) |
| C2 | Reproducible math | Mandatory "judicial mathematical audit" survives in real cases |
| C3 | Multi-methodology accounting | No single tracing convention is universally accepted ([Digital Defenders Group on LIFO](https://www.digitaldefendersgroup.org/post/lifo-crypto-tracing-fraud-victims-recovery)) |
| C4 | Human-in-the-loop on irreversible actions | Freezes, seizures, public attributions |
| C5 | Immutable audit trail | Chain-of-custody for evidence |
| C6 | Cross-chain by default | Sub-50-chain platforms are non-competitive by 2026 ([The Ledger Review](https://theledgerreview.com/on-chain/blockchain-intelligence-platforms-2025-allium-chainalysis-trm-labs)) |
| C7 | Per-wallet basis tracking | IRS Rev. Proc. 2024-28 from Jan 1 2025 ([Wag3s](https://wag3s.io/blog/crypto-cost-basis-methods)) |

---

## 1. Intake & Case Context

### 1.1 Data model — `Case`

```typescript
Case {
  id: uuid
  codename: string
  crime_typology: enum  // rugpull, ransomware, pig_butchering, sextortion,
                        // sanctions_evasion, terror_finance, market_manip,
                        // ip_theft, csam, narcotics, fraud_generic, civil_dispute
  legal_vehicle: enum   // criminal, civil_forfeiture, regulatory, internal_compliance, private_civil
  jurisdictions: string[]   // ISO codes
  lead_investigator_id: uuid
  agency_id: uuid
  status: enum          // intake, active, paused, prepared_for_court, closed, archived
  created_at, updated_at: timestamp

  // narrative
  summary_md: text
  victim_statements: Document[]
  suspects: Person[]
  iocs: IOC[]           // addresses, tx hashes, exchanges, domains, emails, phones, handles

  // time
  incident_t0: timestamp
  lookback_window: interval
  watch_window: interval | null  // null = ongoing

  // legal trackers
  subpoenas: SubpoenaRequest[]
  mlat_requests: MLATRequest[]
  freeze_orders: FreezeOrder[]
}
```

### 1.2 AI role
**Intake Agent** parses complaint PDFs, victim affidavits, exchange CSV responses, scam-report aggregator dumps. Extracts IOCs, normalizes addresses across L2s, deduplicates against existing cases in the org tenant.

### 1.3 Open questions
- Do we want a "victim portal" where retail fraud victims self-submit IOCs that auto-cluster into a master case?
- How tightly do we integrate the Deconflict Academy LE-training perspective — should the platform have a built-in training mode that walks junior investigators through their first case?

---

## 2. Time Frame & Market Context

For every case we snapshot the market state at T0 and continuously thereafter:

- Spot prices (multiple sources, median) for every asset touched
- Stablecoin peg state (USDT, USDC, DAI, USDe, FRAX, TUSD, etc.) — depegs are evidence
- Major exploit / hack events in window (Rekt News, DefiLlama hacks, Chainalysis bulletins)
- Sanctions events (OFAC SDN updates, EU restrictive measures)
- Bridge incidents (Wormhole, Nomad, Ronin, Multichain failures are huge causal context)
- Regulatory events (enforcement actions, indictments) that may explain suspect behavior

### Data model — `MarketContextSnapshot`
Pinned to the case, frozen at intake, refreshed on case re-open. Travels with the reproducibility pack.

### Open questions
- Subscribe to which feeds? DefiLlama API + The Block + Chainalysis Crypto Crime newsletter + OFAC API as a baseline?
- How do we present "what was happening in the market" inside the timeline view without overwhelming the canvas?

---

## 3. Chain & Asset Scope

### 3.1 Chain detection algorithm
1. From IOCs, derive native chain(s).
2. For each EVM address, automatically scan **all** EVM chains for activity (Ethereum, Base, Arb, Op, Polygon, BSC, Avalanche, Linea, Scroll, zkSync, Blast, Mantle, Mode, etc.). One address often appears on 5+ chains.
3. For Bitcoin addresses, check sibling chains (BCH, BSV, LTC) for replayed activity.
4. For any address that has bridged out, recursively scope the destination chains.
5. Flag privacy chains (Monero, Zcash shielded, Aleo, Iron Fish) as "boundary" — note presence, mark unrecoverable, route to specialist.

### 3.2 Valuation snapshot table

| Field | Notes |
|---|---|
| native_amount | exact, BigInt |
| fiat_at_t0 | for harm calculation |
| fiat_at_seizure | for forfeiture filings |
| fiat_at_now | for current exposure |
| stablecoin_peg_factor | if asset was a stablecoin during the trace |
| dex_depth_at_t0 | for illiquid tokens — slippage-adjusted fair value |

### 3.3 Open questions
- For illiquid scam tokens, do we use TWAP, the largest pool's spot, or a slippage-adjusted "exit value"? (My recommendation: store all three, default-display exit value.)

---

## 4. Tx Volume & Trace Scope Estimator

Before we burn compute on a 500-hop trace, the **Scope Agent** runs a cheap estimator:

- Pull 1-hop neighborhood for each seed address
- Estimate fan-out per hop (mean + p95)
- Predict total tx count at depth N
- Predict bridge crossings
- Allocate a **compute budget** (and warn the investigator if the projected cost exceeds case priority budget)

This drops a `TraceScopePlan` into the case file before any heavy work begins.

### Open questions
- What's the right default cap? Auto-cap at 10k txs / 50 hops, prompt to extend?
- Do we want a "speculative trace" mode that runs cheap heuristics first (clustering, known-entity short-circuit) before deep traversal?

---

## 5. Visual Trace Engine — Multi-chain

Visualization is where most existing tools fail. Design choices:

- **Swimlanes per chain** — vertical lane per blockchain, bridges are explicit horizontal hops between lanes
- **Edge encoding** — thickness = value (log scale), color = taint %, dash = stablecoin, double-line = bridged
- **Node encoding** — shape = address vs contract vs known-entity-cluster, color = risk tier, size = total throughput
- **Time axis** — optional time-warped layout (Sankey-with-time) where x position is timestamp
- **Collapse/expand** — entities collapse from 1000-address clusters to single nodes
- **Observer mode** — separate read-only courtroom view with narrated step-through ("press → to advance")

Render stack: WebGL (PixiJS or Sigma.js v3) for >10k nodes; fall back to Cytoscape for <10k.

### Open questions
- Do we want a 3D mode for cross-chain (each chain on its own plane, bridges as vertical edges)? Looks great in demos, often less readable in court.
- Should the observer view auto-narrate using the Narrative Agent + TTS, so a prosecutor can play it in opening statements?

---

## 6. Token Swaps

### 6.1 Decoders
- **EVM**: Uniswap v2/v3/v4, Curve, Balancer, 1inch, 0x, CowSwap, Maverick, Aerodrome, Velodrome, Camelot
- **Solana**: Raydium, Orca (Whirlpools), Meteora, Lifinity, Phoenix, **Jupiter** (aggregator — must unwind to underlying pools)
- **Cosmos**: Osmosis, Astroport
- **Bitcoin L2 / Runes**: Magic Eden, Unisat, Runestone DEXes

### 6.2 What we capture per swap
```
SwapEvent {
  router, pool, version
  token_in, amount_in
  token_out, amount_out
  effective_price
  spot_price_at_block
  slippage_bps
  fee_paid (lp + protocol)
  mev_impact (sandwich detected? front-run? JIT?)
}
```

### Open questions
- Do we treat **wrapped/bridged identity** (WETH↔ETH, USDC↔USDC.e) as a swap or as identity-preserving? Default: identity-preserving, flagged.

---

## 7. Bridges & Cross-Chain Protocols

The hardest tracing problem. We maintain a **canonical bridge registry**:

| Bridge | Type | Correlation Method |
|---|---|---|
| LayerZero / Stargate | Generic messaging | LZ message id (deterministic src↔dst match) |
| Wormhole | Generic messaging | VAA payload |
| CCIP (Chainlink) | Generic messaging | Message id |
| CCTP (Circle) | USDC-native | Attestation id |
| Across | Intent-based | Deposit id |
| Hop | Optimistic | Transfer id |
| Synapse | Liquidity network | Kappa hash |
| deBridge / Squid | Intent / multi-bridge | Order id |
| Thorchain / Maya | Native swap | Memo field |
| Atomic swaps / HTLC | Trust-minimized | Hashlock matching |

When **no message id exists** (older bridges, anonymized routes), fall back to **heuristic matching**: same approximate value within ±slippage window, within Δt, across a known bridge contract. Confidence-scored.

### Open questions
- How do we represent **multi-bridge routes** (Squid/LiFi aggregating across 3 bridges in one user tx)? Probably as a single logical hop with children.
- For Thorchain and other native-swap bridges, are we comfortable treating them as "swap + bridge" or as a single atomic event?

---

## 8. Accounting, Fees & Commingling

This is the **legal heart** of the platform. Existing tools pick one method and lock you in. We won't.

### 8.1 Methodology engine

Runs **in parallel** on the same trace graph:

- **FIFO** — IRS default for US ([Recap](https://recap.io/en-US/blog/us-crypto-cost-basis-methods-fifo-lifo-specific-id-per-wallet-rules))
- **LIFO** — common LE convention, contested ([Digital Defenders Group](https://www.digitaldefendersgroup.org/post/lifo-crypto-tracing-fraud-victims-recovery))
- **HIFO** — minimizes gains for tax cases
- **Specific Identification** — requires contemporaneous lot records
- **LIBR (Lowest Intermediate Balance Rule)** — equitable commingling standard
- **Pari passu** — English law proportional sharing
- **Rolling charge** — English law alternative
- **Average cost / Section 104 pool** — UK
- **Per-wallet** vs **universal** scope toggle (mandatory per-wallet in US from 2025)

Output: a comparison table showing "under FIFO, $X is traceable to seizure address; under LIFO, $Y; under LIBR, $Z." The investigator and counsel pick the method appropriate to the jurisdiction and case theory, with full math.

### 8.2 Fee accounting
Every hop deducts:
- Network fee (gas, priority, blob, sequencer fee on L2)
- Bridge fee
- DEX LP + protocol fees
- MEV extracted against the suspect (yes, this matters for victim recovery)

### 8.3 Commingling math
- Taint percentage propagates per hop using the chosen methodology
- Confidence decays with hop count and with commingling events
- "Severability of traceability" flagged when taint < threshold

### Open questions
- Default jurisdiction-aware method pick: US criminal → LIFO + FIFO side-by-side, US civil → LIBR primary, UK → pari passu + rolling charge. Does that match your view?
- Do we want a "victim recovery mode" that explicitly runs the methodology most favorable to victim claimants (typically LIBR or pari passu)?

---

## 9. Attribution & OSINT

### 9.1 Source layers (priority order on conflict)
1. **Direct evidence** — exchange subpoena returns, KYC docs, court records (always wins)
2. **First-party intelligence** — your own cluster DB, prior cases
3. **BYOK commercial feeds** — Chainalysis, TRM, Elliptic, Crystal, Merkle Science, Arkham (via Sumsub-style BYOK pattern)
4. **OSINT** — Etherscan tags, OFAC SDN, breach data, scam DBs, Telegram/Discord leaks, GitHub leaks
5. **Heuristic clustering** — common-input, change-output, behavioral
6. **AI-inferred** — lowest confidence, always flagged

Every attribution carries: `{source, confidence_0_to_1, evidence_links, timestamp, attributor_id}`. **No attribution without all four.** This is the "glass box" pattern ([TRM Labs glass-box attribution](https://www.trmlabs.com/glossary/glass-box-attribution)).

### 9.2 OSINT Agent
Autonomous web search + structured-source pulls. Maintains per-entity dossiers. Re-runs on schedule when watching live cases.

### Open questions
- Which BYOK providers do we wire first? My pick: Chainalysis + TRM + Arkham (broadest coverage), then add Crystal for sanctions depth.
- Do we surface "low confidence" attributions to the investigator by default, or hide them behind a toggle? (Default-hide, with a "show speculative" mode.)

---

## 10. Collaboration

- **Real-time canvas** — CRDT-backed (Yjs or Automerge), multiple investigators on the same graph
- **Hypothesis branches** — fork the case graph to test alternative theories without polluting the canonical view
- **Comments** — anchored to nodes, edges, or time ranges, not just to the case
- **Roles** — investigator, supervisor, compliance officer, prosecutor, expert witness, observer (read-only)
- **Cross-agency sharing** — case package export with redaction controls
- **Compliance handoff** — when a freeze opportunity is detected at a regulated VASP, auto-draft the compliance package

### Open questions
- Federated cases across agencies (Deconflict-style): do we want a "ping" mechanism where one agency's address-of-interest hits another agency's active case and they get notified (consent-gated)?

---

## 11. Reporting

### 11.1 Templates
- SAR (US FinCEN)
- 314(a) request package
- Seizure affidavit (with the methodology disclosure section the courts now demand)
- Civil complaint exhibit set
- Expert declaration
- Internal compliance memo
- Victim notification letter

### 11.2 Reproducibility pack
Every report ships alongside a `.zip` containing:
- Frozen data snapshot (Parquet)
- Tracing parameters JSON
- Methodology choice + rationale
- AI model version, prompt log, agent traces
- SHA-256 manifest
- A `replay.sh` script that re-runs the exact trace

This is what survives a **D'Aloia-style mathematical audit**.

### Open questions
- Optional anchoring of the manifest hash to a public chain (BTC OP_RETURN or Ethereum calldata) for tamper-evidence timestamping?

---

## 12. Graphing — UTXO vs Account Models

| | UTXO model (BTC family) | Account model (EVM, SOL, Cosmos) |
|---|---|---|
| Node | Output (txid:vout) | Address |
| Edge | Spending tx | Transfer / call |
| Identity | Heuristic clusters (CIH, change detection) | Address-native |
| Balance | Sum of unspent outputs | State at block |
| Tracing primitive | Per-satoshi haircut / FIFO / poison | Per-transfer attribution + internal call expansion |

The platform stores **both representations**, and the tracing engine picks the appropriate primitive per chain. Visualization unifies them — a UTXO cluster renders as a single logical node by default, expandable to its constituent outputs.

### Open questions
- For BTC, do we ship our own clustering or rely on BYOK feeds? My take: ship our own (CIH + change heuristics) as the always-available baseline, augment with BYOK where licensed.

---

## 13. AI Layer (the part you really asked about)

### 13.1 Architecture

```
                    ┌─────────────────────────────────┐
                    │  Orchestrator (planner LLM)     │
                    │  - reads CaseManifest           │
                    │  - decomposes into tasks        │
                    │  - assigns specialist agents    │
                    └────────────┬────────────────────┘
                                 │
       ┌─────────┬───────┬───────┼───────┬────────┬─────────┐
   Intake   Scope   Tracer   Bridge   Swap   Attribution  Watcher
                                 │
                    ┌────────────▼────────────────────┐
                    │  Critic / Red-team agent        │
                    │  - challenges every conclusion  │
                    │  - forces evidence links        │
                    └────────────┬────────────────────┘
                                 │
                    ┌────────────▼────────────────────┐
                    │  Narrative agent (report draft) │
                    └─────────────────────────────────┘
```

### 13.2 Memory stack (hybrid, per [State of AI Agent Memory 2026](https://dev.to/vektor_memory_43f51a32376/the-state-of-ai-agent-memory-in-2026-what-the-research-actually-shows-3aja))

| Tier | Tech | TTL | Purpose |
|---|---|---|---|
| Working | Redis | minutes–hours | current tool outputs, recent reasoning, active task state |
| Episodic | Zep / Graphiti (graph + vector, **timestamped**) | case lifetime | "what happened in this case", "what happened in similar cases" — temporal queries matter |
| Semantic | Vector DB (pgvector or Weaviate) | permanent | typology embeddings, heuristic patterns, learned address fingerprints |
| Procedural | File-backed Skills (Markdown playbooks, versioned in Git) | permanent | per-typology investigation recipes ("ransomware playbook", "pig-butchering playbook") |
| Durable | Postgres + S3 (immutable, hash-anchored) | forever | every agent action, every tool call, every prompt — court-grade audit |

Why this split: Zep's Graphiti scores 63.8% on the LongMemEval temporal retrieval benchmark — investigations are inherently temporal, so a flat vector store is the wrong default ([Vectorize benchmark coverage](https://vectorize.io/articles/best-ai-agent-memory-systems)).

### 13.3 Training loop

1. Investigator reviews every AI claim with **Approve / Reject / Correct** buttons.
2. Approvals + corrections become a labeled dataset.
3. **Per-typology adapters** (LoRA) trained nightly/weekly.
4. **Skill library** (procedural memory) is editable Markdown — investigators write new playbooks, the platform versions them in Git.
5. **Replay/regression** — when a heuristic changes, we re-run it against closed cases and report any conclusion deltas before letting it ship.

### 13.4 Autonomous-trace mode

For the "follow a tx to its final destination, dozens to hundreds of hops" workflow:

- Tracer Agent gets a starting tx + stopping rules (deposit at known VASP, mixer entry, dust threshold, depth cap, taint < ε)
- Expands BFS with budget enforcement
- Each frontier expansion is checkpointed (the [checkpoint-restore pattern](https://www.indium.tech/blog/7-state-persistence-strategies-ai-agents-2026/))
- Bridge crossings hand off to Bridge Agent
- Swap events hand off to Swap Agent
- Each node gets attributed by Attribution Agent in parallel
- Critic agent reviews the trace tree, flags weak links
- Final output: trace graph + narrative + reproducibility pack

This is the workflow that competes with TRM Orion. Expected runtime for a 100-hop multi-chain trace: minutes, not hours.

### 13.5 Guardrails
- **No autonomous freeze/seizure recommendations** without human sign-off (C4)
- **No public attribution** without confidence ≥ threshold + ≥2 independent sources
- **Every claim links to evidence** — the UI refuses to render a claim that doesn't
- **Prompt + model + tool log** stored durably for every action
- **Red-team agent** runs on every conclusion before it surfaces to the investigator

### Open questions
- Local LLM vs frontier API? Your background in local LLM deployment + RunPod suggests we should design for **hybrid**: frontier (Claude/GPT) for orchestration and narrative, fine-tuned local (Llama 3.x / Qwen 2.5) for the high-volume tracing/attribution loops. Cheaper, faster, and works in air-gapped LE deployments.
- Per-tenant vs per-case fine-tunes? Per-tenant scales better; per-case is overkill except for the very largest investigations.

---

## 14. Alerts & Live Watching

### 14.1 Watch types
- **Address watch** — any tx in/out
- **Balance watch** — crosses threshold
- **Counterparty watch** — interacts with risk-tier ≥ N
- **Exchange-deposit watch** — funds land at a VASP we can serve (freeze window opens)
- **Bridge-crossing watch** — funds leave to chain X
- **Dormancy break** — address inactive ≥ N days suddenly moves
- **Cluster expansion** — new address joins a watched cluster

### 14.2 Rule DSL
Editable, versioned, AI-suggested from case learnings:

```yaml
rule: "Freeze window — exchange deposit"
when:
  address in watchlist.exchange_deposits
  and tx.value_usd > 50000
  and counterparty.entity_type == "vasp"
  and counterparty.jurisdiction in compliance.responsive_jurisdictions
notify:
  - on_call_investigator (page)
  - case.compliance_officer (email)
within: 60 seconds
sla:
  freeze_request_drafted: 15 minutes
```

### Open questions
- Default notification channels per role?
- Do we let investigators write Python for advanced rules, or constrain to YAML DSL for safety?

---

## 15. Evidence & Case Management

- **Content-addressed storage** (every artifact stored by hash)
- **Optional anchoring** to BTC/ETH for tamper-evident timestamp
- **Append-only audit log** (DB + S3 mirror)
- **Document vault** for subpoena returns, KYC docs, court orders (encrypted at rest, per-case keys)
- **Legal hold** flag suspends deletion
- **eDiscovery export** (Relativity-compatible load files)

---

## 16. Platform & Ops

- SSO + MFA, hardware key required for freeze/seizure actions
- RBAC + ABAC, case-scoped
- Tenancy: agency → department → team → case
- **Deployment modes**: SaaS, dedicated cloud, on-prem, air-gapped
- **Compliance paths**: SOC2 Type 2 → FedRAMP Moderate → FedRAMP High → CJIS
- Cost guardrails per case (compute, BYOK provider calls, LLM tokens)

### Open questions
- Do we ship a single-investigator "pro" tier for private-sector forensic accountants and law firms, or stay LE/enterprise-only?

---

## 17. Tech stack proposal (starting point — argue with me)

| Layer | Choice | Why |
|---|---|---|
| Data ingest | Allium subscription + self-hosted Erigon/Reth/Geth + Bitcoin Core | Coverage now, control later |
| Cold store | Parquet on S3/R2 | Cheap, columnar, queryable from anywhere |
| Hot graph | **TigerGraph** (or Memgraph) | 900x faster than Neo4j on 3-hop, critical for deep traces |
| Case graph | Postgres + Apache AGE | Per-case subgraphs, transactional |
| Vector | pgvector (start) → Weaviate (scale) | Co-located with Postgres until volume forces a split |
| Agent memory | Zep / Graphiti pattern | Temporal-graph memory, the right primitive for investigations |
| Agent framework | Letta or LangGraph | Stateful, checkpointable |
| Orchestrator LLM | Frontier (Claude 4 / GPT-5 class) | Quality matters for planning |
| Worker LLM | Fine-tuned Llama 3.3 / Qwen 2.5 on RunPod | Volume, cost, air-gap-able |
| Frontend | Next.js + Tailwind + PixiJS (graph) + Cytoscape (fallback) | Matches your stack |
| Backend | Node/Express + Python (tracing workers) | Node for API, Python for the math-heavy + ML |
| Realtime collab | Yjs (CRDT) over WebSocket | Battle-tested |
| Queue | Redis Streams or NATS JetStream | Durable, checkpointable |
| Deploy | Fly.io (start) → AWS GovCloud (LE path) | Matches your stack; LE path required eventually |

---

## 18. Phased build (90-day → 12-month)

**Phase 0 (weeks 1–4) — Foundations**
Case model, intake, evidence vault, single-chain (Ethereum) trace + UI, FIFO accounting, basic OSINT pull.

**Phase 1 (months 2–3) — Multi-chain core**
Bitcoin (UTXO engine), BSC, Base, Arb, Polygon, TRX. CCTP + LayerZero + Wormhole bridges. Visual canvas v1. LIFO + LIBR added.

**Phase 2 (months 4–6) — AI agent layer**
Orchestrator + Tracer + Bridge + Swap + Attribution + Narrative agents. Memory stack (Redis + pgvector + Zep). Glass-box reasoning trace. Skill library.

**Phase 3 (months 7–9) — Court-readiness**
Reproducibility pack, methodology disclosure, expert declaration template, replay engine. Pari passu + rolling charge for UK. SOC2 work begins.

**Phase 4 (months 10–12) — Live watching + collab**
Watcher Agent, rule DSL, real-time CRDT canvas, cross-agency sharing, compliance handoff workflow. FedRAMP path opens.

---

## 19. What I want your input on first

1. **Naming** — ChainSight is a placeholder.
2. **Audience priority** — LE-first, compliance-first, or private-investigator-first? Drives feature ordering.
3. **Methodology defaults** — does my US-criminal = LIFO+FIFO, US-civil = LIBR, UK = pari passu+rolling-charge default match your field experience?
4. **BYOK providers** — which three to wire first?
5. **Local LLM split** — agree with hybrid (frontier orchestrator + local workers), or go full local for air-gap?
6. **Anything in the mind map that's missing.** This is the most important question. What did I leave out that you'd never ship without?
