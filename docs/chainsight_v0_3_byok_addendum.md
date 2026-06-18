# ChainSight v0.3 — BYOK Provider Marketplace Addendum

> Decision: **Bring Your Own Key (BYOK) is a first-class architectural pillar, not a configuration detail.**
>
> Every external data provider — blockchain explorers, attribution feeds, OSINT services, market-data APIs, AI model providers — is interchangeable through a unified provider abstraction. Agencies bring their own commercial licenses; ChainSight ships the integration surface, the agencies bring the data.

This addendum extends v0.1 (vision), v0.2 (accuracy spine), and the v0.3 PSR module.

---

## Why this matters (the commercial thesis)

Selling a forensics platform to law enforcement, regulators, financial-crime units, and private-sector compliance teams has one persistent friction point: **everyone already has data subscriptions**.

- A federal agency has Chainalysis Reactor seats.
- A state task force has TRM Forensics.
- A bank's compliance team has Elliptic Navigator + a Crystal subscription.
- A private investigator has Etherscan Pro and an Arkham license.
- A blockchain analytics firm has direct relationships with Allium, Dune, and Goldsky.

A platform that **forces** agencies to use *our* data deals doesn't sell. A platform that **leverages what they already pay for** and adds tooling/AI/workflow on top is the one they'll buy. This is also the [Sumsub BYOK model](https://docs.sumsub.com/docs/vasp-attribution) — proven commercially.

It's not just compliance with their procurement reality. It's also:

- **Trust** — agencies don't have to send data through a vendor's keys
- **Sovereignty** — air-gapped tenants point to in-network providers only
- **Negotiation leverage** — agencies can swap providers without changing platforms
- **Cost ownership** — the agency sees and controls their own API spend
- **Compliance** — data residency and contractual obligations stay with the agency, not the platform vendor

**This is one of the top three commercial differentiators of the platform.** Treat it accordingly.

---

## Part 1 — Provider categories and known integrations

| Category | Purpose | Providers (initial wire-list) |
|---|---|---|
| **Block explorers (RPC + indexed API)** | Read raw chain data, tx detail, balances, internal calls | Etherscan family (Etherscan, BscScan, Polygonscan, Arbiscan, Optimistic Etherscan, Snowtrace, FtmScan, BaseScan, Lineascan, etc.), Blockchair, Blockchain.com, Blockstream, Mempool.space, Solscan, Solana FM, Tronscan, SuiScan |
| **Indexed multi-chain data** | Fast cross-chain queries, Parquet/SQL access | Allium, Dune, Goldsky, QuickNode Streams, Covalent, The Graph, Bitquery, Footprint, Flipside |
| **RPC providers** | Direct node access for archive queries | Alchemy, Infura, QuickNode, Ankr, Tenderly, BlockPi, GetBlock, NodeReal |
| **Attribution / risk intelligence** | Entity labels, risk scoring, sanctions screening | Chainalysis (Reactor + KYT), TRM Labs (Forensics + Risk + Orion), Elliptic (Navigator + Lens + Investigator), Crystal Intelligence, Merkle Science, Arkham, Scorechain, AnChain.AI, Coinfirm, CipherTrace, Solidus, NOMINIS |
| **Sanctions & watchlists** | Government & multinational lists | OFAC SDN, EU Restrictive Measures, UN Security Council, UK OFSI, OpenSanctions, ComplyAdvantage |
| **Market data** | Spot, OHLC, historical fiat conversion | CoinGecko, CoinMarketCap, Kaiko, CryptoCompare, Messari, CoinAPI, Pyth, Chainlink Price Feeds, TradingView |
| **DeFi / DEX data** | Pool depth, swap routes, slippage | DefiLlama, GeckoTerminal, 1inch API, 0x API, Jupiter, Uniswap subgraphs |
| **Bridge data** | Cross-chain message correlation | Socket, LiFi, Squid, deBridge APIs, native bridge indexers (LayerZero scan, Wormholescan, Across) |
| **OSINT (people/entity)** | Real-world identity correlation | Pipl, Hunter, Clearview (where licensed), LexisNexis, Sayari, OpenCorporates, Pacer, World-Check |
| **OSINT (web/social)** | Telegram/Discord/X/forum monitoring | Telegram API, Discord API, X/Twitter Enterprise, Maltego, SocialLinks, Echosec |
| **Travel rule / VASP directories** | VASP attribution & jurisdiction | Sumsub, Notabene, TRP, CODE, OpenVASP, 21 Analytics |
| **Code/contract intelligence** | Smart contract behavior, audit data | Etherscan source verification, Sourcify, Phalcon, Tenderly, Forta, OpenZeppelin Defender |
| **AI / LLM providers** | Orchestrator and worker models | Anthropic, OpenAI, Google, Mistral, xAI, Together, Fireworks, RunPod (for self-hosted Llama/Qwen/etc.), Bedrock, Azure OpenAI |
| **Embedding providers** | Vector memory | OpenAI, Voyage, Cohere, Mistral, BGE (self-hosted) |
| **Notification / comms** | Alerting fanout | Twilio, Resend, SendGrid, PagerDuty, Opsgenie, Slack, Microsoft Teams, Signal (where supported) |
| **Document intelligence** | Subpoena returns, exchange CSVs, PDFs | AWS Textract, Google Document AI, Azure Form Recognizer, Unstructured |

This list is **not** what we build day one — it's the catalog the agency picks from. Day-one wire-up is much smaller (see Part 6).

---

## Part 2 — The Provider abstraction (data model)

```typescript
ProviderRegistry {
  providers: ProviderDefinition[]   // shipped catalog, updated via signed releases
}

ProviderDefinition {
  id: string                        // "etherscan", "trm_labs", "chainalysis_reactor", "anthropic", ...
  display_name: string              // "Etherscan", "TRM Labs Forensics", ...
  category: ProviderCategory        // see Part 1
  vendor_url: string                // landing page link for the agency procurement team
  signup_url: string                // direct link to purchase/request a key
  pricing_model: enum               // free, freemium, paid_tiered, enterprise_contact
  pricing_notes: string             // human-readable summary; not a contract
  capabilities: Capability[]        // structured list of what this provider can satisfy
  auth_method: enum                 // api_key, oauth2, bearer_token, mtls, signed_request, basic
  auth_schema: JSONSchema           // what fields the agency must enter
  endpoints: EndpointSpec[]         // API surface this connector covers
  rate_limits: RateLimitSpec        // documented defaults; per-key overrides allowed
  data_residency: string[]          // jurisdictions where this provider stores/processes
  compliance_certs: string[]        // SOC2, ISO27001, FedRAMP, CJIS, etc.
  status: enum                      // available, beta, deprecated
  shipped_in_version: semver
  integration_owner: string         // internal — who maintains this connector
  test_endpoint: EndpointSpec       // health-check call used to validate a new key
}

Capability {
  name: string                      // "get_tx_by_hash", "get_address_balance",
                                    // "get_entity_attribution", "get_sanctions_status",
                                    // "get_price_at_timestamp", "decode_router_swap", ...
  required_for_features: FeatureRef[]   // which platform features need this capability
}

AgencyProviderInstall {
  id: uuid
  agency_id: uuid                   // tenant
  provider_id: string               // FK to ProviderDefinition.id
  display_label: string             // agency-set, e.g. "Etherscan — main key" / "Etherscan — overflow"
  credential_ref: HSM_KeyRef        // pointer to encrypted credential in agency's HSM/KMS
  enabled: bool
  enabled_capabilities: Capability[]  // agency may restrict which capabilities use this key
  priority: int                     // ordering when multiple installs satisfy same capability
  budget_limits: BudgetSpec         // hard caps on spend per day/month/case
  rate_limit_override: RateLimitSpec | null
  scope: enum                       // agency_wide | department | case_specific
  scope_refs: uuid[]                // which departments/cases this install applies to
  added_by: investigator_id
  added_at: timestamp
  last_health_check: HealthResult
  current_period_usage: UsageStats
}

ProviderResolution {
  // The runtime answer to "which provider should satisfy this capability for this call?"
  capability: Capability
  case_id: uuid
  resolved_install: AgencyProviderInstall
  fallback_chain: AgencyProviderInstall[]  // try these if the primary fails
  resolution_reason: string         // why this one was picked (for audit)
}
```

**The two important properties:**

1. **Capability-based, not provider-named, internal calls.** No code in the platform ever says "call Etherscan." It says "satisfy `get_tx_by_hash` for chain=ethereum." The resolver picks the install. This is what makes providers interchangeable.

2. **Per-agency, per-case scoping.** A federal agency might wire Chainalysis Reactor agency-wide, but a single specific case requires data segregation (sealed indictment, etc.) so it gets its own provider keys. The data model supports both.

---

## Part 3 — The Provider Marketplace UI

This is what the agency administrator sees:

### 3.1 Catalog view
- Grid/list of every `ProviderDefinition` in the shipped registry
- Filters: category, pricing model, compliance certs, data residency
- Each card shows: name, what it does, pricing model, **direct link to vendor signup page**, "Add to my agency" button
- A "Required capabilities" panel shows which platform features need coverage and flags gaps

### 3.2 Installed providers view
- List of every `AgencyProviderInstall` the agency has configured
- Health status (✅ live / ⚠️ degraded / ❌ failed last check / 🔒 quota near cap)
- Usage stats (this month, this case, vs. budget)
- "Test now," "Rotate key," "Disable," "Remove" actions
- Per-capability override matrix: "for `get_entity_attribution`, prefer TRM, fallback to Chainalysis, last-resort Elliptic"

### 3.3 Coverage matrix
- Y-axis: every capability the platform needs
- X-axis: every provider the agency has installed
- Cells: ✅ satisfied, ❌ no coverage, ⚠️ degraded (rate-limit close, quota close)
- Highlights **unsatisfied capabilities** — features that won't work until a key is added
- Suggests providers from the catalog that would fill the gap

### 3.4 Key entry flow
1. Agency admin picks a provider from the catalog
2. Modal shows vendor info, link to signup, what the key will be used for
3. Admin pastes the key (or completes OAuth, or uploads mTLS cert)
4. **Health check runs immediately** — confirms the key works
5. Admin sets scope (agency-wide, department, case-specific)
6. Admin sets budget caps and rate-limit overrides
7. Key is encrypted with the agency's KMS key, stored as `HSM_KeyRef`
8. Capability resolver picks it up on the next call

### 3.5 Audit & governance
- Every key entry, rotation, scope change, and removal is logged to the immutable audit trail (B8)
- Per-key usage logs (which case used this key, when, for what capability, what it cost)
- Monthly provider-spend reports per agency / per department / per case
- **Investigator sees which provider answered which question** in every report (provenance)

---

## Part 4 — The Capability Router (runtime)

When any agent or service needs external data, it calls the **Capability Router**, not a provider:

```python
# wrong (never written in the codebase):
etherscan.get_tx(tx_hash)

# right (always written this way):
data = capability_router.resolve(
    case_id=case.id,
    capability="get_tx_by_hash",
    args={"chain": "ethereum", "tx_hash": tx_hash},
)
```

The router:

1. **Looks up which installs satisfy this capability** for this case, in priority order.
2. **Checks budget and rate limits** for each candidate install.
3. **Picks the primary**, falls back through the chain on failure.
4. **Caches identically-keyed responses** at the case level for reproducibility.
5. **Records the resolution** in the `ProviderResolution` log — every byte of data the platform used links back to which provider supplied it.
6. **Emits a BeliefAtom provenance entry** so the data's source is permanently bound to any conclusion built on it.

### Why this changes accuracy
This is **also** an accuracy feature, not just a commercial one. If a case uses Chainalysis attribution for one address and TRM for another, the BeliefAtoms record that explicitly. If two providers disagree on an attribution, the Critic Agent (B5) is notified and raises a Challenge automatically. The investigator sees: "TRM says this is Binance hot wallet 4; Chainalysis says it's an unattributed cluster; resolve before promoting to court-grade."

This is what [TRM's glass-box attribution](https://www.trmlabs.com/glossary/glass-box-attribution) is gesturing at, and what BYOK natively enables: **multi-source corroboration becomes the default, not an upsell**.

---

## Part 5 — Failure modes and how we handle them

| Failure | Behavior |
|---|---|
| Primary provider down | Fallback chain triggers; investigator notified if all installs in the chain fail; case work pauses on that capability with a clear "missing data" indicator |
| Quota/budget exhausted | Soft-fail to fallback; if no fallback, surface to investigator with "your TRM budget for this month is exhausted — proceed with Chainalysis, escalate, or pause?" |
| Two installs disagree on attribution | Critic Agent raises Challenge; UI shows side-by-side comparison; investigator resolves before court-grade promotion |
| Provider deprecates an API endpoint | Connector versioning catches it; agency admin sees a deprecation warning in the marketplace; replay of old cases still works because we cached the response |
| Agency rotates a key | Old key marked retired, new key takes over; reproducibility pack of any in-flight case is annotated with the rotation event |
| Provider changes attribution after the fact | **This is the [ChainArgos non-determinism problem](https://medium.com/chainargos/blockchain-tracing-determinism-5a690a95ca5f).** Solved by B3 reproducibility snapshots: the attribution snapshot pinned at case-close survives even if the provider changes its mind later. |

---

## Part 6 — Day-one wire-list (what we actually build first)

The catalog is large; the initial build is focused. **Phase 0–2 must ship with working connectors for:**

**Block explorers / chain data**
- Etherscan family (all V2 API-compatible chains — one connector, many keys)
- Blockchair (multi-chain UTXO + EVM)
- Blockstream / Mempool.space (BTC)
- Solscan + Solana RPC
- Tronscan
- Allium (the indexed multi-chain warehouse — single biggest leverage point)

**Attribution**
- Chainalysis (BYOK)
- TRM Labs (BYOK)
- Elliptic (BYOK)
- Arkham
- OFAC SDN + OpenSanctions (free, but treated as proper providers for consistency)

**Market data**
- CoinGecko
- Kaiko (paid, for institutional-grade historical pricing)

**RPC**
- Alchemy + Infura (redundancy)

**AI**
- Anthropic + OpenAI (orchestrator tier)
- RunPod (self-hosted worker tier — matches your existing infra)

**Notification**
- Resend (email — matches your stack)
- Twilio (SMS/voice for SLA pages)

Everything else from the Part 1 catalog gets a connector in Phase 3 or later, ordered by customer demand. The marketplace UI shows "available," "beta," and "request integration" tiers so agencies can see what's coming.

---

## Part 7 — Provider catalog updates

The `ProviderRegistry` is a versioned, signed artifact shipped with each ChainSight release:

- **Quarterly release cadence** for catalog updates (new providers, deprecations, capability additions)
- **Signed manifest** so air-gapped deployments can verify catalog authenticity
- **Capability schema versioning** — when we add a new capability (e.g. "get_zk_proof_data"), existing installs continue to work; only features that need the new capability gain dependencies
- **Community-suggested providers** — agencies can request new integrations through a portal; popular requests become roadmap items

---

## Part 8 — Where this updates the rest of the schema

Every previous module gets a small but real change:

| Module | Update |
|---|---|
| **v0.1 Domain 2 (Time/market context)** | Market data comes via the Market Data capability — agencies pick which feeds (CoinGecko vs Kaiko vs Pyth) |
| **v0.1 Domain 3 (Chain scope)** | Chain detection runs against whatever explorers the agency has wired; an agency can be "Ethereum-only" by simply not installing other chain providers |
| **v0.1 Domain 4 (Scope estimator)** | Cost estimates include **per-provider API spend** projection, not just compute |
| **v0.1 Domain 7 (Bridges)** | Bridge correlation uses whichever bridge-data providers are installed; falls back to heuristic matching when no message-id source is available |
| **v0.1 Domain 9 (Attribution & OSINT)** | This is the most provider-heavy module — every attribution carries its source provider as part of the BeliefAtom provenance |
| **v0.1 Domain 11 (Reporting)** | Reports include a "Data sources used" section that lists every provider that contributed; reproducibility pack pins versions |
| **v0.2 B1 (Belief State)** | `BeliefAtom.provenance` includes `provider_install_id` for every source |
| **v0.2 B2 (Tiered determinism)** | Provider attribution data is **T2 (attribution-snapshot-deterministic)** — frozen in the reproducibility pack |
| **v0.2 B3 (Reproducibility)** | Reproducibility pack includes the exact provider responses cached at the time of the trace, so even if a provider's data changes, the case replays identically |
| **v0.2 B4 (Confidence)** | Multi-provider corroboration **raises** confidence on agreement; single-source attributions carry lower confidence flag |
| **v0.2 B5 (Critic)** | Disagreements between providers are automatic Challenges |
| **v0.2 B8 (Privacy)** | Provider keys live in the agency's HSM/KMS, never on platform infrastructure; air-gapped tier supports on-prem provider mirrors |
| **v0.3 PSR module** | Path reports cite the provider that supplied each entity label, swap decode, or bridge correlation |

---

## Part 9 — Commercial framing (the elevator pitch update)

> ChainSight is the autonomous, court-defensible blockchain investigation platform. It connects to **your existing data subscriptions** — Chainalysis, TRM, Elliptic, Etherscan, Allium, your own RPC nodes — and adds the AI agent layer, the multi-methodology accounting engine, the reproducibility-guaranteed reporting, and the cross-investigator collaboration that turn raw data into court-grade evidence. **You bring your data deals; we bring the engine.**

That's the line. It defuses the procurement objection ("we already pay Chainalysis"), it positions us *with* the incumbents rather than *against* them, and it makes "ChainSight + your stack" cheaper than "ChainSight as a replacement."

---

## Part 10 — Open question for v0.4

**G8 (new). Reseller / referral economics.**
Some providers offer revenue share when you bring them paying customers. Do we want to pursue that explicitly (the marketplace becomes a discovery + procurement channel for providers) or stay strictly neutral (we're a tool, not a broker)? My instinct: **stay neutral in v1, optional revenue-share program in v2 with full disclosure to agencies.** Vendor neutrality is part of the trust pitch. Agree?

---

## Part 11 — TL;DR

BYOK is now first-class:

- Every external data source is wired through a **capability-based router**, not a hard-coded vendor call.
- Agencies install their own keys through a **Provider Marketplace** in the admin UI, with vendor signup links surfaced inline.
- Multiple installs per capability are allowed, with priority, fallback, scope, budget, and per-case overrides.
- Every BeliefAtom records which provider supplied its source data — provenance is automatic.
- Multi-provider disagreement becomes a Critic Challenge by default — corroboration is the default, not an upsell.
- Reproducibility packs freeze the exact provider responses used, defeating the [tag-drift non-determinism problem](https://medium.com/chainargos/blockchain-tracing-determinism-5a690a95ca5f).
- Air-gapped deployments work because nothing depends on platform-vendor keys.
- The marketplace itself becomes a major commercial differentiator and a sales conversation opener.

This is now a top-three pillar of the platform alongside the **Belief State Service** (accuracy) and the **Reproducibility Pack** (court-defensibility).
