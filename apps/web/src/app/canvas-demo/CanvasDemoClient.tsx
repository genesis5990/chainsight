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
import { PsrToolbar } from '../../components/psr/PsrToolbar';
import { PsrDrawer } from '../../components/psr/PsrDrawer';
import type {
  ActionSuggestion,
  CanvasLayerToggles,
  CanvasNode,
  CanvasNodeId,
  PsrDraft,
  PsrReportDraft,
  PsrSelectionMode,
  TaintMethodology,
  TransactionAnalysis,
} from '@chainsight/shared-types';
import { DEFAULT_LAYER_TOGGLES, emptyReportDraft } from '@chainsight/shared-types';

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

const EMPTY_DRAFT: PsrDraft = {
  display_name: '',
  color: 'cool_blue',
  methodology: 'fifo',
  is_primary_candidate: false,
  ordered_nodes: [],
  last_selection_mode: 'click',
  commentary: '',
};

export default function CanvasDemoClient() {
  const [layers, setLayers] = useState<CanvasLayerToggles>(DEFAULT_LAYER_TOGGLES);
  const [methodology, setMethodology] = useState<TaintMethodology>('fifo');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | undefined>();
  const [analyses, setAnalyses] = useState<Map<string, TransactionAnalysis>>(new Map());
  const nextId = useRef(1);

  // PSR (Path Selection → Report) state
  const [psrActive, setPsrActive] = useState(false);
  const [psrMode, setPsrMode] = useState<PsrSelectionMode>('click');
  const [psrDraft, setPsrDraft] = useState<PsrDraft>(EMPTY_DRAFT);
  const [psrReport, setPsrReport] = useState<PsrReportDraft>(() => emptyReportDraft(EMPTY_DRAFT));

  const nodeMap = useMemo(() => {
    const m = new Map<CanvasNodeId, CanvasNode>();
    for (const n of SEED_CASE.nodes) m.set(n.id, n);
    return m;
  }, []);

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

  // ---------- PSR handlers ----------

  const handlePsrStart = useCallback(() => {
    const fresh: PsrDraft = { ...EMPTY_DRAFT, methodology, last_selection_mode: psrMode };
    setPsrDraft(fresh);
    setPsrReport(emptyReportDraft(fresh));
    setPsrActive(true);
    setLastEvent('Path Selection — shift+click hops to build the path');
  }, [methodology, psrMode]);

  const handlePsrCancel = useCallback(() => {
    setPsrActive(false);
    setPsrDraft(EMPTY_DRAFT);
    setPsrReport(emptyReportDraft(EMPTY_DRAFT));
    setLastEvent('Path Selection cancelled');
  }, []);

  const handlePsrShiftClick = useCallback(
    (nodeId: CanvasNodeId) => {
      if (!psrActive) return;
      setPsrDraft((cur) => {
        // No-op if same as last hop.
        const last = cur.ordered_nodes[cur.ordered_nodes.length - 1];
        if (last === nodeId) return cur;
        const next: PsrDraft = {
          ...cur,
          ordered_nodes: [...cur.ordered_nodes, nodeId],
          last_selection_mode: psrMode,
        };
        setPsrReport(emptyReportDraft(next));
        return next;
      });
      setLastEvent(`Added hop → ${String(nodeId).slice(0, 18)}…`);
    },
    [psrActive, psrMode],
  );

  const handlePsrAltClick = useCallback(() => {
    if (!psrActive) return;
    setPsrDraft((cur) => {
      if (cur.ordered_nodes.length === 0) return cur;
      const next: PsrDraft = {
        ...cur,
        ordered_nodes: cur.ordered_nodes.slice(0, -1),
      };
      setPsrReport(emptyReportDraft(next));
      return next;
    });
    setLastEvent('Removed last hop');
  }, [psrActive]);

  const handlePsrRemoveHop = useCallback((index: number) => {
    setPsrDraft((cur) => {
      const next: PsrDraft = {
        ...cur,
        ordered_nodes: cur.ordered_nodes.filter((_, i) => i !== index),
      };
      setPsrReport(emptyReportDraft(next));
      return next;
    });
  }, []);

  const handlePsrChange = useCallback((next: PsrDraft) => {
    setPsrDraft(next);
    setPsrReport((cur) => ({ ...cur, draft: next }));
  }, []);

  const handlePsrSaveDraft = useCallback(() => {
    setLastEvent(`Saved draft “${psrDraft.display_name || 'Untitled path'}” (Phase 1 persists to Supabase)`);
  }, [psrDraft.display_name]);

  const handlePsrPromote = useCallback(() => {
    setLastEvent(`Promoted “${psrDraft.display_name || 'Untitled path'}” → under_review`);
  }, [psrDraft.display_name]);

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
        onPresentInCourt={() => {
          window.location.href = '/court-demo';
        }}
        psrSlot={
          <PsrToolbar
            active={psrActive}
            mode={psrMode}
            hopCount={psrDraft.ordered_nodes.length}
            onActivate={handlePsrStart}
            onCancel={handlePsrCancel}
            onModeChange={setPsrMode}
          />
        }
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
            onShiftClickNode={handlePsrShiftClick}
            onAltClickNode={handlePsrAltClick}
          />

          {/* Helper toast */}
          {analyses.size === 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-context-700/85 text-white text-[11px] font-medium shadow-lg">
              <span className="pointer-events-none">
                Drag to reposition · double-click or right-click a ◆ tx node to analyze
              </span>
              <span className="text-context-100/60 pointer-events-none">|</span>
              <button
                type="button"
                onClick={() =>
                  handleNodeClick(
                    'tx-uniswap-swap' as CanvasNodeId,
                    'transaction',
                  )
                }
                className="underline hover:text-white/80"
              >
                Spawn for the Uniswap swap tx
              </button>
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

      {/* PSR drawer (right-anchored) */}
      <PsrDrawer
        open={psrActive}
        draft={psrDraft}
        report={psrReport}
        nodeMap={nodeMap}
        onClose={handlePsrCancel}
        onChange={handlePsrChange}
        onRemoveHop={handlePsrRemoveHop}
        onSaveDraft={handlePsrSaveDraft}
        onPromote={handlePsrPromote}
      />
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
