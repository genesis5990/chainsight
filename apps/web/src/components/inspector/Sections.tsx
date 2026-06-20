'use client';

/**
 * The eight sections that fill the Transaction Inspector popup.
 * Each section gracefully handles its own loading / failed / empty state
 * so the parent can render them all unconditionally while data streams in.
 *
 * Spec: docs/chainsight_v0_5_addendum_3.md §8.2
 */

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  Eye,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type {
  ActionSuggestion,
  CaseContextEntry,
  CounterpartyEntry,
  CriticNote,
  DecodedAction,
  KeyValueRow,
  ObfuscationFinding,
  PlainLanguageSummary,
  SectionMeta,
} from './types';
import {
  bareAddress,
  copyToClipboard,
  riskClasses,
  riskLabel,
  truncate,
} from './utils';

// =====================================================================
// Section shell — title strip + status icon + slot for body
// =====================================================================

interface SectionShellProps {
  index: number;
  title: string;
  meta: SectionMeta;
  children?: ReactNode;
}

export function SectionShell({ index, title, meta, children }: SectionShellProps) {
  return (
    <section className="border-t border-context-100 first:border-t-0">
      <header className="flex items-center gap-2 px-4 py-2.5 bg-context-100/40">
        <span className="text-[10px] font-mono font-semibold text-context-500 tabular-nums w-4">
          {String(index).padStart(2, '0')}
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-context-700 flex-1">
          {title}
        </h3>
        <StatusIcon meta={meta} />
      </header>
      <div className="px-4 py-3">
        {meta.status === 'pending' || meta.status === 'loading' ? (
          <SectionSkeleton />
        ) : meta.status === 'failed' ? (
          <SectionError error={meta.error} />
        ) : meta.status === 'empty' ? (
          <SectionEmpty />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function StatusIcon({ meta }: { meta: SectionMeta }) {
  if (meta.status === 'pending') {
    return <span className="size-2 rounded-full bg-context-100 ring-1 ring-context-500/30" />;
  }
  if (meta.status === 'loading') {
    return <Loader2 className="size-3.5 text-elevated-500 animate-spin" />;
  }
  if (meta.status === 'ready') {
    return (
      <span
        className="flex items-center gap-1 text-[10px] font-mono text-clean-700"
        title={meta.landed_at_ms ? `${meta.landed_at_ms}ms` : undefined}
      >
        <Check className="size-3" />
        {meta.landed_at_ms ? `${(meta.landed_at_ms / 1000).toFixed(1)}s` : ''}
      </span>
    );
  }
  if (meta.status === 'failed') {
    return <CircleAlert className="size-3.5 text-taint-500" />;
  }
  return <span className="size-2 rounded-full bg-context-100" />;
}

function SectionSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 rounded bg-context-100 w-3/4" />
      <div className="h-3 rounded bg-context-100 w-1/2" />
    </div>
  );
}

function SectionError({ error }: { error?: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-taint-700 bg-taint-100/60 border border-taint-100 rounded px-3 py-2">
      <CircleAlert className="size-4 shrink-0 mt-0.5" />
      <span>{error ?? 'This section failed to load. Retrying in 5s…'}</span>
    </div>
  );
}

function SectionEmpty() {
  return (
    <div className="text-xs text-context-500 italic">Nothing to surface for this section.</div>
  );
}

// =====================================================================
// Section 1 — Plain-language summary
// =====================================================================

export function SummarySection({ data }: { data: PlainLanguageSummary }) {
  return (
    <div className="text-[13px] leading-relaxed text-context-700">
      <p>{data.paragraph}</p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-context-500">
        {data.verifier_passed ? (
          <span className="inline-flex items-center gap-1 text-clean-700">
            <CircleCheck className="size-3" /> Verified by Verifier Agent
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-elevated-700">
            <AlertTriangle className="size-3" /> Awaiting Verifier
          </span>
        )}
        <span>·</span>
        <span>{data.belief_atoms_referenced.length} BeliefAtoms cited</span>
      </div>
    </div>
  );
}

// =====================================================================
// Section 2 — Structured facts (key/value table)
// =====================================================================

export function StructuredFactsSection({
  rows,
  onPivotAddress,
}: {
  rows: KeyValueRow[];
  onPivotAddress?: (address: string) => void;
}) {
  return (
    <dl className="divide-y divide-context-100 text-[12px]">
      {rows.map((row, i) => (
        <div key={`${row.field}-${i}`} className="grid grid-cols-[140px_1fr] gap-3 py-1.5">
          <dt className="text-context-500 font-medium">{row.field}</dt>
          <dd className="text-context-700 font-mono break-all flex items-center gap-1.5 group">
            <span>
              {row.value}
              {row.note && <span className="ml-1 italic text-context-500">{row.note}</span>}
            </span>
            {row.copyable_full && (
              <CopyButton value={row.copyable_full} />
            )}
            {row.pivot_to_address && onPivotAddress && (
              <button
                type="button"
                onClick={() => onPivotAddress(row.pivot_to_address!)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-markup-500 hover:text-markup-700"
                title="Pivot canvas to this address"
              >
                <Eye className="size-3" />
              </button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-context-500 hover:text-context-700"
      title={copied ? 'Copied' : 'Copy full value'}
    >
      {copied ? <Check className="size-3 text-clean-700" /> : <Copy className="size-3" />}
    </button>
  );
}

// =====================================================================
// Section 3 — Decoded action (discriminated union)
// =====================================================================

export function DecodedActionSection({ action }: { action: DecodedAction }) {
  switch (action.kind) {
    case 'swap':
      return <DecodedSwapView a={action} />;
    case 'bridge':
      return <DecodedBridgeView a={action} />;
    case 'transfer':
      return <DecodedTransferView a={action} />;
    case 'utxo_spend':
      return <DecodedUtxoView a={action} />;
    case 'contract_call':
      return <DecodedContractCallView a={action} />;
    case 'nft_op':
      return <DecodedNftView a={action} />;
    case 'approve':
      return <DecodedApproveView a={action} />;
    case 'mint':
    case 'burn':
      return <DecodedMintBurnView a={action} />;
    case 'other':
      return <DecodedOtherView a={action} />;
  }
}

function ActionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-markup-700 bg-markup-100 px-2 py-0.5 rounded">
      <Sparkles className="size-3" /> {children}
    </div>
  );
}

function KV({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-[12px]">
      <span className="text-context-500">{label}</span>
      <span className={cn('text-context-700', mono && 'font-mono break-all')}>{value}</span>
    </div>
  );
}

function DecodedSwapView({ a }: { a: import('./types').DecodedSwap }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ActionLabel>Token swap</ActionLabel>
        <span className="text-[11px] text-context-500">{a.protocol}</span>
      </div>

      <div className="rounded-md bg-context-100/50 px-3 py-2 space-y-1.5">
        <KV label="Function" value={`${a.router_function}${a.command ? ` (${a.command})` : ''}`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-md border border-context-100 px-3 py-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-context-500">In</div>
          <div className="text-sm font-mono">
            {a.token_in.amount} {a.token_in.symbol}
          </div>
          {a.token_in.fiat_value && (
            <div className="text-[11px] text-context-500">{a.token_in.fiat_value}</div>
          )}
        </div>
        <div className="rounded-md border border-context-100 px-3 py-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-context-500">Out</div>
          <div className="text-sm font-mono">
            {a.token_out.amount} {a.token_out.symbol}
          </div>
          {a.token_out.fiat_value && (
            <div className="text-[11px] text-context-500">{a.token_out.fiat_value}</div>
          )}
        </div>
      </div>

      {a.path.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-context-500 mb-1">Path</div>
          <ol className="space-y-1">
            {a.path.map((hop, i) => (
              <li
                key={i}
                className="flex items-center gap-2 text-[12px] font-mono text-context-700"
              >
                <span>{hop.from_symbol}</span>
                <ArrowRight className="size-3 text-context-500" />
                <span>{hop.to_symbol}</span>
                <span className="text-context-500">· {hop.pool_label}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <KV label="Eff. rate" value={a.effective_rate} />
        {a.spot_rate_at_block && <KV label="Spot @ block" value={a.spot_rate_at_block} />}
        {a.slippage_pct !== undefined && (
          <KV label="Slippage" value={`${a.slippage_pct.toFixed(2)}%`} />
        )}
        <KV
          label="Gas fee"
          value={`${a.fee_breakdown.gas_fee.amount} ${a.fee_breakdown.gas_fee.symbol}${a.fee_breakdown.gas_fee_fiat ? ` (${a.fee_breakdown.gas_fee_fiat})` : ''}`}
        />
      </div>
    </div>
  );
}

function DecodedBridgeView({ a }: { a: import('./types').DecodedBridge }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ActionLabel>Bridge</ActionLabel>
        <span className="text-[11px] text-context-500">{a.protocol}</span>
      </div>
      <div className="flex items-center gap-2 text-sm font-mono">
        <span>{a.source_chain}</span>
        <ArrowRight className="size-4 text-context-500" />
        <span>{a.destination_chain}</span>
      </div>
      <KV label="Asset" value={`${a.token.amount} ${a.token.symbol}`} />
      <KV label="Status" value={a.status} />
      {a.message_id && <KV label="Message ID" value={truncate(a.message_id, 10, 8)} />}
    </div>
  );
}

function DecodedTransferView({ a }: { a: import('./types').DecodedTransfer }) {
  return (
    <div className="space-y-2">
      <ActionLabel>Transfer</ActionLabel>
      <KV label="Asset" value={`${a.asset.amount} ${a.asset.symbol}`} />
      <KV label="From" value={truncate(bareAddress(a.from), 10, 6)} />
      <KV label="To" value={truncate(bareAddress(a.to), 10, 6)} />
    </div>
  );
}

function DecodedContractCallView({ a }: { a: import('./types').DecodedContractCall }) {
  return (
    <div className="space-y-2">
      <ActionLabel>Contract call</ActionLabel>
      <KV
        label="Contract"
        value={`${a.contract_label ?? '—'} (${truncate(bareAddress(a.contract), 6, 4)})`}
      />
      <KV label="Function" value={a.function_signature} />
      {a.decoded_args.length > 0 && (
        <div className="mt-1">
          <div className="text-[10px] uppercase tracking-wider text-context-500 mb-1">Args</div>
          <ul className="space-y-0.5">
            {a.decoded_args.map((arg, i) => (
              <li key={i} className="text-[11px] font-mono text-context-700 break-all">
                <span className="text-context-500">
                  {arg.name} ({arg.type}):
                </span>{' '}
                {arg.value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DecodedUtxoView({ a }: { a: import('./types').DecodedUtxoSpend }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ActionLabel>UTXO spend</ActionLabel>
        <span className="text-[11px] text-context-500">{a.tx_type}</span>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-context-500 mb-1">
          Inputs ({a.inputs.length})
        </div>
        <ul className="space-y-0.5 font-mono text-[11px]">
          {a.inputs.map((inp, i) => (
            <li key={i} className="flex justify-between gap-2 text-context-700">
              <span>{truncate(bareAddress(inp.address), 8, 6)}</span>
              <span>
                {inp.amount.amount} {inp.amount.symbol}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-context-500 mb-1">
          Outputs ({a.outputs.length})
        </div>
        <ul className="space-y-0.5 font-mono text-[11px]">
          {a.outputs.map((out, i) => (
            <li key={i} className="flex justify-between gap-2 text-context-700">
              <span className="flex items-center gap-1">
                {truncate(bareAddress(out.address), 8, 6)}
                {out.classification === 'likely_change' && (
                  <span className="text-[9px] uppercase tracking-wider text-context-500">
                    change
                  </span>
                )}
              </span>
              <span>
                {out.amount.amount} {out.amount.symbol}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[12px]">
        <KV label="Fee" value={`${a.fee.amount} ${a.fee.symbol}`} />
        <KV label="Fee rate" value={`${a.fee_rate_sat_vb} sat/vB`} />
        <KV label="vBytes" value={String(a.vbytes)} />
        <KV label="Confirmations" value={String(a.confirmations)} />
      </div>
    </div>
  );
}

function DecodedNftView({ a }: { a: import('./types').DecodedNftOp }) {
  return (
    <div className="space-y-2">
      <ActionLabel>NFT {a.operation}</ActionLabel>
      <KV label="Collection" value={a.collection} />
      <KV label="Token ID" value={a.token_id} />
      {a.price && <KV label="Price" value={`${a.price.amount} ${a.price.symbol}`} />}
    </div>
  );
}

function DecodedApproveView({ a }: { a: import('./types').DecodedApprove }) {
  return (
    <div className="space-y-2">
      <ActionLabel>Approve</ActionLabel>
      <KV label="Spender" value={truncate(bareAddress(a.spender), 10, 6)} />
      <KV label="Amount" value={a.is_unlimited ? 'UNLIMITED' : `${a.token.amount} ${a.token.symbol}`} />
      {a.is_unlimited && (
        <div className="text-[11px] text-elevated-700 bg-elevated-100/60 px-2 py-1 rounded">
          ⚠ Unlimited token allowance. Common phishing surface.
        </div>
      )}
    </div>
  );
}

function DecodedMintBurnView({
  a,
}: {
  a: import('./types').DecodedMintBurn;
}) {
  return (
    <div className="space-y-2">
      <ActionLabel>{a.kind === 'mint' ? 'Mint' : 'Burn'}</ActionLabel>
      <KV label="Amount" value={`${a.token.amount} ${a.token.symbol}`} />
      <KV label="Authority" value={truncate(bareAddress(a.authority), 10, 6)} />
    </div>
  );
}

function DecodedOtherView({ a }: { a: import('./types').DecodedOther }) {
  return (
    <div className="space-y-2">
      <ActionLabel>Unknown</ActionLabel>
      <div className="text-[12px] text-context-700">{a.reason}</div>
      <div className="font-mono text-[10px] text-context-500 break-all bg-context-100/50 px-2 py-1 rounded">
        {a.raw_input}
      </div>
    </div>
  );
}

// =====================================================================
// Section 4 — Counterparty intelligence
// =====================================================================

export function CounterpartyIntelSection({ entries }: { entries: CounterpartyEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-xs text-context-500 italic">No counterparties to analyze.</div>;
  }
  return (
    <div className="space-y-2">
      {entries.map((entry, i) => {
        const r = riskClasses(entry.risk);
        return (
          <div
            key={`${entry.address}-${i}`}
            className="rounded-md border border-context-100 px-3 py-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] text-context-700 truncate">
                  {truncate(bareAddress(entry.address), 8, 6)}
                </div>
                <div className="text-[13px] font-medium text-context-700 mt-0.5">
                  {entry.attribution}
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0',
                  r.text,
                  r.bg,
                )}
              >
                <span className={cn('size-1.5 rounded-full', r.dot)} />
                {riskLabel(entry.risk)}
              </span>
            </div>
            {entry.risk_reason && (
              <div className="text-[11px] text-context-500 mt-1">{entry.risk_reason}</div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {entry.sources.map((src, j) => (
                <span
                  key={j}
                  className="text-[10px] font-mono text-context-700 bg-context-100 px-1.5 py-0.5 rounded"
                  title={`${src.label} (confidence ${(src.confidence * 100).toFixed(0)}%)`}
                >
                  {src.provider}
                </span>
              ))}
              {entry.has_provider_disagreement && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-elevated-700 bg-elevated-100 px-1.5 py-0.5 rounded">
                  ⚡ Disagreement
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// Section 5 — Case context
// =====================================================================

export function CaseContextSection({ entries }: { entries: CaseContextEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="text-xs text-context-500 italic">
        No case context yet. This transaction is not part of any active path or wallet analysis.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5">
      {entries.map((entry, i) => (
        <li
          key={i}
          className={cn(
            'text-[12px] leading-relaxed flex items-start gap-2',
            entry.is_important_marker && 'text-markup-700',
          )}
        >
          <span className="text-context-500 shrink-0 mt-0.5">›</span>
          <span className={cn(entry.pivot_target && 'cursor-pointer hover:underline')}>
            {entry.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

// =====================================================================
// Section 6 — Obfuscation findings
// =====================================================================

export function ObfuscationSection({ findings }: { findings: ObfuscationFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-clean-700">
        <CircleCheck className="size-4" /> No obfuscation indicators present.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {findings.map((f) => {
        const tone =
          f.severity === 'alert'
            ? 'border-taint-500/40 bg-taint-100/40 text-taint-700'
            : f.severity === 'warning'
              ? 'border-elevated-500/40 bg-elevated-100/40 text-elevated-700'
              : 'border-context-500/40 bg-context-100/40 text-context-700';
        return (
          <div key={f.id} className={cn('rounded-md border px-3 py-2', tone)}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-[12px] flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                {f.headline}
              </div>
              <span className="font-mono text-[10px] opacity-70 shrink-0">
                conf {f.confidence.toFixed(2)}
              </span>
            </div>
            <p className="text-[11px] mt-1 text-context-700">{f.detail}</p>
            {f.navigate_to && (
              <button
                type="button"
                className="text-[11px] underline mt-1 text-markup-700 hover:text-markup-500"
              >
                Open finding
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// Section 7 — Critic notes
// =====================================================================

export function CriticNotesSection({ notes }: { notes: CriticNote[] }) {
  if (notes.length === 0) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-clean-700">
        <CircleCheck className="size-4" /> Critic has no open challenges on this transaction.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {notes.map((n) => (
        <li
          key={n.id}
          className="rounded-md border border-privacy-500/30 bg-privacy-100/30 px-3 py-2"
        >
          <div className="text-[10px] uppercase tracking-wider text-privacy-700 font-semibold mb-1">
            {n.kind}
            {n.tier_concern && (
              <span className="ml-1 font-mono text-context-500">({n.tier_concern})</span>
            )}
          </div>
          <p className="text-[12px] text-context-700 leading-relaxed">{n.text}</p>
        </li>
      ))}
    </ul>
  );
}

// =====================================================================
// Section 8 — Suggested next actions
// =====================================================================

export function SuggestedActionsSection({
  actions,
  onActionClick,
}: {
  actions: ActionSuggestion[];
  onActionClick?: (action: ActionSuggestion) => void;
}) {
  if (actions.length === 0) {
    return <div className="text-xs text-context-500 italic">No suggested actions.</div>;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {actions.map((a, i) => (
        <button
          key={`${a.kind}-${i}`}
          type="button"
          disabled={!a.enabled}
          onClick={() => onActionClick?.(a)}
          className={cn(
            'flex items-center gap-2 text-left text-[12px] px-2.5 py-1.5 rounded border transition-colors',
            a.enabled
              ? 'border-context-100 hover:border-markup-500 hover:bg-markup-100/40 text-context-700'
              : 'border-context-100 text-context-500 cursor-not-allowed opacity-60',
          )}
          title={a.disabled_reason}
        >
          <span className="text-base leading-none">{a.icon}</span>
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// Shared icons re-export for the host component
export { ExternalLink, X };
