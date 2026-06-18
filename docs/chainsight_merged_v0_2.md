# ChainSight — Merged Architecture v0.2

> v0.1 captured Robert's vision across 14 investigation domains.
> v0.2 adds my (the architect's) layer: the **accuracy spine** that makes the AI trustworthy enough to be autonomous.
>
> Both layers are kept distinct in this doc so we can see who-said-what and argue with either.

---

## Part A — What stays from v0.1 (your vision)

The 14 domains, the mind map, and the schema document are unchanged in intent:

1. Case intake & context
2. Time frame & market context
3. Chain & asset scope
4. Tx volume & trace scope estimation
5. Multi-chain visual trace
6. Token swaps
7. Bridges & cross-chain
8. Accounting, fees, commingling
9. Attribution & OSINT
10. Collaboration & visualization
11. Reporting
12. UTXO vs account-model graphing
13. Multi-methodology accounting (FIFO/LIFO/weighted)
14. Evidence & case management
15. _(plus)_ persistent, trainable AI doing real work independently

Those modules survive intact. What follows is **layered on top**.

---

## Part B — My additions (the accuracy spine)

The single hardest engineering problem in this product is not coverage, not visualization, not even bridges. It is this:

> **An AI agent that does dozens of autonomous hops will compound errors. By hop 20, a 98%-accurate agent is wrong more often than right.**

A 10-hop trace where each step is 95% confident is only 60% confident end-to-end. A 50-hop trace is 7.7%. That's the math nobody puts in their marketing deck.

So my contribution to your vision is a set of cross-cutting systems whose only purpose is **making the AI's output good enough to defend in court and stake a freeze on**. Eight additions:

---

### B1. The Structured Belief State (SBS)

**Borrowed from the [LOCARD paper](https://arxiv.org/html/2604.04211v2), which is the best published architecture for agentic blockchain forensics as of mid-2026.**

Instead of letting the AI freely wander a trace graph, the orchestrator maintains an explicit, queryable **belief state** for every entity, address, edge, and hypothesis in the case:

```
BeliefAtom {
  subject: AddressId | TxId | EntityId | EdgeId | HypothesisId
  predicate: enum  // "is_controlled_by", "is_mixer", "received_taint_from", "is_same_entity_as", ...
  object: any
  confidence: float [0, 1]
  provenance: Source[]      // every input that produced this belief
  derivation: ReasoningStep[]  // the chain of inferences
  status: enum  // "asserted", "challenged", "retracted", "court_grade"
  established_at: timestamp
  superseded_by: BeliefAtom | null
}
```

Why this matters:

- Every agent reads from and writes to the SBS. No agent has private "knowledge."
- The Critic Agent can challenge any atom; challenges are first-class objects.
- The graph is **reproducible by replay** — given the same inputs and the same SBS history, you get the same conclusion.
- Court-grade atoms (confidence ≥ threshold, ≥2 independent sources, no open challenges) are visually distinct in the UI.

**This is the single most important addition.** It's what turns "the AI thinks X" into "here is the audit trail of how the AI concluded X, and here is the live list of things that would change its mind."

---

### B2. Tiered Determinism — separate the deterministic core from probabilistic edges

The [ChainArgos analysis on determinism](https://medium.com/chainargos/blockchain-tracing-determinism-5a690a95ca5f) and [Chainalysis's own data-quality writeup](https://www.chainalysis.com/blog/chainalysis-data-accuracy/) both make the same point: a tracing tool can be algorithmically deterministic but operationally non-deterministic because tags and clusters update over time. Different run, different answer. That destroys reproducibility.

We solve this by **explicit tiering** of every operation:

| Tier                               | What it is                                     | Examples                                                             | Behavior                                                                                  |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **T0 — Cryptographic**             | Provable from chain data alone                 | UTXO lineage, EVM transfer logs, signatures, block timestamps        | Always deterministic. Same inputs → same outputs forever.                                 |
| **T1 — Heuristic-deterministic**   | Rule-based on chain data, but rules can change | Common-input clustering, change-output detection, router decoders    | Deterministic **given a pinned rule version**. Rule versions are immutable artifacts.     |
| **T2 — Attribution-deterministic** | Depends on external label data                 | Entity attribution from BYOK feeds, OSINT tags                       | Deterministic **given a pinned data snapshot**. Snapshots are mandatory for court output. |
| **T3 — Probabilistic**             | ML / LLM inference                             | Behavioral fingerprinting, narrative drafting, hypothesis generation | Explicitly flagged. Never the sole basis for a court-grade atom.                          |

**Every BeliefAtom carries its tier.** A T3 atom alone never moves to "court_grade" — it has to be corroborated by a T0/T1/T2 chain. This is how we get the [Chainalysis "data accuracy flywheel"](https://www.chainalysis.com/blog/chainalysis-data-accuracy/) property: any conclusion can be reconstructed step-by-step from frozen inputs.

---

### B3. Reproducibility Snapshots (the "Frozen Case")

For every report, freeze and content-hash:

1. **Chain data snapshot** — Parquet files of every block/tx/log read during the investigation
2. **Rule version manifest** — pinned hashes of every clustering rule, decoder, bridge resolver
3. **Attribution snapshot** — pinned copy of every external tag used (Chainalysis/TRM/Elliptic/OFAC at the moment of use)
4. **Tool log** — every tool call the AI made, with inputs and outputs
5. **Model card** — orchestrator model, worker models, prompt templates, sampling parameters, seeds where applicable
6. **SBS history** — append-only belief evolution log
7. **replay.sh** — single command that rebuilds the entire trace from #1–#6

When opposing counsel demands a mathematical audit (which they will, per [D'Aloia](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/)), you hand them the zip and they re-run it on their own hardware. Same inputs, same outputs, every time.

Optional public anchoring: SHA-256 of the manifest committed to BTC via OP_RETURN or Ethereum calldata for tamper-evident timestamping.

---

### B4. The Confidence Calculus

Confidence cannot just be a float that gets multiplied. Compound it correctly:

- **Per-hop confidence model** — each hop reports `(p_correct, evidence_class)`, not just a float
- **Method-aware combination** — UTXO-direct hops compose multiplicatively; clustering-derived hops use a different aggregation; attribution-derived hops are gated by source agreement
- **Confidence decay visualization** — every node in the trace canvas shows accumulated confidence at that depth (a gradient that visibly fades as the trace gets weaker)
- **Uncertainty bounds, not point estimates** — every quantitative claim ships with a confidence interval ("$2.4M ± $180k traceable under FIFO at p=0.92")
- **Hard floor** — below 0.6 cumulative confidence, the platform refuses to render the conclusion as a primary finding; it goes into an "investigative lead" section instead

This is how we honor the [Bitcoin Heuristics field note](https://geonicolaidis.substack.com/p/following-bitcoin-through-the-maze) point: "A ten-hop trace is not ten times as certain as a one-hop trace; it is potentially exponentially less certain."

---

### B5. The Adversarial Critic — built in, not bolted on

Most agent stacks add a "critic" as an afterthought prompt. We make it structural:

- **The Critic Agent runs in parallel with every Tracer/Bridge/Attribution agent**, not after them
- **It owns its own model and prompt**, with different sampling temperature and a system prompt biased toward skepticism
- **It scores every BeliefAtom on five axes**: provenance quality, alternative-explanation strength, base-rate plausibility, internal consistency, adversarial robustness
- **It can issue `Challenge` objects** that block atoms from being promoted to court-grade until resolved
- **It runs known adversarial patterns** ([CoinJoin demixing edge cases](https://geonicolaidis.substack.com/p/following-bitcoin-through-the-maze), peel-chain false-positives, bridge-front-running confusions, sybil-cluster splits) against every trace
- **It logs every challenge for training**; over time the Critic's blind spots become visible

The cultural point: **the AI argues with itself before the investigator ever sees a conclusion.** That's the only way to get accuracy at autonomous-trace depths.

---

### B6. Hallucination Gates (RAG with strict bindings)

From the [2026 AI guardrails best practices](https://blog.getdarwin.ai/en/ai-guardrails-hallucination-prevention-2026):

> "The model must include a citation token tied to a source chunk for every assertion, and the system rejects responses without sufficient grounding."

Applied here:

- **Every factual claim the AI emits must cite a BeliefAtom or a T0 source.** The output parser rejects ungrounded sentences before they reach the investigator.
- **Numerical claims must round-trip through a calculator tool.** The LLM never does arithmetic on tx values; it calls a deterministic math service.
- **Entity attributions must dereference to an attribution snapshot row.** No free-text "Binance hot wallet" — only `attribution.binance.hot_wallet_2024Q4_pinned_id`.
- **Narrative reports are post-checked** by a Verifier model whose only job is "does every sentence in this draft trace back to a citation token? If no, mark the sentence for human review."

A LLM is never the final voice on a fact. It composes facts that other systems have established.

---

### B7. The Ground Truth Flywheel

Per the [DFIR-Metric benchmark research](https://www.themoonlight.io/en/review/dfir-metric-a-benchmark-dataset-for-evaluating-large-language-models-in-digital-forensics-and-incident-response): "current LLMs are not yet capable of reliably automating end-to-end DFIR investigations." That gap closes only with ground truth.

**Three ground-truth sources we curate from day one:**

1. **Public post-mortems** — Bybit, Ronin, Wormhole, Nomad, FTX, Mt. Gox, Bitfinex, Poly Network, Euler, etc. Every documented hack with a known recovery path is a regression test.
2. **Closed cases (internal)** — every case the platform closes (with investigator validation) becomes a labeled dataset point. Tagging happens at case-close, with the investigator confirming or correcting each AI-emitted BeliefAtom.
3. **Synthetic injection** — we generate adversarial trace scenarios (peel chains with known endpoints, simulated CoinJoin mixing, fake bridge messages) and check that the agent recovers them.

**Nightly regression run**: every rule change, decoder update, or model fine-tune triggers a re-run against the full ground-truth set. **Any regression > 0.5% in any of the headline metrics blocks the deploy.** This is the practice borrowed from [TxRCA-Bench](https://sahua.ng/posts/txrca-bench/) — when ground truth is verifiable, regression testing is mandatory.

Headline metrics:

| Metric                  | Definition                                    | Target                |
| ----------------------- | --------------------------------------------- | --------------------- |
| Trace recall            | % of ground-truth path edges recovered        | ≥0.95                 |
| Trace precision         | % of recovered edges that are correct         | ≥0.98                 |
| Attribution accuracy    | % entity labels correct vs. ground truth      | ≥0.97                 |
| Reproducibility         | identical output on replay                    | 1.000                 |
| Methodology consistency | identical math across two runs of same method | 1.000                 |
| Court-grade rate        | % atoms qualifying for court-grade flag       | tracked, not targeted |
| Critic catch rate       | % of seeded errors the Critic flags           | ≥0.90                 |

---

### B8. Privacy & Data Governance (because LE data is dangerous)

Investigator data is some of the most sensitive data on earth. Victim PII, suspect identifiers, KYC docs, MLAT correspondence. We add:

- **Per-case encryption keys** stored in HSM/KMS, derivable only with case-team auth
- **Differential privacy** ([DP for compliance research](https://pubmed.ncbi.nlm.nih.gov/41911223/)) on any cross-case statistics — investigators can ask "how often does this typology pattern appear?" without learning _which_ cases
- **Need-to-know access** — agents only get the case context they need for the current task; the full case file never goes to the LLM unless the operator opts in
- **Air-gapped tenant option** — for sensitive LE work, full deployment in a customer-controlled environment with no outbound LLM calls (forces local models, which is fine because B6 design works with any capable model)
- **Cross-border data residency** — case data tagged with jurisdiction, processing pinned to compliant regions
- **Audit log immutability** — append-only Postgres + S3 Object Lock; tamper-evident hashes
- **Data minimization for training** — RLHF datasets derived from cases are stripped of PII before they enter any fine-tune

---

## Part C — How B integrates with A (the merge)

Mapping every accuracy-spine addition (B) onto your 14 domains (A):

| Your domain (A)                  | Accuracy spine addition (B)                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1. Case intake                   | B8 governs PII handling; B1 starts the SBS as soon as IOCs are entered                                                             |
| 2. Time frame                    | B3 snapshots market context at intake — frozen forever                                                                             |
| 3. Chain scope                   | B2 tiers every chain-detection inference; B1 records each as a belief atom                                                         |
| 4. Tx volume estimate            | B4 computes expected confidence-at-depth before any expensive work                                                                 |
| 5. Visual trace                  | B4 confidence decay rendered as edge fading; B1 atoms visible on hover                                                             |
| 6. Token swaps                   | B6 calculator tool owns all value math; B2 tier-marks router decoders                                                              |
| 7. Bridges                       | B5 Critic runs adversarial bridge-correlation patterns; B2 distinguishes message-id (T1) from heuristic (T3) matches               |
| 8. Accounting & fees             | B6 forces all math through the deterministic calculator; B3 freezes the methodology version used                                   |
| 9. Attribution & OSINT           | B2 separates source tiers; B6 forces every attribution to dereference to a snapshot row; B5 challenges low-confidence attributions |
| 10. Collaboration & viz          | B4 confidence rendering is visible to all collaborators; B1 challenges show as comment-like objects                                |
| 11. Reporting                    | B3 reproducibility pack is the report's other half; B6 verifier post-checks the narrative                                          |
| 12. UTXO vs account graphing     | B2 makes UTXO traces T0, account-model + clustering T1; clear separation in the UI                                                 |
| 13. Multi-methodology accounting | B3 pins which methodology, B6 calculator runs the math, B1 records the result as an atom                                           |
| 14. Evidence storage             | B3 reproducibility pack lives here; B8 governs key management                                                                      |
| 15. AI persistence               | B1 SBS + B5 Critic + B6 gates + B7 flywheel = trustable persistent AI                                                              |

---

## Part D — Net architectural changes (vs v0.1)

Concrete things that change in the build:

1. **The "Belief State Service" becomes a first-class backend module**, alongside the data layer and graph store. Postgres + event-sourcing pattern. Every agent's first action is to read from SBS; every action ends by emitting an event to SBS.

2. **The Critic Agent is promoted from "one of several specialists" to a first-class system that runs in parallel with every other agent**, not after them. It gets its own model, prompt, and budget.

3. **A dedicated "Math Service"** — pure Python, no LLM — owns all value arithmetic, methodology computation, and confidence math. The LLM calls it via function-calling. This is the single biggest source of accuracy lift over a "do everything in the LLM" architecture.

4. **A "Verifier" agent gates every report draft** before it reaches the investigator. Job: confirm every assertion in the draft maps to a citation token. Block on miss.

5. **The Reproducibility Snapshot becomes a mandatory build artifact**, not an optional export. No report leaves the system without one.

6. **The Ground Truth Set becomes part of the codebase**. Public hacks + synthetic + closed-case-derived. CI fails on regression.

7. **Per-case encryption + air-gapped deployment** mode is in v1, not v2. It's the door-opener for federal/CJIS work.

8. **The Skill Library (procedural memory) gets formal review workflow** — playbooks are versioned in Git, require investigator sign-off before activation, and their performance is tracked per typology.

---

## Part E — Net additions to the tech stack

| Concern                   | Tool / pattern                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Belief state store        | Postgres + event sourcing (or EventStoreDB)                                                              |
| Math service              | Python service with `decimal`-based fixed-point arithmetic; gRPC interface                               |
| Reproducibility snapshots | Content-addressed S3 (or IPFS) with optional public-chain anchoring                                      |
| Critic agent              | Same agent framework as others (Letta/LangGraph), separate model + temperature + skeptical system prompt |
| Ground truth regression   | Custom harness; nightly run; block-on-regression CI gate                                                 |
| Verifier agent            | Smaller, cheaper model (e.g. fine-tuned Llama 3.1 8B) running citation-token check                       |
| Differential privacy      | OpenDP or Google's DP library for cross-case analytics queries                                           |
| HSM/KMS                   | AWS KMS / GCP KMS / on-prem Thales for air-gap tier                                                      |
| Per-case keys             | Envelope encryption with case-scoped DEKs                                                                |
| Tamper-evident audit      | Postgres + S3 Object Lock; periodic Merkle-root anchor to public chain                                   |

---

## Part F — What the user sees, end-to-end

A walkthrough of a real workflow, so we can sanity-check that all of B is non-intrusive to A:

1. **Investigator pastes 12 BTC addresses + a victim affidavit PDF** into a new case.
2. Intake Agent extracts IOCs (B6 verifier checks every extracted fact against the source PDF).
3. Scope Agent estimates: ~14,000 txs, ~40 hop depth, 3 chains, projected confidence at depth-40 = 0.71 (B4).
4. Investigator clicks "Run autonomous trace, court-grade only, stop at confidence < 0.85."
5. Tracer + Bridge + Swap + Attribution agents fan out. Every step emits a BeliefAtom to the SBS (B1). Every math op goes through the Math Service (B6). Every step has a tier label (B2).
6. Critic Agent (B5) runs in parallel. It challenges 17 atoms; 12 resolve, 5 remain open and are visibly flagged in the UI.
7. Trace terminates at a Binance deposit address (T2 attribution, pinned snapshot from 4 hours ago) and a Tornado Cash entry (T0).
8. Investigator opens the visual canvas. Confidence fades visually as edges get deeper (B4). Court-grade atoms are bold; investigative leads are dashed.
9. Investigator clicks "Draft seizure affidavit." Narrative Agent drafts; Verifier Agent (B6) checks every sentence has a citation; investigator gets the draft + a list of 3 sentences flagged for human authorship because they couldn't be grounded.
10. Investigator approves. System builds the **Reproducibility Pack** (B3): chain data, rule versions, attribution snapshot, tool log, model card, SBS history, replay.sh. SHA-256 anchored to Ethereum.
11. Case closes. Investigator confirms/corrects every atom in a close-out review. Approved atoms feed B7 ground-truth flywheel. Next nightly run, the model gets marginally better on this typology.
12. Six months later, opposing counsel demands an audit. You hand them the Reproducibility Pack. They re-run it. Same numbers. The math passes the judicial audit.

That's the product.

---

## Part G — Open questions for our v0.3 pass

The questions from v0.1 stand. I'd add four:

**G1. Where do we draw the autonomy line?**
The Tracer Agent can run unattended. The Bridge Agent can too. Should the **Attribution Agent** be allowed to publish a court-grade entity label without a human in the loop, ever? My instinct: no, not in v1. Even with all of B's guardrails, attribution is the highest-blast-radius mistake. Disagree?

**G2. How public should the reproducibility chain be?**
Anchoring SHA-256 hashes of case manifests to a public blockchain provides tamper-evident timestamping but reveals case metadata (size, time of activity). Is the privacy cost worth the evidentiary value? My instinct: anchor only at case-close, only the final manifest, and only if the case is going to court.

**G3. Cross-case learning, with what consent model?**
The B7 ground-truth flywheel is most powerful when learnings flow across tenants. But LE agencies will not share case data. The differential-privacy layer (B8) lets us extract patterns without exposing cases — but is that compelling enough to ship as a default-opt-in, or do we need separate signed agreements per agency?

**G4. The "freeze decision" interface.**
B's whole point is autonomous accuracy, but B's whole point is also that _the freeze button stays with the human_. What does the UI for that decision look like? My current thinking: a one-pager auto-generated at the moment a freeze opportunity is detected, showing (a) the trace, (b) the confidence with intervals, (c) the Critic's open challenges, (d) the methodology used, (e) the responsible-VASP info, (f) the SLA clock. Investigator clicks one of three buttons: Freeze, Don't Freeze, Escalate to Supervisor. Every click is logged to SBS.

---

## Part H — TL;DR

Your v0.1 gave us the body — 14 well-thought investigation modules and a real plan for AI-assisted automation.

My v0.2 layer is the **nervous system that makes the body trustworthy**: a structured belief state, tiered determinism, reproducibility snapshots, a confidence calculus, a parallel adversarial critic, hallucination gates, a ground-truth regression flywheel, and a privacy/governance backbone.

Together: a platform where the AI does the work, and every claim it makes is reproducible, challengeable, and court-defensible. That is the only path to "AI and automation that is accurate" as you put it. Anything less is a demo, not evidence.

Argue with anything. The Belief State Service, the Critic-as-peer-not-postprocess, and the Reproducibility Pack are the three I'd defend hardest.
