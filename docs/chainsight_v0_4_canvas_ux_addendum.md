# ChainSight v0.4 — Canvas UX & Investigator Markup Addendum

> **Product principle (locked):** _"So Easy a Caveman Can Do It" on the frontend; uncompromising sophistication on the backend._
>
> Every interaction in this addendum is one click, one drag, or one keystroke on the surface. Behind every interaction is a Belief Atom write, a Math Service call, a Critic review, and a reproducibility log entry. The investigator never sees that machinery — they see a graph that responds the way they expect a graph to respond.

This addendum extends v0.1–v0.3 and the v0.4 consolidated reference. Nothing changes; this layer adds the investigator-facing canvas mechanics.

---

## Part 1 — The "Important" markup system

### 1.1 What it is

Anywhere on the canvas, the investigator can mark something as **important**. The thing being marked can be:

- A **transaction** (an edge between two addresses)
- An **input** (a specific UTXO being consumed, or a specific ERC-20 transfer-in)
- An **output** (a specific UTXO being created, or a specific transfer-out)
- A **contract call** (an internal call inside a tx — DEX swap, bridge deposit, approval, etc.)
- An **EOA transaction** (a plain externally-owned-account transfer)
- A **node** (an address or cluster)
- A **path segment** (a sub-section of a TracePath)
- A **time window** (a range on the timeline where activity matters)

One keystroke (`I` for important) or one right-click → "Mark important" attaches an **InvestigatorMark** to the entity. It is visible from then on: glowing border, distinctive color, listed in a side panel.

### 1.2 Why this matters

Every existing forensics tool treats every transaction equally on the canvas. In reality, in a 200-node trace, maybe 30 of them are evidentially load-bearing — the rest are noise the investigator visually filters out. The platform should help with that filtering, not fight it.

Marking is also the first step toward report generation. The investigator marks what matters as they explore; the Narrative Agent reads the marks when drafting; the report writes itself around the marked entities.

### 1.3 Data model

```typescript
InvestigatorMark {
  id: uuid
  case_id: uuid
  target_type: enum   // tx | input | output | contract_call | eoa_tx | node | path_segment | time_window
  target_ref: TargetReference   // discriminated union to the actual graph element
  importance_level: enum        // critical | high | normal | reference_only
  rationale: text               // free-text "why this matters" — investigator-set
  tags: string[]                // free-form, e.g. ["seed-funding", "first-bridge", "obfuscation-attempt"]
  color: ColorRef               // either a preset semantic color or custom
  icon: IconRef                 // optional icon overlay (see Part 3)
  memo: Memo | null             // rich attached note (see Part 4)
  created_by: investigator_id
  created_at: timestamp
  case_role: enum               // evidence | hypothesis | context | red_herring_documented
  visible_to: AccessScope       // case_team | author_only | specific_users
  audit_trail: MarkAuditEvent[] // every change logged
}

InvestigatorMark also writes a corresponding BeliefAtom:
{
  subject: target_ref,
  predicate: "marked_important_by_investigator",
  object: importance_level,
  confidence: 1.0,              // human-asserted, not inferred
  tier: T0,                     // investigator action is canonical
  provenance: [investigator_id, timestamp],
  derivation: [rationale],
}
```

The Belief Atom binding is what makes marks **first-class evidence** rather than UI decoration. They survive reports, replays, exports, and audits.

### 1.4 The Important sidebar

A docked panel on the canvas, always one click away:

- Lists every marked entity in the current case, grouped by importance level
- Each row shows: icon, name/hash, type, rationale snippet, "go to" button (re-centers the canvas)
- Filters by tag, level, author, time
- "Generate report from marked items" button — drafts a report scoped to just the marked entities, using the PSR machinery
- Reorderable — investigators can sequence the marks into the narrative order they want for the report

---

## Part 2 — The Value Split / Flow Indicator

### 2.1 The problem this solves

When a transaction has multiple outputs (the common case for both UTXO and account-model chains), the value splits. A peel chain might send 90% onward and 10% to change. A swap router might split a swap across three pools. A bridge contract might emit fees to one address and the bridged value to another. The investigator needs to **see the math** on the canvas at all times.

Most tools either hide this (showing only "tx → tx" with no proportions) or surface it only in tabular drill-downs. We surface it visually, always.

### 2.2 What the investigator sees

For every multi-output transaction:

- **Edge thickness** = absolute value (log scale, so big and small are both visible)
- **Edge color intensity** = proportion of the parent value going down that edge
- **Inline percentage label** on each outgoing edge: `73.4%` / `26.6%` / `0.0001% (dust)`
- **Native amount** under the percentage: `0.7340 BTC` / `0.2660 BTC` / `5,000 sats`
- **Fiat at tx time** in muted text below: `~$47,210` / `~$17,110` / `~$0.32`
- **Cumulative-from-source percentage** as a hover tooltip: "this output carries 18.4% of the original tainted value after 6 hops" — computed by the Math Service under the active methodology

For UTXO transactions, the input side also gets the same treatment: each input shows what percentage of the total tx value it contributed, so the investigator can see commingling at the input gate, not just at the output gate.

For contract calls (e.g. a Uniswap router call that splits across pools), the **internal call tree** is rendered as a collapsible sub-graph beneath the parent tx node, with the same percentage discipline applied at every fork.

### 2.3 The "Where did the money go?" overlay

A toggle that, when on, renders **every edge in the graph** with its accumulated-from-source percentage and an arrow whose color follows the active methodology's taint propagation. Suddenly the entire graph is colored by "how much of the original tainted money is here?" — and the investigator can see at a glance which branches are dead ends (taint dropped to <1%) and which are live.

Switching methodologies in the toggle (FIFO / LIFO / LIBR / pari passu / rolling charge) **re-colors the entire graph in real time** because the Math Service has precomputed all of them at the case level (G7). This is the single most impressive demo moment in the product.

### 2.4 Data model & Math Service hook

```typescript
EdgeValueAnnotation {
  edge_id: EdgeRef
  parent_tx: TxRef
  absolute_value_native: Decimal
  absolute_value_fiat_at_tx: Decimal
  share_of_parent_tx: float         // 0..1
  cumulative_share_from_source: {   // one per methodology
    fifo: float
    lifo: float
    hifo: float
    libr: float
    pari_passu: float
    rolling_charge: float
  }
  fee_attribution: Decimal          // if this edge bore a portion of the gas/bridge/swap fee
  computed_by_rule_version: string  // for reproducibility
}
```

The Math Service computes these annotations for every edge in the case graph and refreshes them when the graph changes. The canvas reads from the annotation store; it never does math in the browser.

### 2.5 Why this matters

Two reasons.

First, **investigators trust math they can see**. A floating "$2.4M traceable" claim in a report is abstract; a graph where every edge shows its percentage and the colors visibly fade as taint drops is concrete. The math is auditable from the canvas, not just from the appendix.

Second, **prosecutors and judges respond to visual proof**. The same overlay the investigator uses to navigate becomes the courtroom exhibit (observer mode plays it back). The graph that helped the investigator find the truth is the graph that helps the jury see it.

---

## Part 3 — Iconography

### 3.1 Built-in icon library

The canvas ships with a curated icon set. Every icon has semantic meaning, and the meaning is enforced — investigators don't get to make up icons that mean different things in different cases. Categories:

**Entity-type icons (auto-applied by attribution)**

- 🏦 Centralized exchange
- 💱 DEX / AMM
- 🌉 Bridge contract
- 🌀 Mixer (Tornado, CoinJoin, etc.)
- 🛒 OTC desk
- 🧊 Cold storage
- 🔥 Hot wallet
- 💳 Payment processor
- 🎰 Gambling / casino
- 🏴‍☠️ Darknet market
- 📜 Sanctioned entity (with sub-glyph for OFAC/EU/UN)
- 🤖 Smart-contract / DeFi protocol
- 👤 Likely EOA (no contract code, transactional pattern)
- ❓ Unattributed (placeholder until labeled)

**Activity-type icons (auto-applied by tx classification)**

- ➡️ Plain transfer
- 🔄 Swap
- 🌉 Bridge in / Bridge out (directional)
- 📥 Exchange deposit
- 📤 Exchange withdrawal
- ✅ Approval
- 🔒 Lock / stake
- 🔓 Unlock / unstake
- 🪙 Mint
- 🔥 Burn
- 🎁 Airdrop received
- 🧾 NFT mint / transfer
- ⚡ Contract creation
- ⚠️ Failed transaction
- 🥪 MEV sandwich victim
- 🤝 Atomic swap leg

**Investigator-applied icons (semantic markers)**

- 🎯 Pivot point ("this is where the trail turned")
- 🚪 Off-ramp ("funds exited to fiat or stable here")
- 🪤 Trap ("this is a known LE-controlled or honeypot address")
- 👁️ Watched (under live monitoring)
- ⏸️ Awaiting subpoena
- 📞 Awaiting MLAT
- ❄️ Frozen (freeze order issued or executed)
- ⚖️ Court-grade evidence
- 🚩 Red flag (suspicious but unconfirmed)
- ✏️ Has note
- 🔗 Cross-references another case

**Severity icons (auto + manual)**

- 🔴 Critical
- 🟠 High
- 🟡 Medium
- 🟢 Low
- ⚪ Reference only

### 3.2 Custom icons

Agencies can upload their own icon set (organizational symbols, classification markings, jurisdiction-specific markers). Custom icons are scoped to the agency tenant and don't propagate to cross-agency shared cases unless explicitly bundled.

### 3.3 Icon stacking

A single node or edge can carry multiple icons. The renderer stacks them in a small badge cluster attached to the entity — entity-type primary, activity-type secondary, investigator-applied as overlay badges. The visual ordering is consistent across the platform so investigators learn it once.

### 3.4 Color discipline

We don't let investigators free-pick colors. We ship a **semantic palette** with locked meanings:

- **Red family** — taint, sanctions, criminal funds, high risk
- **Orange family** — elevated risk, unattributed, suspicious behavior
- **Yellow family** — caution, pending verification, soft attribution
- **Green family** — clean, attributed legitimate entity, exchange-grade
- **Blue family** — investigator markup (marks, paths, notes)
- **Purple family** — privacy chains, mixers, obfuscation
- **Gray family** — context-only, low confidence, reference

Within each family, hue/saturation encode sub-meaning (e.g. red darkens as taint percentage rises). Investigators can override colors for a specific entity if they have a case-specific reason, but the override is recorded and visible in the audit trail. This is how we keep a 12-investigator team from producing 12 incompatible color schemes.

---

## Part 4 — Memos & Notes

### 4.1 The memo system

Every entity on the canvas — node, edge, transaction, contract call, input, output, path, time window — can carry a **Memo**. Memos are rich-text first-class objects:

```typescript
Memo {
  id: uuid
  case_id: uuid
  target_ref: TargetReference
  author_id: investigator_id
  content_md: text                // markdown body
  attachments: AttachmentRef[]    // images, PDFs, screenshots, audio recordings
  links: ExternalLinkRef[]        // links to subpoena returns, court orders, OSINT pages
  cross_refs: CrossRef[]          // links to other entities in this case or shared cases
  tags: string[]
  pinned: bool
  visibility: AccessScope
  created_at, updated_at: timestamp
  edit_history: MemoVersion[]
}
```

A memo behaves like a sticky note attached to the entity. The canvas shows a `✏️` badge on any entity with a memo. Hover preview shows the first ~120 characters; click opens the full memo in a side drawer.

### 4.2 What investigators put in memos (in practice)

- "Subpoena #2024-0184 returned this address as kyc-verified to John X — see attached"
- "This is the address the victim said the scammer used on Telegram, screenshot attached"
- "OTC desk confirmed by phone with @agent — funds were converted to cash 6 weeks after this tx"
- "This bridge hop is T3 heuristic-matched — we have a request out to the bridge operator for the message ID"
- "Compare to Case 2024-0312, same suspect, similar pattern"

These are the bread crumbs that make a case file useful three years later when it comes back from court appeals. The platform turns them into structured evidence.

### 4.3 AI integration

The **Narrative Agent** reads memos when drafting reports. A node with a memo that says "subpoena confirmed Binance KYC for John X — see attached" produces a report sentence like "Address 0xabc... was confirmed via subpoena return #2024-0184 to belong to John X." with the memo and its attachment cited.

The **Suggestion Agent** also reads memos when proposing paths. If the investigator wrote "this is where the trail turned" on a node, the Suggestion Agent will treat that node as a high-value pivot point in its proposals.

This is the loop that makes the platform learn from the investigator: **the investigator writes plain English; the AI converts that into structured evidence and uses it.** No prompt engineering. No special syntax. Just notes.

### 4.4 Memo templates

For repetitive memo types (subpoena returns, MLAT responses, KYC confirmations, exchange disclosures), templates are available one click away. Each template auto-fills fields the platform can predict (date, case ID, investigator name, target entity) and prompts for the rest. Filled templates are structured under the hood — the Narrative Agent can extract them precisely — but feel like fill-in-the-blank notes to the investigator.

---

## Part 5 — Building the graph (caveman-friendly mechanics)

### 5.1 Direct manipulation

The graph is **directly manipulable**. Investigators don't write queries to build views; they drag things.

- **Drag a node to reposition** — sticky positions saved per investigator per case
- **Drag a node off-canvas** to hide it from the current view (not delete — hide)
- **Double-click an entity** to expand its neighborhood by one hop
- **Right-click → "Trace outgoing"** runs the Tracer Agent forward from this node with default stopping rules
- **Right-click → "Trace incoming"** runs the Tracer Agent backward
- **Drag-select multiple nodes** to group them into a temporary cluster
- **Drag two nodes together** to suggest merging them (Critic Agent confirms or rejects the merge)
- **Drag a memo onto a node** to attach it (also works for files dropped from the desktop)
- **Two-finger pinch / scroll wheel** to zoom; clicking and dragging the background to pan; nothing weirder than a map app

### 5.2 The shortcut sheet (one-page printable)

| Key           | Action                                                     |
| ------------- | ---------------------------------------------------------- |
| `I`           | Mark selected entity as Important                          |
| `M`           | Attach a Memo                                              |
| `T`           | Add a Tag                                                  |
| `P`           | Start a Path from selected node                            |
| `Shift+click` | Extend the current Path                                    |
| `E`           | Expand neighborhood by one hop                             |
| `H`           | Hide selected from current view                            |
| `F`           | Focus / re-center on selected                              |
| `1`–`9`       | Apply preset filter (taint level, methodology, confidence) |
| `Space`       | Toggle the "Where did the money go?" overlay               |
| `?`           | Open shortcut help                                         |

Printable as a one-page reference card the investigator keeps on their desk. **Easy on the front.**

### 5.3 Levels of detail (LOD)

The canvas auto-simplifies as the investigator zooms out and shows more detail as they zoom in:

- **Far out**: clusters as single nodes, only critical-marked entities visible, edges aggregated by chain
- **Medium**: individual addresses, edges grouped by direction
- **Close**: every tx, every contract call expanded, internal call tree visible, percentage labels on every edge
- **Microscope**: a single tx with all its inputs, outputs, internal calls, and decoded calldata

The investigator zooms in and out fluidly; the platform never makes them pick a "view mode."

### 5.4 What never appears on the canvas (by design)

- Walls of text (memos open in a side drawer, not on the graph)
- Modal dialogs that block work (everything is dismissible, everything is non-modal where possible)
- More than ~3 colors at the same zoom level (semantic palette is curated)
- Math the investigator can't see the source of (clicking any number opens its derivation)
- Decisions the investigator didn't make (AI suggestions live in the sidebar, never on the canvas until promoted)

---

## Part 6 — The sophistication that lives behind every click

For every "easy" action the investigator takes, here is what the backend does. The investigator never sees this. The reports prove it happened.

| Investigator action (front)                                        | Backend (the iceberg below)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marks a tx as Important (`I`)                                      | Writes `InvestigatorMark`, writes corresponding `BeliefAtom` (T0, investigator-asserted), logs to audit trail, notifies Suggestion Agent (which may re-rank suggestions), notifies Critic Agent (which may close related challenges), updates the Important sidebar, propagates to any linked path's importance scoring                                                                                                                                                           |
| Drags two nodes together to merge                                  | Critic Agent receives merge proposal, runs cluster-coherence check against rule version pinned to the case, looks for conflicting attributions across installed providers, computes confidence delta if merged, returns approve/reject/challenge; on approve, writes a `is_same_entity_as` BeliefAtom with the investigator as provenance; on challenge, surfaces the conflicting evidence and requires resolution                                                                |
| Toggles the "Where did the money go?" overlay                      | Reads precomputed `EdgeValueAnnotation` rows for every edge in the visible viewport under the active methodology, renders gradient on every edge, no math runs in the browser; backend math service already computed every methodology at case level (G7)                                                                                                                                                                                                                         |
| Attaches a memo with "subpoena #2024-0184 confirms this is John X" | Memo persisted, NER extracts "John X" and "subpoena #2024-0184", links memo to the existing SubpoenaRequest object if found, surfaces a "consider promoting to court-grade attribution" prompt to the investigator, Narrative Agent indexes the memo for next report draft, Critic Agent re-evaluates any open challenges on this entity                                                                                                                                          |
| Drag-selects a region of the graph                                 | Frontend captures node IDs, sends to backend pathfinder service, asks "are there coherent sub-paths in this selection?", pathfinder returns candidate paths, modal asks the investigator to confirm path framing, accepted paths become draft TracePaths with full PSR machinery                                                                                                                                                                                                  |
| Right-clicks → "Trace outgoing"                                    | Tracer Agent receives task with case context, reads SBS for prior beliefs on this node, reads installed provider capabilities to know what data it can fetch, plans expansion under budget constraints, fans out across capability router calls (parallelized across providers per Pillar 3), every hop emits a BeliefAtom, every value computed by Math Service, every step reviewed by Critic in parallel (Pillar 1), every external call logged for reproducibility (Pillar 2) |
| Changes the active methodology in the overlay                      | No tracer re-run; the case-level math is already precomputed for all methodologies (G7); frontend swaps the rendered annotation set; the variance table updates; the report exporter knows which methodology view was active when the investigator hit "generate"                                                                                                                                                                                                                 |
| Drops a PDF onto a node                                            | Document intelligence service (a BYOK capability — Textract / Document AI / Unstructured) extracts text, runs through PII detector, attaches as memo attachment, NER pulls referenced entities, asks investigator "looks like this PDF references addresses 0xabc and 0xdef — add them to the case?"                                                                                                                                                                              |
| Adds a Tag to a marked tx                                          | Tag persisted, tag indexed for filter, Suggestion Agent learns "this investigator considers `obfuscation-attempt` tag → high importance", future suggestions weighted accordingly (B7 flywheel feeding back)                                                                                                                                                                                                                                                                      |

**This is the "Caveman" principle in operation.** One key. Dozens of structured outcomes. Every outcome court-defensible.

---

## Part 7 — Integration with the locked design

| Existing pillar / module        | What changes                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pillar 1 — Belief State**     | InvestigatorMark, Memo, Tag each emit BeliefAtoms with the investigator as provenance and T0 tier. The state of the canvas is always reconstructable from the SBS.                                   |
| **Pillar 2 — Reproducibility**  | All marks, memos, tags, color overrides, and the active methodology at report-generation time are captured in the Reproducibility Pack. The exact canvas state that produced a report is replayable. |
| **Pillar 3 — BYOK Marketplace** | Iconography for entity types depends on attribution providers (icons reflect labels from whichever providers the agency has installed). Document intelligence is itself a BYOK capability.           |
| **PSR (v0.3)**                  | Marked entities become natural anchors for path selection. "Generate report from marked items" is a one-button PSR workflow that uses marks as the path scope.                                       |
| **Suggestion Agent (G6)**       | Reads marks, memos, tags, and color overrides as signals when proposing new paths. The investigator's exploration directly steers AI suggestions.                                                    |
| **Math Service (G7)**           | Owns EdgeValueAnnotation precomputation; the overlay is a read-only view of its output; nothing in the browser does math.                                                                            |
| **Critic Agent (B5)**           | Reviews investigator-asserted marks for internal consistency (e.g. "you marked this as `clean exchange withdrawal` but the source is a flagged mixer — confirm?")                                    |
| **Narrative Agent (B6)**        | Reads marks, memos, and tags when drafting; the report writes itself around the investigator's annotations                                                                                           |
| **Verifier Agent (B6)**         | Confirms every report sentence linked to a marked entity has a memo/citation backing it                                                                                                              |
| **G5 path immutability**        | Marks on a finalized path are immutable; new observations spawn a fork                                                                                                                               |
| **G7 case-level math**          | The overlay always shows the case-canonical math; per-path projections render their share with the variance disclosure rules                                                                         |

---

## Part 8 — What this gives investigators (concretely)

A walkthrough, end-to-end:

1. Investigator opens a new case with 8 BTC addresses from a ransomware payment.
2. Tracer runs overnight; canvas opens to a 180-node, 4-chain graph.
3. Investigator pans, zooms. The "Where did the money go?" overlay is on by default — they can immediately see where the value is concentrated.
4. They press `Space` to flip between FIFO and LIBR; the graph re-colors in real time. They see that under LIBR, more value lands at the suspect Binance address.
5. They `I`-mark the first big multi-output split — a tx where 80% peeled off to a mixer and 20% continued to a swap. They tag it `obfuscation-pattern`.
6. They `M`-attach a memo on the suspect Binance deposit: "Subpoena 2024-0184 returned KYC for John X — see attached." Drop the PDF in. Document intelligence parses it; another address gets extracted and added to the case as a candidate.
7. They drop the 🎯 icon on the pivot tx where the trail turned from BTC to wrapped-BTC. Drop the 🌉 icon on the bridge hop. Drop ❄️ on the Binance address (they've just submitted the freeze request).
8. The Suggestion Agent, watching all this, surfaces three new candidate paths in the sidebar — all anchored on the entities the investigator marked. They promote two with a click each.
9. They drag-select the marked region around the mixer and click "Generate report from marked items." Narrative Agent drafts in 90 seconds. Verifier catches one sentence that's not backed by a memo; it's flagged for the investigator to author. They write one paragraph in their own words.
10. They hit Export. PDF + DOCX + Reproducibility Pack land in their downloads. The pack includes every mark, every memo, every icon position, every color override, the active methodology, the Math Service outputs, the SBS history, and `replay.sh`.
11. Six months later, in deposition, opposing counsel asks "why did you mark this specific transaction as important?" The investigator points to their own memo, attached to that tx, dated the day they made the mark, content-hashed and immutable.

That's the workflow. Easy on the front. Sophisticated on the back. Court-defensible at every step.

---

## Part 9 — Build phasing (updated)

These features slot cleanly into the existing phases:

| Phase                      | Additions from this addendum                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Phase 1 (months 2–3)**   | InvestigatorMark data model, Important sidebar v1, basic memo system, semantic color palette, shortcut keys, drag-to-reposition, direct manipulation primitives                                                          |
| **Phase 2 (months 4–6)**   | EdgeValueAnnotation precomputation, "Where did the money go?" overlay, full iconography library with auto-attribution-driven application, memo templates, document-drop integration, Narrative Agent reading marks/memos |
| **Phase 3 (months 7–9)**   | LOD zoom, methodology-switch real-time recoloring, drag-to-merge with Critic review, custom agency iconography, Suggestion Agent reading marks/memos as signals                                                          |
| **Phase 4 (months 10–12)** | Multi-investigator real-time mark coordination (CRDT), memo cross-references across cases (with consent), printed shortcut card / training mode                                                                          |

---

## Part 10 — Product principle (locked, top-level)

This addendum elevates one line to the platform's top-level product principle, sitting alongside the three architectural pillars:

> **"So Easy a Caveman Can Do It" on the surface. Uncompromising sophistication beneath.**
>
> Every investigator interaction is one click, one keystroke, or one drag. Every interaction triggers Belief Atom writes, Math Service calls, Critic reviews, BYOK provider calls, and immutable audit logging. The investigator sees a responsive graph. The court sees a defensible record. The agency sees a tool their newest investigator can use on day one and their most senior expert can defend on the witness stand.

This goes on the front page of every pitch deck, every onboarding doc, and every engineering retrospective. It is the design tiebreaker when any other principle conflicts.
