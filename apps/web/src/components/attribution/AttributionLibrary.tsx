'use client';

/**
 * Surface 8 — Personal Attribution Library (F25).
 *
 * Layout:
 *   <Topbar/>
 *   <KpiStrip/>
 *   ┌──────────────┬──────────────────────────────┬─────────────────┐
 *   │ Filters      │ Library list (rows)          │ Incoming shares │
 *   │ (sidebar)    │                              │ (right rail)    │
 *   │              │                              │                 │
 *   └──────────────┴──────────────────────────────┴─────────────────┘
 *
 * Click any row → opens AttributionDetail drawer (480px slide-in).
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, Bookmark, CheckCircle2, ChevronDown, Clock, Copy, Download,
  Edit3, Eye, FileText, Filter, Layers, Library, Link2, MessageSquarePlus,
  RefreshCw, Search, Share2, ShieldX, Tag, Trash2, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  ATTRIBUTION_CATEGORIES, BASIS_META, VISIBILITY_META,
  type AttributionBasis, type AttributionCategory, type AttributionLibrarySnapshot,
  type AttributionVisibility, type IncomingShare, type PersonalAttribution,
} from '@chainsight/shared-types';

interface Props {
  snapshot: AttributionLibrarySnapshot;
}

type SortKey = 'recency' | 'confidence' | 'use_count' | 'created' | 'label';

export function AttributionLibrary({ snapshot }: Props) {
  const [search, setSearch] = useState('');
  const [chainFilter, setChainFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<AttributionCategory | null>(null);
  const [basisFilter, setBasisFilter] = useState<AttributionBasis | null>(null);
  const [visibilityFilter, setVisibilityFilter] = useState<AttributionVisibility | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recency');
  const [selected, setSelected] = useState<PersonalAttribution | null>(null);
  const [shareModal, setShareModal] = useState<IncomingShare | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = snapshot.attributions.filter((a) => {
      if (chainFilter && a.target.chain !== chainFilter) return false;
      if (categoryFilter && a.category !== categoryFilter) return false;
      if (basisFilter && a.basis !== basisFilter) return false;
      if (visibilityFilter && a.visibility !== visibilityFilter) return false;
      if (q && !(
        a.label.toLowerCase().includes(q)
        || a.description.toLowerCase().includes(q)
        || a.target.canonical.toLowerCase().includes(q)
      )) return false;
      return true;
    });
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'confidence': return b.confidence - a.confidence;
        case 'use_count':  return b.use_count - a.use_count;
        case 'created':    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'label':      return a.label.localeCompare(b.label);
        case 'recency':
        default:           return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
      }
    });
    return arr;
  }, [snapshot.attributions, search, chainFilter, categoryFilter, basisFilter, visibilityFilter, sortKey]);

  return (
    <div className="min-h-screen bg-context-50">
      <Topbar snapshot={snapshot} />
      <KpiStrip kpi={snapshot.kpi} />

      <main className="max-w-[1480px] mx-auto px-6 pb-8">
        <div className="grid grid-cols-[220px_1fr_360px] gap-5 items-start">
          {/* Filters */}
          <FilterSidebar
            search={search} setSearch={setSearch}
            chain={chainFilter} setChain={setChainFilter}
            category={categoryFilter} setCategory={setCategoryFilter}
            basis={basisFilter} setBasis={setBasisFilter}
            visibility={visibilityFilter} setVisibility={setVisibilityFilter}
            sort={sortKey} setSort={setSortKey}
            counts={snapshot.kpi}
          />

          {/* List */}
          <section className="rounded border border-context-200 bg-white">
            <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
              <Library className="size-4 text-context-700" />
              <h2 className="text-[13px] font-semibold text-context-900">My Attributions</h2>
              <span className="text-[11px] text-context-500">
                {filtered.length} of {snapshot.attributions.length} shown
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-context-200 text-context-700 hover:bg-context-50"
                >
                  <Download className="size-3" /> Export
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-markup-600 text-white hover:bg-markup-700"
                >
                  <Tag className="size-3" /> New attribution
                </button>
              </div>
            </header>
            <div className="divide-y divide-context-100">
              {filtered.length === 0 ? (
                <div className="px-4 py-10 text-center text-[12px] text-context-500 italic">
                  No attributions match the current filters.
                </div>
              ) : filtered.map((a) => (
                <AttributionRow
                  key={a.id}
                  attribution={a}
                  onClick={() => setSelected(a)}
                />
              ))}
            </div>
          </section>

          {/* Incoming shares */}
          <IncomingSharesPanel
            shares={snapshot.incoming_shares}
            onOpen={(s) => setShareModal(s)}
          />
        </div>
      </main>

      {selected && (
        <AttributionDetail
          attribution={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {shareModal && (
        <IncomingShareModal
          share={shareModal}
          onClose={() => setShareModal(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// Topbar
// ============================================================

function Topbar({ snapshot }: { snapshot: AttributionLibrarySnapshot }) {
  return (
    <header className="h-14 border-b border-context-200 bg-white sticky top-0 z-30 flex items-center px-6 gap-4">
      <div className="flex items-center gap-2">
        <Bookmark className="size-5 text-context-700" />
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold text-context-900">My Attributions</h1>
          <span className="text-[11px] text-context-500">Surface 8 · v0.6 F25</span>
        </div>
      </div>
      <div className="ml-auto flex items-center gap-3 text-[11px] text-context-600">
        <span className="text-context-500">Signed in:</span>
        <span className="font-semibold text-context-900">{snapshot.user_name}</span>
        <span className="text-context-500">·</span>
        <span>{snapshot.user_role}</span>
      </div>
    </header>
  );
}

// ============================================================
// KPI strip
// ============================================================

function KpiStrip({ kpi }: { kpi: AttributionLibrarySnapshot['kpi'] }) {
  const tiles = [
    { label: 'Total attributions',  value: kpi.total },
    { label: 'Private',              value: kpi.private },
    { label: 'Shared out',           value: kpi.shared_out },
    { label: 'Accepted by others',   value: kpi.accepted_by_others },
    { label: 'Cases touched',        value: kpi.cases_touched },
    { label: 'Incoming · pending',   value: kpi.incoming_pending, accent: 'markup' as const },
    { label: 'Disagreements',        value: kpi.disagreements, accent: 'taint' as const },
  ];
  return (
    <section className="max-w-[1480px] mx-auto px-6 pt-5 pb-4">
      <div className="grid grid-cols-7 gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={clsx(
              'rounded border bg-white px-3 py-2.5',
              t.accent === 'taint' ? 'border-taint-200' :
              t.accent === 'markup' ? 'border-markup-200' :
              'border-context-200',
            )}
          >
            <div className="text-[10px] uppercase tracking-wide font-semibold text-context-500">{t.label}</div>
            <div className={clsx(
              'text-xl font-semibold tabular-nums mt-0.5',
              t.accent === 'taint' && t.value > 0 ? 'text-taint-700' :
              t.accent === 'markup' && t.value > 0 ? 'text-markup-700' :
              'text-context-900',
            )}>
              {t.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ============================================================
// Filter sidebar
// ============================================================

function FilterSidebar({
  search, setSearch,
  chain, setChain,
  category, setCategory,
  basis, setBasis,
  visibility, setVisibility,
  sort, setSort,
  counts: _counts,
}: {
  search: string; setSearch: (v: string) => void;
  chain: string | null; setChain: (v: string | null) => void;
  category: AttributionCategory | null; setCategory: (v: AttributionCategory | null) => void;
  basis: AttributionBasis | null; setBasis: (v: AttributionBasis | null) => void;
  visibility: AttributionVisibility | null; setVisibility: (v: AttributionVisibility | null) => void;
  sort: SortKey; setSort: (s: SortKey) => void;
  counts: AttributionLibrarySnapshot['kpi'];
}) {
  return (
    <aside className="rounded border border-context-200 bg-white p-3 sticky top-[72px]">
      <div className="flex items-center gap-1.5 mb-2">
        <Filter className="size-3.5 text-context-700" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-context-700">Filter</h3>
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="size-3.5 text-context-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search label or address…"
          className="w-full text-[12px] pl-7 pr-2 py-1.5 rounded border border-context-200 focus:outline-none focus:border-markup-500"
        />
      </div>

      <FilterGroup label="Chain">
        <FilterChip active={chain === null} onClick={() => setChain(null)}>any</FilterChip>
        {(['eth', 'btc', 'sol', 'tron'] as const).map((c) => (
          <FilterChip key={c} active={chain === c} onClick={() => setChain(chain === c ? null : c)}>{c}</FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="Category">
        <FilterChip active={category === null} onClick={() => setCategory(null)}>any</FilterChip>
        {ATTRIBUTION_CATEGORIES.filter((c) => c.id !== 'custom').slice(0, 9).map((c) => (
          <FilterChip
            key={c.id}
            active={category === c.id}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            {c.label}
          </FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="Basis">
        <FilterChip active={basis === null} onClick={() => setBasis(null)}>any</FilterChip>
        {(Object.keys(BASIS_META) as AttributionBasis[]).map((b) => (
          <FilterChip
            key={b}
            active={basis === b}
            onClick={() => setBasis(basis === b ? null : b)}
          >
            {BASIS_META[b].label}
          </FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="Visibility">
        <FilterChip active={visibility === null} onClick={() => setVisibility(null)}>any</FilterChip>
        {(Object.keys(VISIBILITY_META) as AttributionVisibility[]).map((v) => (
          <FilterChip
            key={v}
            active={visibility === v}
            onClick={() => setVisibility(visibility === v ? null : v)}
          >
            {VISIBILITY_META[v].short}
          </FilterChip>
        ))}
      </FilterGroup>

      <FilterGroup label="Sort by">
        {(['recency', 'confidence', 'use_count', 'created', 'label'] as const).map((s) => (
          <FilterChip
            key={s}
            active={sort === s}
            onClick={() => setSort(s)}
          >
            {sortLabel(s)}
          </FilterChip>
        ))}
      </FilterGroup>
    </aside>
  );
}

function sortLabel(s: SortKey): string {
  switch (s) {
    case 'recency': return 'Recency';
    case 'confidence': return 'Confidence';
    case 'use_count': return 'Use count';
    case 'created': return 'Created';
    case 'label': return 'Label A-Z';
  }
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'text-[10px] px-1.5 py-0.5 rounded border transition',
        active
          ? 'bg-markup-600 border-markup-600 text-white font-semibold'
          : 'bg-white border-context-200 text-context-700 hover:bg-context-50',
      )}
    >
      {children}
    </button>
  );
}

// ============================================================
// Attribution row
// ============================================================

function AttributionRow({
  attribution,
  onClick,
}: {
  attribution: PersonalAttribution;
  onClick: () => void;
}) {
  const cat = ATTRIBUTION_CATEGORIES.find((c) => c.id === attribution.category);
  const basisMeta = BASIS_META[attribution.basis];
  const visMeta = VISIBILITY_META[attribution.visibility];
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-4 py-3 hover:bg-context-50/50 transition flex items-start gap-3"
    >
      {/* Color + icon swatch */}
      <div
        className="size-9 rounded flex items-center justify-center shrink-0 text-lg"
        style={{
          backgroundColor: attribution.display_color ?? '#6b7280',
          color: 'white',
        }}
      >
        <span>{attribution.display_icon ?? '·'}</span>
      </div>

      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[13px] font-semibold text-context-900 truncate">{attribution.label}</span>
          {attribution.has_disagreement && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-taint-700 bg-taint-50 px-1.5 py-0.5 rounded">
              <AlertTriangle className="size-3" /> Disagreement
            </span>
          )}
        </div>

        {/* Target row */}
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-context-500 font-semibold">{attribution.target.chain}</span>
          <code className="text-[11px] font-mono text-context-700 truncate">{attribution.target.display}</code>
          <span className="text-[10px] text-context-400">·</span>
          <span className="text-[10px] text-context-500 capitalize">{attribution.target.kind.replace('_', ' ')}</span>
        </div>

        {/* Chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {cat && (
            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded', cat.chip_cls)}>
              {attribution.category === 'custom' && attribution.custom_category ? attribution.custom_category : cat.label}
            </span>
          )}
          <ConfidenceDots value={attribution.confidence} />
          <span className="text-[10px] text-context-600 inline-flex items-center gap-1">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-context-100 text-context-700 font-semibold">
              {basisMeta.tier}
            </span>
            {basisMeta.label}
          </span>
          <VisibilityChip visibility={attribution.visibility} />
        </div>

        {/* Description excerpt */}
        <p className="text-[11px] text-context-600 line-clamp-2 mt-1.5 leading-snug">{attribution.description}</p>
      </div>

      {/* Right meta */}
      <div className="shrink-0 text-right text-[10px] text-context-500 space-y-1 w-[120px]">
        <div className="inline-flex items-center gap-1 text-context-700">
          <Clock className="size-3" />
          {relativeTime(attribution.last_seen_at)}
        </div>
        <div className="inline-flex items-center gap-1">
          <Layers className="size-3" />
          {attribution.use_count} use{attribution.use_count === 1 ? '' : 's'}
        </div>
        <div className="inline-flex items-center gap-1">
          <FileText className="size-3" />
          {attribution.cases_referenced_in.length} case{attribution.cases_referenced_in.length === 1 ? '' : 's'}
        </div>
      </div>
    </button>
  );
}

function ConfidenceDots({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Confidence ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={clsx(
            'size-2 rounded-full',
            i <= value ? 'bg-markup-600' : 'bg-context-200',
          )}
        />
      ))}
    </span>
  );
}

function VisibilityChip({ visibility }: { visibility: AttributionVisibility }) {
  const meta = VISIBILITY_META[visibility];
  const cls = visibility === 'private' ? 'bg-context-100 text-context-700'
    : visibility === 'shared_with_users' ? 'bg-markup-100 text-markup-800'
    : visibility === 'shared_with_team' ? 'bg-markup-100 text-markup-800'
    : visibility === 'shared_with_org' ? 'bg-clean-100 text-clean-800'
    : 'bg-privacy-100 text-privacy-800';
  return (
    <span className={clsx('inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded', cls)}>
      {visibility === 'private' ? '🔒' : <Share2 className="size-2.5" />} {meta.short}
    </span>
  );
}

// ============================================================
// Incoming shares panel
// ============================================================

function IncomingSharesPanel({
  shares,
  onOpen,
}: {
  shares: IncomingShare[];
  onOpen: (s: IncomingShare) => void;
}) {
  const pending = shares.filter((s) => s.status === 'pending');
  return (
    <section className="rounded border border-context-200 bg-white sticky top-[72px]">
      <header className="px-4 py-3 flex items-center gap-2 border-b border-context-100">
        <MessageSquarePlus className="size-4 text-context-700" />
        <h2 className="text-[13px] font-semibold text-context-900">Incoming shares</h2>
        <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-markup-100 text-markup-800 text-[10px] font-bold">
          {pending.length}
        </span>
      </header>
      <div className="divide-y divide-context-100 max-h-[680px] overflow-y-auto">
        {pending.length === 0 ? (
          <div className="px-4 py-6 text-[12px] text-context-500 italic">No pending shares.</div>
        ) : pending.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s)}
            className="w-full text-left px-4 py-3 hover:bg-context-50/50 transition"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="size-6 rounded-full bg-markup-100 text-markup-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                {initials(s.shared_by_name)}
              </div>
              <span className="text-[12px] font-semibold text-context-900 truncate">{s.shared_by_name}</span>
              <span className="ml-auto text-[10px] text-context-500">{relativeTime(s.shared_at)}</span>
            </div>
            <div className="text-[12px] font-semibold text-context-800 mb-0.5 line-clamp-1">
              {s.attribution.label}
            </div>
            <code className="block text-[10px] font-mono text-context-600 mb-1.5 truncate">
              {s.attribution.target.display}
            </code>
            <p className="text-[11px] text-context-600 line-clamp-2 leading-snug">{s.attribution.description}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-clean-700 hover:underline">
                <CheckCircle2 className="size-3" /> Accept
              </span>
              <span className="text-context-400 text-[10px]">·</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-context-600 hover:underline">
                <X className="size-3" /> Reject
              </span>
              <span className="text-context-400 text-[10px]">·</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-elevated-700 hover:underline">
                <AlertTriangle className="size-3" /> Counter
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

// ============================================================
// Attribution detail drawer
// ============================================================

function AttributionDetail({
  attribution: a,
  onClose,
}: {
  attribution: PersonalAttribution;
  onClose: () => void;
}) {
  const cat = ATTRIBUTION_CATEGORIES.find((c) => c.id === a.category);
  const basisMeta = BASIS_META[a.basis];
  const visMeta = VISIBILITY_META[a.visibility];
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside className="fixed top-0 right-0 bottom-0 w-[480px] bg-white border-l border-context-200 z-50 shadow-xl flex flex-col">
        {/* Header */}
        <header className="px-4 py-3 border-b border-context-100 flex items-start gap-3">
          <div
            className="size-12 rounded flex items-center justify-center text-2xl shrink-0"
            style={{ backgroundColor: a.display_color ?? '#6b7280', color: 'white' }}
          >
            {a.display_icon ?? '·'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-context-900">{a.label}</div>
            <div className="text-[11px] text-context-500 mt-0.5">
              {a.target.chain.toUpperCase()} · {a.target.kind.replace('_', ' ')}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer" className="text-context-500 hover:text-context-900">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Target canonical */}
          <div className="px-4 py-3 border-b border-context-100">
            <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1">Target</div>
            <div className="flex items-start gap-2">
              <code className="flex-1 text-[12px] font-mono text-context-900 bg-context-50 rounded px-2 py-1.5 break-all">
                {a.target.canonical}
              </code>
              <button type="button" className="text-context-500 hover:text-context-900 p-1" title="Copy">
                <Copy className="size-3.5" />
              </button>
            </div>
          </div>

          {/* Description */}
          <div className="px-4 py-3 border-b border-context-100">
            <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1">Description</div>
            <p className="text-[12px] text-context-800 leading-snug">{a.description}</p>
          </div>

          {/* Category / Confidence / Basis */}
          <div className="px-4 py-3 grid grid-cols-2 gap-3 text-[11px] border-b border-context-100">
            <KV label="Category" value={
              cat ? (
                <span className={clsx('inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded', cat.chip_cls)}>
                  {a.category === 'custom' && a.custom_category ? a.custom_category : cat.label}
                </span>
              ) : null
            } />
            <KV label="Confidence" value={<ConfidenceDots value={a.confidence} />} />
            <KV label="Basis" value={
              <span className="inline-flex items-center gap-1 text-[11px] text-context-800">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-context-100 text-context-700 font-semibold text-[10px]">
                  {basisMeta.tier}
                </span>
                {basisMeta.label}
              </span>
            } />
            <KV label="Visibility" value={<VisibilityChip visibility={a.visibility} />} />
          </div>

          {/* Supporting evidence */}
          {a.supporting_evidence.length > 0 && (
            <div className="px-4 py-3 border-b border-context-100">
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
                Supporting evidence ({a.supporting_evidence.length})
              </div>
              <ul className="space-y-1.5">
                {a.supporting_evidence.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-[11px]">
                    <FileText className="size-3 text-context-500 shrink-0" />
                    <span className="text-context-800">{e.label}</span>
                    <span className="text-[10px] text-context-500 ml-auto capitalize">{e.kind}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cases referenced */}
          {a.cases_referenced_in.length > 0 && (
            <div className="px-4 py-3 border-b border-context-100">
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
                Cases referenced ({a.cases_referenced_in.length})
              </div>
              <ul className="space-y-1.5">
                {a.cases_referenced_in.map((c) => (
                  <li key={c.case_id} className="flex items-center gap-2 text-[11px]">
                    <FileText className="size-3 text-context-500 shrink-0" />
                    <span className="font-semibold text-context-900">{c.case_name}</span>
                    <span className="text-context-500">· {c.case_code}</span>
                    {c.is_primary && (
                      <span className="text-[9px] font-bold uppercase tracking-wide bg-clean-100 text-clean-800 px-1 py-0.5 rounded">PRIMARY</span>
                    )}
                    <span className="text-[10px] text-context-500 ml-auto">{relativeTime(c.last_used_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sharing log */}
          {a.acceptor_log.length > 0 && (
            <div className="px-4 py-3 border-b border-context-100">
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-2">
                Share log ({a.acceptor_log.length})
              </div>
              <ul className="space-y-1.5">
                {a.acceptor_log.map((ev, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    {ev.action === 'accepted'
                      ? <CheckCircle2 className="size-3 text-clean-600 shrink-0" />
                      : ev.action === 'rejected'
                      ? <X className="size-3 text-context-500 shrink-0" />
                      : ev.action === 'counter_attributed'
                      ? <AlertTriangle className="size-3 text-taint-600 shrink-0" />
                      : <Eye className="size-3 text-context-500 shrink-0" />}
                    <span className="text-context-800">{ev.recipient_name}</span>
                    <span className="text-context-500 capitalize">{ev.action.replace('_', '-')}</span>
                    <span className="text-[10px] text-context-500 ml-auto">{relativeTime(ev.at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Lifecycle */}
          <div className="px-4 py-3 grid grid-cols-2 gap-3 text-[11px]">
            <KV label="Created" value={<span className="tabular-nums">{relativeTime(a.created_at)}</span>} />
            <KV label="Updated" value={<span className="tabular-nums">{relativeTime(a.updated_at)}</span>} />
            <KV label="Last seen" value={<span className="tabular-nums">{relativeTime(a.last_seen_at)}</span>} />
            <KV label="Use count" value={<span className="font-semibold tabular-nums">{a.use_count}</span>} />
          </div>
        </div>

        {/* Action footer */}
        <footer className="px-4 py-3 border-t border-context-100 bg-context-50 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <FooterBtn icon={Edit3} label="Edit" />
            <FooterBtn icon={Share2} label="Share / change visibility" />
            <FooterBtn icon={Download} label="Export" />
            <FooterBtn icon={ShieldX} label="Revoke" destructive />
          </div>
          <p className="text-[10px] text-context-500 italic leading-snug">
            Revoking propagates to all recipients with an audit note. Attributions referenced in finalized reports remain
            immutable for the report's lifetime (G5).
          </p>
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

function FooterBtn({
  icon: Icon, label, destructive,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded border bg-white text-left',
        destructive
          ? 'border-taint-200 text-taint-700 hover:bg-taint-50'
          : 'border-context-200 text-context-800 hover:bg-context-50',
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

// ============================================================
// Incoming share modal (Accept / Reject / Counter-attribute)
// ============================================================

function IncomingShareModal({
  share, onClose,
}: {
  share: IncomingShare;
  onClose: () => void;
}) {
  const a = share.attribution;
  const cat = ATTRIBUTION_CATEGORIES.find((c) => c.id === a.category);
  const basisMeta = BASIS_META[a.basis];
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 z-40 bg-black/30" />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] max-h-[90vh] overflow-y-auto bg-white rounded shadow-2xl z-50 border border-context-200">
        <header className="px-5 py-4 border-b border-context-100 flex items-start gap-3">
          <div className="size-10 rounded-full bg-markup-100 text-markup-700 text-[12px] font-bold flex items-center justify-center shrink-0">
            {initials(share.shared_by_name)}
          </div>
          <div className="flex-1">
            <div className="text-[13px] text-context-700">
              <span className="font-semibold text-context-900">{share.shared_by_name}</span> shared an attribution with you.
            </div>
            <div className="text-[11px] text-context-500 mt-0.5">{relativeTime(share.shared_at)}</div>
          </div>
          <button type="button" onClick={onClose} className="text-context-500 hover:text-context-900">
            <X className="size-4" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-3">
            <div
              className="size-10 rounded flex items-center justify-center text-xl shrink-0"
              style={{ backgroundColor: a.display_color ?? '#6b7280', color: 'white' }}
            >
              {a.display_icon ?? '·'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-context-900">{a.label}</div>
              <code className="block text-[11px] font-mono text-context-700 mt-0.5">{a.target.display}</code>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <KV label="Category" value={
              cat ? <span className={clsx('inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded', cat.chip_cls)}>
                {cat.label}
              </span> : null
            } />
            <KV label="Confidence" value={<ConfidenceDots value={a.confidence} />} />
            <KV label="Basis" value={
              <span className="inline-flex items-center gap-1">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-context-100 text-context-700 font-semibold text-[10px]">
                  {basisMeta.tier}
                </span>
                {basisMeta.label}
              </span>
            } />
            <KV label="Sender's case" value={
              a.cases_referenced_in[0]
                ? <span className="text-[11px] font-semibold">{a.cases_referenced_in[0].case_name}</span>
                : <span className="text-context-500 italic">none</span>
            } />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1">Description</div>
            <p className="text-[12px] text-context-800 leading-snug bg-context-50 rounded px-3 py-2">{a.description}</p>
          </div>

          {a.supporting_evidence.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-context-500 font-semibold mb-1">Supporting evidence</div>
              <ul className="space-y-1">
                {a.supporting_evidence.map((e) => (
                  <li key={e.id} className="text-[11px] text-context-800 flex items-center gap-2">
                    <FileText className="size-3 text-context-500 shrink-0" />
                    <span>{e.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-context-100 bg-context-50 flex items-center gap-2">
          <button
            type="button"
            className="text-[12px] font-semibold px-3 py-1.5 rounded border border-context-300 text-context-800 hover:bg-white inline-flex items-center gap-1"
          >
            <Eye className="size-3.5" /> View in canvas
          </button>
          <button
            type="button"
            className="ml-auto text-[12px] font-semibold px-3 py-1.5 rounded border border-context-300 text-context-700 hover:bg-white inline-flex items-center gap-1"
          >
            <X className="size-3.5" /> Reject
          </button>
          <button
            type="button"
            className="text-[12px] font-semibold px-3 py-1.5 rounded border border-elevated-300 text-elevated-800 hover:bg-elevated-50 inline-flex items-center gap-1"
          >
            <AlertTriangle className="size-3.5" /> Counter-attribute
          </button>
          <button
            type="button"
            className="text-[12px] font-semibold px-3 py-1.5 rounded bg-clean-600 text-white hover:bg-clean-700 inline-flex items-center gap-1"
          >
            <CheckCircle2 className="size-3.5" /> Accept
          </button>
        </footer>
      </div>
    </>
  );
}

// ============================================================
// utils
// ============================================================

function initials(name: string): string {
  const parts = name.replace(/[.,]/g, '').split(/\s+/);
  if (parts.length === 0) return '?';
  const last = parts[parts.length - 1] ?? '';
  const first = parts.find((p) => !/^(Det|Lt|Sgt|Capt|Sr|Jr)$/i.test(p)) ?? last;
  return ((first?.[0] ?? '') + (last[0] ?? '')).toUpperCase();
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export const __ATTRIBUTION_INTERNAL__ = { Users, Link2, Trash2, RefreshCw, ChevronDown };
