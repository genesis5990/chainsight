# UI Mockup Plan — Phase 0 / Phase 1 surfaces

The next major work item. Eight critical surfaces from the integrated index, ordered by demo-leverage and Phase 0 priority.

## Recommended approach

**Use v0.dev** (or Vercel v0). Generates real React/Next.js + shadcn/ui code from prompts, matches our locked stack exactly, and the output drops directly into `apps/web/src/` with minimal adaptation.

Alternative: **Figma** for visual-only mockups, then translate to code separately. More polished visuals; slower path to actual UI.

My recommendation: **v0.dev for surfaces 1-3 (the demo path), Figma for surfaces 4-8** (the longer-tail screens). This gets the demo moments shippable fastest.

## The eight surfaces, in priority order

### Surface 1 — Transaction Inspector (highest demo leverage)

**Status:** ✅ **SHIPPED** — [chainsight-web-dev.fly.dev/inspector-demo](https://chainsight-web-dev.fly.dev/inspector-demo)

**What it shows:** Click a tx diamond on the canvas → non-modal popup floats in. Eight sections stream in as AI populates them (plain-language summary, structured facts, decoded action, counterparty intel, case context, obfuscation findings, Critic notes, suggested actions).

**Why first:** This is the "one click, eight seconds, complete answer" demo moment that sells the platform in a 30-second pitch. Everything else is in service of this.

**Reference:** `docs/chainsight_v0_5_addendum_3.md` for the spec.

**What's in the repo:**
- Data shapes: `packages/shared-types/src/inspector.ts`
- Components: `apps/web/src/components/inspector/{TransactionInspector,Sections,seed,utils,types}.tsx?`
- Demo route: `apps/web/src/app/inspector-demo/`
- Seed data mirrors the Uniswap V3 example from §8.2 verbatim.
- Streaming schedule lands sections progressively over ~6.2s.
- Two demo modes: happy path + with failures (Critic + Obfuscation fail with retry-style error cards).
- Behaviors implemented: drag (by header), resize (right edge), pin/unpin, collapse/expand, Esc-to-close, multi-popup, copy tx hash, explorer link.

**Not implemented yet (deferred to later phases per spec §8.10):**
- Real Narrative Agent + Verifier gate (Phase 2)
- Real Critic Agent (Phase 3)
- Compare-two-transactions mode (Phase 3)
- PDF exhibit export (Phase 3)
- Saved-analysis persistence + reproducibility hash (Phase 3)

**v0 prompt to start:**

> Create a Next.js 15 + shadcn/ui non-modal popup component called TransactionInspector for a blockchain forensics platform. The popup is draggable and pin-able. It shows 8 sections that stream in: (1) Plain-language summary paragraph, (2) Structured facts table (tx hash, from/to, gas, value, block), (3) Decoded action panel showing a Uniswap swap with token in/out and slippage, (4) Counterparty intelligence table with attribution per address from Chainalysis/TRM/Arkham, (5) Case context section showing position in path A hop 7, cumulative taint percentage, related memos, (6) Obfuscation findings with peel-chain flag, (7) Critic Agent notes, (8) Suggested actions buttons (mark important, attach memo, trace forward 3 hops). Use semantic colors: red=taint, orange=elevated risk, green=clean attribution, blue=investigator markup.

### Surface 2 — The Canvas (with markup)

**What it shows:** Force-directed graph rendering address→tx→address (circles + diamonds). Marks, memos, icons, color discipline. Value-split percentages on multi-output edges. "Where did the money go?" overlay with methodology toggle.

**Why second:** The investigator's primary workspace. Everything else is reached from here.

**Reference:** `docs/chainsight_v0_4_canvas_ux_addendum.md`, `docs/chainsight_v0_5_addendum_2.md`.

**Library:** Sigma.js v3 with WebGL renderer. v0 won't generate this directly — but it can generate the surrounding chrome (sidebars, top bar with refresh button, Important sidebar, layer toggles).

### Surface 3 — Court Mode (the "wow" moment for prosecutor demos)

**What it shows:** Full-screen presenter view. Four view modes (timeline, value-Sankey, by-path, by-entity). Accounting-follows-the-frame side panel that updates every advance.

**Why third:** Different audience (prosecutors, not investigators) but the highest emotional impact in any demo where the question is "what does this look like in front of a jury?"

**Reference:** `docs/chainsight_v0_5_addendum.md` §17 (F17).

### Surface 4 — Provider Marketplace + Model Configuration matrix

**What it shows:** Catalog of providers (Chainalysis, TRM, Etherscan, etc.) with one-click install. The `.env`-easy key entry modal. The Model Configuration matrix (per AI role × installed model providers) from v0.9.

**Why fourth:** Locks in the BYOK + sovereignty story visually.

**Reference:** `docs/chainsight_v0_3_byok_addendum.md`, `docs/chainsight_v0_4_api_key_entry_addendum.md`, `docs/chainsight_v0_9_ai_strategy.md` §3.

### Surface 5 — PSR (Path Selection → Report)

**What it shows:** Four selection modes (click / lasso / auto-pathfind / natural-language) and the path-styled overlay with name + color + curated palette.

**Reference:** `docs/chainsight_v0_3_addendum.md`, `docs/chainsight_v0_5_addendum_2.md` F19.

### Surface 6 — Wallet History Analyzer

**What it shows:** Wallet creation flow (paste addresses or drop CSV), real-time analysis progress, sub-graph rendering, flagged addresses panel, one-click Wallet History Analysis Report.

**Reference:** `docs/chainsight_v0_5_addendum_2.md` F21.

### Surface 7 — Supervisor Dashboard

**What it shows:** Span-of-control cases with risk-tier indicators, review checkpoints, caseload balancing, non-destructive approval sidebar.

**Reference:** `docs/chainsight_v0_8_addendum.md` F27.

### Surface 8 — Personal Attribution library

**What it shows:** Investigator's accumulated attributions across all their cases. Sortable, searchable, sharing controls (private / team / org), counter-attribution flow.

**Reference:** `docs/chainsight_v0_6_addendum.md` F25.

## Constraints (locked from canvas UX addendum)

- **Semantic color palette only.** Investigators don't free-pick colors. Tailwind theme in `apps/web/tailwind.config.ts` defines the locked colors: taint (red), elevated (orange), caution (yellow), clean (green), markup (blue), privacy (purple), context (gray).
- **Caveman-easy front, sophisticated back.** One click, one keystroke, one drag for any investigator action. Behind every click: BeliefAtom writes, Math Service calls, Critic reviews, BYOK provider calls, audit logging.
- **Component library: shadcn/ui.** Already wired in the repo. Add new components via `pnpm dlx shadcn-ui@latest add <component>`.
- **No dark patterns.** Every notification is dismissible. Every action is reversible (or requires explicit confirmation for irreversible ones — freeze, seizure, court-grade signoff).

## Outputs from each surface

For each surface, the deliverables are:

1. **Visual mockup** (PNG/Figma frame or live v0 preview URL)
2. **Component code** (in `apps/web/src/components/<surface>/`)
3. **Data shape spec** (TypeScript interfaces in `packages/shared-types/src/<surface>.ts`)
4. **State management notes** (Zustand store, React Query hooks, Realtime subscription if any)
5. **Empty / loading / error states** (every surface ships all three)
6. **Mobile / responsive notes** (Surface 1 + Surface 3 are mobile-ready; Surfaces 4-8 are desktop-only)

## Suggested working session

A focused 2-3 hour session per surface, in priority order. Each session:

1. Re-read the relevant addendum (~10 min)
2. v0.dev prompt drafting + iteration (~30 min)
3. Drop generated code into `apps/web/src/components/<surface>/` (~15 min)
4. Wire to placeholder data (~30 min)
5. Add Storybook story or route demo (~30 min)
6. Commit + PR (~15 min)

That cadence ships one surface per session. The eight surfaces are roughly 2-3 weeks of part-time work, or one focused week of full-time work.

## What this plan does NOT cover yet

- **The actual canvas rendering** (Sigma.js v3 WebGL pipeline). That's a deep engineering effort separate from the mockups — v0 generates the chrome, not the canvas itself. The canvas implementation is a Week 4-5 deliverable.
- **AI streaming UX** for the Transaction Inspector. The popup design comes first; the AI integration layers in once the agent framework is wired (Week 5+).
- **Real-time collaboration** on the canvas (CRDT via Yjs). That's Phase 2.

## Next concrete action

When ready for the mockup session, start with **Surface 1 (Transaction Inspector)** using v0.dev. The prompt in the section above is a starting point. Iterate until the streaming-sections UX feels right, then commit the generated component and we move to Surface 2.
