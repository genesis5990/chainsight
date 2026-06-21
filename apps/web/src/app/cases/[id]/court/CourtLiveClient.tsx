'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePaths } from '../../../../lib/api/hooks';

interface Edge {
  tx_hash: string;
  from_subject: string;
  to_subject: string;
  value_native_minor: string;
  block_height?: number;
  block_time_utc?: string;
}

interface LivePath {
  rank: number;
  hops: number;
  edges: Edge[];
  termination_kind?: string | null;
}

function shortRef(s: string, max = 18): string {
  if (s.length <= max) return s;
  return `${s.slice(0, 12)}…${s.slice(-4)}`;
}

export function CourtLiveClient({ case_id }: { case_id: string }) {
  const [origin, setOrigin] = useState('evm:1_addr:0xfeedface');
  const [destination, setDestination] = useState('evm:1_addr:0xexchange');
  const req = useMemo(() => ({ case_id, origin: [origin], destination: [destination], k: 5 }), [case_id, origin, destination]);
  const pathsQuery = usePaths(req);
  const paths = ((pathsQuery.data as { paths?: LivePath[] })?.paths ?? []) as LivePath[];

  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const selected = paths.find((p) => p.rank === selectedRank) ?? paths[0] ?? null;

  // Sankey: each edge value relative to the path total.
  const sankey = useMemo(() => {
    if (!selected) return [];
    const totals = selected.edges.map((e) => {
      try { return BigInt(e.value_native_minor); } catch { return 0n; }
    });
    const max = totals.reduce((a, b) => (b > a ? b : a), 0n);
    return selected.edges.map((e, i) => ({
      ratio: max > 0n ? Number((totals[i]! * 1000n) / max) / 1000 : 0,
      edge: e,
    }));
  }, [selected]);

  return (
    <main className="min-h-screen px-6 py-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-context-900">Court view</h1>
          <p className="text-sm text-context-500">Read-only path with hop-by-hop navigation and a value Sankey.</p>
        </div>
        <nav className="text-sm">
          <Link href={`/cases/${case_id}/canvas`} className="text-blue-600 hover:underline">← Back to canvas</Link>
        </nav>
      </header>

      <section className="border border-context-300 bg-white rounded-lg p-4 mb-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="text-context-600">Origin</span>
            <input value={origin} onChange={(e) => setOrigin(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
          </label>
          <label className="block">
            <span className="text-context-600">Destination</span>
            <input value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs" />
          </label>
        </div>
        <button
          onClick={() => pathsQuery.refetch()}
          disabled={pathsQuery.isFetching}
          className="mt-3 px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 text-sm"
        >
          {pathsQuery.isFetching ? 'Resolving…' : 'Resolve paths'}
        </button>
      </section>

      {selected ? (
        <>
          <section className="border border-context-300 bg-white rounded-lg p-4 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Path #{selected.rank} — {selected.hops} hops</h2>
              <div className="text-sm">
                {paths.map((p) => (
                  <button
                    key={p.rank}
                    onClick={() => setSelectedRank(p.rank)}
                    className={`px-2 py-0.5 rounded mr-1 text-xs border ${p.rank === selected.rank ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-context-300 text-context-700'}`}
                  >
                    #{p.rank}
                  </button>
                ))}
              </div>
            </div>

            <ol className="space-y-2">
              {selected.edges.map((e, i) => (
                <li key={`${e.tx_hash}-${i}`} className="flex items-center justify-between p-2 rounded bg-context-100 border border-context-200">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="inline-flex items-center justify-center w-6 h-6 text-xs font-mono rounded-full bg-context-300 text-context-800">{i + 1}</span>
                    <span className="font-mono text-xs text-context-700">{shortRef(e.from_subject)} → {shortRef(e.to_subject)}</span>
                  </div>
                  <span className="text-xs text-context-600 font-mono">{e.value_native_minor}</span>
                </li>
              ))}
            </ol>

            {selected.termination_kind && (
              <div className="mt-3 text-xs text-context-600">Terminates at: <code className="bg-context-200 px-1 rounded">{selected.termination_kind}</code></div>
            )}
          </section>

          <section className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Value flow (Sankey)</h2>
            <ul className="space-y-2">
              {sankey.map((s, i) => (
                <li key={i} className="text-xs">
                  <div className="flex items-center justify-between mb-1 text-context-700 font-mono">
                    <span>{shortRef(s.edge.from_subject)} → {shortRef(s.edge.to_subject)}</span>
                    <span>{s.edge.value_native_minor}</span>
                  </div>
                  <div className="h-2 bg-context-200 rounded overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${Math.max(s.ratio * 100, 1)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      ) : (
        <p className="text-sm text-context-500">No paths to display.</p>
      )}
    </main>
  );
}
