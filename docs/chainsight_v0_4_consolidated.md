# ChainSight v0.4 — Consolidated Design

> v0.4 locks every open question from v0.1 through v0.3 and produces a single canonical reference.
> All prior documents (mind map, schema, accuracy spine, PSR addendum, BYOK addendum) remain valid.
> This file is the consolidated state of decisions and the index into them.

---

## Decision log

Every open question that has been raised across the design conversation, with its final disposition.

| ID     | Topic                                       | Status    | Decision                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | Autonomy line for AI attributions           | ✅ Locked | Human-in-the-loop required for any court-grade attribution. AI proposes; investigator publishes. Enforced at the database layer: `signoff_id` mandatory on any court-grade `is_controlled_by`/`is_entity` BeliefAtom.                                                                                           |
| **G2** | Public anchoring of reproducibility hashes  | ⏳ Open   | Lean: anchor only at case-close, only the final manifest hash, only when the case is going to court. Default off; opt-in per case.                                                                                                                                                                              |
| **G3** | Cross-case learning with what consent model | ⏳ Open   | Lean: differential-privacy aggregation on by default for the same agency tenant, opt-in (with signed agreement) for cross-agency. Air-gapped tenants: never.                                                                                                                                                    |
| **G4** | Freeze decision UI                          | ✅ Locked | One-pager design: trace summary, confidence with intervals, open Critic challenges, methodology used, VASP info, SLA clock, three buttons (Freeze / Don't Freeze / Escalate). Every click logged to immutable audit.                                                                                            |
| **G5** | Path immutability after sign-off            | ✅ Locked | Finalized paths are immutable. New facts spawn a new path version with a `supersedes` link to the prior one. Evidentiary integrity.                                                                                                                                                                             |
| **G6** | Proactive AI path suggestions               | ✅ Locked | AI proposes the three highest-value evidentiary paths in a "Suggested" sidebar. Canvas stays clean until investigator promotes a suggestion with a click. Critic Agent reviews every proposal before it can be promoted.                                                                                        |
| **G7** | Cross-path math when paths share nodes      | ✅ Locked | **Case-level math is canonical.** Per-path views are projections of the case-level math. Any discrepancy between "sum of per-path values" and "case total" is rendered prominently in multi-path reports so prosecutors never accidentally double-count. The Math Service computes both views and the variance. |
| **G8** | Reseller/referral economics with providers  | ⏳ Open   | Lean: vendor-neutral in v1; optional, fully-disclosed revenue-share program in v2. Neutrality is part of the trust pitch.                                                                                                                                                                                       |

---

## The three pillars of ChainSight (locked)

After all iterations, the platform stands on three architectural pillars. Everything else hangs off these.

### Pillar 1 — The Belief State Service (accuracy)

Every claim the AI makes is a first-class object with provenance, derivation, confidence, tier (T0–T3), source provider, and challenge history. No agent has private knowledge; every agent reads from and writes to the shared belief state. This is what makes a 50-hop autonomous trace defensible.

### Pillar 2 — The Reproducibility Pack (court-defensibility)

Every report ships with a frozen snapshot — chain data, rule versions, attribution snapshots, tool log, model card, SBS history, and a `replay.sh` that reconstructs the entire trace. Opposing counsel re-runs it on their hardware; same inputs produce same outputs forever. This is what survives the [D'Aloia mathematical audit](https://capturacyber.com/cryptocurrency-tracing-methodology-scrutinised-daloia-v-persons-unknown/).

### Pillar 3 — The BYOK Provider Marketplace (commercial leverage)

Every external data source — explorers, attribution feeds, market data, OSINT, AI models — is interchangeable through a capability-based router. Agencies bring their own commercial licenses (Chainalysis, TRM, Elliptic, Etherscan, Allium, etc.); ChainSight ships the integration surface and the engine. This defuses procurement objections and turns "ChainSight + your stack" into the cheapest path to court-grade output.

These three are the answer to "why does this platform exist when Chainalysis/TRM/Elliptic already do.” Each addresses a real gap none of the incumbents solve well.

---

## The G5/G6/G7 lock — what changes in the codebase

### G5 — Path immutability

```typescript
TracePath {
  // existing fields ...
  status: enum                // draft | under_review | finalized | superseded
  signoff_id: investigator_id | null
  signoff_at: timestamp | null
  signoff_hash: sha256        // hash of the path at moment of signoff
  supersedes: TracePathId | null
  superseded_by: TracePathId | null
  immutable: bool             // becomes true at signoff
}
```

Rules:

- `status: draft` → freely editable by the author
- `status: under_review` → editable but every edit logs an event and re-triggers Critic review
- `status: finalized` → **immutable**; the only allowed operations are `fork` (create a new draft inheriting this path's atoms) and `supersede` (mark this path as outdated and link forward to the replacement)
- Database constraint enforces immutability: any UPDATE on a finalized path's content fields is rejected at the storage layer
- The UI exposes a single "Fork to revise" button on finalized paths; never an "Edit" button
- Reproducibility sub-packs for finalized paths are built once and content-addressed forever

When a finalized path is superseded, both versions remain in the case. The report exporter can show "Path A (superseded by Path A.2 on date X)" so the evidentiary history is visible.

### G6 — Proactive path suggestions

A new background agent — the **Suggestion Agent** — runs whenever a case has ≥1 IOC and ≥1 hop of trace data:

```typescript
PathSuggestion {
  id: uuid
  case_id: uuid
  proposed_path: TracePath          // status: suggested (a new status)
  rationale: string                 // why the AI thinks this matters
  evidentiary_score: float          // multi-factor: value, confidence, terminus type, novelty
  critic_review: CriticReview       // mandatory before this can be promoted
  status: enum                      // suggested | accepted | rejected | stale
  created_at: timestamp
  promoted_to_path_id: TracePathId | null   // set when investigator accepts
}
```

Behavior:

- Suggestion Agent runs continuously in the background as new data lands in the case
- Top-3 suggestions surface in a "Suggested paths" sidebar on the canvas
- Each suggestion has a small preview (mini-graph + key stats)
- Suggestions never auto-render on the main canvas; investigator promotes with one click
- Critic Agent (B5) reviews every suggestion before it appears in the sidebar — suggestions the Critic rejects never reach the investigator
- Suggestions that age past N days without action are marked `stale` and demoted
- When the investigator promotes a suggestion, it becomes a `draft` TracePath; everything else (editing, finalization, immutability) follows the standard PSR workflow
- Investigator can rate suggestions (helpful / not helpful) — feeds the B7 ground-truth flywheel for the Suggestion Agent's training

UX detail: the suggestion sidebar is collapsible. Investigators who want a clean canvas can hide it; investigators who like the AI nudges can keep it open. Either way, the canvas itself stays clean until they choose to engage.

### G7 — Cross-path math (case-level canonical, paths as projections)

This is the most subtle of the three and deserves more detail.

**The problem**: if $1M flows into a shared intermediate wallet from a victim and then splits across three exit paths (A: $400k to Binance, B: $350k to a peel chain, C: $250k to a mixer), each methodology attributes the original $1M differently to the three exits. FIFO and LIFO will disagree; LIBR and pari passu will give yet other answers. If we run the math independently per path, the three per-path numbers will not sum to $1M — they could sum to $1.2M or $0.8M depending on how each methodology handles the commingled intermediate.

**The decision**: **the Math Service computes everything at the case level first**, producing a canonical attribution of the input value across all reachable exits under each methodology. Per-path views are _projections_ of the canonical math onto the subset of edges in that path.

```typescript
CaseAttributionResult {
  case_id: uuid
  methodology: enum             // FIFO | LIFO | HIFO | LIBR | pari_passu | rolling_charge | spec_id | avg_cost
  input_atoms: BeliefAtomId[]   // the tainted/traced inputs
  total_input_value: Decimal    // canonical input
  exit_attributions: ExitAttribution[]   // one per terminal node in the case graph
  computed_at: timestamp
  rule_version: string
  reproducibility_hash: sha256
}

ExitAttribution {
  exit_node: NodeRef
  attributed_value: Decimal     // canonical, methodology-specific
  confidence: ConfidenceInterval
  contributing_paths: TracePathId[]   // every path that ends here
}

PathMathProjection {
  path_id: TracePathId
  methodology: enum
  case_attribution_ref: CaseAttributionResult
  projected_value_at_terminus: Decimal   // this path's slice
  share_of_case_total: float    // 0..1
  unprojected_residual: Decimal // values inside the path that didn't propagate to this terminus under this methodology
}
```

What the investigator sees in a multi-path report:

```
## Methodology comparison — case-level totals
| Method         | Total traceable across all exits | Confidence    |
| FIFO           | $1,000,000                       | 0.94          |
| LIBR           | $1,000,000                       | 0.92          |
| Pari passu     | $1,000,000                       | 0.91          |

## Per-path values (projected from case-level)
| Path | Exit       | FIFO       | LIBR       | Pari passu |
| A    | Binance    | $400,000   | $352,000   | $400,000   |
| B    | Peel chain | $350,000   | $358,000   | $350,000   |
| C    | Mixer      | $250,000   | $290,000   | $250,000   |
| Sum  |            | $1,000,000 | $1,000,000 | $1,000,000 |

## Variance check
✅ Per-path sums equal case-level totals under all methodologies.
```

If the variance check **fails** — which can happen when paths overlap on intermediate hops but the methodology distributes them differently — the report renders a **prominent variance disclosure**:

```
⚠️ Variance detected
Under FIFO, the sum of per-path values ($1,050,000) exceeds the
case-level traceable input ($1,000,000) by $50,000. This indicates
that Paths A and B share an intermediate hop whose attribution is
counted in both paths. The case-level figure of $1,000,000 is
canonical; do not sum per-path values for legal claims.
```

This is the safeguard against the most dangerous accounting mistake a prosecutor can make in a crypto case: double-counting commingled funds. We surface it instead of hiding it.

Implementation:

- Case-level math runs whenever the case graph or methodology configuration changes
- Per-path projections recompute when their path is saved or finalized
- Both numbers are persisted; variance is computed on report generation
- Variance > $0 (or > a configurable epsilon for floating-point safety) triggers the disclosure block automatically — the Verifier Agent will not let a report through without it

---

## Updated build phasing (v0.4 final)

| Phase       | Months | Deliverables                                                                                                                                                                                                                                      |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 0** | 1      | Case model, intake, evidence vault, single-chain Ethereum trace, FIFO accounting, basic OSINT, **Provider Marketplace stub + Capability Router**, **Belief State Service stub**                                                                   |
| **Phase 1** | 2–3    | Bitcoin (UTXO engine), BSC/Base/Arb/Polygon/Tron, CCTP + LayerZero + Wormhole, visual canvas v1, LIFO + LIBR, **full Math Service**, **Reproducibility Pack v1**                                                                                  |
| **Phase 2** | 4–6    | AI agent layer (orchestrator + tracer + bridge + swap + attribution + narrative + **critic in parallel**), memory stack (Redis + pgvector + Zep), **PSR click-select + auto-pathfind + single-path reports**, **Suggestion Agent**, skill library |
| **Phase 3** | 7–9    | Court-readiness, **PSR multi-path + observer-mode playback + NL-select**, **G7 case-level math + variance disclosure**, pari passu + rolling charge, SOC2 work begins, **G5 path immutability enforced at DB layer**                              |
| **Phase 4** | 10–12  | Watcher Agent + rule DSL, real-time CRDT canvas, **collaboration on paths**, cross-agency sharing, compliance handoff, FedRAMP path opens, **expanded Provider catalog (Phase-3+ integrations)**                                                  |

---

## Documents in this design pack

All in `/home/user/workspace/`, all shared:

1. **`chainsight_mindmap.md`** — Mermaid mind map of the 14 domains + AI + platform
2. **`chainsight_schema.md`** — Module-by-module spec with data models and open questions (v0.1)
3. **`chainsight_merged_v0_2.md`** — The accuracy spine (B1–B8) merged with the domain vision
4. **`chainsight_v0_3_addendum.md`** — PSR module (Path Selection → Report) + locked D1/D2
5. **`chainsight_v0_3_byok_addendum.md`** — BYOK Provider Marketplace as a first-class pillar
6. **`chainsight_v0_4_consolidated.md`** _(this file)_ — All locked decisions + G5/G6/G7 implementation detail + final phasing

---

## What's still open (v0.5+ candidates)

- **G2** — Public anchoring policy (default off; opt-in per case is the current lean)
- **G3** — Cross-agency learning consent model (DP within tenant on by default; cross-tenant opt-in with signed agreement)
- **G8** — Reseller economics with data providers (neutral in v1; revenue-share program possible in v2)
- **First module to spec build-ready** — my recommendation remains: **Tracer Agent + Belief State Service + Pathfinder Service** as a coupled trio, since PSR and the autonomous-trace workflow both depend on all three.

---

## Where I want to take v0.5

Three possible next moves, your call which one:

**Option A — Build-ready spec for the trio (Tracer + Belief State + Pathfinder)**
Detailed enough that an engineer could start implementing: API contracts, message schemas, state machines, error handling, performance targets, test plan. About a day's work to produce; produces ~30 pages of dense spec.

**Option B — UI mockups for the canvas, PSR selection, and freeze-decision one-pager**
Visual designs we can iterate on with stakeholders before committing build cycles. About a half-day's work; produces wireframes plus an interactive prototype if you want.

**Option C — Go-to-market plan**
Pricing tiers (agency / department / private-investigator), competitive positioning vs Chainalysis/TRM/Elliptic, pilot-customer profile, BYOK provider partnership outreach list, demo script. About a day's work.

My recommendation is **Option A** — the trio is the technical risk centerpiece and getting it precisely spec'd will derisk everything downstream. But you're the founder; pick what unblocks you most.
