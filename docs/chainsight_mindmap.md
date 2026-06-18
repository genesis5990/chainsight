# ChainSight — Platform Mind Map

> Working codename. Replace freely. The point of this file is the structure, not the name.

```mermaid
mindmap
  root((ChainSight<br/>Investigation Platform))
    Intake & Case Context
      Case Manifest
        Crime typology (rugpull, ransomware, sextortion, pig-butchering, sanctions, NSPM-33, terror finance, IP theft)
        Jurisdiction & legal vehicle (criminal, civil forfeiture, regulatory, internal compliance)
        Victim narrative & affidavits
        Suspect/POI list
        IOCs (addresses, tx hashes, exchanges, domains, emails, phones, telegram handles)
        Subpoena/MLAT status tracker
      Time Window
        Incident T0
        Look-back window
        Look-forward / watch window
        Market context snapshot (prices, depegs, exploits, sanctions events)
      Evidence Chain-of-Custody root
    Asset Scope Discovery
      Chain Detection
        Direct chains from IOCs
        Inferred chains (bridge counterparties, wrapped asset siblings, L2 of same address)
        Privacy chain flags (XMR, ZEC shielded, Aleo)
      Valuation Snapshot
        Native units
        Fiat at T0, T_max, T_now (USD + jurisdiction FX)
        Stablecoin peg state
        Illiquid token NAV (DEX pool depth, slippage-adjusted)
      Scale Estimator
        Tx count forecast
        Hop depth forecast
        Branching factor estimate
        Compute budget pre-allocation
    Data Layer
      Hot Ingest
        Allium / Goldsky / QuickNode streams (Kafka, SNS)
        Self-hosted archive nodes (BTC, ETH, TRX, SOL, BSC, Base, Arb, Op, Polygon)
        Mempool feed (Blocknative, mempool.space)
      Cold Store
        Parquet on S3/R2 partitioned by chain/date
        Per-chain canonical schema (normalized across UTXO and account models)
      Address Intelligence
        Internal cluster DB
        BYOK feeds (Chainalysis, TRM, Elliptic, Crystal, Merkle Science, Arkham)
        OSINT sources (Etherscan tags, OFAC SDN, sanctioned wallets gov lists, breach datasets, scam DBs)
        Sumsub VASP attribution / CODE Travel Rule
      Graph Store
        TigerGraph or Memgraph (primary, for >3-hop traversal)
        Postgres + Apache AGE (case-scoped subgraphs)
    Tracing Engine
      UTXO Tracing (Bitcoin family)
        Haircut method
        Poison / taint
        FIFO on inputs/outputs
        Last-In-First-Out
        Lowest Intermediate Balance Rule (LIBR)
        Pari passu (English law)
        Rolling charge
      Account-Model Tracing (EVM, Solana, Tron, Cosmos)
        Per-address ledger reconstruction
        Internal call tree expansion (traces, not just txs)
        ERC-20 / SPL / TRC-20 transfer extraction
        Approvals & allowance abuse
      Swap & DEX Resolution
        Uniswap v2/v3/v4, Curve, Balancer, Raydium, Orca, Jupiter aggregator
        Multi-hop swap unwinding (router decoding)
        Price impact & slippage capture
        MEV sandwich / JIT detection
      Bridge & Cross-Chain
        Canonical bridge registry (LayerZero, Wormhole, Across, CCTP, Stargate, Synapse, Hop, deBridge, Squid)
        Message-id matching (src tx -> dst tx)
        Liquidity-network attribution (when no message id)
        Time-window heuristics for unattributed bridges
        Atomic-swap / HTLC detection
        Cross-chain cluster propagation
      Mixer & Obfuscation
        CoinJoin demixing (Wasabi, Whirlpool, JoinMarket)
        Tornado Cash temporal + amount correlation
        Peel chain detector
        Chain hopping pattern detector
        Privacy bridge exit watchers
    Accounting & Valuation
      Methodology Engine
        FIFO / LIFO / HIFO / Specific ID / Average cost
        UTXO-native lot tracking
        Per-wallet-per-asset basis (IRS Rev. Proc. 2024-28)
        Pari passu / rolling charge (English law)
        LIBR for commingled
      Side-by-side comparison runner
      Fee Accounting
        Gas, priority fee, blob fee
        Bridge fees, DEX fees, MEV extracted
      Commingling Mathematics
        Taint percentage propagation
        Confidence decay per hop
        Auditable math export (the "judicial mathematical audit")
    AI Agent Layer
      Orchestrator (planner)
      Specialist Agents
        Intake Agent (parse complaints, affidavits, exchange responses)
        Scope Agent (chain detection, value sizing)
        Tracer Agent (autonomous N-hop expansion with stopping rules)
        Bridge Agent (cross-chain message correlation)
        Swap Agent (router/path decoding)
        Attribution Agent (entity resolution, confidence scoring)
        OSINT Agent (web, socials, court records, breach data)
        Accounting Agent (run methodology variants)
        Narrative Agent (report drafting, declaration drafting)
        Watcher Agent (alert rules on live addresses)
        Critic / Red-Team Agent (challenges every conclusion)
      Memory Stack
        Working (Redis) — current case context, last N tool calls
        Episodic (vector + graph, Zep/Graphiti pattern) — what happened in this case and similar ones
        Semantic (vector) — typologies, heuristics, learned patterns
        Procedural (file-backed skills) — versioned playbooks per crime type
        Durable (Postgres + S3) — immutable audit log, court-grade
      Training & Feedback
        Investigator approve/reject every claim -> RLHF dataset
        Per-typology fine-tune adapters
        Heuristic library (editable, versioned)
        Replay / regression tests on closed cases
      Guardrails
        No attribution without confidence + source
        No conclusions without reproducible math
        Mandatory human sign-off on freeze/seizure recommendations
        Glass-box reasoning trace (TRM Orion style)
    Visualization
      Graph Canvas
        Force-directed + hierarchical + Sankey + timeline modes
        Multi-chain lanes (swimlanes per chain)
        Bridge edges visually distinct
        Value-weighted edge thickness
        Taint-weighted color
        Collapse/expand subgraphs (cluster -> entity)
      Timeline View
        Price overlay
        Market events overlay (depegs, exploits)
        Tx clusters as histograms
      Money Flow Sankey
        Source -> sink with fee/loss tributaries
      Geographic / Entity Map
        VASP locations
        Jurisdictional overlays
      Observer Mode
        Read-only courtroom presentation view
        Step-through playback of the trace
    Collaboration
      Multi-investigator real-time canvas (CRDT)
      Comment threads anchored to nodes/edges
      Hypothesis branches (case forks)
      Role-based access (LE, compliance, prosecutor, expert witness, observer)
      Cross-agency sharing (with redaction)
      Compliance dept handoff workflow
      Subpoena/Request tracker integrated with attribution feeds
    Reporting
      Report Composer
        Templates (SAR, 314(a), seizure affidavit, civil complaint exhibit, expert declaration)
        Auto-pulled exhibits (annotated graph snapshots, tx tables, math worksheets)
        Methodology disclosure section (mandatory)
      Export formats
        PDF with embedded reproducibility hash
        DOCX redline
        Court-grade exhibit bundle (zip with manifest + hashes)
        JSON case package (portable to other agencies)
      Reproducibility Pack
        Frozen data snapshot
        Tracing parameters
        AI model version + prompt log
    Alerts & Monitoring
      Address Watchlist
        Inbound/outbound thresholds
        Counterparty risk-tier triggers
        Exchange deposit detection (freeze opportunity)
        Bridge crossing detection
        Dormancy break alerts
      Rule Engine
        DSL for custom rules
        AI-suggested rules from case learnings
      Notification fanout
        Webhook, email, Slack, SMS, on-call paging
      SLA & freeze-window tracking
    Evidence & Case Management
      Hash-anchored evidence store (S3 + content addressing, optional anchoring to BTC/ETH for timestamp)
      Chain-of-custody log (append-only)
      Document vault (subpoena returns, exchange KYC, court orders)
      Case lifecycle states
      eDiscovery export
      Retention & legal hold
    Platform & Ops
      Auth (SSO, MFA, hardware key for seizure actions)
      RBAC + ABAC (case-scoped)
      Audit log (immutable)
      Tenancy (agency / firm / department)
      Air-gapped deployment option (LE / classified)
      Cost guardrails (per-case compute budget)
      CJIS / FedRAMP path
```

## Cross-cutting principles (north stars)

1. **Glass box, not black box.** Every AI claim links to data + reasoning + confidence. Courts now reject opaque tracing ([D'Aloia v Persons Unknown](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/)).
2. **Methodology pluralism.** FIFO, LIFO, HIFO, LIBR, pari passu, rolling charge — all runnable side-by-side on the same case ([Sammis Law](https://criminaldefenseattorneytampa.com/asset-seizure-asset-forfeiture/cryptocurrency/tracing/), [ASCPA forensic accounting](https://www.ascpa.com/news/2fdf3bdc-6f09-40bf-a41c-7a6477478ac2:following-the-money-forensic-accounting-tracing-methods-best-practices)).
3. **Reproducibility is a feature.** Every report ships with a frozen data + parameter pack so opposing counsel can re-run it.
4. **AI is a force multiplier, not a decision maker.** Freezes, seizures, and final attributions require human sign-off.
5. **Memory compounds.** Every closed case enriches the heuristic library and the typology models.
