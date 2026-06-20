/**
 * Phase 0 streaming simulator for Wallet History Analyzer. Mirrors the
 * Inspector pattern \u2014 each address walks through the analysis stages on a
 * randomized schedule so the UI looks alive without real backend calls.
 */

import {
  ADDRESS_ANALYSIS_STAGES,
  type AddressAnalysis,
  type AddressAnalysisStage,
  type WalletAddressInput,
} from '@chainsight/shared-types';

// Stages other than queued / ready / failed (the working stages).
const WORKING_STAGES: AddressAnalysisStage[] = [
  'fetching_history',
  'clustering',
  'attribution',
  'obfuscation_scan',
  'tracing_hops',
  'scoring',
];

const STAGE_DURATIONS_MS: Record<AddressAnalysisStage, number> = {
  queued: 0,
  fetching_history: 1400,
  clustering: 800,
  attribution: 900,
  obfuscation_scan: 700,
  tracing_hops: 1800,
  scoring: 500,
  ready: 0,
  failed: 0,
};

export function initialAnalyses(addresses: WalletAddressInput[]): AddressAnalysis[] {
  return addresses.map((a, i) => ({
    raw_address: a.raw_address,
    chain: a.chain,
    label_from_source: a.label_from_source,
    stage: 'queued',
    progress: 0,
    message: i < 3 ? 'waiting for worker' : `position ${i + 1} in queue`,
  }));
}

export interface SimRow {
  apply: (mut: (cur: AddressAnalysis) => AddressAnalysis) => void;
}

/**
 * Run the simulation. Each address is started after a small stagger so the
 * worker pool feels real (not all 23 addresses kicking off simultaneously).
 */
export function runWalletSim(
  addresses: WalletAddressInput[],
  onUpdate: (rawAddress: string, mut: (cur: AddressAnalysis) => AddressAnalysis) => void,
  onComplete: () => void,
): { cancel: () => void } {
  const cancelled = { value: false };
  const timeouts: ReturnType<typeof setTimeout>[] = [];

  const schedule = (delay: number, fn: () => void) => {
    timeouts.push(setTimeout(() => { if (!cancelled.value) fn(); }, delay));
  };

  let remaining = addresses.length;
  const onAddressDone = () => {
    remaining -= 1;
    if (remaining === 0) onComplete();
  };

  addresses.forEach((addr, i) => {
    // Start delay: workers pick up in waves of 4 with ~150ms jitter.
    const startDelay = Math.floor(i / 4) * 600 + (i % 4) * 120;

    schedule(startDelay, () => {
      let cursor = 0;
      const stages = WORKING_STAGES;

      const runStage = (stageIdx: number) => {
        const stage = stages[stageIdx];
        if (stageIdx >= stages.length || !stage) {
          // Tiny chance to fail (sanity-check rows are already filtered, but
          // simulate the occasional Etherscan flake).
          const willFail = Math.random() < 0.04;
          onUpdate(addr.raw_address, () => ({
            raw_address: addr.raw_address,
            chain: addr.chain,
            label_from_source: addr.label_from_source,
            stage: willFail ? 'failed' : 'ready',
            progress: 1,
            message: willFail ? 'Etherscan returned 429 \u2014 retry available' : undefined,
            summary: willFail ? undefined : synthesizeSummary(addr, i),
            score: willFail ? undefined : synthesizeScore(addr, i),
            flag: willFail ? undefined : maybeFlag(addr, i),
          }));
          onAddressDone();
          return;
        }
        const dur = STAGE_DURATIONS_MS[stage] + Math.floor(Math.random() * 400);

        onUpdate(addr.raw_address, (cur) => ({
          ...cur,
          stage,
          progress: (stageIdx + 0.1) / stages.length,
          message: stageMessage(stage, addr),
        }));

        // Mid-stage progress tick.
        schedule(cursor + dur / 2, () => {
          onUpdate(addr.raw_address, (cur) => ({
            ...cur,
            progress: (stageIdx + 0.5) / stages.length,
          }));
        });

        schedule(cursor + dur, () => {
          onUpdate(addr.raw_address, (cur) => ({
            ...cur,
            progress: (stageIdx + 1) / stages.length,
          }));
          runStage(stageIdx + 1);
        });

        cursor += dur;
      };

      runStage(0);
    });
  });

  return {
    cancel: () => {
      cancelled.value = true;
      for (const t of timeouts) clearTimeout(t);
    },
  };
}

// ---------- synthetic summary / score / flag heuristics ----------

function stageMessage(stage: AddressAnalysisStage, addr: WalletAddressInput): string {
  switch (stage) {
    case 'fetching_history': return `pulling ${addr.chain.toUpperCase()} history via BYOK provider`;
    case 'clustering': return 'common-input + change-output heuristics';
    case 'attribution': return 'TRM \u00d7 Chainabuse \u00d7 OFAC corroboration';
    case 'obfuscation_scan': return 'mixer / peel-chain / bridge detector';
    case 'tracing_hops': return '3-hop incoming, 5-hop outgoing';
    case 'scoring': return 'composite evidentiary value';
    default: return '';
  }
}

function synthesizeSummary(
  addr: WalletAddressInput,
  i: number,
): AddressAnalysis['summary'] {
  // Use the index to vary the synthesized data so the UI feels diverse.
  const seed = i + 1;
  const tx = 12 + ((seed * 17) % 240);
  const inflow = (seed * 0.31 + 0.05).toFixed(2);
  const outflow = (seed * 0.27 + 0.02).toFixed(2);
  const balance = (Math.max(0, seed * 0.04) + 0.001).toFixed(4);

  const counterparties = [
    ['Kraken', 'Coinbase', 'Binance', 'Bitstamp', 'Gemini'],
    ['Tornado Cash 10-ETH', 'Tornado Cash 100-ETH', 'Wasabi CoinJoin', 'Samourai Whirlpool'],
    ['Uniswap V3', 'Curve 3pool', 'Aave v3', '1inch router'],
    ['ChipMixer (sanctioned)', 'Garantex (sanctioned)', 'Hydra Market (defunct)'],
  ];
  const picks: string[] = [];
  for (let k = 0; k < 3; k++) {
    const row = counterparties[(seed + k) % counterparties.length];
    if (!row) continue;
    const pick = row[(seed + k) % row.length];
    if (pick) picks.push(pick);
  }

  const native = addr.chain === 'btc' ? 'BTC' : addr.chain === 'sol' ? 'SOL' : 'ETH';

  return {
    first_activity_at: '2024-08-12',
    last_activity_at: '2026-04-09',
    tx_count: tx,
    total_inflow_display: `${inflow} ${native}`,
    total_outflow_display: `${outflow} ${native}`,
    current_balance_display: `${balance} ${native}`,
    top_counterparties: picks,
    obfuscation_hit: i % 5 === 0 || i % 7 === 0,
    attribution_hit: i % 3 !== 0,
  };
}

function synthesizeScore(_addr: WalletAddressInput, i: number): number {
  // Higher score for the first few addresses (so 'flagged' panel feels useful).
  const base = 95 - i * 6;
  return Math.max(8, Math.min(98, base + ((i * 13) % 11)));
}

function maybeFlag(addr: WalletAddressInput, i: number): AddressAnalysis['flag'] {
  if (i === 0) {
    return {
      kind: 'high_value_moved',
      label: 'High value moved',
      rationale: 'This address moved >$1.2M in a single 7-day window in March 2026. Worth pulling for hop-trace prioritization.',
      weight: 92,
    };
  }
  if (i === 1) {
    return {
      kind: 'mixer_entry',
      label: 'Mixer entry',
      rationale: 'Outbound transactions to Tornado Cash 10-ETH and 100-ETH pools detected at depth 1.',
      weight: 88,
    };
  }
  if (i === 2) {
    return {
      kind: 'sanctions_hit',
      label: 'Sanctions counterparty',
      rationale: 'Interacted with Garantex (OFAC SDN, added 2022-04-05). Multi-provider corroborated.',
      weight: 84,
    };
  }
  if (i === 5) {
    return {
      kind: 'exchange_deposit',
      label: 'Exchange deposit',
      rationale: 'Resolves to a Kraken hot wallet deposit address (TRM + Coinbase Discovery agreement).',
      weight: 65,
    };
  }
  if (i === 7) {
    return {
      kind: 'cluster_anchor',
      label: 'Cluster anchor',
      rationale: 'Common-input clustering links this address to 11 others in the wallet \u2014 likely the same Ledger account.',
      weight: 58,
    };
  }
  if (i === 10) {
    return {
      kind: 'peel_chain_origin',
      label: 'Peel-chain origin',
      rationale: 'Heuristic peel detector found a 6-hop peel chain originating here on 2026-03-14.',
      weight: 71,
    };
  }
  return undefined;
}

/** Build a running aggregate from the per-address rows. */
export function buildAggregate(rows: AddressAnalysis[], totalRequested: number) {
  const ready = rows.filter((r) => r.stage === 'ready');
  const failed = rows.filter((r) => r.stage === 'failed');
  const flagged = rows.filter((r) => r.flag);

  // Synthetic fiat totals \u2014 sum the index-based inflows pseudo-realistically.
  const sumInflow = ready.reduce((acc, r, i) => acc + 18_000 + i * 4_700, 0);
  const sumOutflow = ready.reduce((acc, r, i) => acc + 12_000 + i * 4_100, 0);
  const balance = sumInflow - sumOutflow;

  const allCounterparties = ready.flatMap((r) => r.summary?.top_counterparties ?? []);
  const counts = new Map<string, number>();
  for (const c of allCounterparties) counts.set(c, (counts.get(c) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);

  return {
    addresses_analyzed: ready.length,
    addresses_failed: failed.length,
    total_inflow_fiat_display: usd(sumInflow),
    total_outflow_fiat_display: usd(sumOutflow),
    current_balance_fiat_display: usd(Math.max(0, balance)),
    top_counterparty_entities: top,
    identified_cluster_count: Math.max(1, Math.floor(ready.length / 4)),
    obfuscation_finding_count: ready.filter((r) => r.summary?.obfuscation_hit).length,
    flagged_address_count: flagged.length,
  };

  function usd(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD', maximumFractionDigits: 0,
    }).format(n);
  }
}
