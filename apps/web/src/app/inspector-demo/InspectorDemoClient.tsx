'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TransactionInspector } from '../../components/inspector/TransactionInspector';
import {
  STREAM_SCHEDULE,
  seedActions,
  seedCaseContext,
  seedCounterparties,
  seedCritic,
  seedFacts,
  seedObfuscation,
  seedSummary,
  seedSwap,
  seedSwapAnalysis,
} from '../../components/inspector/seed';
import type {
  ActionSuggestion,
  TransactionAnalysis,
} from '../../components/inspector/types';

/**
 * The demo page renders a placeholder canvas with a single transaction node.
 * Clicking the node spawns a fresh Inspector instance whose sections stream
 * in on the schedule defined in seed.ts.
 *
 * Multiple inspectors can be open at once (each is independent).
 */
export default function InspectorDemoClient() {
  const [analyses, setAnalyses] = useState<Map<string, TransactionAnalysis>>(new Map());
  const [demoMode, setDemoMode] = useState<'happy' | 'with_failure'>('happy');
  const nextId = useRef(1);

  const openInspector = useCallback(() => {
    const id = `demo-${nextId.current++}`;
    const fresh = seedSwapAnalysis();
    const initial: TransactionAnalysis = { ...fresh, id: id as TransactionAnalysis['id'] };
    setAnalyses((prev) => new Map(prev).set(id, initial));
    streamSections(id, demoMode, (updater) => {
      setAnalyses((prev) => {
        const cur = prev.get(id);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(id, updater(cur));
        return next;
      });
    });
  }, [demoMode]);

  const closeInspector = useCallback((id: string) => {
    setAnalyses((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handlePivot = useCallback((address: string) => {
    // eslint-disable-next-line no-console
    console.log('[Inspector demo] pivot canvas to', address);
  }, []);

  const handleAction = useCallback((action: ActionSuggestion) => {
    // eslint-disable-next-line no-console
    console.log('[Inspector demo] action clicked:', action.kind);
  }, []);

  return (
    <main className="relative min-h-screen w-full bg-context-100/40 overflow-hidden">
      {/* Faux canvas grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(107,114,128,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(107,114,128,0.15) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-3 bg-white/80 backdrop-blur border-b border-context-100">
        <div>
          <h1 className="text-base font-semibold text-context-700">
            ChainSight · Transaction Inspector demo
          </h1>
          <p className="text-[11px] text-context-500">
            Surface 1 mockup · Click the transaction diamond to spawn the popup
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-[11px] text-context-700 flex items-center gap-2">
            Demo mode
            <select
              value={demoMode}
              onChange={(e) => setDemoMode(e.target.value as typeof demoMode)}
              className="text-[11px] border border-context-100 rounded px-2 py-1 bg-white"
            >
              <option value="happy">Happy path (all sections succeed)</option>
              <option value="with_failure">
                With failures (Critic + Obfuscation fail)
              </option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              const ids = Array.from(analyses.keys());
              ids.forEach(closeInspector);
            }}
            className="text-[11px] text-context-500 hover:text-context-700"
          >
            Close all
          </button>
        </div>
      </header>

      {/* Faux canvas with placeholder address-tx-address row */}
      <div className="relative z-10 min-h-[calc(100vh-56px)] flex items-center justify-center">
        <div className="flex items-center gap-3 select-none">
          <AddressNode label="0xdef…a4c2" sublabel="EOA" />
          <Edge />
          <TransactionNode onClick={openInspector} />
          <Edge />
          <AddressNode label="0xE5…0aD" sublabel="Uniswap Router" attributed />
        </div>
      </div>

      {/* All open Inspectors */}
      {Array.from(analyses.entries()).map(([id, analysis], i) => (
        <TransactionInspector
          key={id}
          analysis={analysis}
          initialPosition={{ x: 80 + i * 32, y: 80 + i * 32 }}
          onClose={() => closeInspector(id)}
          onPivotAddress={handlePivot}
          onActionClick={handleAction}
        />
      ))}

      {/* Empty state hint */}
      {analyses.size === 0 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-context-700/85 text-white text-[11px] font-medium shadow-lg">
          Click the orange diamond to spawn the Inspector popup
        </div>
      )}
    </main>
  );
}

// ---------- Canvas placeholder primitives ----------

function AddressNode({
  label,
  sublabel,
  attributed,
}: {
  label: string;
  sublabel: string;
  attributed?: boolean;
}) {
  return (
    <div
      className={`size-24 rounded-full border-2 flex flex-col items-center justify-center text-center px-2 shadow-sm bg-white ${
        attributed ? 'border-clean-500' : 'border-elevated-500'
      }`}
    >
      <span className="font-mono text-[11px] text-context-700">{label}</span>
      <span className="text-[10px] text-context-500 mt-0.5">{sublabel}</span>
    </div>
  );
}

function Edge() {
  return (
    <div className="flex items-center gap-1">
      <div className="h-px w-10 bg-context-500/60" />
      <div className="size-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-context-500/60" />
    </div>
  );
}

function TransactionNode({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Analyze this transaction (Enter)"
      className="group relative"
    >
      <div className="size-20 rotate-45 border-2 border-elevated-700 bg-elevated-500 shadow-md group-hover:scale-110 transition-transform" />
      <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-semibold uppercase tracking-wider pointer-events-none">
        TX
      </span>
      <span className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-context-500 group-hover:text-context-700">
        Click to analyze
      </span>
    </button>
  );
}

// ---------- streaming simulator ----------

/**
 * Drive the section meta + payload mutations from the schedule in seed.ts.
 * Each section first transitions pending → loading, then loading → ready
 * (with the payload landed). In 'with_failure' mode, obfuscation + critic
 * fail instead of landing.
 */
function streamSections(
  id: string,
  mode: 'happy' | 'with_failure',
  apply: (updater: (cur: TransactionAnalysis) => TransactionAnalysis) => void,
) {
  const t0 = Date.now();

  // Overall status → 'streaming' immediately.
  apply((cur) => ({ ...cur, status: 'streaming' }));

  STREAM_SCHEDULE.forEach((step) => {
    // loading at t = loading_at
    setTimeout(() => {
      apply((cur) => ({
        ...cur,
        sections: {
          ...cur.sections,
          [step.section]: { status: 'loading' },
        },
      }));
    }, step.loading_at);

    // ready or failed at t = ready_at
    const shouldFail =
      mode === 'with_failure' &&
      (step.section === 'obfuscation_findings' || step.section === 'critic_notes');

    setTimeout(() => {
      apply((cur) => {
        const landed = Date.now() - t0;
        const meta = shouldFail
          ? {
              status: 'failed' as const,
              error: 'Provider timeout. Falling back to last good snapshot.',
              landed_at_ms: landed,
            }
          : { status: 'ready' as const, landed_at_ms: landed };

        // Patch payload per section.
        const patch: Partial<TransactionAnalysis> = {};
        if (!shouldFail) {
          switch (step.section) {
            case 'summary':
              patch.summary = seedSummary;
              break;
            case 'structured_facts':
              patch.structured_facts = seedFacts;
              break;
            case 'decoded_action':
              patch.decoded_action = seedSwap;
              break;
            case 'counterparty_intel':
              patch.counterparty_intel = seedCounterparties;
              break;
            case 'case_context':
              patch.case_context = seedCaseContext;
              break;
            case 'obfuscation_findings':
              patch.obfuscation_findings = seedObfuscation;
              break;
            case 'critic_notes':
              patch.critic_notes = seedCritic;
              break;
            case 'suggested_actions':
              patch.suggested_actions = seedActions;
              break;
          }
        }
        return {
          ...cur,
          ...patch,
          sections: {
            ...cur.sections,
            [step.section]: meta,
          },
        };
      });
    }, step.ready_at);
  });

  // Mark complete once the last section lands.
  const maxReady = Math.max(...STREAM_SCHEDULE.map((s) => s.ready_at));
  setTimeout(() => {
    apply((cur) => {
      const anyFailed = Object.values(cur.sections).some((s) => s.status === 'failed');
      return {
        ...cur,
        status: anyFailed ? 'partial' : 'complete',
        completed_at: new Date().toISOString(),
      };
    });
  }, maxReady + 200);
}
