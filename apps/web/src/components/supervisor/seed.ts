/**
 * Phase-0 seed dataset for Surface 7 (Supervisor Dashboard).
 *
 * Models FBI Cyber Squad 14 — 6 investigators, 24 active cases, realistic
 * mix of risk tiers, SLA states, sanctions hits, dormancy, and overlap groups.
 *
 * The dataset is deterministic — no randomness — so screenshots stay stable.
 */

import type {
  CaseloadSparkline,
  DashboardSnapshot,
  DeconflictionAlertSummary,
  HeatmapCell,
  HeatmapRow,
  KpiTile,
  ReviewCheckpointSummary,
  SupervisoryRoleSummary,
} from '@chainsight/shared-types';

// ---------- scope ----------

const SCOPE: SupervisoryRoleSummary = {
  id: 'role-cyber-squad-14-lead',
  scope: 'squad',
  scope_label: 'Cyber Squad 14 · Team Lead',
  agency_id: 'agency-fbi-fo-7',
  agency_label: 'FBI · Field Office 7',
  is_active: true,
};

export const ALTERNATE_SCOPES: SupervisoryRoleSummary[] = [
  SCOPE,
  {
    id: 'role-fo7-cyber-branch',
    scope: 'division',
    scope_label: 'Field Office 7 · Cyber Branch',
    agency_id: 'agency-fbi-fo-7',
    agency_label: 'FBI · Field Office 7',
    is_active: false,
  },
  {
    id: 'role-fbi-cyber-division-delegated',
    scope: 'agency',
    scope_label: 'FBI · Cyber Division (delegated)',
    agency_id: 'agency-fbi',
    agency_label: 'FBI',
    is_active: false,
  },
];

// ---------- investigators ----------

interface Investigator {
  id: string;
  name: string;
  badge: string;
  /** seniority drives target band */
  level: 'junior' | 'mid' | 'senior';
  availability: HeatmapRow['availability'];
}

const INVESTIGATORS: Investigator[] = [
  { id: 'inv-nguyen',  name: 'Det. T. Nguyen',  badge: 'Det. · #4471', level: 'senior', availability: 'available' },
  { id: 'inv-park',    name: 'Lt. R. Park',     badge: 'Lt. · #2218',  level: 'senior', availability: 'available' },
  { id: 'inv-cho',     name: 'Det. S. Cho',     badge: 'Det. · #5044', level: 'mid',    availability: 'available' },
  { id: 'inv-patel',   name: 'Det. A. Patel',   badge: 'Det. · #5119', level: 'mid',    availability: 'in_court' },
  { id: 'inv-reyes',   name: 'Det. M. Reyes',   badge: 'Det. · #5602', level: 'junior', availability: 'available' },
  { id: 'inv-park-a',  name: 'Det. A. Park',    badge: 'Det. · #5710', level: 'junior', availability: 'out' },
];

const TARGET_BAND: Record<Investigator['level'], [number, number]> = {
  junior: [2, 4],
  mid: [3, 6],
  senior: [4, 7],
};

// ---------- cases ----------

interface CaseDef {
  inv: Investigator['id'];
  code: string;
  name: string;
  risk: HeatmapCell['risk_tier'];
  sla: number;                     // 0..1 remaining
  sanct: boolean;
  dormant_days: number;            // 0 = active
  awaiting: boolean;
  overlap_group?: string;          // shared between cases that overlap
  composite: number;               // 0..100
  last_activity_hours_ago: number;
}

const CASES: CaseDef[] = [
  // Det. Nguyen (senior, 8 cases — slightly above band)
  { inv: 'inv-nguyen', code: 'OP-LEM-042', name: 'Operation Lemon',     risk: 'critical', sla: 0.38, sanct: true,  dormant_days: 0,  awaiting: true,  overlap_group: 'og-1', composite: 91, last_activity_hours_ago: 6 },
  { inv: 'inv-nguyen', code: 'OP-OWL-019', name: 'Operation Owl',       risk: 'high',     sla: 0.62, sanct: true,  dormant_days: 0,  awaiting: false, composite: 78, last_activity_hours_ago: 14 },
  { inv: 'inv-nguyen', code: 'OP-PEAR-007', name: 'Operation Pear',     risk: 'high',     sla: 0.51, sanct: false, dormant_days: 0,  awaiting: false, overlap_group: 'og-2', composite: 71, last_activity_hours_ago: 28 },
  { inv: 'inv-nguyen', code: 'OP-MOSS-013', name: 'Operation Moss',     risk: 'medium',   sla: 0.74, sanct: false, dormant_days: 0,  awaiting: false, composite: 52, last_activity_hours_ago: 8 },
  { inv: 'inv-nguyen', code: 'OP-ASH-031', name: 'Operation Ash',       risk: 'medium',   sla: 0.81, sanct: false, dormant_days: 0,  awaiting: false, composite: 47, last_activity_hours_ago: 30 },
  { inv: 'inv-nguyen', code: 'OP-FERN-024', name: 'Operation Fern',     risk: 'low',      sla: 0.92, sanct: false, dormant_days: 0,  awaiting: false, composite: 28, last_activity_hours_ago: 4 },
  { inv: 'inv-nguyen', code: 'OP-SAGE-008', name: 'Operation Sage',     risk: 'low',      sla: 0.88, sanct: false, dormant_days: 18, awaiting: false, composite: 32, last_activity_hours_ago: 18 * 24 },
  { inv: 'inv-nguyen', code: 'OP-IVY-002',  name: 'Operation Ivy',      risk: 'medium',   sla: 0.67, sanct: false, dormant_days: 0,  awaiting: false, composite: 49, last_activity_hours_ago: 36 },

  // Lt. Park (senior, 6 cases)
  { inv: 'inv-park', code: 'OP-KRA-067', name: 'Operation Kraken',      risk: 'critical', sla: 0.22, sanct: true,  dormant_days: 0,  awaiting: true,  overlap_group: 'og-1', composite: 95, last_activity_hours_ago: 2 },
  { inv: 'inv-park', code: 'OP-EEL-014', name: 'Operation Eel',         risk: 'high',     sla: 0.45, sanct: true,  dormant_days: 0,  awaiting: false, composite: 76, last_activity_hours_ago: 9 },
  { inv: 'inv-park', code: 'OP-ORCA-021', name: 'Operation Orca',       risk: 'high',     sla: 0.58, sanct: false, dormant_days: 0,  awaiting: false, overlap_group: 'og-2', composite: 68, last_activity_hours_ago: 16 },
  { inv: 'inv-park', code: 'OP-SHK-033', name: 'Operation Shark',       risk: 'medium',   sla: 0.71, sanct: false, dormant_days: 0,  awaiting: false, composite: 54, last_activity_hours_ago: 22 },
  { inv: 'inv-park', code: 'OP-SQD-006', name: 'Operation Squid',       risk: 'medium',   sla: 0.84, sanct: false, dormant_days: 0,  awaiting: false, composite: 41, last_activity_hours_ago: 5 },
  { inv: 'inv-park', code: 'OP-COD-028', name: 'Operation Cod',         risk: 'low',      sla: 0.95, sanct: false, dormant_days: 0,  awaiting: false, composite: 22, last_activity_hours_ago: 12 },

  // Det. Cho (mid, 4 cases — on band)
  { inv: 'inv-cho', code: 'OP-FOX-022', name: 'Operation Fox',          risk: 'high',     sla: 0.44, sanct: true,  dormant_days: 0,  awaiting: false, composite: 73, last_activity_hours_ago: 7 },
  { inv: 'inv-cho', code: 'OP-WOLF-011', name: 'Operation Wolf',        risk: 'medium',   sla: 0.69, sanct: false, dormant_days: 0,  awaiting: true,  composite: 55, last_activity_hours_ago: 19 },
  { inv: 'inv-cho', code: 'OP-LYNX-005', name: 'Operation Lynx',        risk: 'medium',   sla: 0.78, sanct: false, dormant_days: 0,  awaiting: false, composite: 48, last_activity_hours_ago: 27 },
  { inv: 'inv-cho', code: 'OP-BEAR-040', name: 'Operation Bear',        risk: 'low',      sla: 0.90, sanct: false, dormant_days: 9,  awaiting: false, composite: 30, last_activity_hours_ago: 9 * 24 },

  // Det. Patel (mid, 3 cases — on band)
  { inv: 'inv-patel', code: 'OP-RVN-017', name: 'Operation Raven',      risk: 'high',     sla: 0.40, sanct: true,  dormant_days: 0,  awaiting: false, composite: 79, last_activity_hours_ago: 3 },
  { inv: 'inv-patel', code: 'OP-HWK-010', name: 'Operation Hawk',       risk: 'medium',   sla: 0.65, sanct: false, dormant_days: 0,  awaiting: false, composite: 51, last_activity_hours_ago: 11 },
  { inv: 'inv-patel', code: 'OP-EAG-025', name: 'Operation Eagle',      risk: 'low',      sla: 0.87, sanct: false, dormant_days: 0,  awaiting: false, composite: 26, last_activity_hours_ago: 36 },

  // Det. Reyes (junior, 2 cases — on band)
  { inv: 'inv-reyes', code: 'OP-OAK-001', name: 'Operation Oak',        risk: 'medium',   sla: 0.55, sanct: false, dormant_days: 0,  awaiting: true,  composite: 56, last_activity_hours_ago: 4 },
  { inv: 'inv-reyes', code: 'OP-ELM-009', name: 'Operation Elm',        risk: 'low',      sla: 0.83, sanct: false, dormant_days: 0,  awaiting: false, composite: 31, last_activity_hours_ago: 15 },

  // Det. A. Park (junior, 1 case — OUT, reassignment needed)
  { inv: 'inv-park-a', code: 'OP-BIRCH-016', name: 'Operation Birch',   risk: 'high',     sla: 0.18, sanct: false, dormant_days: 11, awaiting: true,  composite: 70, last_activity_hours_ago: 11 * 24 },
];

// ---------- build heatmap ----------

function buildHeatmap(): HeatmapRow[] {
  return INVESTIGATORS.map((inv) => {
    const myCases = CASES.filter((c) => c.inv === inv.id);
    // Sort cases by risk tier (critical → low) so the highest-risk cells appear leftmost.
    const tierOrder: Record<HeatmapCell['risk_tier'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
    myCases.sort((a, b) => tierOrder[a.risk] - tierOrder[b.risk]);

    const cases: HeatmapCell[] = myCases.map((c) => ({
      case_id: `case-${c.code}`,
      case_name: c.name,
      case_code: c.code,
      risk_tier: c.risk,
      sla_pct_remaining: c.sla,
      sla_breached: c.sla < 0.2,
      has_sanctions_hit: c.sanct,
      is_dormant: c.dormant_days > 14,
      days_dormant: c.dormant_days,
      awaiting_my_input: c.awaiting,
      in_overlap_group: !!c.overlap_group,
      last_activity_at: new Date(Date.now() - c.last_activity_hours_ago * 3600_000).toISOString(),
      composite_risk_score: c.composite,
    }));

    const [lo, hi] = TARGET_BAND[inv.level];
    const load = cases.length / ((lo + hi) / 2);

    return {
      investigator_id: inv.id,
      investigator_name: inv.name,
      investigator_badge: inv.badge,
      availability: inv.availability,
      cases,
      load_score: load,
    };
  });
}

// ---------- build caseload sparklines ----------

function buildCaseload(): CaseloadSparkline[] {
  // 30 days of synthetic but deterministic data per investigator.
  return INVESTIGATORS.map((inv) => {
    const [lo, hi] = TARGET_BAND[inv.level];
    const target_band: [number, number] = [lo, hi];
    // Seed varies per investigator id to give each a distinct shape.
    const seed = hashCode(inv.id);
    const active: number[] = [];
    const hours: number[] = [];
    const sentBack: number[] = [];
    let current = (lo + hi) / 2;
    for (let d = 0; d < 30; d++) {
      const wobble = Math.sin((d + seed) * 0.4) * 1.2;
      current = Math.max(0, current + wobble * 0.3);
      // Final week pushes Nguyen + Park-A above band.
      if (inv.id === 'inv-nguyen' && d > 22) current = 7.5 + (d - 22) * 0.15;
      if (inv.id === 'inv-park-a' && d > 18) current = Math.max(current - 0.2, 1);
      active.push(Math.round(current * 10) / 10);
      hours.push(Math.round((6 + Math.sin((d + seed) * 0.5) * 2.5) * 10) / 10);
      sentBack.push(d % 9 === seed % 9 ? 1 : 0);
    }
    const last = active[active.length - 1] ?? 0;
    const label: CaseloadSparkline['current_load_label'] =
      last > hi ? 'overloaded' : last < lo ? 'has_capacity' : 'on_target';
    return {
      investigator_id: inv.id,
      investigator_name: inv.name,
      active_case_count: active,
      hours_logged: hours,
      reviews_sent_back: sentBack,
      target_band,
      current_load_label: label,
    };
  });
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// ---------- pending reviews ----------

const PENDING_REVIEWS: ReviewCheckpointSummary[] = [
  {
    id: 'chk-1',
    case_id: 'case-OP-LEM-042',
    case_name: 'Operation Lemon',
    case_code: 'OP-LEM-042',
    kind: 'pre_freeze',
    submitted_by_id: 'inv-park',
    submitted_by_name: 'Lt. R. Park',
    submitted_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    urgency: 'normal',
    summary: 'Freeze target: 5 BTC addresses, ~$1.42M USD equiv. AUSA pre-cleared.',
    quick_approve_allowed: false,
  },
  {
    id: 'chk-2',
    case_id: 'case-OP-KRA-067',
    case_name: 'Operation Kraken',
    case_code: 'OP-KRA-067',
    kind: 'pre_court',
    submitted_by_id: 'inv-patel',
    submitted_by_name: 'Det. A. Patel',
    submitted_at: new Date(Date.now() - 62 * 60_000).toISOString(),
    urgency: 'sent_back_twice',
    summary: 'Expert declaration draft — 14-page tracing report, 2 paths, Daubert sections complete.',
    quick_approve_allowed: false,
  },
  {
    id: 'chk-3',
    case_id: 'case-OP-FOX-022',
    case_name: 'Operation Fox',
    case_code: 'OP-FOX-022',
    kind: 'report_draft',
    submitted_by_id: 'inv-cho',
    submitted_by_name: 'Det. S. Cho',
    submitted_at: new Date(Date.now() - 4 * 3600_000).toISOString(),
    urgency: 'normal',
    summary: 'Interim tracing memo — 1 path under_review, 11 belief atoms attached.',
    quick_approve_allowed: true,
  },
  {
    id: 'chk-4',
    case_id: 'case-OP-OAK-001',
    case_name: 'Operation Oak',
    case_code: 'OP-OAK-001',
    kind: 'initial_intake',
    submitted_by_id: 'inv-reyes',
    submitted_by_name: 'Det. M. Reyes',
    submitted_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    urgency: 'normal',
    summary: 'New case scoped: BEC victim referral, 3 suspect addresses, USDT inbound.',
    quick_approve_allowed: true,
  },
];

// ---------- deconfliction alerts ----------

const DECONFLICTION: DeconflictionAlertSummary[] = [
  {
    id: 'alert-1',
    kind: 'intra_agency_address',
    severity: 'critical',
    detected_at: new Date(Date.now() - 12 * 60_000).toISOString(),
    subject_display: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    subject_kind: 'address',
    involved_cases: [
      { case_id: 'case-OP-LEM-042', case_name: 'Operation Lemon',  case_code: 'OP-LEM-042', investigator_name: 'Det. T. Nguyen' },
      { case_id: 'case-OP-KRA-067', case_name: 'Operation Kraken', case_code: 'OP-KRA-067', investigator_name: 'Lt. R. Park' },
    ],
    involved_agencies: ['FBI · Field Office 7'],
    status: 'open',
    unread: true,
  },
  {
    id: 'alert-2',
    kind: 'intra_agency_tx',
    severity: 'high',
    detected_at: new Date(Date.now() - 34 * 60_000).toISOString(),
    subject_display: '0xa7b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9c8d3e4f1a2b9',
    subject_kind: 'tx_hash',
    involved_cases: [
      { case_id: 'case-OP-PEAR-007', case_name: 'Operation Pear', case_code: 'OP-PEAR-007', investigator_name: 'Det. T. Nguyen' },
      { case_id: 'case-OP-ORCA-021', case_name: 'Operation Orca', case_code: 'OP-ORCA-021', investigator_name: 'Lt. R. Park' },
    ],
    involved_agencies: ['FBI · Field Office 7'],
    status: 'open',
    unread: true,
  },
  {
    id: 'alert-3',
    kind: 'cross_agency_cadnp',
    severity: 'medium',
    detected_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    subject_display: 'cluster:eth:0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503',
    subject_kind: 'cluster_anchor',
    involved_cases: [
      { case_id: 'case-OP-LEM-042', case_name: 'Operation Lemon', case_code: 'OP-LEM-042', investigator_name: 'Det. T. Nguyen' },
    ],
    involved_agencies: ['FBI · Field Office 7', 'USSS · ECTF NYC (peer)'],
    cadnp_count_band: '2-5',
    cadnp_since_ts: new Date(Date.now() - 18 * 86400_000).toISOString(),
    status: 'open',
    unread: true,
  },
  {
    id: 'alert-4',
    kind: 'intra_agency_cluster',
    severity: 'high',
    detected_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    subject_display: 'cluster:btc:bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cg6d3tg6axemvljvt2k76zs50tv4q',
    subject_kind: 'cluster_anchor',
    involved_cases: [
      { case_id: 'case-OP-EEL-014', case_name: 'Operation Eel', case_code: 'OP-EEL-014', investigator_name: 'Lt. R. Park' },
      { case_id: 'case-OP-RVN-017', case_name: 'Operation Raven', case_code: 'OP-RVN-017', investigator_name: 'Det. A. Patel' },
    ],
    involved_agencies: ['FBI · Field Office 7'],
    status: 'open',
    unread: false,
  },
  {
    id: 'alert-5',
    kind: 'cross_agency_cadnp',
    severity: 'medium',
    detected_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
    subject_display: 'eth:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    subject_kind: 'address',
    involved_cases: [
      { case_id: 'case-OP-OWL-019', case_name: 'Operation Owl', case_code: 'OP-OWL-019', investigator_name: 'Det. T. Nguyen' },
    ],
    involved_agencies: ['FBI · Field Office 7', 'IRS-CI · Cyber Crimes Unit (peer)'],
    cadnp_count_band: '1',
    cadnp_since_ts: new Date(Date.now() - 4 * 86400_000).toISOString(),
    status: 'acknowledged',
    unread: false,
  },
  {
    id: 'alert-6',
    kind: 'intra_agency_address',
    severity: 'info',
    detected_at: new Date(Date.now() - 30 * 3600_000).toISOString(),
    subject_display: 'eth:0x28C6c06298d514Db089934071355E5743bf21d60',
    subject_kind: 'address',
    involved_cases: [
      { case_id: 'case-OP-MOSS-013', case_name: 'Operation Moss', case_code: 'OP-MOSS-013', investigator_name: 'Det. T. Nguyen' },
      { case_id: 'case-archived-001', case_name: 'Operation Lichen (closed)', case_code: 'OP-LCN-003', investigator_name: 'Lt. R. Park' },
    ],
    involved_agencies: ['FBI · Field Office 7'],
    status: 'open',
    unread: false,
  },
];

// ---------- KPI ----------

function buildKpis(heatmap: HeatmapRow[], reviews: ReviewCheckpointSummary[], alerts: DeconflictionAlertSummary[]): KpiTile[] {
  const totalCases = heatmap.reduce((acc, r) => acc + r.cases.length, 0);
  const critical = alerts.filter((a) => a.severity === 'critical' && a.status === 'open').length;
  const overlaps = new Set(alerts.filter((a) => a.status === 'open').map((a) => a.id)).size;
  return [
    { id: 'active_cases',        label: 'Active cases',         value: totalCases, delta_7d: +2, delta_direction: 'neutral', href: '/supervisor-demo' },
    { id: 'pending_my_approval', label: 'Pending my approval',  value: reviews.length, delta_7d: +1, delta_direction: 'bad', href: '/supervisor-demo' },
    { id: 'critical_alerts',     label: 'Critical alerts',      value: critical, delta_7d: +1, delta_direction: 'bad', href: '/supervisor-demo' },
    { id: 'avg_days_per_case',   label: 'Avg. days / case',     value: 87, delta_7d: -3, delta_direction: 'good', href: '/supervisor-demo' },
    { id: 'cross_case_overlaps', label: 'Cross-case overlaps',  value: overlaps, delta_7d: +2, delta_direction: 'neutral', href: '/supervisor-demo' },
  ];
}

// ---------- export ----------

export const SUPERVISOR_DASHBOARD: DashboardSnapshot = (() => {
  const heatmap = buildHeatmap();
  const caseload = buildCaseload();
  const kpi = buildKpis(heatmap, PENDING_REVIEWS, DECONFLICTION);
  return {
    scope: SCOPE,
    generated_at: new Date().toISOString(),
    kpi,
    heatmap,
    caseload,
    pending_reviews: PENDING_REVIEWS,
    deconfliction: DECONFLICTION,
  };
})();
