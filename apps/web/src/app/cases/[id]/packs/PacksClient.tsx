'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useBuildPack, useDownloadPack, usePackList, useVerifyPack } from '../../../../lib/api/hooks';
import type { PackStatusRowDto, VerificationResultDto } from '../../../../lib/api/hooks';

function verdictChip(verdict: 'pass' | 'warn' | 'fail' | undefined, label?: string) {
  if (!verdict) return null;
  const cls =
    verdict === 'pass' ? 'bg-green-100 text-green-800 border-green-300' :
    verdict === 'warn' ? 'bg-yellow-100 text-yellow-800 border-yellow-300' :
    'bg-red-100 text-red-800 border-red-300';
  return <span className={`text-xs px-2 py-0.5 rounded border ${cls}`}>{label ?? verdict.toUpperCase()}</span>;
}

function signatureChip(row: PackStatusRowDto) {
  if (!row.signature) {
    return <span className="text-xs px-2 py-0.5 rounded border bg-context-100 text-context-600 border-context-300">UNSIGNED</span>;
  }
  return <span className="text-xs px-2 py-0.5 rounded border bg-blue-50 text-blue-700 border-blue-300" title={`signer ${row.signer_id ?? 'unknown'}`}>SIGNED</span>;
}

export function PacksClient({ case_id }: { case_id: string }) {
  const list = usePackList(case_id);
  const build = useBuildPack();
  const verify = useVerifyPack();
  const download = useDownloadPack();
  const [verifyResults, setVerifyResults] = useState<Record<string, VerificationResultDto>>({});
  const [finalize, setFinalize] = useState(true);

  async function onVerify(pack_id: string) {
    const r = await verify.mutateAsync(pack_id);
    setVerifyResults((prev) => ({ ...prev, [pack_id]: r }));
  }
  async function onDownload(pack_id: string) {
    const r = await download.mutateAsync(pack_id);
    window.open(r.signed_url, '_blank', 'noopener,noreferrer');
  }

  const packs: PackStatusRowDto[] = (list.data?.packs ?? []) as PackStatusRowDto[];

  return (
    <main className="min-h-screen px-6 py-8 max-w-5xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-context-900">Reproducibility packs</h1>
          <p className="text-sm text-context-500">case <code className="bg-context-200 px-1 rounded text-xs">{case_id}</code></p>
        </div>
        <nav className="flex gap-3 text-sm">
          <Link href={`/cases/${case_id}/canvas`} className="text-blue-600 hover:underline">Canvas</Link>
          <Link href={`/cases/${case_id}/court`} className="text-blue-600 hover:underline">Court view</Link>
        </nav>
      </header>

      <section className="border border-context-300 bg-white rounded-lg p-4 mb-6 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Build a new pack</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={finalize} onChange={(e) => setFinalize(e.target.checked)} />
            <span>Finalize (lock atoms per G5)</span>
          </label>
          <button
            onClick={() => build.mutate({ case_id, finalize })}
            disabled={build.isPending}
            className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {build.isPending ? 'Building…' : 'Build pack'}
          </button>
          {build.error && <span className="text-xs text-red-700">{(build.error as Error).message}</span>}
          {build.data && (
            <span className="text-xs text-green-700">Built <code>{build.data.pack_id.slice(0, 8)}</code> · {build.data.atoms_locked} atoms locked</span>
          )}
        </div>
      </section>

      <section className="border border-context-300 bg-white rounded-lg p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">Pack history</h2>
        {list.isLoading && <p className="text-sm text-context-500">Loading…</p>}
        {!list.isLoading && packs.length === 0 && (
          <p className="text-sm text-context-500">No packs yet — build the first one above.</p>
        )}
        <ul className="divide-y divide-context-200">
          {packs.map((p) => {
            const v = verifyResults[p.pack_id];
            return (
              <li key={p.pack_id} className="py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-context-100 px-1 rounded">{p.pack_id.slice(0, 8)}…</code>
                    {verdictChip(p.status === 'finalized' ? 'pass' : p.status === 'failed' ? 'fail' : 'warn', p.status.toUpperCase())}
                    {signatureChip(p)}
                    {v && verdictChip(v.overall, `VERIFY ${v.overall.toUpperCase()}`)}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onVerify(p.pack_id)}
                      disabled={verify.isPending}
                      className="px-2 py-0.5 text-xs rounded border border-context-400 hover:bg-context-100"
                    >Verify</button>
                    <button
                      onClick={() => onDownload(p.pack_id)}
                      disabled={download.isPending || !p.storage_ref}
                      className="px-2 py-0.5 text-xs rounded border border-context-400 hover:bg-context-100 disabled:opacity-50"
                    >Download</button>
                  </div>
                </div>
                <div className="text-xs text-context-600 mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><span className="text-context-500">manifest_hash</span><br /><code className="text-[11px]">{p.manifest_hash.slice(0, 16)}…</code></div>
                  <div><span className="text-context-500">atoms</span><br />{p.total_atoms}</div>
                  <div><span className="text-context-500">traces</span><br />{p.total_traces}</div>
                  <div><span className="text-context-500">built</span><br />{new Date(p.built_at).toLocaleString()}</div>
                </div>
                {v?.errors?.length ? (
                  <ul className="text-xs text-red-700 mt-2 list-disc list-inside">
                    {v.errors.map((err, i) => <li key={i}>{err}</li>)}
                  </ul>
                ) : null}
                {v?.signature_valid != null && (
                  <div className="text-xs mt-1">
                    Signature: {v.signature_valid ? '✓ valid' : `✗ ${v.signature_reason ?? 'invalid'}`}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
