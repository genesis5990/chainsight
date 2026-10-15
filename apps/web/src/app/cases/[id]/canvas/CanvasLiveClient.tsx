'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePaths, useStartTrace, useTraceJobs } from '../../../../lib/api/hooks';
import { useSSE } from '../../../../lib/api/sse';
import { ApiError } from '../../../../lib/api/fetch';

interface LiveEdge {
  tx_ref: string;
  from_subject: string;
  to_subject: string;
  value_minor: string;
}

interface LivePath {
  nodes: string[];
  edges: LiveEdge[];
}

/** EVM chains served by the Etherscan v2 connector. */
const CHAINS = [
  { id: '1', label: 'Ethereum' },
  { id: '42161', label: 'Arbitrum One' },
  { id: '137', label: 'Polygon PoS' },
  { id: '8453', label: 'Base' },
  { id: '10', label: 'Optimism' },
  { id: '56', label: 'BNB Smart Chain' },
] as const;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Turn what the user typed into a tracer subject ref. Accepts a bare 0x
 * address (combined with the selected chain) or a full `evm:<id>_addr:0x…`
 * subject. Returns null if it is neither.
 */
function toSubject(chainId: string, raw: string): string | null {
  const v = raw.trim();
  const full = /^evm:(\d+)_addr:(0x[0-9a-fA-F]{40})$/.exec(v);
  if (full) return `evm:${full[1]}_addr:${full[2]!.toLowerCase()}`;
  if (EVM_ADDRESS.test(v)) return `evm:${chainId}_addr:${v.toLowerCase()}`;
  return null;
}

export function CanvasLiveClient({ case_id }: { case_id: string }) {
  const [chainId, setChainId] = useState<string>('1');
  const [originInput, setOriginInput] = useState('');
  const [destinationInput, setDestinationInput] = useState('');
  const [k, setK] = useState(3);
  const origin = toSubject(chainId, originInput);
  const destination = toSubject(chainId, destinationInput);
  // Only query paths when both ends are valid subjects.
  const req = useMemo(
    () =>
      origin && destination ? { case_id, origin: [origin], destination: [destination], k } : null,
    [case_id, origin, destination, k],
  );
  const pathsQuery = usePaths(req);
  const traceJobs = useTraceJobs(case_id);
  const startTrace = useStartTrace();

  const [events, setEvents] = useState<Array<{ kind: string; case_seq?: number; at: string }>>([]);
  useSSE(case_id, {
    onEvent: (evt) => {
      const e = evt as { kind?: string; topic?: string; case_seq?: number };
      if (e.topic === 'control') return; // snapshot marker
      setEvents((cur) =>
        [
          {
            kind: e.kind ?? e.topic ?? 'event',
            case_seq: e.case_seq,
            at: new Date().toLocaleTimeString(),
          },
          ...cur,
        ].slice(0, 30),
      );
      // Keep the trace list current as jobs progress and finish.
      if (e.topic === 'trace') void traceJobs.refetch();
    },
  });

  const paths = ((pathsQuery.data as { paths?: LivePath[]; truncated?: boolean })?.paths ??
    []) as LivePath[];

  return (
    <main className="min-h-screen px-6 py-8 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-context-900">Live canvas</h1>
          <p className="text-sm text-context-500">
            case <code className="bg-context-200 px-1 rounded text-xs">{case_id}</code>
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href={`/cases/${case_id}/court`} className="text-blue-600 hover:underline">
            Court view
          </Link>
          <Link href={`/cases/${case_id}/packs`} className="text-blue-600 hover:underline">
            Packs
          </Link>
          <Link href="/agency" className="text-blue-600 hover:underline">
            Agency admin
          </Link>
        </nav>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Path query panel ───────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Pathfinder query</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
              <label className="block">
                <span className="text-context-600">Chain</span>
                <select
                  value={chainId}
                  onChange={(e) => setChainId(e.target.value)}
                  className="mt-1 w-full border border-context-300 rounded px-2 py-1"
                >
                  {CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="text-context-600">Origin address</span>
                <input
                  value={originInput}
                  onChange={(e) => setOriginInput(e.target.value)}
                  placeholder="0x…"
                  spellCheck={false}
                  className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs"
                />
                {originInput && !origin && (
                  <span className="text-xs text-red-700">
                    Enter a 0x address with 40 hex characters.
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-context-600">k (paths)</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={k}
                  onChange={(e) => setK(Number(e.target.value))}
                  className="mt-1 w-full border border-context-300 rounded px-2 py-1"
                />
              </label>
              <label className="block md:col-span-4">
                <span className="text-context-600">Destination address (for path search only)</span>
                <input
                  value={destinationInput}
                  onChange={(e) => setDestinationInput(e.target.value)}
                  placeholder="0x… (optional)"
                  spellCheck={false}
                  className="mt-1 w-full border border-context-300 rounded px-2 py-1 font-mono text-xs"
                />
                {destinationInput && !destination && (
                  <span className="text-xs text-red-700">
                    Enter a 0x address with 40 hex characters.
                  </span>
                )}
              </label>
            </div>
            <div className="mt-3 flex items-center gap-3 text-sm">
              <button
                onClick={() => pathsQuery.refetch()}
                disabled={!req || pathsQuery.isFetching}
                className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
              >
                {pathsQuery.isFetching ? 'Resolving…' : 'Resolve paths'}
              </button>
              <button
                onClick={() =>
                  origin &&
                  startTrace.mutate({ case_id, origin: [origin], mode: 'autonomous', max_hops: 3 })
                }
                disabled={!origin || startTrace.isPending}
                className="px-3 py-1.5 rounded border border-context-400 text-context-700 hover:bg-context-100"
              >
                {startTrace.isPending ? 'Queueing…' : 'Start autonomous trace'}
              </button>
              {startTrace.error && (
                <span role="alert" className="text-red-700 text-xs">
                  Trace not started: {(startTrace.error as Error).message}
                </span>
              )}
              {startTrace.isSuccess && (
                <span className="text-xs text-context-600">Trace queued.</span>
              )}
              {pathsQuery.error && (
                <span className="text-red-700 text-xs">
                  {(pathsQuery.error as ApiError).status}: {(pathsQuery.error as Error).message}
                </span>
              )}
            </div>
          </div>

          {/* ── Path results table ───────────────────────────────────── */}
          <div className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
            <h2 className="text-lg font-semibold mb-3">Paths ({paths.length})</h2>
            {paths.length === 0 && !pathsQuery.isFetching && (
              <p className="text-sm text-context-500">
                No paths yet. Enter an origin and a destination, then resolve.
              </p>
            )}
            <ul className="divide-y divide-context-200">
              {paths.map((p, idx) => (
                <li key={idx} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Path #{idx + 1}</span>
                    <span className="text-xs text-context-500">
                      {p.edges?.length ?? 0} edges · {p.nodes?.length ?? 0} nodes
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="text-xs text-blue-700 cursor-pointer">show edges</summary>
                    <ul className="font-mono text-[11px] mt-1 space-y-0.5">
                      {(p.edges ?? []).map((e, i) => (
                        <li key={i} className="text-context-700 truncate">
                          {e.from_subject} → {e.to_subject}{' '}
                          <span className="text-context-500">({e.tx_ref.slice(0, 14)}…)</span>
                        </li>
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
              {(
                (
                  traceJobs.data as {
                    traces?: Array<{
                      job_id: string;
                      status: string;
                      total_hops: number;
                      total_atoms_emitted: number;
                    }>;
                  }
                )?.traces ?? []
              ).map((j) => (
                <li key={j.job_id} className="py-2 flex items-center justify-between">
                  <span className="font-mono text-xs text-context-700 truncate">
                    {j.job_id.slice(0, 8)}…
                  </span>
                  <span className="text-xs">
                    <span
                      className={
                        j.status === 'completed'
                          ? 'text-green-700'
                          : j.status === 'running'
                            ? 'text-blue-600'
                            : j.status === 'failed'
                              ? 'text-red-700'
                              : 'text-context-600'
                      }
                    >
                      {j.status}
                    </span>
                    {' · '}
                    {j.total_hops}h / {j.total_atoms_emitted}a
                  </span>
                </li>
              ))}
              {(traceJobs.data as { traces?: unknown[] })?.traces?.length === 0 && (
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
                  <span className="text-context-500">
                    {e.at}
                    {e.case_seq != null ? ` · seq ${e.case_seq}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}
