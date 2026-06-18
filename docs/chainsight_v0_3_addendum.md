# ChainSight v0.3 — Addendum

> Decisions locked from v0.2 review + one new feature spec.

---

## Part 1 — Decisions locked

### D1. Autonomy line (G1 resolved)
**Human-in-the-loop is mandatory for any court-grade attribution.** The Attribution Agent may *propose* and *enrich* — it may never *publish* a court-grade entity label without an investigator's explicit sign-off. This is enforced in the Belief State Service: any atom with `status: court_grade` and `predicate: is_controlled_by | is_entity` requires a `signoff_id` field populated by an authenticated investigator. The DB constraint rejects the insert otherwise.

### D2. Freeze decision UI (G4 resolved)
Ship the one-pager design from Part G4 of v0.2 as the v1 freeze interface. (Trace summary, confidence with intervals, open Critic challenges, methodology used, VASP info, SLA clock, three buttons: Freeze / Don't Freeze / Escalate. Every click logged.)

### D3. New feature: **Path Selection → Report (PSR)**
See Part 2 below. Promoted to a first-class module that touches Visualization, Belief State, Math, Critic, Reporting, and Evidence.

---

## Part 2 — Path Selection → Report (PSR)

### 2.1 What it is

On the visual trace canvas, the investigator can:

1. **Click-select** a sequence of nodes/edges, or
2. **Lasso-select** a region of the graph, or
3. **Auto-select** "all paths from address X to address Y," or
4. **Ask in natural language** ("show me every path the BTC took from the victim wallet to a centralized exchange") and have the AI propose path candidates that the investigator accepts/rejects.

The selection becomes a first-class object — a **TracePath** — that can be:
- Named, tagged, and annotated by the investigator
- Saved to the case as evidence
- Rendered as a standalone written report (single path)
- Compared side-by-side with other paths (multi-path report)
- Replayed step-by-step in observer mode (courtroom presentation)
- Exported as a reproducibility sub-pack

This is the **connective tissue between Domain 5 (visualization) and Domain 11 (reporting)** that v0.1 and v0.2 left implicit. It deserves to be explicit because in practice, this is how investigators actually work: they explore visually, then they need to lock down what they found in writing.

---

### 2.2 Data model

```typescript
TracePath {
  id: uuid
  case_id: uuid
  name: string              // investigator-set, e.g. "Path A — Victim deposit to Binance hot wallet"
  description: text         // investigator-set, free-form rationale

  // composition
  ordered_nodes: NodeRef[]  // can span multiple chains
  ordered_edges: EdgeRef[]
  branches: TracePathBranch[]  // optional sub-paths (when a hop splits)

  // derived
  total_hops: int
  chains_crossed: string[]
  bridges_used: BridgeRef[]
  swaps_executed: SwapEventRef[]
  start_value_native: Decimal
  start_value_fiat: Decimal
  end_value_native: Decimal
  end_value_fiat: Decimal
  total_fees_paid: FeeBreakdown
  taint_at_terminus: float  // under each methodology
  cumulative_confidence: ConfidenceInterval

  // methodology snapshots — same path, multiple lenses
  methodology_results: {
    fifo:    PathMathResult
    lifo:    PathMathResult
    hifo:    PathMathResult
    libr:    PathMathResult
    pari_passu: PathMathResult
    rolling_charge: PathMathResult
  }

  // provenance
  selected_by: investigator_id
  selected_at: timestamp
  selection_method: enum    // click, lasso, auto_pathfind, ai_proposed_accepted
  belief_atoms_referenced: BeliefAtomId[]
  open_critic_challenges: ChallengeId[]

  // workflow
  status: enum              // draft, under_review, finalized, exported_to_report
  signoff_id: investigator_id | null

  // hashes
  content_hash: sha256      // hash of the canonical path serialization for reproducibility
}

TracePathBranch {
  parent_node: NodeRef
  branch_path: TracePath    // recursive
  rationale: string         // why this branch was included (commingling, swap, bridge fork, etc.)
}
```

The `content_hash` is the critical field. Two investigators selecting "the same path" will produce the same hash if and only if they selected the same atoms in the same order. This makes paths **citeable** across the case and across reports.

---

### 2.3 Selection mechanics on the canvas

**Click-to-select (precise)**
- Investigator clicks a starting node
- The canvas highlights every downstream edge with a faint glow
- Each click extends the path; the path is shown as a bright overlay
- Shift-click adds branches; Alt-click removes the last hop
- Right-click → "Snap to confidence ≥ 0.9 path only" / "Snap to court-grade only" filters

**Lasso-select (regional)**
- Investigator draws a freeform shape on the canvas
- All nodes inside become candidate path members
- A modal asks: "Treat as a single path, or detect sub-paths?"
- If sub-paths, the Tracer Agent runs a constrained pathfinder inside the lasso region

**Auto-pathfind (origin → destination)**
- Investigator picks a start node and end node
- The Tracer Agent enumerates all paths up to a depth/branching cap
- Returns ranked candidates (by value-flow weight, confidence, or shortest)
- Investigator picks one, many, or "include all"

**Natural-language select (AI-assisted)**
- Investigator types: "Show me every path where stablecoins were bridged to Tron before being deposited at a VASP"
- The Tracer Agent parses → constructs a graph query → returns candidate paths
- Each candidate is shown as a hoverable preview overlay before being accepted into the case
- **Critic Agent reviews every AI-proposed path** before it can be promoted to `under_review`

**Multi-path mode**
- The investigator can have N paths active simultaneously, each in a distinct color
- Paths can share nodes; the UI shows overlap explicitly
- Comparison panel docks at the bottom showing methodology results side-by-side

---

### 2.4 The PSR report — what gets generated

For each `TracePath` (or set of paths), the **Narrative Agent** generates a structured report with the **Verifier Agent** gating every claim. Template:

```
# Trace Path Report — {path.name}

## 1. Executive summary
{Two-sentence narrative auto-drafted, verifier-checked, investigator-edited}

## 2. Path overview
- Start: {start_node} ({chain}, {entity_label_if_signed_off})
- End:   {end_node}   ({chain}, {entity_label_if_signed_off})
- Hops: {total_hops}
- Chains traversed: {chains_crossed}
- Bridges used: {bridges_used with versions}
- Swaps: {swap_count, total_slippage, MEV_extracted}
- Start value: {start_value_native} ({start_value_fiat} at T0)
- End value:   {end_value_native}   ({end_value_fiat} at terminus)
- Fees paid:   {total_fees_breakdown}
- Cumulative confidence: {confidence_interval}

## 3. Step-by-step trace
{For each hop:}
  ### Hop {n}: {tx_hash}
  - Timestamp: {block_timestamp}
  - From: {from_address} → To: {to_address}
  - Value: {value_in} → {value_out} (fee: {fee})
  - Type: {transfer | swap | bridge | mixer_entry | mixer_exit | contract_call}
  - Tier: {T0 | T1 | T2 | T3}
  - Confidence at this hop: {p}
  - Belief atoms referenced: [list with links]
  - Critic notes: {if any}

## 4. Accounting under each methodology
{Methodology comparison table — same path, different lenses}
| Method        | Traceable at terminus | Confidence | Notes |
| FIFO          | $X                    | p          |       |
| LIFO          | $Y                    | p          |       |
| HIFO          | $Z                    | p          |       |
| LIBR          | $W                    | p          |       |
| Pari passu    | $V                    | p          |       |
| Rolling chg   | $U                    | p          |       |

## 5. Open challenges
{Any Critic challenges still open against atoms in this path — must be addressed before status: finalized}

## 6. Investigator commentary
{Free-text section the investigator writes}

## 7. Citations
{Every numeric and factual claim above maps to a BeliefAtom or T0 source — listed here with content-addressed links}

## 8. Reproducibility sub-pack
- Path content hash: {sha256}
- Belief atoms snapshot: {hash}
- Rule version manifest: {hash}
- Attribution snapshot: {hash}
- replay.sh: {included}
```

The investigator can:
- **Edit any section freely** (changes tracked, original AI draft preserved in history)
- **Lock sections** to mark them human-authored (verifier still checks citations on locked sections)
- **Regenerate sections** after editing the underlying path
- **Export to PDF, DOCX, or court-exhibit bundle**

---

### 2.5 Multi-path comparison report

When the investigator selects ≥2 paths and clicks "Generate comparison report":

```
# Multi-Path Comparison Report — {case.codename}

## Paths included
| ID | Name | Hops | Chains | Start | End | Value@end | Confidence |
| A  | ...  | ...  | ...    | ...   | ... | ...       | ...        |
| B  | ...  | ...  | ...    | ...   | ... | ...       | ...        |
| C  | ...  | ...  | ...    | ...   | ... | ...       | ...        |

## Shared infrastructure
{Nodes/edges that appear in ≥2 paths — often the most evidentially valuable}

## Divergence analysis
{Where paths split, why, and what that implies — drafted by Narrative Agent, verifier-checked}

## Methodology comparison across paths
{Same methodology table, but per-path columns}

## Combined value flow
{Sankey-style summary: total value into the case, broken down by terminal destination across all paths}

## Narrative synthesis
{AI-drafted holistic story of what the paths collectively show — verifier-gated, investigator-editable}

## Citations & reproducibility
{Same as single-path report, but aggregated}
```

The "shared infrastructure" section is the prosecutor's gold — if three independent victim deposits all converge on the same intermediate address before scattering, that intermediate address is doing work, and showing it visually + in writing is exactly the evidence a prosecutor needs.

---

### 2.6 Integration with the rest of the platform

| System | Interaction |
|---|---|
| **Belief State (B1)** | Every node/edge in a `TracePath` is a reference to a `BeliefAtomId`. The path itself becomes a `BeliefAtom` with predicate `"is_evidentiary_path"`. |
| **Tiered Determinism (B2)** | The path inherits the lowest tier of any atom in it. A path with one T3 atom is a T3 path overall. The report flags this prominently. |
| **Reproducibility (B3)** | The path produces its own sub-pack — a path-scoped slice of the case's reproducibility pack. Useful for exhibits in court. |
| **Confidence Calculus (B4)** | The path's cumulative confidence is computed by the Math Service using the proper per-hop composition. Rendered with intervals, not point estimates. |
| **Critic Agent (B5)** | The Critic reviews every path on save. Open challenges block promotion to `finalized`. The Critic also runs adversarial "alternative path" generation: "here are three other paths the same funds could plausibly have taken — does your conclusion change?" |
| **Hallucination Gates (B6)** | Every sentence the Narrative Agent emits in the report must reference a BeliefAtom or T0 source. The Verifier blocks unfounded sentences. The Math Service owns every number. |
| **Ground Truth Flywheel (B7)** | When a case closes, the investigator's accepted paths become training labels for "what a good path looks like" — improves the natural-language path selector over time. |
| **Privacy (B8)** | Path reports respect case-scoped encryption. Cross-agency sharing of a path uses redaction templates. |
| **Methodology engine (Domain 13)** | Every path runs through all enabled methodologies in parallel. Investigator picks the lens(es) shown in the final report. |
| **Visualization (Domain 5)** | Selected paths render as colored overlays on the canvas; multi-path mode uses distinct colors with overlap indicators. |
| **Observer mode** | A finalized path can be played back step-by-step in courtroom view with optional narration. |
| **Collaboration (Domain 10)** | Paths can be shared, commented on, branched (CRDT-backed). Multiple investigators on the same case can author different paths. |

---

### 2.7 Edge cases the spec handles

- **Path includes a mixer transit (Tornado, CoinJoin)** — report explicitly marks the mixer boundary, distinguishes "pre-mixer trace" from "post-mixer hypothesis," and renders the confidence cliff visually.
- **Path includes a bridge with no message-id correlation** — report flags the heuristic-matched bridge hop as T3 and lists the alternative bridge destinations the Critic considered.
- **Path includes a token swap** — report shows both the native-asset path and the swap-equivalent fiat path, so a prosecutor can see "this same money."
- **Path branches at commingling event** — the report includes all branches with a per-branch methodology table, and the investigator chooses which branches are evidentially relevant.
- **Path's terminus is privacy-chain (XMR, ZEC shielded)** — report ends with a hard boundary marker and routes follow-up to the specialist workflow.
- **Path requires data the investigator hasn't yet subpoenaed** — report flags exchange-deposit termini with "subpoena needed for ground-truth attribution" and auto-drafts the subpoena template.
- **Path crosses cases (the same atoms appear in another active case)** — flagged with consent-gated cross-case notification (the Deconflict pattern).
- **Investigator selects a path that contradicts an existing court-grade BeliefAtom** — UI blocks the save, surfaces the conflict, requires the investigator to either resolve or document the disagreement.

---

### 2.8 What the investigator does in practice

1. Investigator is on the canvas, looking at a 200-node trace the Tracer Agent built overnight.
2. They see what looks like the cleanest path: victim wallet → 4 hops on BTC → Bitcoin/Wrapped-BTC bridge → 6 hops on Ethereum → Uniswap swap to USDT → 2 hops → Binance deposit.
3. They click the victim wallet, then shift-click the Binance deposit. The UI offers "Auto-pathfind A→B" — they pick it.
4. The Tracer Agent enumerates 7 candidate paths. The top-ranked one matches what they expected; ranks 2–7 are alternatives the Critic wants them to acknowledge.
5. They accept rank 1, label it "Path A — Primary route to Binance hot wallet."
6. They lasso-select a side branch they think also matters (a peel chain). Name it "Path B — Peel chain to OTC desk."
7. They click "Generate multi-path comparison report."
8. The Narrative Agent drafts. The Verifier checks every citation. Two sentences are flagged for human authorship. The investigator edits, locks them, regenerates the rest.
9. The Critic surfaces one remaining challenge: the bridge hop in Path A is heuristic-matched (T3 within the path) and has a 0.83 confidence floor, not the 0.95 the investigator's case theory implied. The investigator either commissions a subpoena to the bridge operator to upgrade the hop to T1, or documents the limitation in the report's commentary.
10. Report finalized. Reproducibility sub-pack built. PDF + DOCX + court-exhibit bundle exported. Investigator signs off; the path's content hash and signoff_id are committed to the immutable audit log.

---

### 2.9 What's new in the tech stack to support this

| Component | Addition |
|---|---|
| **Frontend canvas** | Path selection state machine (click / lasso / auto / NL modes), multi-path color manager, overlap renderer |
| **Pathfinder service** | New Python service: constrained k-shortest-paths on the case subgraph, with branching-factor and confidence bounds |
| **NL-to-graph-query** | Smaller fine-tuned model for "convert investigator language to constrained graph traversal spec" — sits in front of the pathfinder |
| **Path report generator** | New Narrative Agent skill, with the path-report template baked in as procedural memory |
| **Path comparison engine** | Math service extension: shared-infrastructure detection, divergence analysis, multi-path methodology cross-tabulation |
| **Observer-mode playback** | New frontend module — step-through with optional TTS narration |
| **Path-scoped reproducibility builder** | Sub-pack builder; same primitives as the case-level pack but scoped to a path's atoms |

---

### 2.10 Open questions for v0.4

**G5 (new). Path immutability vs. living paths.**
Once finalized and signed off, should a path become immutable (only forkable, not editable)? My instinct: yes. Finalized paths are evidence; mutating them after sign-off destroys their evidentiary value. New facts spawn a new path version with a `supersedes` link to the old one. Disagree?

**G6 (new). AI-proposed paths — how aggressive?**
When the investigator opens a fresh case canvas, should the system **proactively propose** "here are the three highest-value evidentiary paths I see" before the investigator selects anything? My instinct: yes, but the AI-proposed paths land in a "Suggested" sidebar, never auto-selected onto the canvas. The investigator promotes them with a click. Same B5 Critic review applies before promotion.

**G7 (new). Cross-path math.**
When the investigator generates a multi-path report with overlapping nodes, the methodology math gets subtle. If $1M of victim funds flows into a shared intermediate wallet and then splits across three exit paths, the methodology engine has to decide how to attribute the $1M across the three exits. FIFO and LIFO give different answers; LIBR and pari passu give yet others. **Do we run the math once at the case level and project onto each path, or run independently per path and accept that they sum to more than the input?** My recommendation: case-level math is canonical, per-path views are projections of it, and any discrepancy between "sum of per-path values" and "case total" is rendered prominently so prosecutors don't accidentally double-count. This needs your forensic-accounting instinct to confirm.

---

## Part 3 — Updated v0.3 build phasing

PSR slots into Phase 2, not Phase 3, because it's the feature that makes the rest of the platform feel like a real investigator's tool instead of a data warehouse:

- **Phase 0 (weeks 1–4)** — Foundations (unchanged)
- **Phase 1 (months 2–3)** — Multi-chain core + Belief State Service stub + Math Service (unchanged)
- **Phase 2 (months 4–6)** — AI agent layer + **PSR (click-select + auto-pathfind + single-path report)** + Critic
- **Phase 3 (months 7–9)** — Court-readiness + **PSR multi-path comparison + observer-mode playback + NL-select**
- **Phase 4 (months 10–12)** — Live watching + collaboration on paths (CRDT path co-authoring)

---

## Part 4 — Summary of v0.3 changes vs v0.2

| Change | Status |
|---|---|
| D1: Court-grade attributions require investigator signoff_id | Locked |
| D2: Freeze decision UI design from G4 | Locked |
| D3: Path Selection → Report (PSR) as first-class module | Added |
| TracePath data model | Defined |
| Selection mechanics (click / lasso / auto / NL / multi-path) | Defined |
| Single-path report template | Defined |
| Multi-path comparison report template | Defined |
| Integration with B1–B8 + Domains 5/10/11/13 | Mapped |
| Edge cases (mixers, bridges, swaps, branches, privacy chains, cross-case) | Spec'd |
| Tech stack additions (pathfinder service, NL-to-graph, observer-mode playback) | Listed |
| New open questions G5/G6/G7 | Surfaced |
| Build phasing updated | PSR pulled forward to Phase 2 |

The mind map and original schema (v0.1) remain valid. The accuracy spine (v0.2) remains valid. This addendum extends, doesn't replace.
