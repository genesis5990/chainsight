'use client';

/**
 * Provider Marketplace + Model Configuration matrix (Surface 4).
 *
 * Two tabs:
 *   - Providers — grid of catalog entries with install/health state
 *   - Model Configuration — agent role × model dropdown matrix (v0.9 §3.3)
 *
 * Plus the .env-easy paste modal (v0.4 §2.2) for bulk key entry.
 */

import {
  AlertTriangle,
  Check,
  CircleHelp,
  Globe,
  HardDrive,
  KeyRound,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import type {
  AgentRole,
  AgentRoleId,
  EnvParseResult,
  LlmModel,
  LlmModelId,
  ModelAssignment,
  ModelMatrix,
  ProviderCategory,
  ProviderDefinition,
  ProviderInstall,
} from '@chainsight/shared-types';

// =====================================================================
// Top-level shell with tabs
// =====================================================================

export interface MarketplaceProps {
  catalog: ProviderDefinition[];
  installs: ProviderInstall[];
  roles: AgentRole[];
  models: LlmModel[];
  matrix: ModelMatrix;
  /** Demo callbacks — Phase 1 replaces with real mutations. */
  onInstall?: (providerId: string) => void;
  onUninstall?: (installId: string) => void;
  onBulkEnvPaste?: (raw: string) => EnvParseResult;
  onAssignmentChange?: (roleId: AgentRoleId, modelId: LlmModelId | null) => void;
  onBulkSetModels?: (mode: 'reset' | 'local_only' | 'anthropic_only' | 'openai_only') => void;
}

export function Marketplace({
  catalog,
  installs,
  roles,
  models,
  matrix,
  onInstall,
  onUninstall,
  onBulkEnvPaste,
  onAssignmentChange,
  onBulkSetModels,
}: MarketplaceProps) {
  const [tab, setTab] = useState<'providers' | 'models'>('providers');
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<ProviderDefinition | null>(null);

  return (
    <div className="h-screen w-screen flex flex-col bg-context-100/40">
      <header className="h-14 border-b border-context-100 bg-white px-6 flex items-center gap-6 shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] font-semibold text-context-500">
            BYOK marketplace
          </div>
          <div className="text-[14px] font-semibold text-context-700">Providers & Models</div>
        </div>

        <nav className="flex items-center gap-1 ml-4">
          <TabButton active={tab === 'providers'} onClick={() => setTab('providers')}>
            <KeyRound className="size-3.5" /> Providers
          </TabButton>
          <TabButton active={tab === 'models'} onClick={() => setTab('models')}>
            <Sparkles className="size-3.5" /> Model Configuration
          </TabButton>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowKeyEntry(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded border border-context-100 hover:bg-context-100/60 text-context-700"
          >
            <Plus className="size-3.5" /> Bulk paste keys (.env)
          </button>
          <span className="text-[10px] text-context-500">
            {installs.length} of {catalog.length} providers installed
          </span>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">
        {tab === 'providers' ? (
          <ProvidersTab
            catalog={catalog}
            installs={installs}
            onInstallClick={(p) => {
              setPendingProvider(p);
              setShowKeyEntry(true);
            }}
            onUninstall={onUninstall}
          />
        ) : (
          <ModelsTab
            roles={roles}
            models={models}
            matrix={matrix}
            installs={installs}
            onAssignmentChange={onAssignmentChange}
            onBulkSetModels={onBulkSetModels}
          />
        )}
      </main>

      {showKeyEntry && (
        <KeyEntryModal
          catalog={catalog}
          pendingProvider={pendingProvider}
          onParse={onBulkEnvPaste}
          onConfirm={(providerIds) => {
            providerIds.forEach((id) => onInstall?.(id));
            setShowKeyEntry(false);
            setPendingProvider(null);
          }}
          onClose={() => {
            setShowKeyEntry(false);
            setPendingProvider(null);
          }}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-md transition-colors',
        active
          ? 'bg-markup-100/60 text-markup-700'
          : 'text-context-500 hover:bg-context-100/60 hover:text-context-700',
      )}
    >
      {children}
    </button>
  );
}

// =====================================================================
// Providers tab
// =====================================================================

const CATEGORY_LABELS: Record<ProviderCategory, string> = {
  rpc: 'RPC',
  block_explorer: 'Block explorers',
  attribution: 'Attribution',
  osint: 'OSINT',
  market_data: 'Market data',
  historical_price: 'Historical price',
  contract_intelligence: 'Contract intelligence',
  sanctions_screening: 'Sanctions',
  kyc_kyb: 'KYC / KYB',
  subpoena_correspondence: 'Subpoena correspondence',
  llm: 'LLM',
  embedding: 'Embeddings',
  vector_store: 'Vector store',
  object_storage: 'Object storage',
  identity_verification: 'Identity verification',
};

function ProvidersTab({
  catalog,
  installs,
  onInstallClick,
  onUninstall,
}: {
  catalog: ProviderDefinition[];
  installs: ProviderInstall[];
  onInstallClick: (p: ProviderDefinition) => void;
  onUninstall?: (installId: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ProviderCategory | 'all' | 'installed' | 'air_gap'>('all');

  const installsByProvider = useMemo(() => {
    const m = new Map<string, ProviderInstall>();
    for (const i of installs) m.set(i.provider_id, i);
    return m;
  }, [installs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return catalog.filter((p) => {
      if (q && !`${p.name} ${p.vendor} ${p.description}`.toLowerCase().includes(q)) return false;
      if (filter === 'installed' && !installsByProvider.has(p.id)) return false;
      if (filter === 'air_gap' && !p.is_air_gap_capable) return false;
      if (filter !== 'all' && filter !== 'installed' && filter !== 'air_gap' && p.category !== filter)
        return false;
      return true;
    });
  }, [catalog, search, filter, installsByProvider]);

  const grouped = useMemo(() => {
    const g = new Map<ProviderCategory, ProviderDefinition[]>();
    for (const p of filtered) {
      const arr = g.get(p.category) ?? [];
      arr.push(p);
      g.set(p.category, arr);
    }
    return g;
  }, [filtered]);

  return (
    <div className="px-6 py-5">
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-context-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers…"
            className="w-full pl-8 pr-3 py-1.5 text-[12px] rounded border border-context-100 focus:outline-none focus:border-markup-500"
          />
        </div>
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        <FilterChip active={filter === 'installed'} onClick={() => setFilter('installed')}>
          <Check className="size-3" /> Installed
        </FilterChip>
        <FilterChip active={filter === 'air_gap'} onClick={() => setFilter('air_gap')}>
          <Shield className="size-3" /> Air-gap capable
        </FilterChip>
      </div>

      {/* Grouped cards */}
      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([category, providers]) => (
          <section key={category}>
            <h2 className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2.5">
              {CATEGORY_LABELS[category] ?? category}{' '}
              <span className="text-context-500 font-normal">({providers.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {providers.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  install={installsByProvider.get(p.id)}
                  onInstall={() => onInstallClick(p)}
                  onUninstall={() => {
                    const inst = installsByProvider.get(p.id);
                    if (inst) onUninstall?.(inst.id);
                  }}
                />
              ))}
            </div>
          </section>
        ))}
        {filtered.length === 0 && (
          <div className="text-center text-context-500 text-sm italic py-12">
            No providers match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border',
        active
          ? 'border-markup-500 bg-markup-100/60 text-markup-700'
          : 'border-context-100 text-context-700 hover:bg-context-100/60',
      )}
    >
      {children}
    </button>
  );
}

function ProviderCard({
  provider,
  install,
  onInstall,
  onUninstall,
}: {
  provider: ProviderDefinition;
  install?: ProviderInstall;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  const installed = !!install;
  return (
    <article
      className={cn(
        'rounded-lg border bg-white p-3 flex flex-col gap-2 transition-colors',
        installed ? 'border-clean-500/40 ring-1 ring-clean-500/10' : 'border-context-100',
      )}
    >
      <header className="flex items-start gap-2">
        <span className="text-2xl leading-none mt-0.5">{provider.glyph}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-semibold text-context-700 truncate">{provider.name}</h3>
          <p className="text-[10px] text-context-500 truncate">{provider.vendor}</p>
        </div>
        {installed && <HealthDot health={install.health} reason={install.health_reason} />}
      </header>

      <p className="text-[11.5px] text-context-700 leading-snug line-clamp-2">
        {provider.description}
      </p>

      <ul className="flex flex-wrap gap-1">
        {provider.capabilities.slice(0, 4).map((c) => (
          <li
            key={c}
            className="text-[9px] font-mono uppercase tracking-wider text-context-700 bg-context-100 px-1.5 py-0.5 rounded"
          >
            {c}
          </li>
        ))}
        {provider.capabilities.length > 4 && (
          <li className="text-[9px] font-mono text-context-500 px-1">
            +{provider.capabilities.length - 4}
          </li>
        )}
      </ul>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-context-500">
        <span className="inline-flex items-center gap-1">
          <Globe className="size-3" /> {provider.data_residency.join(', ')}
        </span>
        <span className="text-context-100">·</span>
        <span>{provider.pricing_hint ?? PRICING_MODEL_LABEL[provider.pricing_model]}</span>
        {provider.is_air_gap_capable && (
          <>
            <span className="text-context-100">·</span>
            <span className="inline-flex items-center gap-1 text-clean-700">
              <Shield className="size-3" /> air-gap
            </span>
          </>
        )}
        {provider.is_self_hostable && !provider.is_air_gap_capable && (
          <>
            <span className="text-context-100">·</span>
            <span className="inline-flex items-center gap-1 text-markup-700">
              <HardDrive className="size-3" /> self-host
            </span>
          </>
        )}
      </div>

      {installed && (
        <div className="text-[10px] text-context-500 border-t border-context-100 pt-2 mt-1 grid grid-cols-2 gap-1">
          <span>
            calls/mo:{' '}
            <span className="font-mono text-context-700 tabular-nums">
              {install.calls_this_month?.toLocaleString() ?? '—'}
            </span>
          </span>
          <span>
            cost/mo:{' '}
            <span className="font-mono text-context-700">
              {install.cost_this_month_fiat ?? '—'}
            </span>
          </span>
        </div>
      )}

      <div className="mt-auto pt-2 flex items-center gap-2">
        {installed ? (
          <>
            <button
              type="button"
              className="text-[11px] font-medium px-2 py-1 rounded border border-context-100 hover:bg-context-100/60 text-context-700 inline-flex items-center gap-1"
            >
              <Settings2 className="size-3" /> Configure
            </button>
            <button
              type="button"
              onClick={onUninstall}
              className="text-[11px] font-medium px-2 py-1 rounded text-context-500 hover:text-taint-700 ml-auto"
            >
              Remove
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onInstall}
            className="text-[11px] font-semibold px-2.5 py-1 rounded border border-markup-500 bg-markup-100/40 text-markup-700 hover:bg-markup-100/80 inline-flex items-center gap-1"
          >
            <Plus className="size-3" /> Install
          </button>
        )}
      </div>
    </article>
  );
}

function HealthDot({ health, reason }: { health: ProviderInstall['health']; reason?: string }) {
  const tone =
    health === 'green'
      ? 'bg-clean-500'
      : health === 'yellow'
        ? 'bg-elevated-500'
        : health === 'red'
          ? 'bg-taint-500'
          : 'bg-context-500';
  return (
    <span
      className={cn('size-2 rounded-full shrink-0 mt-1.5', tone)}
      title={reason ?? `health: ${health}`}
    />
  );
}

const PRICING_MODEL_LABEL: Record<ProviderDefinition['pricing_model'], string> = {
  usage_metered: 'Usage-metered',
  monthly_seat: 'Monthly seat',
  annual_contract: 'Annual contract',
  free: 'Free',
  self_hosted: 'Self-hosted',
};

// =====================================================================
// Models tab (v0.9 §3.3)
// =====================================================================

function ModelsTab({
  roles,
  models,
  matrix,
  installs,
  onAssignmentChange,
  onBulkSetModels,
}: {
  roles: AgentRole[];
  models: LlmModel[];
  matrix: ModelMatrix;
  installs: ProviderInstall[];
  onAssignmentChange?: (roleId: AgentRoleId, modelId: LlmModelId | null) => void;
  onBulkSetModels?: (mode: 'reset' | 'local_only' | 'anthropic_only' | 'openai_only') => void;
}) {
  const modelById = useMemo(() => {
    const m = new Map<string, LlmModel>();
    for (const x of models) m.set(x.id, x);
    return m;
  }, [models]);

  const assignmentByRole = useMemo(() => {
    const m = new Map<string, ModelAssignment>();
    for (const a of matrix.assignments) m.set(a.role_id, a);
    return m;
  }, [matrix.assignments]);

  // Group models by vendor, filtered to those whose vendor has an install
  // (or is self-hosted — always available).
  const availableModels = useMemo(() => {
    const installedVendors = new Set<string>();
    for (const i of installs) {
      // Look up the catalog entry to get vendor — but we don't pass catalog here.
      // Phase 0 simplification: any vendor with at least one installed provider counts.
      installedVendors.add(i.provider_id);
    }
    return models.filter(
      (m) => m.is_self_hosted || installs.some((i) => providerVendorMatchesModelVendor(i, m)),
    );
  }, [models, installs]);

  return (
    <div className="px-6 py-5 max-w-5xl mx-auto">
      <header className="mb-4">
        <h1 className="text-xl font-semibold text-context-700">Model assignment</h1>
        <p className="text-[12px] text-context-500 mt-1 max-w-2xl">
          Per-role override for the agency. Defaults come from the v0.9 baseline; switching is one
          dropdown per role and takes effect on the next call.
        </p>
      </header>

      <div className="rounded-lg border border-context-100 bg-white overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-context-100/60">
            <tr className="text-left text-context-500 text-[11px] uppercase tracking-wider">
              <th className="py-2 px-4 font-semibold">Agent / role</th>
              <th className="py-2 px-4 font-semibold">Default</th>
              <th className="py-2 px-4 font-semibold">Your assignment</th>
              <th className="py-2 px-4 font-semibold text-right">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-context-100">
            {roles.map((role) => {
              const defaultModel = modelById.get(role.default_model_id);
              const assignment = assignmentByRole.get(role.id);
              const override = assignment?.override_model_id ?? null;
              const effective = override ? modelById.get(override) : defaultModel;
              return (
                <tr key={role.id} className="hover:bg-context-100/30">
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-context-700">{role.display_name}</div>
                    <div className="text-[11px] text-context-500 line-clamp-1">
                      {role.description}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-context-500 font-mono text-[11px]">
                    {defaultModel?.display_name ?? '—'}
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={override ?? ''}
                      onChange={(e) =>
                        onAssignmentChange?.(
                          role.id,
                          (e.target.value || null) as LlmModelId | null,
                        )
                      }
                      className="text-[12px] border border-context-100 rounded px-2 py-1 bg-white text-context-700 min-w-[200px]"
                    >
                      <option value="">Default ({defaultModel?.display_name ?? '—'})</option>
                      {availableModels.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name} {m.is_self_hosted ? '· local' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {effective && <TierChip tier={effective.tier} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cost summary */}
      <section className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-context-100 bg-white px-5 py-4">
          <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2">
            Estimated monthly LLM cost
          </div>
          <div className="text-2xl font-mono font-semibold text-context-700 tabular-nums">
            {matrix.estimated_monthly_cost_fiat}
          </div>
          <p className="text-[11px] text-context-500 mt-1">
            Would be{' '}
            <span className="font-mono text-context-700">{matrix.baseline_all_frontier_fiat}</span>{' '}
            with an all-frontier configuration.
          </p>
        </div>

        <div className="rounded-lg border border-context-100 bg-white px-5 py-4">
          <div className="text-[10px] uppercase tracking-wider font-bold text-context-500 mb-2">
            Bulk actions
          </div>
          <div className="flex flex-wrap gap-2">
            <BulkBtn onClick={() => onBulkSetModels?.('reset')} icon={<RefreshCw className="size-3" />}>
              Reset all to defaults
            </BulkBtn>
            <BulkBtn
              onClick={() => onBulkSetModels?.('local_only')}
              icon={<HardDrive className="size-3" />}
            >
              Use only local models
            </BulkBtn>
            <BulkBtn
              onClick={() => onBulkSetModels?.('anthropic_only')}
              icon={<Sparkles className="size-3" />}
            >
              Use only Anthropic
            </BulkBtn>
            <BulkBtn
              onClick={() => onBulkSetModels?.('openai_only')}
              icon={<Zap className="size-3" />}
            >
              Use only OpenAI
            </BulkBtn>
          </div>
        </div>
      </section>
    </div>
  );
}

function TierChip({ tier }: { tier: LlmModel['tier'] }) {
  const map: Record<LlmModel['tier'], { label: string; classes: string }> = {
    A_local: { label: 'A · local', classes: 'bg-clean-100 text-clean-700' },
    B_efficient: { label: 'B · efficient', classes: 'bg-caution-100 text-caution-700' },
    C_frontier: { label: 'C · frontier', classes: 'bg-elevated-100 text-elevated-700' },
  };
  const m = map[tier];
  return (
    <span
      className={cn(
        'inline-block text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded',
        m.classes,
      )}
    >
      {m.label}
    </span>
  );
}

function BulkBtn({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded border border-context-100 hover:bg-context-100/60 text-context-700"
    >
      {icon} {children}
    </button>
  );
}

// Phase 0 stand-in for vendor matching — used only to filter the dropdown options.
function providerVendorMatchesModelVendor(install: ProviderInstall, model: LlmModel): boolean {
  const map: Record<string, string[]> = {
    Anthropic: ['inst-anthropic'],
    OpenAI: ['inst-openai'],
    DeepSeek: ['inst-deepseek'],
  };
  return map[model.vendor]?.includes(install.id) ?? false;
}

// =====================================================================
// .env-easy key entry modal (v0.4 §2)
// =====================================================================

function KeyEntryModal({
  catalog,
  pendingProvider,
  onParse,
  onConfirm,
  onClose,
}: {
  catalog: ProviderDefinition[];
  pendingProvider: ProviderDefinition | null;
  onParse?: (raw: string) => EnvParseResult;
  onConfirm: (providerIds: string[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>(pendingProvider ? 'single' : 'bulk');
  const [raw, setRaw] = useState('');
  const [singleValue, setSingleValue] = useState('');
  const [parseResult, setParseResult] = useState<EnvParseResult | null>(null);

  const handleParse = useCallback(() => {
    if (!onParse) return;
    setParseResult(onParse(raw));
  }, [onParse, raw]);

  const installable = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.detected.filter((d) => d.provider_id && d.looks_valid);
  }, [parseResult]);

  return (
    <div
      role="dialog"
      aria-label="Key entry"
      className="fixed inset-0 z-40 bg-context-700/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-context-100 w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-context-100">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-markup-700" />
            <h2 className="text-sm font-semibold text-context-700">
              {pendingProvider ? `Install ${pendingProvider.name}` : 'Bulk paste API keys'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-7 inline-flex items-center justify-center rounded hover:bg-context-100 text-context-500 hover:text-context-700"
          >
            <X className="size-4" />
          </button>
        </header>

        {!pendingProvider && (
          <div className="px-5 pt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('bulk')}
              className={cn(
                'text-[12px] font-medium px-2.5 py-1 rounded',
                mode === 'bulk'
                  ? 'bg-markup-100/60 text-markup-700'
                  : 'text-context-500 hover:bg-context-100',
              )}
            >
              Bulk paste
            </button>
            <button
              type="button"
              onClick={() => setMode('single')}
              className={cn(
                'text-[12px] font-medium px-2.5 py-1 rounded',
                mode === 'single'
                  ? 'bg-markup-100/60 text-markup-700'
                  : 'text-context-500 hover:bg-context-100',
              )}
            >
              Single key
            </button>
          </div>
        )}

        <div className="px-5 py-4 flex-1 overflow-y-auto">
          {mode === 'bulk' || (!pendingProvider && mode !== 'single') ? (
            <>
              <p className="text-[12px] text-context-500 mb-2">
                Paste your <code className="font-mono text-context-700">.env</code> block. We&apos;ll
                detect which providers each key belongs to, validate the format client-side, and only
                send confirmed keys to the agency vault.
              </p>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={`# Paste your .env here, e.g.:\nETHERSCAN_API_KEY=ABC123...\nCHAINALYSIS_API_KEY=eyJhbGc...\nANTHROPIC_API_KEY=sk-ant-...`}
                rows={8}
                className="w-full font-mono text-[11px] p-3 border border-context-100 rounded resize-y focus:outline-none focus:border-markup-500"
              />
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!raw.trim()}
                  className="text-[12px] font-semibold px-3 py-1.5 rounded bg-markup-700 text-white hover:bg-markup-500 disabled:opacity-40"
                >
                  Detect providers
                </button>
                <span className="text-[10px] text-context-500">
                  Parsed locally. Secrets never leave your browser until you confirm.
                </span>
              </div>

              {parseResult && (
                <div className="mt-4 space-y-2">
                  <h3 className="text-[10px] uppercase tracking-wider font-bold text-context-500">
                    Detected ({parseResult.detected.length})
                  </h3>
                  <ul className="space-y-1.5">
                    {parseResult.detected.map((d, i) => {
                      const provider = catalog.find((p) => p.id === d.provider_id);
                      return (
                        <li
                          key={i}
                          className={cn(
                            'flex items-center gap-3 text-[12px] px-3 py-2 rounded border',
                            d.looks_valid && provider
                              ? 'border-clean-500/40 bg-clean-100/30'
                              : 'border-elevated-500/40 bg-elevated-100/30',
                          )}
                        >
                          {d.looks_valid && provider ? (
                            <Check className="size-4 text-clean-700 shrink-0" />
                          ) : (
                            <AlertTriangle className="size-4 text-elevated-700 shrink-0" />
                          )}
                          <code className="font-mono text-[11px] text-context-700 w-44 shrink-0 truncate">
                            {d.env_var}
                          </code>
                          <span className="flex-1 text-context-700">
                            {provider ? provider.name : 'Unknown provider'}
                          </span>
                          <code className="font-mono text-[10px] text-context-500">
                            {d.masked_preview}
                          </code>
                          {d.warning && (
                            <span className="text-[10px] text-elevated-700 italic">
                              {d.warning}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {parseResult.unknown_lines.length > 0 && (
                    <details className="text-[11px] text-context-500 mt-2">
                      <summary className="cursor-pointer hover:text-context-700">
                        {parseResult.unknown_lines.length} unrecognized lines
                      </summary>
                      <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
                        {parseResult.unknown_lines.map((l, i) => (
                          <li key={i} className="truncate">
                            {l}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          ) : (
            // Single-key entry
            <div>
              {pendingProvider && (
                <div className="mb-3 flex items-center gap-2 text-[12px] text-context-700">
                  <span className="text-2xl leading-none">{pendingProvider.glyph}</span>
                  <div>
                    <div className="font-semibold">{pendingProvider.name}</div>
                    <div className="text-[11px] text-context-500">
                      Expects env var:{' '}
                      <code className="font-mono">
                        {pendingProvider.env_var_names.join(', ') || 'none'}
                      </code>
                    </div>
                  </div>
                </div>
              )}
              <label className="text-[11px] text-context-500 font-medium">API key</label>
              <input
                type="password"
                value={singleValue}
                onChange={(e) => setSingleValue(e.target.value)}
                placeholder="Paste your API key…"
                className="w-full mt-1 px-3 py-2 text-[12px] font-mono border border-context-100 rounded focus:outline-none focus:border-markup-500"
              />
              <p className="text-[10px] text-context-500 mt-2 inline-flex items-center gap-1">
                <CircleHelp className="size-3" /> Stored encrypted in the agency vault. Never logged
                in cleartext.
              </p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-context-100">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-medium px-3 py-1.5 rounded text-context-700 hover:bg-context-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              mode === 'bulk'
                ? installable.length === 0
                : mode === 'single'
                  ? !singleValue.trim()
                  : true
            }
            onClick={() => {
              if (mode === 'bulk') {
                onConfirm(installable.map((d) => d.provider_id!));
              } else if (pendingProvider) {
                onConfirm([pendingProvider.id]);
              }
            }}
            className="text-[12px] font-semibold px-3 py-1.5 rounded bg-markup-700 text-white hover:bg-markup-500 disabled:opacity-40"
          >
            {mode === 'bulk'
              ? `Install ${installable.length} provider${installable.length === 1 ? '' : 's'}`
              : 'Install'}
          </button>
        </footer>
      </div>
    </div>
  );
}
