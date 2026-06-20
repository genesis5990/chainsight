/**
 * Supervisor Dashboard (Surface 7) data shapes.
 *
 * Spec: docs/chainsight_v1_0_supervisor_dashboard_addendum.md (Phase-0 mockup).
 *
 * Phase 0 ships a static, scripted dataset at /supervisor-demo to sell the
 * vision. Phase 1 wires the real supervisor-api service, materialized
 * dashboard_snapshot table, and live deconfliction scan worker.
 */

// ---------- scope + roles ----------

export type SupervisoryScope = 'team' | 'squad' | 'division' | 'agency';

export interface SupervisoryRoleSummary {
  id: string;
  scope: SupervisoryScope;
  scope_label: string;          // e.g. "Cyber Squad 14 · Team Lead"
  agency_id: string;
  agency_label: string;
  is_active: boolean;
}

// ---------- KPI strip ----------

export interface KpiTile {
  id:
    | 'active_cases'
    | 'pending_my_approval'
    | 'critical_alerts'
    | 'avg_days_per_case'
    | 'cross_case_overlaps';
  label: string;
  value: number | string;
  /** 7-day delta (raw count or percent change depending on the tile). */
  delta_7d: number;
  /** Whether the delta is good news (green), bad news (red), or neutral. */
  delta_direction: 'good' | 'bad' | 'neutral';
  /** Where clicking the tile routes the user. */
  href: string;
}

// ---------- heatmap ----------

export type CaseRiskTier = 'low' | 'medium' | 'high' | 'critical';

export interface HeatmapCell {
  case_id: string;
  case_name: string;
  case_code: string;            // short code, e.g. "OP-LEM-042"
  risk_tier: CaseRiskTier;
  /** 0..1 — fraction of SLA budget remaining (drives cell width). */
  sla_pct_remaining: number;
  sla_breached: boolean;
  has_sanctions_hit: boolean;
  is_dormant: boolean;          // no activity in >14 days
  days_dormant: number;
  awaiting_my_input: boolean;   // diagonal hatch overlay
  in_overlap_group: boolean;    // 2-px outline ring
  last_activity_at: string;
  /** Composite risk score 0..100, used in tooltips. */
  composite_risk_score: number;
}

export interface HeatmapRow {
  investigator_id: string;
  investigator_name: string;
  investigator_badge: string;   // e.g. "Det. · #4471"
  /** "out" if the investigator is on leave — row renders with a banner. */
  availability: 'available' | 'in_court' | 'training' | 'out';
  cases: HeatmapCell[];
  /** 0..1 — load relative to their target band; >1 is overloaded. */
  load_score: number;
}

// ---------- caseload sparklines ----------

export interface CaseloadSparkline {
  investigator_id: string;
  investigator_name: string;
  /** 30 daily points — oldest first. */
  active_case_count: number[];
  hours_logged: number[];
  reviews_sent_back: number[];
  /** Target band for active cases (e.g. [4, 7] for a senior). */
  target_band: [number, number];
  /** Computed at snapshot time. */
  current_load_label: 'has_capacity' | 'on_target' | 'overloaded';
}

// ---------- review checkpoints ----------

export type CheckpointKind =
  | 'initial_intake'
  | 'tracing_complete'
  | 'report_draft'
  | 'pre_freeze'
  | 'pre_seizure'
  | 'pre_court'
  | 'case_close';

export interface ReviewCheckpointSummary {
  id: string;
  case_id: string;
  case_name: string;
  case_code: string;
  kind: CheckpointKind;
  submitted_by_id: string;
  submitted_by_name: string;
  submitted_at: string;         // ISO
  /** Higher = more urgent. */
  urgency: 'normal' | 'sent_back_twice';
  /** Brief summary the supervisor sees in the queue card. */
  summary: string;
  /** Pre-freeze / pre-seizure / pre-court cannot quick-approve. */
  quick_approve_allowed: boolean;
}

// ---------- deconfliction alerts ----------

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'info';

export type AlertKind =
  | 'intra_agency_address'
  | 'intra_agency_tx'
  | 'intra_agency_cluster'
  | 'cross_agency_cadnp';

export interface CaseSummaryRef {
  case_id: string;
  case_name: string;
  case_code: string;
  investigator_name: string;
}

export interface DeconflictionAlertSummary {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  detected_at: string;          // ISO
  /** Address / tx / cluster anchor in canonical form. */
  subject_display: string;
  subject_kind: 'address' | 'tx_hash' | 'cluster_anchor';
  /** For intra-agency: cases that overlap. For CADNP: just our case + a peer agency stub. */
  involved_cases: CaseSummaryRef[];
  /** Length 1 for intra; ≥2 for cross_agency_cadnp. */
  involved_agencies: string[];
  /** Coarse band returned by CADNP — only present on cross-agency alerts. */
  cadnp_count_band?: '0' | '1' | '2-5' | '6+';
  cadnp_since_ts?: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'false_positive';
  unread: boolean;
}

// ---------- dashboard snapshot (top-level) ----------

export interface DashboardSnapshot {
  scope: SupervisoryRoleSummary;
  generated_at: string;
  kpi: KpiTile[];
  heatmap: HeatmapRow[];
  caseload: CaseloadSparkline[];
  pending_reviews: ReviewCheckpointSummary[];
  deconfliction: DeconflictionAlertSummary[];
}
