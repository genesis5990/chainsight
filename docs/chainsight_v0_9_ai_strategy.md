# ChainSight v0.9 — AI/LLM Strategy

> This document consolidates AI/LLM choices that have been scattered across a dozen prior addenda into a coherent strategy. The strategy must remain compatible with all four pillars — especially Pillar 4 (sovereign deployment, including air-gapped).
>
> The single sentence that defines the strategy: **ChainSight uses a heterogeneous AI stack with small specialist models as the default and frontier LLMs as the reserved fallback for ambiguous reasoning. All model providers are BYOK. AI features can be disabled at any granularity, including entirely.**
>
> The rest of this document is the rationale, the model picks, the deployment modes, the toggles, the licensing posture, and the upgrade path.

---

## Part 1 — The strategic frame

### 1.1 The realization that shapes everything

A blockchain forensics platform does many AI tasks. Most of them are **not the kind of task that requires a frontier model**:

- "Decode this tx into structured fields" — schema-constrained extraction
- "Classify this transaction as transfer / swap / bridge / approval" — narrow classification
- "Extract entities from this subpoena PDF" — structured extraction
- "Suggest the top-3 evidentiary paths" — ranked retrieval with constraints
- "Summarize this transaction in one paragraph" — bounded generation with citation requirements
- "Detect peel-chain pattern in this sequence" — pattern recognition with rule support

A few are. Specifically:

- **Orchestration** — deciding which specialist to invoke, in what order, with what handoffs, across dozens of steps
- **Long-horizon reasoning** — when a multi-hop trace requires keeping the thread coherent across hundreds of intermediate facts
- **Ambiguous judgment** — when the Critic Agent's challenges need resolution by a model with broader reasoning capacity
- **Cross-examination prep** — anticipating defense counsel's arguments requires creative adversarial reasoning

The [SLM research consensus](https://research.nvidia.com/labs/lpr/slm-agents/) and the [Small Language Models for Agentic Systems survey](https://www.arxiv.org/pdf/2510.03847.pdf) both make the same case: **fine-tuned 1-12B SLMs are often superior** for the agentic workloads that dominate, with **frontier LLMs reserved as targeted fallback** for the truly hard generalist moments.

This matches our needs exactly. Most of the 30+ AI features in ChainSight are repetitive, schema-constrained, and high-volume. A few are open-ended and high-stakes. The strategy follows the workload.

### 1.2 The heterogeneous stack — three tiers

| Tier | Purpose | Model class | Examples (defaults) |
|---|---|---|---|
| **Tier A — Specialist SLMs** | High-volume repetitive tasks: extraction, classification, decoding, summarization, routing | Fine-tuned 1-12B SLMs | Phi-4 (14B), Qwen 3.5 (8B), Llama 4 Scout, custom LoRA adapters |
| **Tier B — General workers** | Medium-complexity reasoning: narrative drafting, attribution synthesis, suggestion ranking | Mid-tier open or commercial | DeepSeek V4 Pro, Qwen 3.5 32B, Claude Sonnet 4.6, GPT-5.4 mini |
| **Tier C — Frontier reasoners** | Ambiguity resolution, long-horizon orchestration, adversarial reasoning | Frontier closed or top open | Claude Opus 4.6/4.7, GPT-5.4/5.5, Gemini 3.1 Pro, DeepSeek V4 Pro Max |

**The orchestrator decides which tier handles each call.** Routing is based on task type, confidence requirements, latency budget, and the agency's configured cost preferences. Most calls go to Tier A; the orchestrator promotes to Tier B or C when the task signals require it.

### 1.3 Why this maps to ChainSight's specific agent layer

Every named agent from prior addenda maps to a tier:

| Agent | Default tier | Why |
|---|---|---|
| Orchestrator (planner) | **Tier C** | Long-horizon reasoning, must keep coherent thread across many specialists |
| Intake Agent | Tier A | Schema-constrained extraction from complaints and affidavits |
| Scope Agent | Tier A | Constrained estimation with rule support |
| Tracer Agent | Tier B | Hop-by-hop reasoning with tool calls; can elevate to Tier C for hard branches |
| Bridge Agent | Tier A | Specialized message-correlation; very repetitive |
| Swap Agent | Tier A | Calldata decoding with known ABIs |
| Attribution Agent | Tier B | Synthesis across multiple providers; surfaces disagreement |
| OSINT Agent | Tier B | Open-domain search + extraction |
| Accounting Agent | Tier A (rule-based; no LLM for math) | Math runs in deterministic Math Service; LLM only formats |
| Narrative Agent | **Tier C** | Court-grade drafting; must navigate methodology, evidence chain, methodology disclosure |
| Watcher Agent | Tier A | Rule evaluation |
| Critic Agent | **Tier C** | Adversarial reasoning, must catch what other agents miss |
| Suggestion Agent | Tier B | Ranked retrieval with explainable rationale |
| Verifier Agent | Tier A | Citation-token enforcement; small specialized SLM is perfect |
| Inspector | Mixed | Decoded action: Tier A; plain-language summary: Tier B; Critic notes: Tier C |
| Extraction Agent (documents) | Tier A | Schema extraction from PDFs |

Tier A handles 70-80% of all model calls by volume. Tier B handles 15-25%. Tier C handles the few-percent that are most consequential.

This is what makes the BYOK economics realistic. An agency paying frontier-LLM rates for every Tier A call would burn $50k/month on a busy case load. With Tier A on cheap or self-hosted models and Tier C reserved for hard reasoning, the same case load runs for a fraction of that.

---

## Part 2 — Default model choices

### 2.1 SaaS Blind tier (default for hosted customers)

Out-of-the-box defaults the agency can override:

| Tier | Default model | License | Hosting |
|---|---|---|---|
| Tier A specialists | Phi-4 (14B), Qwen 3.5 8B, custom LoRAs per task | Open (MIT, Apache 2.0) | ChainSight-hosted via vLLM in confidential enclaves |
| Tier B workers | DeepSeek V4 Pro (37B active MoE) or Claude Sonnet 4.6 | DeepSeek MIT / Anthropic API | DeepSeek self-hosted via vLLM; Claude via BYOK API |
| Tier C frontier | Claude Opus 4.6 (orchestrator + Critic + Narrative) | Anthropic API | BYOK Anthropic |

Per the research, **Claude Opus is the strongest pick for long-horizon orchestration and high-stakes judgment** ([Mindstudio analysis](https://www.mindstudio.ai/blog/best-ai-models-agentic-workflows-2026), [Klavis comparison](https://www.klavis.ai/blog/claude-opus-4-5-vs-gemini-3-pro-vs-gpt-5-the-ultimate-agentic-ai-showdown-for-developers)) — exactly what ChainSight's Critic and Orchestrator need. Constraint-fidelity matters more than speed for these roles.

DeepSeek V4 Pro at Tier B [matches the closed frontier on SWE-bench at 10-13x lower cost](https://callsphere.ai/blog/llm-comparison-compliance-regulatory-analysis-open-vs-open-may-2026) — the right choice for high-volume work where quality must be near-frontier but cost matters.

Phi-4 and Qwen 3.5 at Tier A are well-supported, MIT/Apache-licensed, and proven for fine-tuning to specialized agentic tasks.

### 2.2 On-Premises Sovereign tier (default for on-prem customers)

Out-of-the-box defaults, all self-hosted, no external API dependencies:

| Tier | Default model | Hardware |
|---|---|---|
| Tier A specialists | Phi-4 + Qwen 3.5 8B + custom LoRAs | Single workstation (DGX Spark, Mac M-series) or 2×H100 |
| Tier B workers | DeepSeek V4 Pro (37B active MoE) or Qwen 3.5 32B | 2×H100 PCIe server or 4×A100 |
| Tier C frontier | DeepSeek V4 Pro Max, Llama 4 70B, or Qwen 3.5 397B | 8×H100 cluster |

For sovereign deployments, **all model weights are pre-loaded during installation** and run via [NVIDIA NIM, Ollama, or vLLM](https://www.cuilabs.io/articles/sovereign-infrastructure-guide). No external connectivity required. ChainSight ships the configuration recipes for each hardware tier.

**For air-gapped deployments** (IL5/IL6 / classified), Tier C is the same open-weight stack — there is no commercial LLM option because there is no outbound API. Customers running air-gapped infrastructure already have GPU clusters provisioned per [DoD/IC AI guidance](https://corporateaiconsultants.com/insights/air-gapped-ai-defense-classified-environments); ChainSight integrates with their existing inference infrastructure.

**CPU-only fallback path:** For deployments without GPUs, [AirgapAI Edge / OpenVINO with Intel AMX](https://iternal.ai/how-to-deploy-llm-on-premise) enables 26B MoE models at ~32 tok/sec on a single Xeon server. Useful for edge/branch deployments where GPU procurement is impractical. Quality is reduced; the platform is honest about which features degrade and how.

### 2.3 Why these defaults and not others

The defaults are picked for three reasons:

1. **The agency can switch them.** Defaults exist so the platform works out-of-the-box. Every default is changeable per the BYOK marketplace pattern (Part 3 below).

2. **License compatibility with the four pillars.** Anything in the SaaS Blind default must be runnable in a confidential enclave. Anything in the On-Prem Sovereign default must be self-hostable with no phone-home. DeepSeek MIT, Qwen Apache 2.0, Llama 4 community license, Phi-4 MIT all meet that bar. Claude/GPT/Gemini are BYOK-only (not bundled).

3. **Hardware reality.** The defaults are picked to run on hardware the customer profile actually owns. A federal LE field office that's getting a budget for an 8×H100 cluster is realistic. A small private compliance team with a single workstation is realistic. We support both.

---

## Part 3 — BYOK for LLMs (the answer to "can the agency add their own LLM?")

**Yes — and it works exactly like the data-provider BYOK marketplace.** The capability router treats LLM providers as another category of provider (already designed in v0.3 BYOK addendum Part 1).

### 3.1 What the agency can swap

Every model role in the platform can be swapped, individually or in bulk:

| Role | Swappable to |
|---|---|
| Orchestrator (Tier C) | Any frontier API (Anthropic, OpenAI, Google, xAI, AWS Bedrock, Azure OpenAI) or self-hosted open frontier model |
| Tier B workers | Any open or commercial mid-tier model, self-hosted or API |
| Tier A specialists | Any small model (BYOK API or self-hosted via Ollama/vLLM/NIM) |
| Verifier | Any small instruction-following model |
| Embeddings | Any embedding provider (OpenAI, Voyage, Cohere, Mistral, BGE self-hosted) |
| Document intelligence | Already addressed in v0.5 F2 (Textract, Document AI, Form Recognizer, Unstructured, Tesseract self-hosted) |
| Speech-to-text (interviews) | Whisper self-hosted, AssemblyAI, Deepgram, Rev.ai |

The agency picks per-role:

- "Use Anthropic Claude Opus 4.7 for orchestrator and Critic"
- "Use Azure-hosted OpenAI GPT-5.4 for orchestrator (because we have an existing Azure contract)"
- "Use our locally-hosted Llama 4 70B for all tiers (because we're air-gapped)"
- "Use Anthropic Claude for orchestrator; locally-hosted Qwen 3.5 for all specialists"
- "Use locally-hosted DeepSeek V4 Pro for everything (because we want maximum sovereignty with near-frontier quality)"

### 3.2 The model registry

The Provider Marketplace catalog includes a Model section parallel to the data-provider section:

```typescript
LLMProviderDefinition {
  id: string                          // "anthropic_api", "openai_api", "azure_openai",
                                      // "bedrock_anthropic", "google_vertex",
                                      // "deepseek_api", "self_hosted_vllm",
                                      // "self_hosted_ollama", "self_hosted_nim"
  display_name: string
  vendor_url: string                  // marketplace link to provider signup
  hosting_type: enum                  // commercial_api | cloud_hosted | self_hosted | air_gapped
  available_models: ModelDefinition[]
  auth_method: enum                   // api_key | oauth | mtls | iam_role |
                                      // service_account | local_endpoint
  capabilities: LLMCapability[]
  data_residency: string[]
  compliance_certs: string[]
  test_endpoint: EndpointSpec
}

ModelDefinition {
  id: string                          // "claude-opus-4-6", "gpt-5-4", "gemini-3-1-pro",
                                      // "deepseek-v4-pro", "qwen3-5-32b", "phi-4",
                                      // "llama-4-scout", "custom-finetune-{hash}"
  display_name: string
  context_window: int
  input_cost_per_million: Decimal     // null for self-hosted
  output_cost_per_million: Decimal
  capabilities: ModelCapability[]    // function_calling | structured_output | vision |
                                      // long_context | reasoning_chains | citations
  recommended_tier: enum              // A | B | C
  benchmark_signals: BenchmarkSignal[]
  fine_tunable: bool
  license: string
}

AgencyLLMInstall {
  // Same pattern as AgencyProviderInstall from v0.3 BYOK
  // Per-role assignment, per-case scope, budget caps, fallback chain
  // Tested via test_endpoint on save
  // Encrypted credentials in agency KMS
}
```

### 3.3 The Model Override UI

In the Provider Marketplace, a new tab: **Model Configuration**.

Shows a matrix of platform AI roles × installed model providers:

```
┌────────────────────────────────────────────────────────────────────────┐
│  MODEL ASSIGNMENT                                                       │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Agent / Role         Default              Your assignment              │
│  ─────────────────────────────────────────────────────────────────────  │
│  Orchestrator         Claude Opus 4.6      [▼ Claude Opus 4.7        ]  │
│  Critic Agent         Claude Opus 4.6      [▼ Claude Opus 4.7        ]  │
│  Narrative Agent      Claude Opus 4.6      [▼ Local Llama 4 70B       ]  │
│  Tracer Agent         DeepSeek V4 Pro      [▼ Default                 ]  │
│  Bridge Agent         Qwen 3.5 8B FT       [▼ Default                 ]  │
│  Swap Agent           Phi-4 FT (swap)      [▼ Default                 ]  │
│  Attribution Agent    DeepSeek V4 Pro      [▼ Default                 ]  │
│  Inspector summary    DeepSeek V4 Pro      [▼ Default                 ]  │
│  Verifier             Qwen 3.5 8B          [▼ Default                 ]  │
│  Extraction Agent     Phi-4 FT (docs)      [▼ Default                 ]  │
│  ...                                                                    │
│                                                                         │
│  Bulk actions:                                                          │
│    [ Reset all to defaults ]                                            │
│    [ Use only local models ]                                            │
│    [ Use only Anthropic ]                                               │
│    [ Use only OpenAI ]                                                  │
│                                                                         │
│  Estimated monthly cost at current case volume: $1,420                  │
│  (would be $14,200 with all-frontier configuration)                     │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

The agency admin sees clearly which roles are using which models, what each costs, and what the alternatives are. Switching is one dropdown selection per role; the change takes effect on the next call.

The bulk-action buttons matter. "Use only local models" with one click is what makes air-gapped deployment frictionless. "Use only Anthropic" is what an agency does when they've negotiated an enterprise Anthropic contract.

### 3.4 Model cost telemetry

The cost telemetry section (already designed in v0.6 F23.8 for data providers) extends to LLMs:

```
LLM COST — JUNE 2026

  Anthropic (Claude Opus 4.6)         $1,847.30  (90% from Orchestrator + Critic + Narrative)
  DeepSeek API (V4 Pro)                $124.80   (Tracer + Attribution + Inspector)
  Local Llama 4 70B (own GPUs)         $0.00     (electricity ~$240 estimated)
  Local Qwen 3.5 8B (own GPUs)         $0.00     (electricity ~$80 estimated)
  ─────────────────────────────────
  TOTAL EXTERNAL                  $1,972.10
  ESTIMATED LOCAL (electricity)      $320.00

  By role:
    Orchestrator         $980.40   (53%)
    Critic               $604.20   (33%)
    Narrative            $262.70   (14%)
    Tracer               $87.30
    ...
```

This makes the cost-vs-quality tradeoff visible. If an agency sees they're spending $980/month on orchestrator and wonders whether they need frontier for it, they can A/B test against a self-hosted alternative for a week and decide.

---

## Part 4 — The "can AI be turned off?" answer

**Yes. At any granularity, including entirely.**

This is critical for several customer profiles:

- Agencies that prefer manual investigation with AI assistance only for narrow tasks
- Jurisdictions that prohibit AI-generated content in legal proceedings
- Pilot deployments where the customer wants to validate the platform without the AI layer first
- Litigation-defensive postures where opposing counsel might attack AI involvement
- Investigators who simply prefer working without it

### 4.1 The AI toggle hierarchy

Four levels of granularity, all functional:

**Level 1 — Per-agency global toggle**

Agency admin can disable AI features entirely. The platform reverts to a non-AI mode:

- No autonomous tracing — investigators trace manually hop by hop
- No AI-drafted reports — investigators write reports from scratch with structured templates
- No AI-suggested paths — Suggestion sidebar is hidden
- No AI attribution — only deterministic provider attribution and personal attribution surface
- No Inspector AI sections — Inspector shows only structured facts (Sections 1-2), with manually-curated decoded action for known contracts
- No obfuscation detection AI — only rule-based detectors fire
- All deterministic platform features remain functional (case management, Belief State, Math Service, BYOK providers, cache, court mode, deconfliction, document storage, evidence chain-of-custody, supervisor mode, reproducibility packs)

**The platform is fully usable without AI.** It's a less efficient investigator's tool, but every guarantee (sovereignty, court-defensibility, reproducibility) still holds.

**Level 2 — Per-role toggle**

The Model Configuration matrix has an "Off" option for every role. An agency might:

- Disable Narrative Agent (no AI-drafted reports) but keep Tracer Agent (faster hop expansion)
- Disable Suggestion Agent (no AI-proposed paths) but keep Inspector summary
- Disable Critic Agent (some agencies prefer human-only review) but keep everything else

When a role is off, the platform falls back to non-AI behavior for that specific function — the Critic's absence means challenges are surfaced as raw signals for human review; the Narrative's absence means reports use a structured fill-in template.

**Level 3 — Per-case toggle**

Within a case, the investigator can disable AI assistance for sensitivity reasons. Useful when:

- The case is sealed and the investigator wants no AI logging
- The case involves a confidential informant whose identifiers shouldn't be processed by the AI
- The case is heading to a jurisdiction that's hostile to AI-assisted evidence

Case-level toggle overrides the agency default for that specific case.

**Level 4 — Per-action confirmation**

Even with AI enabled, every high-impact AI action can be configured to require investigator confirmation before executing:

- "Confirm before running autonomous trace"
- "Confirm before drafting a report"
- "Confirm before promoting a path to court-grade"
- "Confirm before publishing an attribution"

This is the "AI suggests, human acts" pattern at maximum granularity.

### 4.2 What is never AI-driven, regardless of toggle

Certain things are always human-only, never AI-driven, regardless of any toggle (these are commitments from v0.8 F41 and the v0.3 G1 lock):

- **Court-grade attribution promotion** — always requires investigator signoff_id
- **Freeze request submission** — always requires investigator decision plus supervisor approval per F27
- **Seizure recommendation** — always requires supervisor approval
- **Public disclosure of attributions** — always requires explicit human action
- **Final report sign-off** — always requires investigator signature
- **Path finalization** — investigator finalizes; AI cannot finalize

These are anti-feature commitments. Toggling AI on does not promote any of these to autonomous action.

### 4.3 Honest UX when AI is off

When AI is disabled or a role is unavailable, the platform shows it clearly:

- Inspector panel: "AI summary unavailable (disabled); see structured facts below"
- Suggestion sidebar: hidden when Suggestion Agent is off (no empty placeholder)
- Report drafts: "AI drafting disabled; use the structured template"
- No degraded silent fallback to lower-quality AI without disclosure

The investigator always knows what's AI-generated and what isn't. Every AI output is labeled with its source model and version (so when the model is upgraded, the change is visible in the audit trail).

---

## Part 5 — Specialist fine-tuning (the proprietary advantage)

The platform's edge over generic LLMs comes from **specialist SLMs fine-tuned on blockchain forensics tasks**.

### 5.1 The fine-tuning targets

Per the [SLM specialization recipe](https://research.nvidia.com/labs/lpr/slm-agents/), each high-volume agentic task gets its own fine-tuned specialist:

| Specialist | Task | Training data |
|---|---|---|
| **Calldata Decoder SLM** | Decode arbitrary contract calldata into structured action | Public ABI database + known function selectors + 100k+ historical decoded txs |
| **Token Swap Specialist** | Decode router calldata to swap structure (path, slippage, fees) | Uniswap/Raydium/Curve/etc. historical swap data |
| **Bridge Correlator SLM** | Match source-side and destination-side bridge transactions | Historical bridge message correlations across LayerZero/Wormhole/CCTP/Across |
| **Entity Extractor SLM** | Extract addresses, tx hashes, names, amounts from PDFs | Subpoena returns + bank statements + court orders with labeled extractions |
| **Sub-poena Format Parser** | Parse exchange subpoena return formats | One per major exchange: Binance, Coinbase, Kraken, etc. |
| **Obfuscation Pattern Detector** | Recognize peel chains, chain hops, mixer patterns from sub-graph features | Curated positive/negative examples per detector type |
| **Attribution Synthesizer** | Reconcile multi-provider attribution into a unified atom with confidence | Provider responses + investigator-confirmed ground truth |
| **Verifier SLM** | Check that every sentence in a draft cites a BeliefAtom | Generated training data: drafts + manual verification labels |

Each specialist is a LoRA or QLoRA adapter on top of a base SLM (Phi-4 14B for reasoning-heavy specialists; Qwen 3.5 8B for high-throughput specialists; Llama 3.2 3B for routing/classification). Training data is 10k-100k examples per specialist, per the [established SLM specialization pattern](https://arxiv.org/pdf/2510.03847.pdf).

### 5.2 Training data sourcing

This is the critical part. Specialist SLMs need training data, and forensics data is sensitive.

**Sources we can use:**

- Public blockchain data — every confirmed transaction, every public ABI, every public exchange disclosure
- Public hack post-mortems (Trail of Bits, Spearbit, Code4rena audits, Rekt News reconstructions)
- Public sanctions lists (OFAC SDN, OFSI, EU restrictive measures)
- Public legal filings (PACER, court records, SEC enforcement actions)
- Open-source forensics datasets (Chartalist, Elliptic Dataset, public CTF challenges)
- Vendor-published case studies (Chainalysis, TRM, Elliptic blog posts with case details)
- Synthetic data — generated adversarial scenarios with known ground truth

**Sources we cannot use:**

- Customer case data (per Pillar 4 sovereignty — we never see it)
- Subpoena returns or any PII-containing documents
- Any non-public investigation data

**The agency can opt in to contribute training data** — confirmed attributions, validated obfuscation findings, refined detectors — with explicit consent, full anonymization, and the F45 community-flywheel governance. This is the federated improvement loop, not centralized data collection.

### 5.3 Per-agency LoRA adapters

Agencies that opt in to the training contribution program can additionally have **per-agency LoRA adapters** trained on their own anonymized, on-prem data:

- The LoRA training happens entirely on the agency's infrastructure
- ChainSight provides the training tooling (HuggingFace PEFT, Unsloth, axolotl recipes)
- The resulting adapter is owned by the agency and never leaves their infrastructure
- The agency can choose to share aggregate insights (not raw data) back to the community catalog

This is how an agency with deep expertise in (say) sextortion case patterns ends up with a fine-tuned obfuscation detector specifically attuned to their patterns — without ever sharing their casework with the vendor.

---

## Part 6 — Hallucination mitigation (the accuracy spine for AI)

Per [Pillar 1 (Belief State)](https://blockeden.xyz/blog/2026/04/11/blockchain-evidence-courtroom-trm-labs-on-chain-analytics-legal/) and [Pillar 2 (Reproducibility)](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/), AI outputs must be defensible. The research confirms: **RAG + verification is the single biggest hallucination mitigation lever**, reducing hallucinations [up to 96% in production systems](https://zylos.ai/research/2026-01-27-llm-hallucination-detection-mitigation).

ChainSight stacks these techniques, building on the v0.2 B6 hallucination gates:

1. **Mandatory grounding** — every factual claim cites a BeliefAtom or T0 source. Outputs lacking citation tokens are rejected by the Verifier before reaching the investigator.
2. **Math Service ownership of every number** — LLMs never compute. Every value comes from a deterministic Math Service call (per v0.2 B6). This eliminates the largest hallucination category (numeric errors).
3. **Attribution dereference** — every entity label must dereference to a pinned attribution snapshot. No free-text "Binance hot wallet"; only `attribution.binance.hot_wallet_2024Q4_pinned_id`.
4. **Critic Agent runs in parallel** — not as a post-process. Catches what other agents miss.
5. **Faithfulness judge on every generative output** — a Verifier SLM checks every drafted sentence against its citations. Failed sentences are flagged for human authorship.
6. **Self-consistency checks** for ambiguous decisions — the Critic asks for the same conclusion via multiple paths; disagreement triggers escalation.
7. **Confidence scoring** at every step — per v0.2 B4, decay-aware compound confidence with hard floor at 0.6 below which conclusions don't surface as findings.
8. **Atomic claim verification** — narrative drafts are decomposed into atomic claims; each claim is verified independently before the draft is assembled.
9. **Domain-grounded RAG** — every agent has access to a curated, domain-specific RAG index (typologies, methodologies, prior case heuristics, jurisdiction-specific rules) — per the [MEGA-RAG / corrective RAG pattern](https://arxiv.org/html/2603.17872v1).
10. **Continuous regression** — per v0.2 B7, nightly regression against the ground-truth flywheel; any model swap or fine-tune that regresses headline metrics blocks deploy.

The combined effect (per [Zylos research](https://zylos.ai/research/2026-01-27-llm-hallucination-detection-mitigation)) is 40-96% hallucination reduction over single-technique baselines. Our target is the high end of that range for any output that reaches a court-grade BeliefAtom.

---

## Part 7 — The full BYOK LLM provider catalog

For completeness, the model providers wired in Phase 0-2 (matching the BYOK Provider Marketplace pattern from v0.3):

**Commercial APIs**
- Anthropic (Claude Opus 4.6/4.7, Claude Sonnet 4.6, Claude Haiku)
- OpenAI (GPT-5.4, GPT-5.5, GPT-5 mini, GPT-5 Codex, o-series reasoning models)
- Google Vertex AI (Gemini 3.1 Pro, Gemini 3.1 Flash, Gemini Nano)
- AWS Bedrock (Claude via Bedrock for FedRAMP/IL paths; Titan; Llama via Bedrock)
- Azure OpenAI (GPT models via Azure for customers with Microsoft contracts)
- xAI (Grok 4)
- Mistral AI (Mistral Large, Mistral Medium, Codestral)
- DeepSeek (DeepSeek V4, V4 Pro, V4 Pro Max via API)
- Together AI, Fireworks AI, Anyscale (hosted open-source models)

**Self-hosted (via Ollama, vLLM, NVIDIA NIM, llama.cpp, OpenVINO)**
- DeepSeek V4 Pro / V4 Pro Max (MIT license)
- Llama 4 Scout (long context), Llama 4 Maverick, Llama 4 70B
- Qwen 3.5 / 3.6 family (Apache 2.0)
- GLM-5.1 (cleanest MIT license)
- Phi-4 and Phi-3.5-mini (MIT)
- Mistral / Ministral family
- Gemma 4 (Google open weights)
- Kimi K2.6 (Moonshot)
- Hunter Alpha
- Any other model loadable via the supported runtimes

**Embedding providers**
- OpenAI Embeddings
- Voyage AI
- Cohere
- Mistral Embed
- BGE (self-hosted)
- E5 (self-hosted)

**For air-gapped deployments**, only self-hosted models are usable; the runtime stack (Ollama / vLLM / NIM) handles the local inference and ChainSight's capability router treats them identically to commercial APIs.

---

## Part 8 — Upgrade and obsolescence path

LLMs improve quickly. By the time the platform reaches Phase 2, today's frontier models will be the new mid-tier. The strategy accommodates this:

### 8.1 Model versioning and pinning

Every BeliefAtom that came from an LLM records the **model card** — provider, model name, model version, prompt template, sampling parameters. When a model is upgraded:

- New cases default to the new version
- Existing cases stay pinned to the version that produced their current BeliefAtoms (for reproducibility per Pillar 2)
- The agency can choose to migrate an existing case to a new model; the migration is logged and any BeliefAtoms re-evaluated under the new model get a "model upgraded from X to Y on date Z" note

For court-grade BeliefAtoms, the model version is **frozen at signoff** and never changes. The Reproducibility Pack replays the exact model that produced the conclusion.

### 8.2 Quarterly model catalog updates

The platform's LLM provider catalog gets quarterly updates with:

- New models added (when providers release new versions)
- Deprecated models flagged (so agencies plan migration)
- Updated benchmark signals (so the recommended-tier assignments reflect current capability)
- Pricing updates (for cost telemetry accuracy)

Catalog updates ship as signed artifacts; air-gapped deployments receive them via the same offline-update path as the rest of the platform (per v0.7 deployment model).

### 8.3 Fine-tune migration

When a base model is upgraded (Phi-4 to Phi-5, Qwen 3.5 to Qwen 4), the platform's specialist LoRAs need to be re-trained. ChainSight publishes pre-built LoRA migration packs for major version transitions; agencies that have their own LoRAs get tooling and training-data preservation to migrate their adapters.

### 8.4 The exit ramp

If a model provider becomes unsuitable (price increase, geopolitical concern, deprecation), the agency can:

1. See the alternatives in the Model Configuration matrix
2. Switch with one click
3. Keep existing cases running on the old model for reproducibility
4. New work proceeds on the new model

The capability-router abstraction means swapping providers is a configuration change, not a code change. Every layer of the system is provider-agnostic.

---

## Part 9 — Risks and tradeoffs (in writing)

I want this in the doc so the strategy is honest.

**Risk 1 — Frontier model dependency for Tier C tasks**

The Orchestrator and Critic default to Claude Opus 4.6, a closed-API model. If Anthropic raises prices, has an outage, deprecates the API, or is acquired by a hostile entity, ChainSight's hosted customers feel it.

Mitigation: open-frontier alternatives (DeepSeek V4 Pro Max, Llama 4 70B, Qwen 3.5 397B) are getting close enough to frontier for these roles. By Phase 2, the platform supports falling back to open frontier with quality acceptable for production. Air-gapped customers are already there by definition.

**Risk 2 — Fine-tuned specialist quality**

The Tier A specialist SLMs are only as good as the training data. Public blockchain data is abundant; private investigation patterns are scarce. The platform may underperform on novel attack patterns until enough customers contribute to the community catalog.

Mitigation: ground-truth flywheel (B7) accelerates over time. In the meantime, the orchestrator's promotion-to-Tier-C path means novel patterns fall back to frontier reasoning until specialists catch up.

**Risk 3 — Cost predictability for customers**

LLM costs are variable. A case with many ambiguous decisions might burn $50 of frontier-model spend in a day. Customers need cost predictability.

Mitigation: budget caps per-role and per-case (already in the capability router); real-time cost telemetry; "estimate cost before action" prompts on expensive operations; defaulting most work to cheap specialists.

**Risk 4 — Court reception of AI evidence**

Defense counsel will attack AI involvement. Some judges will be skeptical. Daubert challenges to AI-generated forensic conclusions are increasing.

Mitigation: the Belief State + Reproducibility Pack architecture means the platform can show its work step-by-step, with citations, math, and rule versions. Every claim is grounded. The Verifier ensures no ungrounded sentences enter reports. The Methodology Disclosure in every report names the AI involvement explicitly. The platform's posture is transparent, not stealth.

**Risk 5 — AI provider geopolitical risk**

DeepSeek is a Chinese company. Qwen is Alibaba. Some federal customers will be uncomfortable with model providers from adversarial jurisdictions, even when the model runs locally.

Mitigation: The model marketplace clearly labels each model's provenance. Agencies can filter to only certain jurisdictions. The recommended-stack for federal customers in classified environments defaults to US/EU-origin models (Llama 4, Phi-4, Mistral). The agency chooses; the platform doesn't impose.

**Risk 6 — AI feature creep into anti-feature territory**

Every model improvement makes it tempting to build "smarter" features. Predictive policing, demographic correlation, mass surveillance — these are all easier to build now than five years ago. The platform must resist.

Mitigation: F41 anti-feature commitments are in the MSA, in marketing collateral, in the CI test suite (a build check that fails if any anti-feature code path appears). Civil-Liberties Review Board (F41) reviews high-impact features before release.

---

## Part 10 — Phasing the AI work

| Phase | AI deliverables |
|---|---|
| **Phase 0** | Capability router LLM extension; default models wired (Anthropic for hosted, Llama 4 for on-prem defaults); Model Configuration UI with bulk-action presets; per-role and per-case AI toggles; cost telemetry stub for LLM spend; AI-off mode fully functional; Verifier Agent prototype |
| **Phase 1** | First specialist SLMs (Calldata Decoder, Bridge Correlator, Entity Extractor); domain-grounded RAG indexes (typologies, methodologies, jurisdiction rules); fine-tuning pipeline (LoRA/QLoRA on PEFT); cost telemetry with per-role breakdown |
| **Phase 2** | Full specialist SLM lineup (8-12 fine-tuned specialists per the F45 catalog); Critic Agent in parallel; Narrative Agent with Verifier gating; ground-truth flywheel feeding back into fine-tuning; community-contributed detector library v1 |
| **Phase 3** | Per-agency LoRA adapter program (agencies fine-tune their own specialists on-prem); model migration tooling for base-model upgrades; reasoning-model integration (Claude Opus 4.7+, o-series, DeepSeek reasoning) for complex Critic challenges; full transparency report on AI accuracy and FPR per F41 |
| **Phase 4** | Multi-language specialist SLMs (jurisdiction-specific extraction); voice-assistant integration for Court Mode; advanced model-routing (the orchestrator learns which tier each task should go to from outcome data); Community Detector Library quarterly publishing cadence |
| **Post-Phase-4** | Continuous improvement against the ground-truth flywheel; integration with whatever the 2027+ frontier looks like; potential federated learning across consenting customers |

---

## Part 11 — TL;DR for stakeholders

The AI strategy in five bullets:

1. **Heterogeneous three-tier stack.** Small specialist SLMs handle 70-80% of work; mid-tier workers handle 15-25%; frontier reserved for orchestration and ambiguity. Cost-efficient, fast, and good enough for everything that matters.

2. **Default models are Claude Opus for orchestration (SaaS Blind) or Llama 4 / DeepSeek / Qwen for sovereign deployment**. Defaults exist to make the platform work out-of-the-box.

3. **Every model role is BYOK and swappable.** Agency picks per-role via the Model Configuration matrix. One-click bulk presets for "use only local" or "use only Anthropic." Air-gapped deployments are fully supported via local Llama/Qwen/DeepSeek.

4. **AI can be turned off at four levels** — agency, role, case, or per-action. The platform is fully functional (less efficient, but still court-defensible) without AI. Critical for jurisdictions, sensitivities, and customer preferences.

5. **Hallucination is treated as the central engineering problem.** RAG + Math Service + Verifier + Critic + atomic claim verification + grounded citations + confidence floors + nightly regression — stacked to reach the high end of the 40-96% mitigation range. Every output is grounded, every number deterministic, every claim cited.

The strategy is consistent with all four pillars, accommodates every customer profile from solo PI to classified federal deployment, and respects the anti-feature commitments. It is also designed to age well — the upgrade and obsolescence paths assume LLMs will continue improving, and the platform absorbs the improvements without architectural change.

This is now the canonical AI strategy. Every prior reference to AI models, frontier vs. local LLMs, or "we use Claude / GPT / Llama" should be read in light of this document.
