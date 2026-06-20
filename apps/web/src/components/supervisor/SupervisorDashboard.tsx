'use client';

/**
 * Surface 7 — Supervisor Dashboard (Phase-0 mockup).
 *
 * Composition:
 *   <Topbar/>
 *   <KpiStrip/>
 *   ┌──────────────────────────────┬─────────────────────────┐
 *   │ CasePortfolioHeatmap         │ PendingApprovals        │
 *   │                              │                         │
 *   │                              │ DeconflictionFeed       │
 *   │ CaseloadBalance              │                         │
 *   └──────────────────────────────┴─────────────────────────┘
 *
 * Click any heatmap cell → opens <CaseSidebar/> (slide-in, non-destructive).
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowUpRight, Calendar, ChevronDown, Eye, FileText,
  Flag, Gavel, Globe, Layers, Link2, Loader2, MessageSquarePlus, Network,
  ShieldAlert, Snowflake, Sparkles, UserMinus, X,
} from 'lucide-react';
import clsx from 'clsx';
import type {
  CaseRiskTier,
  CaseloadSparkline,
  DashboardSnapshot,
  DeconflictionAlertSummary,
  HeatmapCell,
  HeatmapRow,
  KpiTile,
  ReviewCheckpointSummary,
  SupervisoryRoleSummary,
} from '@chainsight/shared-types';

interface Props {
  snapshot: DashboardSnapshot;
  scopes: SupervisoryRoleSummary[];
  onScopeChange?: (scope: SupervisoryRoleSummary) => void;
}

export function SupervisorDashboard({ snapshot, scopes, onScopeChange }: Props) {
  const [selectedCell, setSelectedCell] = useState<{ row: HeatmapRow; cell: HeatmapCell } | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<DeconflictionAlertSummary | null>(null);

  return (
    <div className="min-h-screen bg-context-50">
      <Topbar scope={snapshot.scope} scopes={scopes} onScopeChange={onScopeChange} />
      <main className="max-w-[1480px] mx-auto px-6 py-5 space-y-5">
        <KpiStrip kpi={snapshot.kpi} />
        <div className="grid grid-cols-[1fr_380px] gap-5">
          {/* LEFT column */}
          <div className="space-y-5">
            <CasePortfolioHeatmap
              rows={snapshot.heatmap}
              onCellClick={(row, cell) => setSelectedCell({ row, cell })}
            />
            <CaseloadBalance rows={snapshot.caseload} />
          </div>
          {/* RIGHT column */}
          <div className="space-y-5">
            <PendingApprovals reviews={snapshot.pending_reviews} />
            <DeconflictionFeed
              alerts={snapshot.deconfliction}
              onAlertClick={(a) => setSelectedAlert(a)}
            />
          </div>
        </div>
      </main>

      {selectedCell && (
        <CaseSidebar
          row={selectedCell.row}
          cell={selectedCell.cell}
          onClose={() => setSelectedCell(null)}
        />
      )}

      {selectedAlert && (
        <AlertModal alert={selectedAlert} onClose={() => setSelectedAlert(null)} />
      )}
    </div>
  );
}

// ============================================================
// Topbar + scope picker
// ============================================================

function Topbar({
  scope,
  scopes,
  onScopeChange,
}: {
  scope: SupervisoryRoleSummary;
  scopes: SupervisoryRoleSummary[];
  onScopeChange?: (s: SupervisoryRoleSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="h-14 border-b border-context-200 bg-white sticky top-0 z-30 flex items-center px-6 gap-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-5 text-context-700" />
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold text-context-900">ChainSight Supervisor</h1>
          <span className="text-[11px] text-context-500">Surface 7 · v1.0</span>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-[12px] rounded border border-context-200 bg-white hover:bg-context-50 text-context-800"
        >
          <span className="text-context-500">Viewing:</span>
          <span className="font-semibold">{scope.scope_label}</span>
          <ChevronDown className="size-3 text-context-500" />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 w-[320px] rounded border border-context-200 bg-white shadow-lg overflow-hidden z-40">
            {scopes.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (s.id !== scope.id) onScopeChange?.(s);
                }}
                className={clsx(
                  'w-full text-left px-3 py-2 text-[12px] hover:bg-context-50',
                  s.id === scope.id && 'bg-markup-50 text-markup-800 font-semibold',
                )}
              >
                {s.scope_label}
                <div className="text-[10px] text-context-500">{s.agency_label}</div>
              </button>
            ))}
            <div className="px-3 py-2 text-[10px] text-context-500 italic bg-context-50 border-t border-context-100 leading-snug">
              ⓘ All scope switches are recorded in the audit log.
            </div>
          </div>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 text-[12px] text-context-600">
        <span>Refreshed just now</span>
        <span className="size-1.5 rounded-full bg-clean-500" />
      </div>
    </header>
  );
}

// ============================================================
// KPI strip
// ============================================================

function KpiStrip({ kpi }: { kpi: KpiTile[] }) {
  return (
    <section className="grid grid-cols-5 gap-3">
      {kpi.map((t) => (
        <div key={t.id} className="rounded border border-context-200 bg-white px-4 py-3">
          <div className="flex items-start justify-between">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-context-500">
              {t.label}
            </span>
            <DeltaBadge value={t.delta_7d} direction={t.delta_direction} />
          </div>
          <div className="text-2xl font-semibold tabular-nums text-context-900 mt-1">
            {t.value}
          </div>
        </div>
      ))}
    </section>
  );
}

function DeltaBadge({ value, direction }: { value: number; direction: 'good' | 'bad' | 'neutral' }) {
  const sign = value > 0 ? '+' : '';
  const colorCls =
    direction === 'good' ? 'text-clean-700' :
    direction === 'bad' ? 'text-taint-700' : 'text-context-500';
  return (
    <span className={clsx('text-[10px] font-semibold tabular-nums', colorCls)}>
      {sign}{value} 7d
    </span>
  );
}

// ============================================================
// Case Portfolio Heatmap
// ============================================================

const RISK_BG: Record<CaseRiskTier, string> = {
  low: 'bg-context-200',
  medium: 'bg-caution-400',
  high: 'bg-elevated-500',
  critical: 'bg-taint-600',
};
const RISK_HOVER: Record<CaseRiskTier, string> = {
  low: 'hover:ring-context-400',
  medium: 'hover:ring-caution-600',
  high: 'hover:ring-elevated-700',
  critical: 'hover:ring-taint-800',
};
const RISK_GLYPH: Record<CaseRiskTier, string> = { low: 'L', medium: 'M', high: 'H', critical: 'C' };

function CasePortfolioHeatmap({
  rows,
  onCellClick,
}: {
  rows: HeatmapRow[];
  onCellClick: (row: HeatmapRow, cell: HeatmapCell) => void;
}) {
  // Sort rows by load score (overloaded first).
  const sorted = useMemo(() => [...rows].sort((a, b) => b.load_score - a.load_score), [rows]);
  return (
    <section className="rounded border border-context-200 bg-white">
      <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
        <Network className="size-4 text-context-700" />
        <h2 className="text-[13px] font-semibold text-context-900">Case Portfolio Heatmap</h2>
        <span className="text-[11px] text-context-500 ml-1">
          {rows.length} investigators · {rows.reduce((a, r) => a + r.cases.length, 0)} active cases
        </span>
        <Legend />
      </header>

      <div className="p-3 space-y-1.5">
        {sorted.map((row) => (
          <div key={row.investigator_id} className="grid grid-cols-[200px_1fr] items-center gap-3">
            <InvestigatorTag row={row} />
            {row.availability === 'out' ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-elevated-50 border border-elevated-200 text-[11px] text-elevated-800">
                <UserMinus className="size-3.5" />
                <span className="font-semibold">On leave — caseload reassignment required</span>
                <span className="text-elevated-700">· {row.cases.length} open case{row.cases.length === 1 ? '' : 's'}</span>
                <button type="button" className="ml-auto text-[11px] font-semibold underline hover:text-elevated-900">
                  Open reassign flow
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1 flex-wrap">
                {row.cases.map((c) => (
                  <HeatmapCellView key={c.case_id} row={row} cell={c} onClick={onCellClick} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="ml-auto flex items-center gap-3 text-[10px] text-context-600">
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-context-200" /> low
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-caution-400" /> med
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-elevated-500" /> high
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="size-2.5 rounded-sm bg-taint-600" /> critical
      </span>
      <span className="text-context-400">·</span>
      <span className="inline-flex items-center gap-1"><span className="text-taint-700">◤</span> sanctions</span>
      <span className="inline-flex items-center gap-1"><Snowflake className="size-3 text-markup-600" /> dormant</span>
      <span className="inline-flex items-center gap-1">⌗ awaiting</span>
      <span className="inline-flex items-center gap-1"><Link2 className="size-3 text-privacy-600" /> overlap</span>
    </div>
  );
}

function InvestigatorTag({ row }: { row: HeatmapRow }) {
  const overloaded = row.load_score > 1.05;
  const underloaded = row.load_score < 0.6 && row.availability !== 'out';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="size-7 rounded-full bg-markup-100 text-markup-700 text-[10px] font-bold flex items-center justify-center shrink-0">
        {initials(row.investigator_name)}
      </div>
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-context-900 truncate">{row.investigator_name}</div>
        <div className="text-[10px] text-context-500 flex items-center gap-1.5">
          <span>{row.cases.length} cases</span>
          {overloaded && <span className="text-elevated-700 font-semibold">· ⚠ overloaded</span>}
          {underloaded && <span className="text-clean-700 font-semibold">· has capacity</span>}
          {row.availability === 'in_court' && <span className="text-markup-700">· in court</span>}
          {row.availability === 'training' && <span className="text-markup-700">· training</span>}
        </div>
      </div>
    </div>
  );
}

function HeatmapCellView({
  row,
  cell,
  onClick,
}: {
  row: HeatmapRow;
  cell: HeatmapCell;
  onClick: (row: HeatmapRow, cell: HeatmapCell) => void;
}) {
  // Width scales with SLA remaining: 22px (no time) → 44px (full time).
  const width = Math.round(22 + cell.sla_pct_remaining * 22);
  const title = [
    cell.case_name,
    `${cell.case_code} · ${cell.risk_tier.toUpperCase()} risk`,
    `SLA: ${Math.round(cell.sla_pct_remaining * 100)}% remaining`,
    cell.has_sanctions_hit ? '⚠ sanctions counterparty' : null,
    cell.is_dormant ? `💤 dormant ${cell.days_dormant}d` : null,
    cell.in_overlap_group ? '🔗 in cross-case overlap' : null,
    cell.awaiting_my_input ? '⌗ awaiting your input' : null,
  ].filter(Boolean).join('\n');

  return (
    <button
      type="button"
      onClick={() => onClick(row, cell)}
      title={title}
      style={{ width }}
      className={clsx(
        'relative h-7 rounded-sm shrink-0 ring-1 ring-black/5 transition hover:ring-2 hover:scale-110',
        RISK_BG[cell.risk_tier],
        RISK_HOVER[cell.risk_tier],
        cell.in_overlap_group && 'outline outline-2 outline-privacy-500 outline-offset-1',
      )}
    >
      <span className={clsx(
        'absolute inset-0 flex items-center justify-center text-[9px] font-bold',
        cell.risk_tier === 'low' ? 'text-context-700' : 'text-white/95',
      )}>
        {RISK_GLYPH[cell.risk_tier]}
      </span>
      {cell.has_sanctions_hit && (
        <span className="absolute -top-0.5 -right-0.5 text-[10px] leading-none text-taint-900">◤</span>
      )}
      {cell.is_dormant && (
        <span className="absolute -bottom-0.5 -left-0.5 size-1.5 rounded-full bg-markup-700" />
      )}
      {cell.awaiting_my_input && (
        <span
          className="absolute inset-0 opacity-40 pointer-events-none"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.6) 0 2px, transparent 2px 5px)',
          }}
        />
      )}
    </button>
  );
}

function initials(name: string): string {
  const parts = name.replace(/[.,]/g, '').split(/\s+/);
  if (parts.length === 0) return '?';
  const last = parts[parts.length - 1] ?? '';
  const first = parts.find((p) => !/^(Det|Lt|Sgt|Capt|Sr|Jr)$/i.test(p)) ?? last;
  return ((first?.[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

// ============================================================
// Caseload Balance
// ============================================================

function CaseloadBalance({ rows }: { rows: CaseloadSparkline[] }) {
  return (
    <section className="rounded border border-context-200 bg-white">
      <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
        <Layers className="size-4 text-context-700" />
        <h2 className="text-[13px] font-semibold text-context-900">Caseload Balance</h2>
        <span className="text-[11px] text-context-500 ml-1">Last 30 days · routing input only</span>
        <span className="ml-auto text-[10px] italic text-context-500">
          For caseload-balancing decisions only — not performance evaluation
        </span>
      </header>
      <div className="p-3">
        <div className="grid grid-cols-[200px_1fr_120px] gap-3 text-[10px] uppercase tracking-wide text-context-500 px-2 pb-1 border-b border-context-100">
          <span>Investigator</span>
          <span>Active cases · 30d (shaded = target band)</span>
          <span className="text-right">Today</span>
        </div>
        <div className="divide-y divide-context-100">
          {rows.map((r) => (
            <SparklineRow key={r.investigator_id} row={r} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SparklineRow({ row }: { row: CaseloadSparkline }) {
  const w = 520;
  const h = 32;
  const max = Math.max(10, ...row.active_case_count) + 1;
  const xStep = w / (row.active_case_count.length - 1);
  const yFor = (v: number) => h - (v / max) * h;

  const linePath = row.active_case_count.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * xStep} ${yFor(v)}`).join(' ');
  const bandTop = yFor(row.target_band[1]);
  const bandBottom = yFor(row.target_band[0]);
  const today = row.active_case_count[row.active_case_count.length - 1] ?? 0;

  const badge =
    row.current_load_label === 'overloaded' ? { cls: 'text-elevated-700', txt: '⚠ overloaded' } :
    row.current_load_label === 'has_capacity' ? { cls: 'text-clean-700', txt: 'has capacity' } :
    { cls: 'text-context-600', txt: 'on target' };

  return (
    <div className="grid grid-cols-[200px_1fr_120px] gap-3 items-center py-2 px-2">
      <span className="text-[12px] text-context-800 truncate">{row.investigator_name}</span>
      <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        <rect x={0} y={bandTop} width={w} height={Math.max(0, bandBottom - bandTop)} fill="#dbeafe" opacity={0.6} />
        <path d={linePath} stroke="#1d4ed8" strokeWidth={1.5} fill="none" />
        {row.reviews_sent_back.map((v, i) =>
          v > 0 ? <circle key={i} cx={i * xStep} cy={h - 2} r={1.6} fill="#dc2626" /> : null,
        )}
      </svg>
      <div className="text-right text-[11px]">
        <div className="font-semibold tabular-nums text-context-900">{today.toFixed(1)} active</div>
        <div className={clsx('text-[10px] font-semibold', badge.cls)}>{badge.txt}</div>
      </div>
    </div>
  );
}

// ============================================================
// Pending approvals
// ============================================================

const CHECKPOINT_ICONS = {
  initial_intake: FileText,
  tracing_complete: Network,
  report_draft: FileText,
  pre_freeze: Flag,
  pre_seizure: ShieldAlert,
  pre_court: Gavel,
  case_close: FileText,
} as const;

const CHECKPOINT_LABEL: Record<ReviewCheckpointSummary['kind'], string> = {
  initial_intake: 'Initial intake',
  tracing_complete: 'Tracing complete',
  report_draft: 'Report draft',
  pre_freeze: 'Pre-freeze',
  pre_seizure: 'Pre-seizure',
  pre_court: 'Pre-court',
  case_close: 'Case close',
};

function PendingApprovals({ reviews }: { reviews: ReviewCheckpointSummary[] }) {
  return (
    <section className="rounded border border-context-200 bg-white">
      <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
        <Gavel className="size-4 text-context-700" />
        <h2 className="text-[13px] font-semibold text-context-900">Pending my approval</h2>
        <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-elevated-100 text-elevated-800 text-[10px] font-bold">
          {reviews.length}
        </span>
      </header>
      <div className="divide-y divide-context-100">
        {reviews.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-context-500 italic">
            No checkpoints in your queue. Nice clean inbox.
          </div>
        ) : reviews.map((r) => (
          <CheckpointCard key={r.id} review={r} />
        ))}
      </div>
    </section>
  );
}

function CheckpointCard({ review }: { review: ReviewCheckpointSummary }) {
  const Icon = CHECKPOINT_ICONS[review.kind] ?? FileText;
  const sentBackTwice = review.urgency === 'sent_back_twice';
  return (
    <div className={clsx(
      'px-4 py-3',
      sentBackTwice && 'bg-taint-50/40 border-l-4 border-taint-500',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="size-3.5 text-context-700 shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-context-700">
          {CHECKPOINT_LABEL[review.kind]}
        </span>
        <span className="text-[11px] text-context-900 font-semibold">· {review.case_name}</span>
        {sentBackTwice && (
          <span className="ml-auto text-[10px] font-bold text-taint-700">NEEDS ATTENTION</span>
        )}
      </div>
      <div className="text-[11px] text-context-600 mb-1.5">
        {review.submitted_by_name} · {relativeTime(review.submitted_at)} · {review.case_code}
      </div>
      <p className="text-[11px] text-context-700 leading-snug mb-2 line-clamp-2">{review.summary}</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-[11px] font-semibold px-2 py-1 rounded bg-markup-600 text-white hover:bg-markup-700 inline-flex items-center gap-1"
        >
          <Eye className="size-3" /> Open review
        </button>
        {review.quick_approve_allowed ? (
          <button
            type="button"
            className="text-[11px] font-semibold px-2 py-1 rounded border border-clean-300 text-clean-800 hover:bg-clean-50"
          >
            Quick approve
          </button>
        ) : (
          <span
            className="text-[10px] text-context-500 italic"
            title="External-effect actions require the full review form"
          >
            ⓘ External-effect — quick approve disabled
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Deconfliction Feed
// ============================================================

const SEVERITY_ICON: Record<DeconflictionAlertSummary['severity'], string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  info: '🔵',
};
const SEVERITY_CLS: Record<DeconflictionAlertSummary['severity'], string> = {
  critical: 'border-l-taint-600',
  high: 'border-l-elevated-500',
  medium: 'border-l-caution-500',
  info: 'border-l-markup-500',
};

function DeconflictionFeed({
  alerts,
  onAlertClick,
}: {
  alerts: DeconflictionAlertSummary[];
  onAlertClick: (a: DeconflictionAlertSummary) => void;
}) {
  return (
    <section className="rounded border border-context-200 bg-white">
      <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
        <Sparkles className="size-4 text-context-700" />
        <h2 className="text-[13px] font-semibold text-context-900">Deconfliction feed</h2>
        <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-elevated-100 text-elevated-800 text-[10px] font-bold">
          {alerts.length}
        </span>
      </header>
      <div className="divide-y divide-context-100 max-h-[640px] overflow-y-auto">
        {alerts.map((a) => (
          <AlertCard key={a.id} alert={a} onClick={() => onAlertClick(a)} />
        ))}
      </div>
    </section>
  );
}

function AlertCard({ alert, onClick }: { alert: DeconflictionAlertSummary; onClick: () => void }) {
  const isCadnp = alert.kind === 'cross_agency_cadnp';
  const subjectShort = alert.subject_display.length > 36
    ? alert.subject_display.slice(0, 18) + '…' + alert.subject_display.slice(-8)
    : alert.subject_display;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'w-full text-left px-4 py-3 border-l-4 hover:bg-context-50/50 transition',
        SEVERITY_CLS[alert.severity],
        alert.unread && 'bg-markup-50/30',
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[12px]">{SEVERITY_ICON[alert.severity]}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-context-800">
          {alertKindLabel(alert.kind)}
        </span>
        {isCadnp && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-privacy-700 bg-privacy-50 px-1.5 py-0.5 rounded">
            <Globe className="size-3" /> CADNP
          </span>
        )}
        {alert.unread && <span className="size-1.5 rounded-full bg-markup-600 ml-auto" />}
      </div>
      <code className="block text-[11px] font-mono text-context-700 mb-1.5">{subjectShort}</code>
      <div className="text-[11px] text-context-700 leading-snug">
        {alert.kind === 'cross_agency_cadnp' ? (
          <>
            CADNP-verified match with{' '}
            <span className="font-semibold">{alert.involved_agencies[1]}</span>
            {alert.cadnp_count_band && (
              <> · count band <span className="font-semibold">{alert.cadnp_count_band}</span></>
            )}
          </>
        ) : (
          <>
            Appears in{' '}
            <span className="font-semibold">{alert.involved_cases.length} cases</span>:{' '}
            {alert.involved_cases.map((c, i) => (
              <span key={c.case_id}>
                <span className="text-context-900 font-semibold">{c.case_name}</span>
                <span className="text-context-500"> ({c.investigator_name})</span>
                {i < alert.involved_cases.length - 1 ? ' ∩ ' : ''}
              </span>
            ))}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-context-500">
        <span>{relativeTime(alert.detected_at)}</span>
        <span>·</span>
        <span className="font-semibold text-markup-700 inline-flex items-center gap-0.5">
          Review <ArrowUpRight className="size-3" />
        </span>
      </div>
    </button>
  );
}

function alertKindLabel(k: DeconflictionAlertSummary['kind']): string {
  switch (k) {
    case 'intra_agency_address': return 'Cross-case · same address';
    case 'intra_agency_tx': return 'Cross-case · same TX hash';
    case 'intra_agency_cluster': return 'Cross-case · same cluster';
    case 'cross_agency_cadnp': return 'Cross-agency · CADNP match';
  }
}

// ============================================================
// Case Sidebar (slide-in)
// ============================================================

function CaseSidebar({
  row,
  cell,
  onClose,
}: {
  row: HeatmapRow;
  cell: HeatmapCell;
  onClose: () => void;
}) {
  return (
    <>
      {/* backdrop click-to-close */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/10"
      />
      <aside className="fixed top-0 right-0 bottom-0 w-[480px] bg-white border-l border-context-200 z-50 shadow-xl flex flex-col">
        <header className="px-4 py-3 border-b border-context-100 flex items-start gap-3">
          <div className={clsx('size-9 rounded flex items-center justify-center text-white font-bold', RISK_BG[cell.risk_tier])}>
            {RISK_GLYPH[cell.risk_tier]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-context-900 truncate">{cell.case_name}</div>
            <div className="text-[11px] text-context-500">{cell.case_code} · {row.investigator_name}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-context-500 hover:text-context-900"
            aria-label="Close sidebar"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Status row */}
          <div className="px-4 py-3 grid grid-cols-2 gap-3 text-[11px]">
            <KV label="Risk tier" value={<RiskBadge tier={cell.risk_tier} />} />
            <KV label="Composite score" value={<span className="font-semibold tabular-nums">{cell.composite_risk_score}/100</span>} />
            <KV
              label="SLA remaining"
              value={
                <span className={clsx('font-semibold tabular-nums', cell.sla_breached && 'text-taint-700')}>
                  {Math.round(cell.sla_pct_remaining * 100)}%
                </span>
              }
            />
            <KV label="Last activity" value={<span>{relativeTime(cell.last_activity_at)}</span>} />
          </div>

          {/* Flags */}
          {(cell.has_sanctions_hit || cell.is_dormant || cell.awaiting_my_input || cell.in_overlap_group) && (
            <div className="px-4 py-3 border-t border-context-100 space-y-1.5">
              <h3 className="text-[10px] uppercase tracking-wide text-context-500 font-semibold">Flags</h3>
              {cell.has_sanctions_hit && (
                <Flagline icon="⚠" cls="text-taint-700" text="Sanctions counterparty finding on at least one path" />
              )}
              {cell.is_dormant && (
                <Flagline icon="💤" cls="text-elevated-700" text={`Dormant ${cell.days_dormant} days — no investigator activity`} />
              )}
              {cell.awaiting_my_input && (
                <Flagline icon="⌗" cls="text-markup-700" text="Awaiting your input — checkpoint queued for you" />
              )}
              {cell.in_overlap_group && (
                <Flagline icon="🔗" cls="text-privacy-700" text="In cross-case overlap group — see deconfliction feed" />
              )}
            </div>
          )}

          {/* Action buttons (non-destructive) */}
          <div className="px-4 py-3 border-t border-context-100">
            <h3 className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
              Supervisor actions (non-destructive)
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <ActionBtn icon={Eye} label="Open in canvas (read-only)" />
              <ActionBtn icon={MessageSquarePlus} label="Add reviewer comment" />
              <ActionBtn icon={Calendar} label="Open chain of custody" />
              <ActionBtn icon={UserMinus} label="Reassign…" />
            </div>
            <p className="text-[10px] text-context-500 italic mt-3 leading-snug">
              Supervisors don't edit the evidentiary stream. Comments live in a parallel namespace
              and are visible to the line investigator. All actions are audit-logged.
            </p>
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-context-100 bg-context-50 text-[10px] text-context-500 italic">
          Phase-0 mockup — Phase 1 wires real case data from Supabase.
        </footer>
      </aside>
    </>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-context-500">{label}</div>
      <div className="text-[12px] text-context-900 mt-0.5">{value}</div>
    </div>
  );
}

function Flagline({ icon, cls, text }: { icon: string; cls: string; text: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px] text-context-800">
      <span className={cls}>{icon}</span>
      <span>{text}</span>
    </div>
  );
}

function ActionBtn({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded border border-context-200 hover:bg-context-50 text-context-800 text-left"
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function RiskBadge({ tier }: { tier: CaseRiskTier }) {
  const label = tier.toUpperCase();
  return (
    <span className={clsx(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold text-white',
      RISK_BG[tier],
    )}>{label}</span>
  );
}

// ============================================================
// Alert modal (lightweight — full /supervisor/deconfliction/[id] is Phase 1)
// ============================================================

function AlertModal({ alert, onClose }: { alert: DeconflictionAlertSummary; onClose: () => void }) {
  const isCadnp = alert.kind === 'cross_agency_cadnp';
  return (
    <>
      <button type="button" onClick={onClose} aria-label="Close" className="fixed inset-0 z-40 bg-black/30" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] max-h-[90vh] overflow-y-auto bg-white rounded shadow-2xl z-50 border border-context-200">
        <header className="px-5 py-4 border-b border-context-100 flex items-start gap-3">
          <span className="text-2xl leading-none">{SEVERITY_ICON[alert.severity]}</span>
          <div className="flex-1">
            <div className="text-[14px] font-semibold text-context-900">{alertKindLabel(alert.kind)}</div>
            <div className="text-[11px] text-context-500 mt-0.5">
              Detected {relativeTime(alert.detected_at)} · Severity <span className="font-semibold">{alert.severity}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-context-500 hover:text-context-900">
            <X className="size-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1">Subject</div>
            <code className="block text-[12px] font-mono text-context-900 bg-context-50 rounded px-2 py-1.5 break-all">
              {alert.subject_display}
            </code>
            <div className="text-[10px] text-context-500 mt-1 capitalize">{alert.subject_kind.replace('_', ' ')}</div>
          </div>

          {isCadnp ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
                CADNP match (hash-only, bilateral)
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded border border-context-200 p-3">
                  <div className="text-[10px] uppercase text-context-500 font-semibold mb-1">Our agency</div>
                  <div className="text-[12px] font-semibold text-context-900">{alert.involved_agencies[0]}</div>
                  <div className="text-[11px] text-context-700 mt-2">
                    <span className="font-semibold">{alert.involved_cases[0]?.case_name}</span> · {alert.involved_cases[0]?.investigator_name}
                  </div>
                </div>
                <div className="rounded border border-privacy-200 bg-privacy-50/30 p-3">
                  <div className="text-[10px] uppercase text-privacy-700 font-semibold mb-1">Peer agency (hash-verified)</div>
                  <div className="text-[12px] font-semibold text-context-900">{alert.involved_agencies[1]}</div>
                  <div className="text-[11px] text-context-700 mt-2">
                    Count band: <span className="font-semibold">{alert.cadnp_count_band}</span>
                  </div>
                  {alert.cadnp_since_ts && (
                    <div className="text-[10px] text-context-500 mt-1">
                      First seen at peer: {new Date(alert.cadnp_since_ts).toLocaleDateString()}
                    </div>
                  )}
                  <div className="text-[10px] italic text-context-500 mt-2">
                    Peer revealed no case identifiers. Initiate Liaison Request to disclose more.
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
                Involved cases ({alert.involved_cases.length})
              </div>
              <div className="space-y-2">
                {alert.involved_cases.map((c) => (
                  <div key={c.case_id} className="rounded border border-context-200 p-3 flex items-center gap-3">
                    <div className="size-8 rounded-full bg-context-100 text-context-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                      {initials(c.investigator_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-context-900">{c.case_name}</div>
                      <div className="text-[10px] text-context-500">{c.case_code} · {c.investigator_name}</div>
                    </div>
                    <button type="button" className="text-[11px] text-markup-700 hover:underline">
                      Open case →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-context-100 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
              Resolution
            </div>
            <div className="space-y-1.5 text-[11px] text-context-800">
              {[
                'Separate investigations (cases remain independent)',
                'Joint task force (creates a Charter; both supervisors sign)',
                'One agency leads (the other case pauses with notes)',
                'Both close (rare — only if subject is no longer of interest)',
                'Escalate to DOJ (cross-agency or interstate)',
              ].map((opt) => (
                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="resolution" className="size-3" />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <textarea
              placeholder="Rationale (min 40 characters, required)…"
              className="mt-3 w-full text-[12px] px-2 py-1.5 rounded border border-context-200 focus:outline-none focus:border-markup-500"
              rows={3}
            />
            <div className="flex items-center gap-2 mt-3">
              <button
                type="button"
                className="text-[11px] font-semibold px-3 py-1.5 rounded border border-context-300 text-context-800 hover:bg-context-50"
              >
                Send to other lead for concurrence
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold px-3 py-1.5 rounded bg-markup-600 text-white hover:bg-markup-700"
              >
                Record decision
              </button>
              <span className="ml-auto text-[10px] italic text-context-500">
                Resolution becomes a BeliefAtom in each case (audit-logged).
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// utils
// ============================================================

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Imports kept at bottom for code organisation - used only inside this file
export const __SUPERVISOR_INTERNAL__ = { Loader2, AlertTriangle };
