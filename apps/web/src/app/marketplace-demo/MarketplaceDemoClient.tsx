'use client';

import { useCallback, useState } from 'react';
import { Marketplace } from '../../components/marketplace/Marketplace';
import {
  AGENT_ROLES,
  MODEL_REGISTRY,
  PROVIDER_CATALOG,
  SEED_INSTALLS,
  SEED_MATRIX,
} from '../../components/marketplace/seed';
import type {
  AgentRoleId,
  EnvParseResult,
  LlmModelId,
  ModelMatrix,
  ProviderId,
  ProviderInstall,
  ProviderInstallId,
} from '@chainsight/shared-types';

let nextInstId = 100;

export default function MarketplaceDemoClient() {
  const [installs, setInstalls] = useState<ProviderInstall[]>(SEED_INSTALLS);
  const [matrix, setMatrix] = useState<ModelMatrix>(SEED_MATRIX);

  const handleInstall = useCallback((providerId: string) => {
    setInstalls((cur) => {
      if (cur.some((i) => i.provider_id === providerId)) return cur;
      const id = `inst-new-${nextInstId++}` as ProviderInstallId;
      return [
        ...cur,
        {
          id,
          provider_id: providerId as ProviderId,
          installed_by: 'demo-investigator-doe' as ProviderInstall['installed_by'],
          installed_at: new Date().toISOString(),
          key_scope: 'agency',
          health: 'green',
          calls_this_month: 0,
          cost_this_month_fiat: '$0',
        },
      ];
    });
  }, []);

  const handleUninstall = useCallback((installId: string) => {
    setInstalls((cur) => cur.filter((i) => i.id !== installId));
  }, []);

  const handleEnvParse = useCallback((raw: string): EnvParseResult => {
    return parseEnvBlock(raw);
  }, []);

  const handleAssignmentChange = useCallback(
    (roleId: AgentRoleId, modelId: LlmModelId | null) => {
      setMatrix((cur) => {
        const next = { ...cur };
        next.assignments = cur.assignments.map((a) =>
          a.role_id === roleId ? { ...a, override_model_id: modelId } : a,
        );
        next.estimated_monthly_cost_fiat = estimateMonthlyCost(next.assignments);
        return next;
      });
    },
    [],
  );

  const handleBulkSetModels = useCallback(
    (mode: 'reset' | 'local_only' | 'anthropic_only' | 'openai_only') => {
      setMatrix((cur) => {
        const assignments = cur.assignments.map((a) => {
          if (mode === 'reset') return { ...a, override_model_id: null };
          if (mode === 'local_only') {
            // Pick the smallest local model that floors the role's tier requirement.
            return { ...a, override_model_id: 'qwen-3-5-8b' as LlmModelId };
          }
          if (mode === 'anthropic_only') {
            return { ...a, override_model_id: 'claude-opus-4-6' as LlmModelId };
          }
          if (mode === 'openai_only') {
            return { ...a, override_model_id: 'gpt-5-5' as LlmModelId };
          }
          return a;
        });
        return {
          ...cur,
          assignments,
          estimated_monthly_cost_fiat: estimateMonthlyCost(assignments),
        };
      });
    },
    [],
  );

  return (
    <Marketplace
      catalog={PROVIDER_CATALOG}
      installs={installs}
      roles={AGENT_ROLES}
      models={MODEL_REGISTRY}
      matrix={matrix}
      onInstall={handleInstall}
      onUninstall={handleUninstall}
      onBulkEnvPaste={handleEnvParse}
      onAssignmentChange={handleAssignmentChange}
      onBulkSetModels={handleBulkSetModels}
    />
  );
}

// =====================================================================
// .env parser — client-side
// =====================================================================

/** Env-var → provider ID map, derived from the catalog. */
const ENV_TO_PROVIDER: Record<string, ProviderId> = (() => {
  const m: Record<string, ProviderId> = {};
  for (const p of PROVIDER_CATALOG) {
    for (const env of p.env_var_names) m[env] = p.id;
  }
  return m;
})();

function parseEnvBlock(raw: string): EnvParseResult {
  const detected: EnvParseResult['detected'] = [];
  const unknown: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Strip optional "export " prefix.
    const clean = trimmed.replace(/^export\s+/, '');
    const eq = clean.indexOf('=');
    if (eq <= 0) {
      unknown.push(line);
      continue;
    }
    const name = clean.slice(0, eq).trim();
    let value = clean.slice(eq + 1).trim();
    // Strip surrounding quotes.
    value = value.replace(/^["'](.*)["']$/, '$1');

    const providerId = ENV_TO_PROVIDER[name] ?? null;
    if (!providerId) {
      unknown.push(line);
      continue;
    }

    const looksValid = value.length >= 8;
    detected.push({
      env_var: name,
      provider_id: providerId,
      masked_preview: maskSecret(value),
      looks_valid: looksValid,
      warning: looksValid ? undefined : 'Value looks too short — double-check the paste.',
    });
  }

  return { detected, unknown_lines: unknown };
}

function maskSecret(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 12))}${value.slice(-4)}`;
}

// =====================================================================
// Cost estimator (toy — Phase 1 will read real telemetry)
// =====================================================================

function estimateMonthlyCost(assignments: ModelMatrix['assignments']): string {
  // Toy heuristic: each role costs $200/mo if it uses a frontier-tier model,
  // $30/mo if efficient, $0 if local. Sum and round.
  // (The seed numbers below mirror the v0.9 §3.4 telemetry table.)
  const ROLE_BASE: Record<string, number> = {
    orchestrator: 980,
    critic: 604,
    narrative: 263,
    tracer: 75,
    attribution: 30,
    bridge: 0,
    swap: 0,
    inspector: 20,
    verifier: 0,
    extraction: 0,
  };
  const FACTOR: Record<string, number> = {
    'claude-opus-4-6': 1,
    'claude-opus-4-8': 1.2,
    'gpt-5-5': 0.9,
    'claude-sonnet-4-6': 0.25,
    'deepseek-v4-pro': 0.05,
    'llama-4-70b-local': 0,
    'qwen-3-5-8b': 0,
    'phi-4-ft-docs': 0,
    'phi-4-ft-swap': 0,
  };
  let total = 0;
  for (const a of assignments) {
    const base = ROLE_BASE[a.role_id] ?? 50;
    const factor = a.override_model_id
      ? (FACTOR[a.override_model_id] ?? 0.5)
      : 1;
    total += base * factor;
  }
  return `$${Math.round(total).toLocaleString()}`;
}
