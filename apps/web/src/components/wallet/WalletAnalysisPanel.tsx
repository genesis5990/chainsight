'use client';

/**
 * Surface 6 — streaming analysis panel. Three columns:
 *
 *   ┌─────────────────────────────┬───────────────────────────┐
 *   │ Per-address progress rows   │ Flagged for review        │
 *   │ (one row per address;       │ (top-N composite-scored   │
 *   │ stage chip + tiny progress  │ addresses, drill-down)    │
 *   │ bar)                        │                           │
 *   ├─────────────────────────────┴───────────────────────────┤
 *   │ Aggregate summary footer (totals, top counterparties)   │
 *   └─────────────────────────────────────────────────────────┘
 */

import { useMemo } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Loader2, Snowflake, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import {
  ADDRESS_ANALYSIS_STAGES,
  type AddressAnalysis,
  type AddressAnalysisStage,
  type WalletAnalysisRun,
  type WalletDraft,
} from '@chainsight/shared-types';

export interface WalletAnalysisPanelProps {
  draft: WalletDraft;
  run: WalletAnalysisRun;
  onBack: () => void;
  onGenerateReport: () => void;
  onPromoteAddress: (rawAddress: string) => void;
}

export function WalletAnalysisPanel({
  draft,
  run,
  onBack,
  onGenerateReport,
  onPromoteAddress,
}: WalletAnalysisPanelProps) {
  const isComplete = run.status === 'complete';
  const flagged = useMemo(() => {
    return [...run.per_address]
      .filter((a) => a.flag)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [run.per_address]);

  const finishedCount = run.per_address.filter((a) => a.stage === 'ready' || a.stage === 'failed').length;
  const progressPct = run.per_address.length
    ? Math.round((finishedCount / run.per_address.length) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="px-6 py-3 border-b border-context-100 flex items-center gap-3 bg-white">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-[12px] text-context-600 hover:text-context-900"
        >
          <ArrowLeft className="size-3.5" /> Back to intake
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-context-900 truncate">{draft.name}</div>
          <div className="text-[11px] text-context-500 truncate">
            {draft.source} · {draft.addresses.length} addresses · {progressPct}% analyzed
          </div>
        </div>
        <StatusChip status={run.status} />
        <button
          type="button"
          onClick={onGenerateReport}
          disabled={!isComplete}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded bg-markup-600 text-white hover:bg-markup-700 disabled:bg-context-200 disabled:cursor-not-allowed"
        >
          <FileText className="size-3.5" /> Wallet History Analysis Report
        </button>
      </header>

      {/* Body grid */}
      <div className="flex-1 grid grid-cols-[1fr_360px] min-h-0">
        {/* Per-address rows */}
        <section className="overflow-y-auto p-4 space-y-1.5">
          {run.per_address.map((a) => (
            <AddressRow key={a.raw_address} analysis={a} />
          ))}
        </section>

        {/* Flagged sidebar */}
        <aside className="border-l border-context-100 bg-context-50/40 overflow-y-auto">
          <div className="px-4 py-3 border-b border-context-100 flex items-center gap-2 sticky top-0 bg-context-50/95 backdrop-blur">
            <Sparkles className="size-3.5 text-elevated-600" />
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-context-700">
              Flagged for review
            </h3>
            <span className="ml-auto text-[10px] text-context-500">{flagged.length}</span>
          </div>
          {flagged.length === 0 ? (
            <div className="px-4 py-6 text-[12px] text-context-500 italic">
              No addresses flagged yet. The composite-score pass runs after history + attribution.
            </div>
          ) : (
            <div className="divide-y divide-context-100">
              {flagged.map((a) => (
                <FlagRow key={a.raw_address} analysis={a} onPromote={onPromoteAddress} />
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Aggregate summary footer */}
      {run.aggregate && (
        <footer className="border-t border-context-100 px-6 py-3 bg-white grid grid-cols-5 gap-4 text-[11px]">
          <Stat label="Analyzed" value={`${run.aggregate.addresses_analyzed} / ${draft.addresses.length}`} />
          <Stat label="Total inflow" value={run.aggregate.total_inflow_fiat_display} />
          <Stat label="Total outflow" value={run.aggregate.total_outflow_fiat_display} />
          <Stat label="Current balance" value={run.aggregate.current_balance_fiat_display} />
          <Stat
            label="Findings"
            value={`${run.aggregate.flagged_address_count} flagged · ${run.aggregate.obfuscation_finding_count} obf hits`}
          />
        </footer>
      )}
    </div>
  );
}

// ---------- subcomponents ----------

function StatusChip({ status }: { status: WalletAnalysisRun['status'] }) {
  const map = {
    not_run: { label: 'Not run', cls: 'bg-context-100 text-context-700' },
    running: { label: 'Running', cls: 'bg-markup-100 text-markup-700' },
    complete: { label: 'Complete', cls: 'bg-clean-100 text-clean-700' },
    partial: { label: 'Partial', cls: 'bg-caution-100 text-caution-700' },
    failed: { label: 'Failed', cls: 'bg-taint-100 text-taint-700' },
  } as const;
  const m = map[status];
  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase', m.cls)}>
      {status === 'running' && <Loader2 className="size-3 animate-spin" />}
      {status === 'complete' && <CheckCircle2 className="size-3" />}
      {m.label}
    </span>
  );
}

function AddressRow({ analysis }: { analysis: AddressAnalysis }) {
  const stageMeta = ADDRESS_ANALYSIS_STAGES.find((s) => s.id === analysis.stage);
  const isTerminal = analysis.stage === 'ready' || analysis.stage === 'failed';
  return (
    <div
      className={clsx(
        'rounded border px-3 py-2 transition',
        analysis.stage === 'failed'
          ? 'border-taint-200 bg-taint-50/30'
          : analysis.stage === 'ready'
          ? 'border-clean-200 bg-clean-50/30'
          : 'border-context-100 bg-white',
      )}
    >
      <div className="flex items-center gap-3">
        <span className={clsx('size-2 rounded-full shrink-0', chainDot(analysis.chain))} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-[12px] font-mono text-context-900 truncate">
              {truncateAddress(analysis.raw_address)}
            </code>
            {analysis.label_from_source && (
              <span className="text-[10px] text-context-500 truncate">{analysis.label_from_source}</span>
            )}
            <span className="ml-auto text-[10px] uppercase tracking-wide font-semibold text-context-600">
              {analysis.chain}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <StageChip stage={analysis.stage} />
            {!isTerminal && (
              <div className="flex-1 h-1 rounded-full bg-context-100 overflow-hidden">
                <div
                  className="h-full bg-markup-500 transition-all duration-300"
                  style={{ width: `${Math.round(analysis.progress * 100)}%` }}
                />
              </div>
            )}
            {analysis.message && (
              <span className="text-[10px] text-context-500 truncate">{analysis.message}</span>
            )}
          </div>
          {analysis.summary && (
            <div className="mt-2 grid grid-cols-4 gap-3 text-[10px] text-context-600">
              <span><span className="text-context-400">tx</span> {analysis.summary.tx_count}</span>
              <span><span className="text-context-400">in</span> {analysis.summary.total_inflow_display}</span>
              <span><span className="text-context-400">out</span> {analysis.summary.total_outflow_display}</span>
              <span><span className="text-context-400">bal</span> {analysis.summary.current_balance_display}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageChip({ stage }: { stage: AddressAnalysisStage }) {
  const cls = stage === 'ready'
    ? 'bg-clean-100 text-clean-700'
    : stage === 'failed'
    ? 'bg-taint-100 text-taint-700'
    : stage === 'queued'
    ? 'bg-context-100 text-context-600'
    : 'bg-markup-100 text-markup-700';
  const meta = ADDRESS_ANALYSIS_STAGES.find((s) => s.id === stage);
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded', cls)}>
      {stage === 'ready' ? <CheckCircle2 className="size-3" />
        : stage === 'failed' ? <AlertTriangle className="size-3" />
        : stage === 'queued' ? <Snowflake className="size-3" />
        : <Loader2 className="size-3 animate-spin" />}
      {meta?.label ?? stage}
    </span>
  );
}

function FlagRow({
  analysis,
  onPromote,
}: {
  analysis: AddressAnalysis;
  onPromote: (raw: string) => void;
}) {
  if (!analysis.flag) return null;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-bold tabular-nums text-context-900">
          {Math.round(analysis.score ?? 0)}
        </span>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-elevated-700 truncate">
          {analysis.flag.label}
        </span>
      </div>
      <code className="text-[11px] font-mono text-context-900 block truncate">
        {truncateAddress(analysis.raw_address)}
      </code>
      <p className="text-[11px] text-context-600 mt-1 leading-snug">{analysis.flag.rationale}</p>
      <button
        type="button"
        onClick={() => onPromote(analysis.raw_address)}
        className="mt-2 text-[10px] font-semibold text-markup-700 hover:underline"
      >
        Promote to BeliefAtom →
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-context-500">{label}</div>
      <div className="text-[13px] font-semibold text-context-900 tabular-nums">{value}</div>
    </div>
  );
}

function chainDot(chain: string): string {
  switch (chain) {
    case 'eth': return 'bg-markup-500';
    case 'btc': return 'bg-elevated-500';
    case 'sol': return 'bg-privacy-500';
    case 'tron': return 'bg-taint-500';
    default: return 'bg-context-400';
  }
}

function truncateAddress(addr: string): string {
  if (addr.length <= 22) return addr;
  return `${addr.slice(0, 12)}…${addr.slice(-8)}`;
}
