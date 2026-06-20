'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import { WalletIntake } from '../../components/wallet/WalletIntake';
import { WalletAnalysisPanel } from '../../components/wallet/WalletAnalysisPanel';
import {
  buildAggregate,
  initialAnalyses,
  runWalletSim,
} from '../../components/wallet/streamSimulator';
import type {
  AddressAnalysis,
  WalletAnalysisRun,
  WalletDraft,
} from '@chainsight/shared-types';

export default function WalletDemoClient() {
  const [draft, setDraft] = useState<WalletDraft | null>(null);
  const [run, setRun] = useState<WalletAnalysisRun | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const [, setToast] = useState<string | undefined>();

  const handleAnalyze = useCallback((d: WalletDraft) => {
    setDraft(d);
    const initial: WalletAnalysisRun = {
      status: 'running',
      started_at: new Date().toISOString(),
      completed_at: null,
      per_address: initialAnalyses(d.addresses),
      aggregate: buildAggregate(initialAnalyses(d.addresses), d.addresses.length),
    };
    setRun(initial);

    const sim = runWalletSim(
      d.addresses,
      (raw, mut) => {
        setRun((cur) => {
          if (!cur) return cur;
          const next: AddressAnalysis[] = cur.per_address.map((r) =>
            r.raw_address === raw ? mut(r) : r,
          );
          return {
            ...cur,
            per_address: next,
            aggregate: buildAggregate(next, d.addresses.length),
          };
        });
      },
      () => {
        setRun((cur) => cur ? { ...cur, status: 'complete', completed_at: new Date().toISOString() } : cur);
      },
    );
    cancelRef.current = sim.cancel;
  }, []);

  const handleBack = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setDraft(null);
    setRun(null);
  }, []);

  const handleGenerateReport = useCallback(() => {
    setToast('Wallet History Analysis Report draft created — visible in the case Reports tab (Phase 1)');
  }, []);

  const handlePromote = useCallback((raw: string) => {
    setToast(`Promoted ${raw.slice(0, 14)}… to BeliefAtom — enters the case ledger (Phase 1)`);
  }, []);

  useEffect(() => {
    return () => { cancelRef.current?.(); };
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-context-50/40">
      <header className="h-12 border-b border-context-100 bg-white/95 backdrop-blur flex items-center gap-3 px-4 shrink-0">
        <Wallet className="size-4 text-context-700" />
        <h1 className="text-[13px] font-semibold text-context-900">Wallet History Analyzer</h1>
        <span className="text-[11px] text-context-500">Surface 6 · v0.5 F21</span>
        <span className="ml-auto text-[11px] text-context-500">
          {draft ? draft.name : 'New wallet'}
        </span>
      </header>

      <main className="flex-1 min-h-0">
        {draft && run ? (
          <WalletAnalysisPanel
            draft={draft}
            run={run}
            onBack={handleBack}
            onGenerateReport={handleGenerateReport}
            onPromoteAddress={handlePromote}
          />
        ) : (
          <WalletIntake onAnalyze={handleAnalyze} />
        )}
      </main>
    </div>
  );
}
