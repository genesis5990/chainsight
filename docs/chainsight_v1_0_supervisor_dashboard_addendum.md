# ChainSight v1.0 — Supervisor Dashboard & Cross-Agency Deconfliction (F27 Expansion)

> **Document type:** Expansion of v0.8 F27 (Supervisor Mode) into a buildable surface specification
> **Audience:** Solo developer + AI agents building ChainSight; agency procurement reviewing supervisory controls
> **Predecessors:** v0.8 F27 (Supervisor Mode), v0.3 G4 (Freeze Request), v0.5_2 F19 (Path Selection → Report), v1.0 Frontend Architecture §1, v1.0 Security & Sovereignty §3
> **Status:** v1.0 spec — addendum to the v0.8 Gap Incorporation document
> **Build phase:** Phase 1 (post-launch, before multi-agency federation)
> **Anti-features reaffirmed (F41):** No predictive policing. No demographic correlation. No mass surveillance. No silent cross-agency telemetry. No key escrow. Every deconfliction signal is opt-in, signed, and audit-logged.

---

## Section 0 — Why this surface exists

ChainSight v0.1 → v0.7 sold the platform one investigator at a time. F27 in v0.8 introduced the supervisory role model but stopped at a bullet list of "what supervisors see." This addendum turns that list into:

1. A **case-portfolio command center** UI that a Sergeant, Lieutenant, ASAC, or unit chief opens first thing each morning.
2. A **caseload heatmap** that surfaces dormant cases, SLA-breaching cases, and over-/under-loaded investigators at a glance.
3. A **review queue** of checkpoints awaiting their signature.
4. A **cross-case overlap alert feed** — within the agency by default, optionally federated across agencies via a signed, opt-in deconfliction protocol.
5. A **cross-agency deconfliction notification protocol** (CADNP) — the bilateral, hash-only handshake by which two agencies can discover that they are working the same address without revealing case details to each other.

The dashboard is **read-mostly** for supervisors. Write actions are constrained to: approve / send-back / escalate / comment / reassign. Supervisors never edit a subordinate's evidence — that pollutes the chain of custody. They route work.

---

## Section 1 — Information architecture

### 1.1 Route structure (Next.js App Router)

```
apps/web/app/(app)/supervisor/
├── layout.tsx                       # Supervisor shell — role guard + scope picker in topbar
├── page.tsx                         # → redirects to /supervisor/overview
├── overview/page.tsx                # The dashboard (this spec)
├── caseload/page.tsx                # Investigator workload deep-dive
├── reviews/page.tsx                 # Checkpoint review queue (full-page)
├── reviews/[checkpointId]/page.tsx  # One checkpoint with full case context
├── deconfliction/page.tsx           # Cross-case + cross-agency overlap feed
├── deconfliction/[alertId]/page.tsx # One overlap with the full evidence trail
└── audit/page.tsx                   # All supervisor actions audit log (read-only)
```

Route guard: `layout.tsx` reads the user's `SupervisoryRole[]` from Supabase. Anyone without at least one role gets a 403 with a polite explainer ("This area is restricted to authorized supervisors. If you need supervisor access, ask your unit's ChainSight administrator."). The guard runs server-side as a `redirect()` from the layout — never client-only.

### 1.2 Permission gates (cascading defaults)

Each route reads two things:

- The user's `SupervisoryRole.scope` (team | squad | division | agency)
- Their `SupervisoryPermission[]`

The dashboard renders **only the cases/investigators within their scope**. A team-lead sees their direct reports; a division chief sees every team under them; an agency-wide supervisor sees the whole org. There is no "see-everything mode" — even an agency supervisor only sees their agency. Cross-agency visibility requires the explicit CADNP handshake described in §6.

### 1.3 The scope picker

In the topbar, a small dropdown labeled **"Viewing:"** shows the supervisor's active scope:

```
Viewing:  ▾ [ Cyber Squad 14 · Team Lead ]
            ──────────────────────────────────
            Cyber Squad 14 · Team Lead          ← active
            Field Office 7 · Cyber Branch
            FBI · Cyber Division (delegated)
            ──────────────────────────────────
            ⓘ All scopes are recorded in the
              audit log when switched.
```

Every scope switch is logged with timestamp, scope_from, scope_to, and the request path of the next page load. This is non-negotiable — without it, supervisors could quietly upgrade their view to investigate someone, and we lose the "no mass surveillance" guarantee.

---

## Section 2 — `/supervisor/overview` — UI wireframe

The overview page is a 12-column grid. At ≥1280 px viewport the layout is:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│  TOPBAR  ChainSight  |  Viewing: ▾ Cyber Squad 14 · Team Lead  |  🔍 search  |  🔔 4  |  👤   │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  ┌────────────────────────────┐  │
│  │  KPI STRIP  (5 tiles across — row 1)                   │  │  PENDING MY APPROVAL   (4) │  │
│  │ ┌──────┐┌──────┐┌──────┐┌──────┐┌──────┐               │  │ ┌────────────────────────┐ │  │
│  │ │ 23   ││ 4    ││ 11   ││ 87   ││ 7    │               │  │ │ Pre-freeze · Op Lemon │ │  │
│  │ │Active││Pendi-││Crit. ││Avg.  ││Cross-│               │  │ │ Lt. Park · 12m ago    │ │  │
│  │ │cases ││ng    ││alerts││days/ ││case  │               │  │ │ ───────────────────── │ │  │
│  │ │      ││reviews││     ││case  ││ovrlp │               │  │ │ Pre-court · Op Kraken │ │  │
│  │ └──────┘└──────┘└──────┘└──────┘└──────┘               │  │ │ Det. Nguyen · 1h ago  │ │  │
│  └────────────────────────────────────────────────────────┘  │ │ ───────────────────── │ │  │
│                                                              │ │ Report draft · Op X   │ │  │
│  ┌────────────────────────────────────────────────────────┐  │ │ Det. Cho · 4h ago     │ │  │
│  │  CASE PORTFOLIO HEATMAP                                │  │ │ ───────────────────── │ │  │
│  │                                                        │  │ │ Initial intake · UI…  │ │  │
│  │  Rows: investigators (sorted by load score)            │  │ │ Det. Patel · 1d ago   │ │  │
│  │  Cols: their cases (sorted by risk tier)               │  │ │                       │ │  │
│  │  Cell: square colored by composite risk; size by       │  │ │ Review all (4) →      │ │  │
│  │        SLA-remaining; corner pip for sanctions hit;    │  │ └────────────────────────┘ │  │
│  │        dot for dormant >14 days.                       │  │                            │  │
│  │                                                        │  │  ──────────────────────    │  │
│  │  ▶ Det. Nguyen   ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                   │  │  DECONFLICTION FEED  (11) │  │
│  │  ▶ Lt. Park      ▢ ▢ ▢ ▢ ▢ ▢                          │  │  ──────────────────────    │  │
│  │  ▶ Det. Cho      ▢ ▢ ▢ ▢                              │  │ 🔴 Cross-case overlap     │  │
│  │  ▶ Det. Patel    ▢ ▢                                  │  │   bc1qxy…0wlh appears in  │  │
│  │  ▶ Det. Reyes    ▢                                    │  │   Op Lemon (Nguyen) AND   │  │
│  │  ▶ A. Park (OUT) (caseload reassign required)         │  │   Op Kraken (Park).       │  │
│  │                                                        │  │   12 min ago · Review →   │  │
│  │  Legend: ⚪ low  🟡 med  🟠 high  🔴 critical · ◢ sanct │  │ ──────────────────────── │  │
│  │  ⓘ Click any cell to open the case sidebar (non-destr) │  │ 🟠 Same TX hash, two cases│  │
│  └────────────────────────────────────────────────────────┘  │   0xa7b…3f9 (3 paths)     │  │
│                                                              │   Op Lemon ∩ Op Kraken    │  │
│  ┌────────────────────────────────────────────────────────┐  │   34 min ago · Review →   │  │
│  │  CASELOAD BALANCE (sparkline per investigator)         │  │ ──────────────────────── │  │
│  │  Last 30 days: active count, hours logged, reviews     │  │ 🟡 Cross-agency (FBI)     │  │
│  │  passed/sent-back, dormant ratio.                      │  │   CADNP-verified match    │  │
│  │  ► Bands shade target loads.                           │  │   on cluster anchor.      │  │
│  └────────────────────────────────────────────────────────┘  │   2h ago · Review →       │  │
│                                                              │ ──────────────────────── │  │
│                                                              │ View full feed (11) →     │  │
│                                                              └────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 KPI strip (top of page)

Five tiles, fixed order, never reordered (muscle memory matters for daily ritual):

| # | Tile                  | Source                                                  | Click target               |
|---|-----------------------|---------------------------------------------------------|----------------------------|
| 1 | Active cases          | `cases WHERE status IN ('open','under_review')`         | `/supervisor/caseload`     |
| 2 | Pending my approval   | `review_checkpoints WHERE status='pending' AND approver=me` | `/supervisor/reviews`  |
| 3 | Critical alerts       | `deconfliction_alerts WHERE severity='critical' AND unread` | `/supervisor/deconfliction?severity=critical` |
| 4 | Avg. days per case    | Rolling 90-day median of `case.closed_at − case.opened_at` for closed cases in scope | `/supervisor/caseload?view=throughput` |
| 5 | Cross-case overlaps   | Count of distinct `overlap_groups` open in scope        | `/supervisor/deconfliction` |

Every tile shows its number in 24-px tabular figures, the label in 11-px uppercase, and a 1-px delta arrow versus 7 days ago (↑ red for the bad direction; the dashboard explicitly does **not** treat "more cases closed" as universally good — it shows the delta but never editorializes via color on tile 4).

### 2.2 Case Portfolio Heatmap (the centerpiece)

This is what the supervisor stares at every morning. Rows are investigators; columns are their cases; each cell is one case.

**Cell visual encoding:**

- **Fill color:** composite risk tier
  - ⚪ `--context-200` low (no flagged addresses, low value moved, no SLA pressure)
  - 🟡 `--caution-400` medium (some flags, no critical findings, within SLA)
  - 🟠 `--elevated-500` high (sanctions counterparty, freeze opportunity open, OR SLA <50%)
  - 🔴 `--taint-600` critical (sanctions + freeze open + SLA breached, OR any pre-court checkpoint sent back twice)
- **Cell size (height of the row stays 28 px; width varies 18–40 px):** SLA-remaining as a fraction of the SLA budget for that case type. Squeezed cells = "running out of clock."
- **Top-right corner pip:** present if any sanctions-counterparty finding exists on the case.
- **Bottom-left dot:** present if the case is dormant (no investigator activity in >14 days).
- **Hatched diagonal overlay:** the case is awaiting supervisor input (checkpoint pending for this user).
- **Outline ring (2 px):** the case appears in an open deconfliction overlap group.

**Cell hover (tooltip):**

```
┌─────────────────────────────────────────┐
│  Operation Lemon                        │
│  Det. Nguyen · opened 2026-04-12         │
│  Risk: HIGH · SLA: 38% remaining        │
│  ⚠ 2 sanctions hits                     │
│  🔗 Overlaps with Op Kraken (Park)      │
│  Last activity: 6 hours ago             │
└─────────────────────────────────────────┘
```

**Cell click:** opens the **Case Sidebar** (slide-in from the right, 480 px, non-modal). The sidebar contains:

1. Case header (name, ID, opened-by, opened-at, current investigator, supervisor, status badge)
2. The case's open checkpoints (with "Review" button if any are assigned to me)
3. Last 10 audit events (read-only — supervisors do not write to the case stream from here)
4. The Path & Belief summary (count of paths, count of belief atoms, count of marks, current report-draft status)
5. Buttons: **Open in canvas (read-only)**, **Add reviewer comment**, **Reassign…**, **Open chain of custody**

The sidebar is non-destructive on principle: no edit buttons. Reviewer comments live in the F27 `ReviewerComment` thread, which is rendered to investigators in the case but is filed in a separate namespace from belief atoms (it never enters the evidentiary record).

### 2.3 Caseload Balance panel

Below the heatmap, a horizontal multi-series sparkline. One row per investigator, 30 days on the x-axis. Three thin lines per row:

- **Active case count** — solid line, agency-default-color
- **Hours logged** (derived from session telemetry — investigators see and consent to this) — dotted line, neutral grey
- **Reviews sent back** — small red ticks

A shaded **target band** runs across each row (e.g., 4–7 active cases for a senior investigator, 2–4 for a junior). Anyone above the band gets a "⚠ overloaded" badge; anyone below gets a "💤 has capacity" tag. **Both badges are explicitly labeled "for caseload-balancing decisions only — not performance evaluation"** — the legal/HR posture matters and the UI says so.

The panel is intentionally not a leaderboard. There is no ranking column, no score, no quota. Workload is a routing input, not a stack rank.

### 2.4 Pending My Approval panel (right column, top)

Each row in the queue is one `ReviewCheckpoint`:

```
┌─────────────────────────────────────┐
│ 🛑 Pre-freeze · Operation Lemon     │
│ Lt. Park · submitted 12m ago         │
│ ────────────────────────────────────│
│ Freeze target: 5 addresses, ~$1.4M  │
│ ────────────────────────────────────│
│ [Open review →]  [Quick approve]    │
└─────────────────────────────────────┘
```

The chip on the left encodes urgency:

- 🛑 pre-freeze, pre-seizure — actions with external effect; supervisors cannot quick-approve these from the panel (the "Quick approve" button is grayed out with a tooltip "External-effect actions require the full review form")
- 📝 report draft, initial intake — review-and-comment workflows; "Quick approve" works
- 🚨 sent-back-twice — these jump to the top of the panel with a red border and a "needs your attention" tag

### 2.5 Deconfliction Feed panel (right column, bottom)

Each alert is one card. Severity icons:

- 🔴 critical — same exact address in two open cases at the same agency
- 🟠 high — same transaction hash, or same cluster-anchor, in two open cases
- 🟡 medium — cross-agency CADNP-verified match (see §6)
- 🔵 info — historical overlap (one case is closed; surfaced for awareness)

Click any card to open `/supervisor/deconfliction/[alertId]`, which renders the full evidence side-by-side (see §5).

### 2.6 Empty states (matter)

This dashboard often has zero items in some panels. Empty states are **specific, not chirpy**:

- KPI tile shows "0" in 24-px figures with no smiley, no exclamation.
- "Pending my approval (0)" panel: "No checkpoints in your queue. Nice clean inbox."
- Deconfliction feed (0): "No active overlaps in scope. Cross-agency feed last refreshed 4 minutes ago."
- Heatmap (0 cases): "No active cases under your supervision. Cases assigned to you will appear here." with a small button "Adjust scope" pointing to the scope picker.

### 2.7 Mobile / narrow-viewport collapse (<1024 px)

Stack to a single column. KPI tiles compress to a horizontal scrolling row. Heatmap renders as one row per investigator with the cells inline-wrapped. Side panels move below the heatmap as full-width sections. The dashboard is **not optimized for phones** — it is a desk tool. Mobile/field use is F30 territory; pointing supervisors there from a phone shows a friendly "Open this on your desk to see the full dashboard" note above the collapsed view.

---

## Section 3 — Data model additions

These extend the v0.8 F27 model. All new tables live in the `supervisor` schema in Supabase.

### 3.1 `supervisor.dashboard_snapshot`

Materialized hourly. Keeps the dashboard fast even when the underlying case stream is large.

```typescript
DashboardSnapshot {
  id: uuid
  scope_id: uuid                     // SupervisoryRole.id
  generated_at: timestamp
  kpi: {
    active_cases: int
    pending_my_approval: int
    critical_alerts: int
    avg_days_per_case_p50: number
    cross_case_overlaps: int
    delta_7d: { active_cases: int, ... }   // 7-day deltas for every KPI
  }
  heatmap: HeatmapRow[]
  caseload: CaseloadSparkline[]
  pending_reviews: ReviewCheckpointSummary[]
  deconfliction: DeconflictionAlertSummary[]
}

HeatmapRow {
  investigator_id: uuid
  investigator_name: string
  cases: HeatmapCell[]
}

HeatmapCell {
  case_id: uuid
  case_name: string
  risk_tier: enum                    // low | medium | high | critical
  sla_pct_remaining: number          // 0..1
  has_sanctions_hit: boolean
  is_dormant: boolean
  awaiting_my_input: boolean
  in_overlap_group: boolean
}
```

The snapshot is keyed on `scope_id` because two supervisors can have overlapping but non-identical views. Materialization is incremental — only cases changed in the last hour rebuild.

### 3.2 `supervisor.deconfliction_alert`

```typescript
DeconflictionAlert {
  id: uuid
  alert_kind: enum                   // intra_agency_address | intra_agency_tx |
                                     // intra_agency_cluster | cross_agency_cadnp
  severity: enum                     // critical | high | medium | info
  detected_at: timestamp
  overlap_group_id: uuid             // FK — multiple alerts can share the same group
  involved_cases: CaseRef[]          // 2+ cases that overlap
  involved_subjects: SubjectRef[]    // the actual address/tx/cluster that overlapped
  involved_agencies: AgencyRef[]     // length=1 for intra; ≥2 for cross_agency_cadnp
  status: enum                       // open | acknowledged | resolved | false_positive
  resolution: ResolutionNote | null
  acknowledged_by: investigator_id[] // each agency lead acknowledges separately
  audit_log_id: uuid                 // immutable trace of how the alert came to exist
}

SubjectRef {
  kind: 'address' | 'tx_hash' | 'cluster_anchor'
  // For intra-agency: the raw value
  raw_value: string | null
  // For cross-agency: only the hash is ever stored (see §6)
  blake3_hash: hex64
  chain: WalletChain
}

ResolutionNote {
  resolved_by: investigator_id
  resolved_at: timestamp
  rationale: string                  // free text — required, min 40 chars
  decision: enum                     // separate_investigations | joint_task_force |
                                     // one_agency_leads | both_close | escalate_to_doj
  joint_task_force_charter_id: uuid | null
}
```

Alerts are append-only. "Resolved" is a status flip, not a delete. The audit trail must survive even if an alert is later determined to be a false positive — the false-positive state itself is evidence of process working.

### 3.3 `supervisor.audit_event`

Every supervisor action emits one row. Already covered by the v0.8 F27 audit_actions permission, but here we specify the schema explicitly so the front-end can render an Audit page.

```typescript
SupervisorAuditEvent {
  id: uuid
  actor_id: investigator_id
  actor_role: SupervisoryRole
  action: enum                       // scope_switched | dashboard_viewed |
                                     // case_sidebar_opened | checkpoint_approved |
                                     // checkpoint_sent_back | checkpoint_escalated |
                                     // comment_added | case_reassigned |
                                     // alert_acknowledged | alert_resolved |
                                     // cadnp_handshake_initiated | cadnp_match_accepted
  target_kind: enum                  // case | checkpoint | comment | alert | cadnp_request
  target_id: uuid
  payload: jsonb                     // action-specific details, never PII
  occurred_at: timestamp
  ip_hash: blake3                    // hash, not raw IP
  client_fingerprint: blake3
}
```

The audit table is in an append-only role-restricted schema. Even the agency admin cannot DELETE from it; rotation/archival uses INSERT INTO archive + index drop, never DELETE.

---

## Section 4 — Backend services

### 4.1 `supervisor-api` (new service, Fastify)

A separate Fly app — `chainsight-supervisor-api-dev` initially, then `-prod`. Reasons for separation:

- Distinct rate limits (supervisor pages refresh more aggressively).
- Distinct authn — supervisor endpoints require both a Supabase session AND a "supervisor role assertion" header signed by the agency admin's HSM (or, in Phase 1, a TOTP confirmation).
- Easier audit isolation — every request to `supervisor-api.*` is logged at the LB layer, separate from investigator API traffic.

Endpoints (all return JSON; all require the supervisor role assertion):

```
GET    /v1/dashboard                      → DashboardSnapshot for current scope
GET    /v1/heatmap?scope_id=…             → HeatmapRow[] (fresh, not from snapshot)
GET    /v1/caseload                       → CaseloadSparkline[]
GET    /v1/reviews?status=pending         → ReviewCheckpointSummary[]
POST   /v1/reviews/:id/approve            → emits approval event
POST   /v1/reviews/:id/send-back          → body: { rework_notes: string }
POST   /v1/reviews/:id/escalate           → body: { escalated_to_role_id: uuid, rationale }
GET    /v1/deconfliction                  → DeconflictionAlertSummary[]
GET    /v1/deconfliction/:id              → full alert + evidence
POST   /v1/deconfliction/:id/acknowledge  → no body
POST   /v1/deconfliction/:id/resolve      → body: ResolutionNote
GET    /v1/audit?since=…                  → SupervisorAuditEvent[] for current scope
POST   /v1/scope/switch                   → body: { scope_id: uuid }; emits audit event
```

### 4.2 Worker job: `supervisor.dashboard.refresh`

Triggered hourly per scope; also on demand when a case undergoes a high-impact state change (checkpoint submitted, freeze opportunity opened, sanctions finding added, deconfliction alert created). Runs in the existing BullMQ worker pool on Upstash. Idempotent — repeat invocations within 30 s short-circuit.

### 4.3 Worker job: `supervisor.deconfliction.scan.intra_agency`

Runs every 5 minutes per agency. SQL: across all open cases in the agency, find addresses / tx hashes / cluster anchors that appear in ≥2 case workspaces. New overlaps become `DeconflictionAlert` rows with `alert_kind='intra_agency_*'`. Existing overlaps that gain a new case get an updated row, not a new one.

Optimization: maintain `case_subject_index` (case_id, subject_hash, subject_kind) as an incremental table; the scan is then a `GROUP BY subject_hash HAVING COUNT(DISTINCT case_id) ≥ 2` query.

---

## Section 5 — `/supervisor/deconfliction/[alertId]` — the resolution page

When two cases overlap, the resolution page is what decides the next step. The layout:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Cross-case overlap · 🔴 CRITICAL · Detected 12 min ago                     │
├────────────────────────────────────────────────────────────────────────────┤
│  Subject: BTC address bc1qxy…0wlh                                          │
│  Appears in 2 active cases:                                                │
│                                                                            │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐    │
│  │ Operation Lemon              │  │ Operation Kraken                 │    │
│  │ Lead: Det. Nguyen            │  │ Lead: Lt. Park                   │    │
│  │ Opened: 2026-04-12           │  │ Opened: 2026-05-03               │    │
│  │ Subject role: peel-output    │  │ Subject role: cluster-anchor     │    │
│  │ Path A · 4 hops since intro  │  │ Path B · cold-storage candidate  │    │
│  │ ──────────────────────────── │  │ ──────────────────────────────── │    │
│  │ [Open case sidebar]          │  │ [Open case sidebar]              │    │
│  └──────────────────────────────┘  └──────────────────────────────────┘    │
│                                                                            │
│  ── Side-by-side evidence ────────────────────────────────────────────────│
│  [tabs] Tx history · Belief atoms · Open paths · Citations · Reviewer notes│
│                                                                            │
│  ── Resolution panel ────────────────────────────────────────────────────  │
│  Decision (required):                                                      │
│    ◯ Separate investigations (cases remain independent)                    │
│    ◯ Joint task force (creates a Charter; both supervisors must sign)     │
│    ◯ One agency leads (the other case is paused with notes)               │
│    ◯ Both close (rare — only if subject is no longer of interest)         │
│    ◯ Escalate to DOJ (cross-agency or interstate)                          │
│                                                                            │
│  Rationale (min 40 chars, required):                                       │
│  [────────────────────────────────────────────────────────────────────]    │
│                                                                            │
│  [Send to other lead for concurrence]  [Record decision]                   │
└────────────────────────────────────────────────────────────────────────────┘
```

Notes:

- **The case-detail panes never show evidence the viewing supervisor isn't entitled to.** If Op Lemon is in a different scope than the current supervisor's role, the left panel shows a "Partial view — full evidence visible only to supervisors of Field Office 7" note with a "Request liaison access" button.
- **"Send to other lead for concurrence"** routes the resolution to the other case's supervisor; both must sign for joint-task-force outcomes. The decision is not final until both signatures land.
- **The resolution becomes a `BeliefAtom`** in each case — annotated as a "supervisor deconfliction decision" atom. This is the only path by which the supervisor writes to a case's evidentiary stream, and it is bounded, signed, and audit-logged.

---

## Section 6 — Cross-Agency Deconfliction Notification Protocol (CADNP)

This is the new protocol. Designed to satisfy three constraints simultaneously:

1. **Two agencies should be able to discover they are working the same subject** (address, tx, cluster) without either revealing case details to the other.
2. **No central directory.** No "ChainSight Cloud" that knows what every agency is investigating. Even if Perplexity / ChainSight Inc. wanted to be malicious, the protocol must not expose case content to us.
3. **All matches must be opt-in, signed, and auditable on both sides.** No silent cross-agency telemetry. Anti-feature F41 is non-negotiable.

### 6.1 Threat model

- **Honest-but-curious peer agency:** the other side runs the protocol correctly but tries to learn what the asking agency is investigating. Must not succeed.
- **Hostile peer agency:** the other side may run a modified protocol to probe. Must not learn more than "you also touch this hash" or "you don't."
- **Compromised CADNP coordinator (if any):** must not be able to recover the underlying address from the hash stream.
- **Compromised single agency:** must not be able to enumerate other agencies' subject lists by replaying tokens.

### 6.2 Cryptographic primitives

- **Subject hash:** `BLAKE3(canonicalize(subject) || agency_pepper_id)` truncated to 32 bytes, then encoded base32. The `agency_pepper_id` is a per-agency 32-byte secret rotated annually; it ensures rainbow tables of common addresses don't work.
  - **But wait:** if each agency peppers differently, the hashes don't match. So peppering is **not used at the matching layer**. The matching layer uses an unpeppered `BLAKE3(canonicalize(subject))` and relies on the address space being large enough that targeted brute-force (precomputing every Ethereum address) is economic only for nation-state attackers — and even then, only reveals what addresses *might* be in another agency's stream, never the case content.
  - **The pepper is used at the storage layer** instead: the agency's own DB stores `BLAKE3(canonicalize(subject) || agency_pepper)`, so a DB breach at agency A doesn't reveal subjects to a future attacker without also stealing the pepper.
  - **Canonical form** for `subject`:
    - Address: lower-case + chain prefix (`eth:0x…`, `btc:bc1q…`, `sol:…`, `tron:T…`).
    - Tx hash: lower-case + chain prefix (`eth_tx:0x…`).
    - Cluster anchor: `cluster:{chain}:{anchor_address_canonical}`.
- **Bilateral handshake:** ECDH on Curve25519. Each agency holds an offline-issued long-term identity key (signed by a national CA — DOJ/USSS/FBI internal PKI, or in pilot, manually exchanged). Session keys are derived per handshake.
- **Token signing:** Ed25519 over the agency identity key. Every CADNP message carries a signature.
- **Transport:** TLS 1.3 to the agency's own CADNP endpoint. No third-party broker between two agencies.

### 6.3 Discovery (how two agencies learn about each other)

There is **no central directory**. Discovery happens out-of-band:

- Agency A's supervisor exchanges a "CADNP card" with agency B's supervisor through normal liaison channels (email, USB, paper printout signed by both). The card contains:
  - Agency name + agency_id (UUID)
  - Public Ed25519 identity key
  - CADNP endpoint URL (e.g., `https://cadnp.fbi-cyber-field-7.gov/v1/`)
  - Authorized contact name + phone
  - Effective dates + revocation contact
- Both agencies install each other's cards in the local ChainSight supervisor instance under **Settings → Cross-Agency Trust**.
- A card can be revoked at any time by either side; revocation is a one-click action that removes the peer's public key and refuses all future handshakes.

### 6.4 The match protocol — step by step

Agency A wants to know whether any of its subjects also appear in agency B's open caseload.

```
A                                          B
──                                         ──
1. Pick subject S; compute h = BLAKE3(canonicalize(S)).
2. Generate ephemeral X25519 keypair (a_priv, a_pub).
3. Sign request:
   req = { h, a_pub, ts, nonce, agency_a_id }
   sig_a = Ed25519_sign(agency_a_identity_priv, req)
4. POST /v1/match  (req, sig_a)            ──────►   5. Verify sig_a; verify agency_a is on the trust list.
                                                     6. Verify ts within ±5 min; nonce not seen in 24 h window.
                                                     7. Lookup: does h exist in B's open_case_subject_index?
                                                     8. Build response:
                                                        resp = { h, b_pub_ephemeral, found: bool,
                                                                 found_count_band: '0' | '1' | '2-5' | '6+',
                                                                 since_ts (only if found),
                                                                 agency_b_id, ts, nonce_b }
                                                        sig_b = Ed25519_sign(agency_b_identity_priv, resp)
                                       ◄──────       9. Return (resp, sig_b).
10. Verify sig_b; verify b is on trust list.
11. If found: open a CADNP-pending alert in
    /supervisor/deconfliction with severity='medium'
    (never auto-promoted to high or critical without
    further human review).
12. Both A and B emit cadnp_handshake audit events.
```

**What the protocol deliberately does NOT reveal:**

- B never learns S (only its hash). Brute-force is computationally bounded by the address space; for ETH/BTC this is 2^160 → infeasible without already knowing the candidate.
- A never learns *which* cases at B contain the subject, or by whom, or when in detail (only "found" + a coarse `found_count_band` + a since-date).
- Neither side learns anything if the other has revoked their trust card.
- Even on a positive match, neither side automatically reveals case identifiers. The next step (sharing case context) requires a separate, explicit, signed request — see §6.5.

**What the protocol DOES reveal (and we acknowledge):**

- The fact that A asked about *some* subject at this timestamp. B knows A is interested in something — but not what.
- Whether B has it. If B is asked about subjects A controls (e.g., A asks about its own decoy addresses just to probe), A can build a partial map of B's interest space. The protocol mitigates this with **per-agency query rate limits** (default: 200/day, configurable downward by either party; queries above the limit return a deterministic "rate-limited" response that does not reveal `found` status). Rate limit is enforced server-side at B.

### 6.5 Post-match disclosure (also voluntary)

If both sides agree a match warrants discussion, either supervisor can initiate a **liaison request**:

```
LiaisonRequest {
  cadnp_match_id: uuid               // ties back to the handshake
  requesting_agency_id: uuid
  responding_agency_id: uuid
  disclosure_level: enum              // 'case_exists' | 'lead_name_and_phone' |
                                      // 'subject_role_in_case' | 'full_evidence_share'
  rationale: string
  legal_basis: string                 // e.g., 'MLAT request', 'JTTF charter',
                                      // 'inter-agency MOU §3.2'
  requested_by: investigator_id
  requested_at: timestamp
  approved_by_requestor_supervisor: signature
  approved_by_responder_supervisor: signature | null
  approved_at: timestamp | null
  fulfilled_at: timestamp | null
}
```

`disclosure_level` is a ladder. The first rung ("case_exists") confirms there is a case but reveals nothing else; the top rung ("full_evidence_share") opens the full case workspace to a specific named investigator at the peer agency. Each rung requires both supervisors' signatures, and the audit trail records the exact disclosure level chosen.

### 6.6 Default posture: opt-in everywhere

- A fresh ChainSight install has CADNP **disabled**. Supervisors enable it under Settings, accept the legal preamble (drafted with v1.0 Compliance Legal sign-off, §4), and exchange their first card.
- Every match — incoming or outgoing — emits a notification to both supervisors in the deconfliction feed. Nothing is silent.
- Either agency can pause CADNP at any time (a "Pause cross-agency matching for 48 hours" button) without revoking trust cards. Useful during sensitive operations.
- Revocation is permanent for the revoked card. Re-establishing trust requires a fresh card exchange.

### 6.7 Federation roadmap (out of scope for v1.0)

- **v1.1:** Hub-and-spoke optional broker (a USSS-hosted or DOJ-hosted neutral relay) that lets ≥3 agencies query in one round-trip. The broker only sees hashes; case content remains bilateral.
- **v1.2:** Multi-party private set intersection (PSI) for ≥3-way matches with cryptographic guarantees that the broker learns nothing.
- **v2.0:** International coordination via Egmont Group or similar — full legal framework, MLAT-aligned disclosure ladder, language-locale-aware UIs.

CADNP v1.0 ships bilateral, manual-discovery, opt-in. The roadmap above is a checklist for later — none of it is built or implied by v1.0.

---

## Section 7 — Frontend implementation notes

### 7.1 State management

The dashboard fetches `/v1/dashboard` once on mount via React Query (`staleTime: 60_000`, `refetchInterval: 60_000`). The deconfliction feed additionally subscribes to a Supabase Realtime channel `supervisor:deconfliction:scope_<scope_id>` so new alerts pop in within a second.

A Zustand store holds:

- The current scope (so the scope picker works without a full page refresh).
- The selected case in the sidebar.
- The selected alert in the resolution page.
- Local-only UI flags (sidebar open, filter chips active).

### 7.2 Component inventory (apps/web/src/components/supervisor/)

```
supervisor/
├── ScopePicker.tsx                  # the topbar dropdown
├── KpiStrip.tsx
├── CasePortfolioHeatmap.tsx         # the grid; uses canvas, not DOM cells, when >300 cells
├── CaseloadBalance.tsx              # sparklines via Recharts
├── PendingApprovalsList.tsx
├── DeconflictionFeed.tsx
├── CaseSidebar.tsx                  # slide-in 480-px panel
├── ReviewerCommentThread.tsx        # used in CaseSidebar and on review pages
├── ReviewPage.tsx                   # /supervisor/reviews/[id]
├── ResolutionPage.tsx               # /supervisor/deconfliction/[id]
├── CadnpTrustCardList.tsx           # in Settings
├── CadnpMatchInitiator.tsx          # the "ask peer agencies" flow
├── EmptyState.tsx                   # shared empty-state primitive
└── auditTimeline.tsx                # /supervisor/audit
```

### 7.3 Performance budget

- First Contentful Paint <1.5 s on a typical agency laptop (mid-tier i5 + WAN to Fly.io).
- Heatmap renders 25 investigators × 12 cases (300 cells) in <120 ms after data arrives.
- Scope switch <500 ms p95 (the snapshot for the new scope is pre-warmed when the picker opens).
- Deconfliction alert ingestion latency <2 s from scan-job completion to UI badge update.

### 7.4 Accessibility

- The heatmap exposes a list-view toggle (top-right corner button "Grid · List"). The list view is keyboard-navigable, screen-reader friendly, and ships the same information as the grid. Color is never the only encoding — every risk tier also has a one-letter glyph (L/M/H/C) inside the cell when text-size ≥ medium.
- Status badges include text alongside icons.
- Color choices target WCAG AA contrast on both light and dark mode.

---

## Section 8 — What we are NOT building (anti-features for this surface)

These are out-of-scope for v1.0 supervisor mode and remain out-of-scope under F41:

1. **No predictive workload models.** The caseload panel shows what *is*, never what an algorithm *predicts* about an investigator's future performance.
2. **No "investigator score."** No composite metric, no ranking, no leaderboard. Workload is a routing input only.
3. **No silent telemetry.** Investigators see their own hours-logged and review-pass/sent-back counts in their own profile; the supervisor sees the same numbers; nothing is hidden from the investigator about what supervisors can see.
4. **No automated case reassignment.** Reassignment is always a deliberate human action with a recorded rationale.
5. **No cross-agency directory.** CADNP is bilateral and discovery is out-of-band. We refuse to build a central "who's investigating what" service even if asked.
6. **No demographic correlation in heatmap rows.** Investigator rows are identified by professional identity (name + role + badge#) only. Demographic attributes are never sortable, filterable, or color-encoded.
7. **No auto-promotion of CADNP medium alerts to high/critical.** Severity escalation requires a supervisor decision.
8. **No supervisor edit access to a case's evidentiary stream.** Supervisors comment in a parallel namespace; the only writes to belief atoms are the explicit "deconfliction decision" atoms described in §5, which are clearly labeled and append-only.

---

## Section 9 — Build phasing

| Phase  | Scope                                                                                            |
|--------|--------------------------------------------------------------------------------------------------|
| 0      | Phase-0 mockup at `/supervisor-demo` — static heatmap, scripted alerts, no auth. Sells the vision. |
| 1.0    | Live dashboard, scope picker, KPI strip, real heatmap from `dashboard_snapshot`, real reviews queue, intra-agency deconfliction feed. **No CADNP yet.** |
| 1.1    | CADNP v1.0: trust-card exchange, bilateral handshake, post-match liaison ladder, audit pages. |
| 1.2    | Joint-task-force charters, multi-supervisor signature workflows, reassignment flow polish, audit export to PDF. |
| 2.0+   | Federation (broker, PSI, international) — see §6.7.                                              |

---

## Section 10 — Open questions for next pass

1. **Multi-tenant snapshot keying.** If a supervisor has 4 roles, do we generate 4 snapshots or one merged snapshot? Current design: 4 separate, switched via the picker. Worth revisiting once the first agency exceeds 8 roles per user.
2. **CADNP rate-limit calibration.** 200/day default is a guess. Pilot agencies should report what they actually need.
3. **Cross-case overlap on cluster anchors.** Clusters drift over time. Do we re-scan historical alerts when a cluster's anchor changes? Current design: yes, with a new alert kind `cluster_anchor_drift` rather than mutating the original.
4. **Supervisor-of-supervisor escalation.** Three-level chains (team → squad → division) are supported by the role model but not yet rendered in the UI. Add when a pilot agency requests it.
5. **Court-mode interaction.** Should pre-court checkpoints automatically include the supervisor approval signature line on the generated court-ready report? Probably yes, but the exact placement and visibility need v1.0 Compliance Legal sign-off.

---

## Section 11 — Cross-references

- **v0.3 G4** — Freeze Request workflow gains the optional supervisor-approval gate (§F27 confirmed; §2.4 here renders it in the queue).
- **v0.5_2 F19** — PSR draft → under_review uses the same checkpoint primitive defined in F27.
- **v0.8 F27** — base spec; this document is its UI/protocol expansion.
- **v0.8 F28** — Case transfer; the reassign action in §2.2 emits the F28 `CaseTransfer` row.
- **v0.8 F29** — Chain of custody; the case sidebar's "Open chain of custody" button routes to F29 view.
- **v1.0 Frontend Architecture** — Section 1 (App Router); routes registered at `/supervisor/*`.
- **v1.0 Compliance Legal** — must sign off on CADNP legal preamble, MLAT alignment, and disclosure-ladder language before §6 ships.
- **v1.0 Security & Sovereignty** — must sign off on Ed25519 / X25519 key handling and the per-agency pepper rotation procedure.
- **v1.0 Backend Architecture** — adds `chainsight-supervisor-api-dev` to the service inventory.

---

*End of v1.0 Supervisor Dashboard & CADNP Addendum.*
