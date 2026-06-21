'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePaths, useStartTrace, useTraceJobs } from '../../../../lib/api/hooks';
import { useSSE } from '../../../../lib/api/sse';
import { ApiError } from '../../../../lib/api/fetch';

interface LivePath {
  rank: number;
  hops: number;
  edges: Array<{ tx_hash: string; from_subject: string; to_subject: string; value_native_minor: string }>;
  termination_kind?: string | null;
}

export function CanvasLiveClient({ case_id }: { case_id: string }) {
  const [origin, setOrigin] = useState<string>('evm:1_addr:0xfeedface');
  const [destination, setDestination] = useState<string>('evm:1_addr:0xexchange');
  const [k, setK] = useState(3);
  const req = useMemo(
    () => ({ case_id, origin: [origin], destination: [destination], k }),
    [case_id, origin, destination, k],
  );
  const pathsQuery = usePaths(req);
  const traceJobs = useTraceJobs(case_id);
  const startTrace = useStartTrace();

  const [events, setEvents] = useState<Array<{ kind: string; case_seq?: number; at: string }>>([]);
  useSSE(case_id, {
    onEvent: (evt) => {
      setEvents((cur) => [{ kind: evt.kind, case_seq: evt.case_seq, at: new Date().toLocaleTimeString() }, ...cur].slice(0, 30));
    },
  });

  const paths = ((pathsQuery.data as { paths?: LivePath[] })?.paths ?? []) as LivePath[];

  return (
    <main className="min-h-screen px-6 py-8 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-context-900">Live canvas</h1>
          <p className="text-sm text-context-500">case <code className="bg-context-200 px-1 rounded text-xs">{case_id}</code></p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href={`/cases/${case_id}/court`} className="text-blue-600 hover:underline">Court view</Link>
          <Link href={`/cases/${case_id}/packs`} className="text-blue-600 hover:underline">Packs</Link>
          <Link href="/agency" className="text-blue-600 hover:underline">Agency admin</Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Path query panel ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Pathfinder query</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <label className="block">
                <span className="text-context-600">Origin subject</span>
                <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
              </label>
              <label className="block">
                <span className="text-context-600">Destination subject</span>
                <input value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
              </label>
              <label className="block">
                <span className="text-context-600">k (paths)</span>
                <input type="number" min={1} max={10} value={k} onChange={(e) => setK(Number(e.target.value))} className="mt-1 w-full border border-context-300 rounded px-2 py-1" />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <button
                onClick={() => pathsQuery.refetch()}
                disabled={pathsQuery.isFetching}
                className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {pathsQuery.isFetching ? 'Resolving…' : 'Resolve paths'}
              </button>
              <button
                onClick={() => startTrace.mutate({ case_id, origin: [origin], mode: 'autonomous', max_hops: 3 })}
                disabled={startTrace.isPending}
                className="px-3 py-1.5 rounded border border-context-400 text-context-700 hover:bg-context-100"
              >
                {startTrace.isPending ? 'Queueing…' : 'Start autonomous trace'}
              </button>
              {pathsQuery.error && (
                <span className="text-red-700 text-xs">
                  {(pathsQuery.error as ApiError).status} — {(pathsQuery.error as Error).message}
                </span>
              )}
            </div>
          </div>

          {/* ── Path results table ───────────────────────────────────── */}
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Paths ({paths.length})</h2>
            {paths.length === 0 && !pathsQuery.isFetching && (
              <p className="text-sm text-context-500">No paths yet — set origin + destination and resolve.</p>
            )}
            <ul className="divide-y divide-context-200">
              {paths.map((p) => (
                <li key={p.rank} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Path #{p.rank}</span>
                    <span className="text-xs text-context-500">{p.hops} hops · {p.edges?.length ?? 0} edges</span>
                  </div>
                  {p.termination_kind && (
                    <div className="text-xs text-context-600 mt-0.5">terminates: <code>{p.termination_kind}</code></div>
                  )}
                  <details className="mt-1">
                    <summary className="text-xs text-blue-700 cursor-pointer">show edges</summary>
                    <ul className="font-mono text-[11px] mt-1 space-y-0.5">
                      {(p.edges ?? []).map((e, i) => (
                        <li key={i} className="text-context-700 truncate">{e.from_subject} → {e.to_subject} <span className="text-context-500">({e.tx_hash.slice(0, 14)}…)</span></li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── Live events + traces panel ─────────────────────────────── */}
        <aside className="space-y-4">
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Trace jobs</h2>
            {traceJobs.isLoading && <p className="text-sm text-context-500">Loading…</p>}
            <ul className="divide-y divide-context-200 text-sm">
              {((traceJobs.data as { jobs?: Array<{ job_id: string; status: string; total_hops: number; total_atoms_emitted: number }> })?.jobs ?? []).map((j) => (
                <li key={j.job_id} className="py-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-context-700 truncate">{j.job_id.slice(0, 8)}…</span>
                  <span className="text-xs">
                    <span className={
                      j.status === 'completed' ? 'text-green-700' :
                      j.status === 'running' ? 'text-blue-600' :
                      j.status === 'failed' ? 'text-red-700' : 'text-context-600'
                    }>{j.status}</span>
                    {' · '}{j.total_hops}h / {j.total_atoms_emitted}a
                  </span>
                </li>
              ))}
              {(traceJobs.data as { jobs?: unknown[] })?.jobs?.length === 0 && (
                <li className="text-context-500 py-2 text-sm">No trace jobs yet.</li>
              )}
            </ul>
          </div>

          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Live events (SSE)</h2>
            <ul className="divide-y divide-context-200 text-xs">
              {events.length === 0 && <li className="text-context-500 py-2">Listening…</li>}
              {events.map((e, i) => (
                <li key={i} className="py-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-context-700">{e.kind}</span>
                  <span className="text-context-500">{e.at}{e.case_seq != null ? ` · seq ${e.case_seq}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
