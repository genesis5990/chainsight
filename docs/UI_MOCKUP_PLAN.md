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

**Status:** ✅ **SHIPPED** — [chainsight-web-dev.fly.dev/canvas-demo](https://chainsight-web-dev.fly.dev/canvas-demo)

**What it shows:** Force-directed graph rendering address→tx→address (circles + diamonds). Marks, memos, icons, color discipline. Value-split percentages on multi-output edges. "Where did the money go?" overlay with methodology toggle.

**Why second:** The investigator's primary workspace. Everything else is reached from here.

**Reference:** `docs/chainsight_v0_4_canvas_ux_addendum.md`, `docs/chainsight_v0_5_addendum_2.md`.

**Library:** Sigma.js v3 with WebGL renderer. v0 won't generate this directly — but it can generate the surrounding chrome (sidebars, top bar with refresh button, Important sidebar, layer toggles).

**What's in the repo:**
- Data shapes: `packages/shared-types/src/canvas.ts` (AddressNode + TransactionNode + CanvasEdge + TracePath + InvestigatorMark + layer toggles + helper hex maps)
- Renderer: `apps/web/src/components/canvas/CanvasView.tsx` (Sigma v3 WebGL + graphology + forceAtlas2 layout, EdgeArrowProgram registered)
- Chrome: `apps/web/src/components/canvas/Chrome.tsx` (TopBar, LayerRail, ImportantSidebar, StatusBar)
- Seed: `apps/web/src/components/canvas/seed.ts` (17 addresses + 10 transactions + 23 edges + 2 paths + 5 marks — a complete Acme Corp ransomware case)
- Demo route: `apps/web/src/app/canvas-demo/`
- Click any tx node → spawns the Surface 1 Inspector with streaming sections; click an address → sets the top-bar event ribbon.

**Not implemented yet (deferred):**
- Real Sigma diamond/square node program (Phase 1) — transactions currently use circles with ◆ prefix
- Cumulative-taint live recoloring when methodology changes (Phase 1, requires Math Service)
- Right-click context menus (Phase 1)
- Lasso / multi-select / Shift+click path extension (Phase 1, part of PSR Surface 5)
- Layered concentric rings when a node is in multiple paths (Phase 1)
- LOD pagination at >10k nodes (Phase 2)

### Surface 3 — Court Mode (the "wow" moment for prosecutor demos)

**Status:** ✅ **SHIPPED** — [chainsight-web-dev.fly.dev/court-demo](https://chainsight-web-dev.fly.dev/court-demo)

**What it shows:** Full-screen presenter view. Four view modes (timeline, value-Sankey, by-path, by-entity). Accounting-follows-the-frame side panel that updates every advance.

**Why third:** Different audience (prosecutors, not investigators) but the highest emotional impact in any demo where the question is "what does this look like in front of a jury?"

**Reference:** `docs/chainsight_v0_5_addendum.md` §3 (Feature 3).

**What's in the repo:**
- Data shapes: `packages/shared-types/src/court.ts` (FrameDeck + 6 frame kinds + AccountingState).
- Views: `apps/web/src/components/court/Views.tsx` (TitleView, OverTimeView, ByValueView with pure-SVG Sankey, ByTracePathView, ByEntityView, DocumentView).
- Shell: `apps/web/src/components/court/CourtMode.tsx` (full-screen presenter with title bar, accounting panel, frame strip, hotkey overlay).
- Seed: 10-frame Acme Corp narrative — title → timeline → 5 path hops → case Sankey → Binance entity → source document.
- Demo route: `apps/web/src/app/court-demo/`. Reachable from the canvas TopBar via 'Present in Court'.
- Hotkeys live: ←/→/Space (nav), P (pause), R (read-aloud teleprompter), M (cycle methodology), Esc (exit), Shift+Esc (reset), ? (overlay).

**Not implemented yet (deferred to Phase 1+ per spec §3.5):**
- J (jump-to-entity by typing an address)
- C (Critic challenges overlay)
- D (open source document at exact bounding box — the document frame is mocked, not a real PDF viewer)
- Real per-methodology recomputation when M is pressed (currently just relabels; numbers are deck-baked)
- d3-sankey replacement for the hand-rolled SVG (labels collide at high density)
- Court Export Bundle (`.zip` with ChainSight Viewer)
- Audit log of every frame shown

### Surface 4 — Provider Marketplace + Model Configuration matrix

**Status:** ✅ **SHIPPED** — [chainsight-web-dev.fly.dev/marketplace-demo](https://chainsight-web-dev.fly.dev/marketplace-demo)

**What it shows:** Catalog of providers (Chainalysis, TRM, Etherscan, etc.) with one-click install. The `.env`-easy key entry modal. The Model Configuration matrix (per AI role × installed model providers) from v0.9.

**Why fourth:** Locks in the BYOK + sovereignty story visually.

**Reference:** `docs/chainsight_v0_3_byok_addendum.md`, `docs/chainsight_v0_4_api_key_entry_addendum.md`, `docs/chainsight_v0_9_ai_strategy.md` §3.

**What's in the repo:**
- Data shapes: `packages/shared-types/src/marketplace.ts` (ProviderDefinition, ProviderInstall, LlmModel, AgentRole, ModelMatrix, EnvParseResult).
- Seed catalog: 14 providers across 7 categories; 9 LLM models across the three tiers; 10 agent roles matching the v0.9 §3.3 baseline.
- Marketplace component (Marketplace.tsx): two-tab shell (Providers / Model Configuration). Providers tab has search + 3 filter chips, categorized cards with health dot + cost telemetry, install/configure/remove actions. Model Configuration tab is the v0.9 §3.3 matrix verbatim with tier chips + cost summary + four bulk-action buttons.
- .env-easy KeyEntryModal: bulk-paste with client-side detection, masked previews, unrecognized-line disclosure. Single-key fallback when launched per-provider.
- /marketplace-demo route. Linked from homepage.
- Verified: 'Use only local models' bulk action flipped all 10 roles to Qwen 3.5 8B local and the cost dropped from $1,972/mo to $0 — the air-gap-with-one-click moment from §3.3.

**Not implemented yet (deferred to Phase 1+):**
- Real key persistence to the agency vault (current state is in-memory only)
- Per-case key scoping (data shape supports it; UI is agency-only)
- Live health pings
- Coverage map (capability × provider grid) from v0.3 §3.2
- 'Suggest provider' button when coverage has gaps

### Surface 5 — PSR (Path Selection → Report) ✅ SHIPPED

**What it shows:** Four selection modes (click / lasso / auto-pathfind / natural-language) and the path-styled overlay with name + color + curated palette.

**Reference:** `docs/chainsight_v0_3_addendum.md`, `docs/chainsight_v0_5_addendum_2.md` F19.

**Status:** Live at `/canvas-demo` — click **Start Path Selection** to open the PATH MODE toolbar + right-side Path & Report Draft drawer. Shift+click extends path, Alt+click removes last hop. Drawer has path name, 10-color curated palette (Cool / Warm / Primary evidentiary gold+lime / Neutral), methodology, primary-candidate toggle, hop list with per-hop remove, investigator commentary, and an 8-section live report preview. Save draft + Promote to under_review fire UI events (Supabase persistence lands Phase 1).

### Surface 6 — Wallet History Analyzer ✅ SHIPPED

Live at `/wallet-demo`. Paste-or-upload intake with chain-of-custody capture and curated wallet color picker; live address detection for EVM/BTC/SOL/TRON; streaming per-address analysis through 7 stages (queued → fetching_history → clustering → attribution → obfuscation_scan → tracing_hops → scoring → ready/failed) with progress bars; flagged-for-review sidebar with composite-scored rationale + promote-to-BeliefAtom CTA; aggregate footer with inflow/outflow/balance/counterparties/cluster + obfuscation counts.

### Surface 7 — Supervisor Dashboard ✅ SHIPPED (Phase-0 mockup)

Live at `/supervisor-demo`. **Reference:** `docs/chainsight_v1_0_supervisor_dashboard_addendum.md`.

Seeded with FBI Cyber Squad 14 (6 investigators × 24 active cases). Five-tile KPI strip with 7-day deltas; scope picker (3 scopes with audit-log notice); Case Portfolio Heatmap with full cell encoding per spec §2.2 (fill=risk, width=SLA, top-right pip=sanctions, bottom-left dot=dormant, diagonal hatch=awaiting input, 2-px outline ring=in overlap group, L/M/H/C glyph for a11y); per-investigator OUT banner with reassign-flow CTA; Caseload Balance sparklines with shaded target bands and the explicit 'routing input only, not performance evaluation' label; Pending Approvals queue with urgency chips and pre-freeze/pre-seizure/pre-court quick-approve gating; Deconfliction Feed with 4 severity tiers and CADNP badge for cross-agency alerts; click-through Case Sidebar (480px slide-in, non-destructive) and Alert Modal with the 5-way resolution ladder. CADNP modal renders the bilateral hash-only model exactly: peer-agency card shows count band + since-timestamp + the 'Peer revealed no case identifiers' disclaimer.

### Surface 8 — Personal Attribution Library ✅ SHIPPED (Phase-0 mockup)

Live at `/attribution-demo`. **Reference:** `docs/chainsight_v0_6_addendum.md` F25.

Seeded with Det. T. Nguyen’s 4-year library (24 attributions across address / cluster / entity / bridge_contract / transaction targets on ETH/BTC/SOL/TRON spanning all 11 categories and 6 bases). 7-tile KPI strip (total / private / shared-out / accepted by others / cases touched / incoming pending / disagreements with taint-red accent). Sticky filter sidebar (search across label/description/canonical, chain · category · basis · visibility chips, 5 sort orders). Library list with color+icon swatch, 5-dot confidence indicator, T0/T2/T3 tier-prefixed basis label, visibility chip, description excerpt, and right-rail meta. Incoming shares panel (sticky right rail) with Park’s Kraken hot wallet, Cho’s overlapping Fox-runner cluster, and Patel’s MSB-registry correction that disputes attr-011 — each with inline Accept / Reject / Counter actions. Click-through AttributionDetail drawer (480px slide-in, non-destructive) renders canonical with copy, supporting evidence, cases referenced with PRIMARY badge, share log with action icons, lifecycle KVs, and Edit/Share/Export/Revoke buttons with the G5 immutability disclosure. IncomingShareModal renders the full F25 §11.6 layout with all 4 actions.

## 8 of 8 surfaces shipped

All Phase-0 UI mockups complete. Next phase wires real backend services (case-stream API, BeliefAtom persistence, real BYOK provider calls, deconfliction scan worker, supervisor-api service).


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
