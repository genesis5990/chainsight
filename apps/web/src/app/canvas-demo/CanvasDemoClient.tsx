'use client';

import dynamic from 'next/dynamic';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ImportantSidebar,
  LayerRail,
  StatusBar,
  TopBar,
} from '../../components/canvas/Chrome';
import { SEED_CASE } from '../../components/canvas/seed';
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
import { TransactionInspector } from '../../components/inspector/TransactionInspector';
import type {
  ActionSuggestion,
  CanvasLayerToggles,
  CanvasNodeId,
  TaintMethodology,
  TransactionAnalysis,
} from '@chainsight/shared-types';
import { DEFAULT_LAYER_TOGGLES } from '@chainsight/shared-types';

// Sigma touches window/canvas; load client-only.
const CanvasView = dynamic(
  () => import('../../components/canvas/CanvasView').then((m) => m.CanvasView),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center text-context-500 text-sm">
        Initializing canvas (Sigma.js / WebGL)…
      </div>
    ),
  },
);

export default function CanvasDemoClient() {
  const [layers, setLayers] = useState<CanvasLayerToggles>(DEFAULT_LAYER_TOGGLES);
  const [methodology, setMethodology] = useState<TaintMethodology>('fifo');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | undefined>();
  const [analyses, setAnalyses] = useState<Map<string, TransactionAnalysis>>(new Map());
  const nextId = useRef(1);

  // Click a tx node → spawn a streaming Inspector.
  const handleNodeClick = useCallback(
    (nodeId: CanvasNodeId, kind: 'address' | 'transaction') => {
      if (kind === 'address') {
        setLastEvent(`Selected address ${String(nodeId).slice(0, 14)}…`);
        return;
      }

      const id = `demo-${nextId.current++}`;
      const fresh = seedSwapAnalysis();
      const initial: TransactionAnalysis = { ...fresh, id: id as TransactionAnalysis['id'] };
      setAnalyses((prev) => new Map(prev).set(id, initial));
      setLastEvent('Inspector spawned — sections streaming');
      streamSections(id, (updater) => {
        setAnalyses((prev) => {
          const cur = prev.get(id);
          if (!cur) return prev;
          const next = new Map(prev);
          next.set(id, updater(cur));
          return next;
        });
      });
    },
    [],
  );

  const handleCanvasClick = useCallback(() => {
    setLastEvent(undefined);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setLastEvent('Re-running Math Service…');
    setTimeout(() => {
      setIsRefreshing(false);
      setLastEvent(`Refreshed at ${new Date().toLocaleTimeString()}`);
    }, 900);
  }, []);

  const handleCloseInspector = useCallback((id: string) => {
    setAnalyses((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleAction = useCallback((action: ActionSuggestion) => {
    setLastEvent(`Action queued: ${action.label}`);
  }, []);

  const handleJumpTo = useCallback((id: string) => {
    setLastEvent(`Jump-to ${id} — Phase 1 will animate the camera`);
  }, []);

  const counts = useMemo(
    () => ({
      nodeCount: SEED_CASE.nodes.length,
      edgeCount: SEED_CASE.edges.length,
      pathCount: SEED_CASE.paths.length,
      markCount: SEED_CASE.marks.length,
    }),
    [],
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-context-100/40">
      <TopBar
        caseName={SEED_CASE.case_name}
        methodology={methodology}
        onMethodologyChange={setMethodology}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        lastEvent={lastEvent}
      />
      <div className="flex-1 flex min-h-0">
        <LayerRail layers={layers} onLayersChange={setLayers} />

        <main className="relative flex-1 min-w-0 bg-white">
          {/* Faux grid background to hint that this is a canvas */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-50"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(107,114,128,0.10) 1px, transparent 1px), linear-gradient(to bottom, rgba(107,114,128,0.10) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
          <CanvasView
            graph={SEED_CASE}
            layers={layers}
            methodology={methodology}
            onNodeClick={handleNodeClick}
            onCanvasClick={handleCanvasClick}
          />

          {/* Helper toast */}
          {analyses.size === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-context-700/85 text-white text-[11px] font-medium shadow-lg pointer-events-none">
              Click any transaction node (square) to spawn the Inspector
            </div>
          )}
        </main>

        <ImportantSidebar graph={SEED_CASE} onJumpTo={handleJumpTo} />
      </div>
      <StatusBar
        nodeCount={counts.nodeCount}
        edgeCount={counts.edgeCount}
        pathCount={counts.pathCount}
        markCount={counts.markCount}
        lastRefreshedAt={SEED_CASE.last_refreshed_at}
      />

      {/* Open Inspectors live in a portal-like overlay (fixed-position popups). */}
      {Array.from(analyses.entries()).map(([id, analysis], i) => (
        <TransactionInspector
          key={id}
          analysis={analysis}
          initialPosition={{ x: 280 + i * 32, y: 100 + i * 32 }}
          onClose={() => handleCloseInspector(id)}
          onActionClick={handleAction}
        />
      ))}
    </div>
  );
}

// ---------- streaming simulator (mirrors inspector-demo) ----------

function streamSections(
  _id: string,
  apply: (updater: (cur: TransactionAnalysis) => TransactionAnalysis) => void,
) {
  const t0 = Date.now();
  apply((cur) => ({ ...cur, status: 'streaming' }));

  STREAM_SCHEDULE.forEach((step) => {
    setTimeout(() => {
      apply((cur) => ({
        ...cur,
        sections: { ...cur.sections, [step.section]: { status: 'loading' } },
      }));
    }, step.loading_at);

    setTimeout(() => {
      apply((cur) => {
        const landed = Date.now() - t0;
        const meta = { status: 'ready' as const, landed_at_ms: landed };
        const patch: Partial<TransactionAnalysis> = {};
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
        return {
          ...cur,
          ...patch,
          sections: { ...cur.sections, [step.section]: meta },
        };
      });
    }, step.ready_at);
  });

  const maxReady = Math.max(...STREAM_SCHEDULE.map((s) => s.ready_at));
  setTimeout(() => {
    apply((cur) => ({
      ...cur,
      status: 'complete',
      completed_at: new Date().toISOString(),
    }));
  }, maxReady + 200);
}
