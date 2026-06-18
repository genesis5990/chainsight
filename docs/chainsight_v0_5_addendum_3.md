# ChainSight v0.5 — "Analyze This Transaction" Inspector

> One more feature. The most-used interaction in any blockchain investigation: clicking on a transaction and asking "what is this?" This makes it a first-class, AI-powered, court-defensible primitive.

This addendum extends the transaction-centric graph model from the previous addendum and the canvas UX, PSR, and Belief State systems from earlier work.

---

## Feature 8 — The Transaction Inspector ("Analyze This Transaction")

### 8.1 The interaction

The investigator clicks on any **TransactionNode** (the diamond in the middle of every address-tx-address sequence per Feature 6). A compact context menu appears anchored to the icon:

```
┌─────────────────────────────────┐
│  🔍  Analyze this transaction   │
│  📋  Copy tx hash               │
│  🌐  Open in block explorer     │
│  📎  Attach a memo              │
│  ⭐  Mark as important          │
│  🎨  Add to active path         │
│  🔗  Trace forward from here    │
│  🔙  Trace backward from here   │
└─────────────────────────────────┘
```

Selecting **Analyze this transaction** opens the **Transaction Inspector** — a non-modal popup that floats next to the transaction node (or docks to the side panel if the investigator prefers a sticky position). The AI begins analyzing in real time and feedback streams into the popup as it produces it.

### 8.2 What the investigator sees

The Inspector is structured as a series of stacked sections that fill in progressively as the analysis completes. The investigator sees the popup populate over 2–8 seconds depending on complexity, with each section flagged as it lands. They can scroll, copy any value, or click any referenced entity to pivot the canvas to it.

**Header strip**

- Tx hash (truncated, click to copy full)
- Chain
- Block height + timestamp
- Confirmation depth + finality status
- "Open in explorer" link → uses whichever explorer provider the agency has installed for this chain
- A status chip showing the analysis state: `🟡 Analyzing... → 🟢 Complete`

**Section 1 — Plain-language summary**

A one-paragraph English summary the investigator can read aloud. Example:

> "On August 12, 2024 at 14:33 UTC, address `0xdef...a4c2` executed a Uniswap V3 swap on Ethereum, exchanging 423.7 USDT for 0.1248 ETH at an effective price of $3,395.83/ETH (with 0.41% slippage vs. spot). The transaction paid 0.0021 ETH ($7.13) in gas and routed through the USDT/WETH 0.05% fee pool. The receiving address `0x123...bf90` had not previously interacted with the sending address. This appears to be a routine swap, with no obfuscation indicators present."

This is the Narrative Agent's output, gated by the Verifier (B6), with every claim citing a BeliefAtom. The investigator can copy this paragraph directly into a memo or report.

**Section 2 — Structured facts**

A clean two-column display of canonical facts pulled from chain data (all T0 — cryptographic ground truth):

| Field             | Value                                                 |
| ----------------- | ----------------------------------------------------- |
| From              | `0xdef...a4c2` _(EOA, no contract code)_              |
| To (top-level)    | `0xE5...Uniswap Universal Router` _(attributed)_      |
| Value             | 0 ETH _(token swap; native value is in the calldata)_ |
| Gas used          | 168,432                                               |
| Gas price         | 12.4 gwei                                             |
| Effective fee     | 0.0021 ETH ($7.13 at tx time)                         |
| Nonce             | 1,847                                                 |
| Input data        | `0x3593564c...` _(decoded below)_                     |
| Status            | Success                                               |
| Block             | 20,512,338                                            |
| Position in block | 87                                                    |
| Tx type           | EIP-1559 (Type 2)                                     |

Each value is one-click-copyable and one-click-pivots-the-canvas-to-it (for addresses).

**Section 3 — Decoded action**

For account-model chains, the Inspector decodes the contract call into human-readable form. This is where the platform's value over a plain block explorer becomes obvious.

Example for a Uniswap swap:

```
ACTION: Token swap (Uniswap V3)
─────────────────────────────────
Router function:  execute (Universal Router)
Decoded command:  V3_SWAP_EXACT_IN

Input:
  Token in:       USDT (0xdAC1...1ec7)
  Amount in:      423.7184 USDT
  Recipient:      0x123...bf90

Path:
  USDT → WETH (0.05% fee pool, 0x88e6...5640)
  WETH → unwrapped → ETH

Output:
  Token out:      ETH (native)
  Amount out:     0.1248 ETH
  Effective rate: 3,395.83 USDT/ETH
  Spot at block:  3,409.94 USDT/ETH
  Slippage:       0.41% (within typical range)

Fee breakdown:
  LP fee paid:    0.21 USDT (0.05% to pool)
  Protocol fee:   0.00 (Uniswap V3, currently disabled on this pool)
  Gas fee:        0.0021 ETH ($7.13)
```

For UTXO chains, the same section decodes the input/output structure:

```
ACTION: Bitcoin transaction
─────────────────────────────
Type:             P2WPKH (Native SegWit) spend
Inputs (3):
  bc1q...8a2  → 0.42100000 BTC  [from tx 4f3a...c2b1, output 0]
  bc1q...d3f  → 0.18700000 BTC  [from tx 9e21...77ac, output 1]
  bc1q...9e4  → 0.05000000 BTC  [from tx ab33...440f, output 0]
  ─────────────────────────────
  Total in:        0.65800000 BTC

Outputs (2):
  bc1q...x7y  → 0.58000000 BTC  [main spend]
  bc1q...c4n  → 0.07785000 BTC  [likely change (heuristic: rounded main, smaller, unspent)]

Fee:             0.00015000 BTC ($9.92 at tx time)
vBytes:          141
Fee rate:        106 sat/vB
RBF:             Not enabled
Confirmations:   142 (finalized)
```

For bridges, the decoded action shows source-side and destination-side details, message ID if available, and the cross-chain correlation status.

**Section 4 — Counterparty intelligence**

Each address involved (sender, top-level recipient, every transfer source/destination, every contract called) gets a quick attribution panel:

| Address         | Attribution                     | Source                              | Risk                                  |
| --------------- | ------------------------------- | ----------------------------------- | ------------------------------------- |
| `0xdef...a4c2`  | _Unattributed EOA_              | —                                   | 🟡 Medium (mixer-adjacent, see notes) |
| `0xE5...0aD`    | Uniswap Universal Router v1.2   | Chainalysis + Arkham (corroborated) | 🟢 Low (clean infrastructure)         |
| `0x88e6...5640` | Uniswap V3 USDT/WETH 0.05% Pool | Multi-source                        | 🟢 Low                                |
| `0x123...bf90`  | _Unattributed EOA_              | —                                   | 🟡 Medium (newly created, no history) |

Each row shows where the attribution came from (per Pillar 3 — BYOK provider provenance) and aggregates risk across providers. When providers disagree (e.g. Chainalysis says one thing, TRM says another), the Inspector flags it inline and surfaces the disagreement as a Critic Challenge.

**Section 5 — Context within the case**

The Inspector knows what case it's in. This section places the transaction in case context:

- "This transaction is **hop 7 of Path A** (your primary evidentiary path)"
- "Cumulative taint from source at this hop: **87.3%** under FIFO, **91.1%** under LIBR"
- "This transaction shares its sending address with **3 other transactions** in this case"
- "The recipient address appears in **Wallet: Suspect's Ledger Nano** (analyzed yesterday)"
- "A memo exists on this transaction: _'Confirmed via subpoena #2024-0184'_ — open"
- "**Important** marker set by Investigator Doe on 2026-06-12"

Clicking any line navigates the canvas to the referenced context.

**Section 6 — Obfuscation findings**

If the Obfuscation Detection layer (Feature 4) has anything to say about this transaction, it surfaces here:

```
🪤  OBFUSCATION INDICATORS

  🚨  Peel chain hop detected (confidence 0.91)
      This transaction is hop 4 of 12 in a peel chain
      pattern that originates at 0xabc...d4e3.
      → Open peel-chain finding

  ⚠️  Low-liquidity pool usage (confidence 0.62)
      The Uniswap pool used has under $50k TVL.
      Slippage tolerance higher than typical.
      → Review
```

If nothing flags, this section displays a clean `✅ No obfuscation indicators present.`

**Section 7 — Critic notes**

The Critic Agent always reviews the analysis before it surfaces to the investigator. This section shows any open challenges or skeptical observations:

```
🧐  CRITIC NOTES

  • The attribution for 0xdef...a4c2 as a likely Tornado-adjacent
    address is based on a single-source heuristic (T3). Consider
    seeking corroboration before treating as court-grade.

  • Recipient 0x123...bf90 has no history beyond this transaction.
    If this is a fresh deposit address, attribution will require
    a subpoena to the receiving entity.
```

If the Critic has nothing to say: `✅ Critic has no open challenges on this transaction.`

**Section 8 — Suggested next actions**

Concrete things the investigator can do now, each a single click:

- ⭐ **Mark as Important** (adds to the case's important sidebar; emits a BeliefAtom)
- 📎 **Attach a memo** (opens the memo editor with the tx pre-filled)
- 🎨 **Add to active path** (extends the currently-selected TracePath through this transaction)
- 🔗 **Trace forward 3 hops** (runs Tracer Agent forward from the recipient)
- 🔙 **Trace backward 3 hops** (runs Tracer Agent backward from the sender)
- 📑 **Draft subpoena request** (if recipient is attributed to a regulated VASP, auto-drafts the subpoena package)
- ❄️ **Add to freeze opportunity list** (if recipient is an exchange deposit and the funds are still there)
- 📤 **Export this analysis as a PDF exhibit**

### 8.3 What the AI actually does (the iceberg)

When the investigator clicks "Analyze this transaction," the platform does the following in parallel. The investigator sees a streaming popup; the platform runs:

1. **Pulls full tx data** from installed chain-data providers (capability router — Etherscan / Blockchair / Solscan / etc. per chain), including internal calls and logs. Caches the response in the case for reproducibility.
2. **Decodes calldata** against known contract ABIs from the contract intelligence provider (Sourcify, Etherscan source verification, etc.). For unverified contracts, uses bytecode signature matching against the known-function-selector database (4byte.directory, OpenChain).
3. **Resolves token metadata** — symbol, decimals, name, market cap, current liquidity — via the market-data and DEX-data providers.
4. **Computes value at tx time** in the agency's preferred fiat (default USD) using the historical price provider snapshot pinned at the case level.
5. **Resolves every address involved** through the attribution providers (multi-provider corroboration; disagreements become Critic Challenges).
6. **Reads the Belief State** for any prior knowledge about the transaction or its participants in this case.
7. **Runs the obfuscation detectors** against the transaction and its immediate neighborhood.
8. **Computes the transaction's role in the case** — which paths it appears in, cumulative taint, related transactions, related memos and marks.
9. **Composes a structured analysis output** — the seven sections above plus suggested actions.
10. **Drafts the plain-language summary** with the Narrative Agent; gates it through the Verifier Agent (every sentence must cite a BeliefAtom or T0 source).
11. **Critic Agent reviews** the whole analysis in parallel; any concerns surface in Section 7.
12. **Emits a BeliefAtom** recording that this analysis was performed (with provenance, rule versions, provider responses) so the analysis itself is reproducible.

All of this in 2–8 seconds. The streaming UI lets the investigator start reading Section 1 while Sections 6 and 7 are still computing.

### 8.4 Data model

```typescript
TransactionAnalysis {
  id: uuid
  case_id: uuid
  transaction_node_id: TransactionNodeRef
  requested_by: investigator_id
  requested_at: timestamp
  completed_at: timestamp | null
  status: enum                      // pending | streaming | complete | partial | failed

  // structured outputs
  plain_language_summary: text
  structured_facts: KeyValueRow[]
  decoded_action: DecodedAction     // discriminated union: swap | bridge | transfer | contract_call | utxo_spend | nft_op | mint | burn | approve | other
  counterparty_intel: CounterpartyEntry[]
  case_context: CaseContextEntry[]
  obfuscation_findings: ObfuscationFindingRef[]
  critic_notes: CriticNote[]
  suggested_actions: ActionSuggestion[]

  // provenance
  belief_atoms_referenced: BeliefAtomId[]
  belief_atoms_emitted: BeliefAtomId[]
  provider_responses: ProviderResponseSnapshot[]   // cached for reproducibility
  rule_version_pins: RuleVersionPin[]
  model_card: ModelCardRef                         // which model, prompt template, sampling params

  // reproducibility
  content_hash: sha256
  inspection_persisted: bool        // false = ephemeral inspection, true = saved to case
}
```

### 8.5 Persistence model

Most transaction inspections are exploratory and ephemeral — the investigator clicks around looking at things and doesn't need every inspection persisted. But some are evidentiary and must be preserved. The Inspector supports both:

- **Default**: inspections are cached for 24h, then garbage-collected. They are not part of the Reproducibility Pack unless explicitly saved.
- **Explicit save**: investigator clicks "Save this analysis to the case" — the inspection persists, is included in the Reproducibility Pack, and becomes citable from reports.
- **Auto-save triggers**: if the investigator takes any action that depends on the analysis (marks the tx as important, attaches a memo, adds to a path, drafts a subpoena), the underlying analysis auto-saves so the action has a citable basis.
- **Re-running**: a saved analysis can be re-run later (e.g. after new attribution data arrives); the new version supersedes the old but the old remains in the audit log under G5's immutability principle.

### 8.6 Visual design

The popup itself follows the Caveman principle from the canvas UX addendum:

- **One column, top-to-bottom flow** — investigators don't have to navigate; they scroll
- **Section headers are bold and one-glance recognizable** (the emoji-and-words pattern: `🔍 Decoded action`, `👥 Counterparties`, `🪤 Obfuscation indicators`)
- **Every value is copyable** with a one-pixel hover-to-copy affordance
- **Every entity is clickable** — clicking pivots the canvas to that entity without closing the popup
- **The popup is draggable, resizable, and pin-able** — the investigator can keep it open while exploring the canvas
- **Multiple popups can be open simultaneously** for side-by-side comparison of transactions
- **Compact mode** — investigators who only want Section 1 (the summary) can collapse the rest with one click; the platform learns the investigator's preference per agency tenant
- **Keyboard shortcut** — `Enter` while a transaction is selected opens the Inspector without needing the right-click menu; `Esc` closes it

### 8.7 The "compare two transactions" mode

A natural extension that drops out of the popup design: when two TransactionNodes are selected (shift-click), the right-click menu offers "**Compare these transactions**." This opens a side-by-side Inspector showing both transactions with shared fields aligned for visual diffing. Useful for:

- Spotting copy-cat patterns ("the suspect always swaps right after the deposit hits")
- Identifying transactions executed by the same script (similar gas patterns, similar timing offsets)
- Confirming or refuting the hypothesis that two transactions are part of the same operation

The same Critic Agent reviews the comparison and surfaces structural similarities or divergences in its own section.

### 8.8 Integration with locked features

| System                                  | Touchpoint                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Belief State (Pillar 1)**             | Every analysis emits a BeliefAtom; every reference inside the analysis cites BeliefAtoms; the analysis itself is a BeliefAtom of type `transaction_analysis_performed` |
| **Reproducibility (Pillar 2)**          | Provider responses cached; rule versions pinned; model card recorded; saved analyses are part of the Pack; replay reproduces the exact analysis word for word          |
| **BYOK Marketplace (Pillar 3)**         | Inspector uses installed providers for chain data, attribution, market data, contract intelligence — capability-based, not vendor-named                                |
| **Transaction-centric graph (v0.5 F6)** | The Inspector is _the_ primary inspection primitive for TransactionNodes; this feature is what makes the address-tx-address structure feel useful instead of pedantic  |
| **Canvas UX**                           | Right-click menu and Enter shortcut from the canvas; popup follows the design language; suggested actions match the rest of the platform's vocabulary                  |
| **PSR**                                 | "Add to active path" extends a TracePath through this transaction; "Save analysis" attaches the analysis to the path's evidence trail                                  |
| **Obfuscation Detection (v0.5 F4)**     | Findings surface in Section 6 of the Inspector; the Inspector is where investigators first see most findings                                                           |
| **Document Ingest (v0.5 F2)**           | If a memo on this transaction references a document, the Inspector links to the document at the right page and bounding box                                            |
| **Wallet History Analyzer (v0.5 F7)**   | Inspections inside an analyzed wallet's sub-graph reference the wallet by name in Section 5                                                                            |
| **Court Mode (v0.5 F3)**                | An Inspector view is a valid courtroom frame — "let me show you the analysis of this specific transaction" jumps to the Inspector for the selected tx                  |
| **Critic Agent (B5)**                   | Reviews every analysis; Section 7 is the Critic's visible output                                                                                                       |
| **Narrative Agent (B6)**                | Drafts Section 1 (the summary); Verifier gates it                                                                                                                      |
| **Math Service**                        | Computes every numeric value in the analysis; LLM never types a number                                                                                                 |
| **Deconfliction (v0.5 F1)**             | If the transaction's addresses overlap with another active case, the Inspector flags it inline at the top with a deconfliction badge                                   |

### 8.9 The product-defining moment

This is the feature that sells the platform to investigators in a demo. Every existing tool requires the investigator to:

1. Copy the tx hash
2. Paste into a block explorer
3. Squint at the calldata
4. Open the contract on Etherscan
5. Find the ABI
6. Manually decode the arguments
7. Look up each address in their attribution tool
8. Compute the fiat values themselves
9. Type up their findings

The ChainSight investigator clicks once. Eight seconds later they have all of that in plain English, every number computed, every address attributed across multiple providers, every memo and mark and path context surfaced, every obfuscation indicator named, every Critic note visible, and every suggested next action ready to click.

That's the demo moment. **"Show me the transaction" becomes one click.**

### 8.10 Build phasing

| Phase       | Inspector additions                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Phase 1** | Inspector data model; basic structured-facts display; raw decoded action for known contracts (Uniswap, common ERC-20 transfers, common bridge contracts)                                                       |
| **Phase 2** | Full plain-language summary via Narrative Agent + Verifier; counterparty intelligence with multi-provider corroboration; case-context section; suggested-actions panel; streaming UI                           |
| **Phase 3** | Obfuscation findings section; Critic notes section; compare-two-transactions mode; saved-analysis persistence and reproducibility; export as PDF exhibit                                                       |
| **Phase 4** | Inspector personalization (compact mode learned per investigator); cross-case context surfacing when overlaps exist; voice-assistant integration ("read this analysis aloud") for accessibility and Court Mode |

---

## Where the design pack stands

Eleven documents in `/home/user/workspace/`, all shared:

1. `chainsight_mindmap.md`
2. `chainsight_schema.md`
3. `chainsight_merged_v0_2.md`
4. `chainsight_v0_3_addendum.md` (PSR)
5. `chainsight_v0_3_byok_addendum.md` (BYOK marketplace)
6. `chainsight_v0_4_consolidated.md` (locked decisions)
7. `chainsight_v0_4_canvas_ux_addendum.md` (canvas markup)
8. `chainsight_v0_4_api_key_entry_addendum.md` (API key UX)
9. `chainsight_v0_5_addendum.md` (deconfliction, docs, court, obfuscation)
10. `chainsight_v0_5_addendum_2.md` (path styling, transaction-centric graph, wallet analyzer)
11. `chainsight_v0_5_addendum_3.md` (this file — Transaction Inspector)

---

## One last principle, locked

The Inspector is the proof of the Caveman principle at its strongest. **One click. Eight seconds. The investigator's entire question answered.**

Everything else in the platform — the Belief State, the Math Service, the BYOK providers, the Critic, the Verifier, the Reproducibility Pack — is in service to this moment. The investigator never sees that machinery. They see the popup. They click again. They keep working.

The reports prove the machinery existed.
