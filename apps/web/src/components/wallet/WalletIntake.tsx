'use client';

/**
 * Surface 6 \u2014 Wallet intake form. The investigator pastes addresses (or
 * drops a CSV), picks the source + color + name, and hits Analyze.
 */

import { useCallback, useMemo, useState } from 'react';
import { Play, Trash2, Upload } from 'lucide-react';
import clsx from 'clsx';
import {
  DEFAULT_WALLET_ANALYSIS_CONFIG,
  WALLET_SOURCES,
  type PathColor,
  type WalletAddressInput,
  type WalletDraft,
  type WalletSource,
} from '@chainsight/shared-types';
import { detectAddress, parseAddresses } from './addressDetect';

const COLOR_GROUPS: { label: string; values: PathColor[] }[] = [
  { label: 'Cool', values: ['cool_blue', 'cool_teal', 'cool_violet', 'cool_indigo'] },
  { label: 'Warm', values: ['warm_orange', 'warm_red', 'warm_magenta'] },
  { label: 'Primary', values: ['accent_gold', 'accent_lime'] },
  { label: 'Neutral', values: ['neutral_gray'] },
];

const COLOR_HEX: Record<PathColor, string> = {
  cool_blue: '#2563eb',
  cool_teal: '#0d9488',
  cool_violet: '#7c3aed',
  cool_indigo: '#4338ca',
  warm_orange: '#ea580c',
  warm_red: '#dc2626',
  warm_magenta: '#be185d',
  accent_gold: '#d97706',
  accent_lime: '#65a30d',
  neutral_gray: '#6b7280',
};

export interface WalletIntakeProps {
  onAnalyze: (draft: WalletDraft) => void;
  /** True while analysis is running \u2014 disables the Analyze button. */
  busy?: boolean;
}

export function WalletIntake({ onAnalyze, busy }: WalletIntakeProps) {
  const [name, setName] = useState('John Doe \u2014 seized Ledger Nano (2026-04-12)');
  const [description, setDescription] = useState('');
  const [source, setSource] = useState<WalletSource>('forensic_seizure');
  const [sourceProvenance, setSourceProvenance] = useState('Warrant SDIL-2026-0042; seized at the suspect\u2019s residence by FBI Field Office 14.');
  const [color, setColor] = useState<PathColor>('cool_blue');
  const [pasted, setPasted] = useState('');

  const parsed: WalletAddressInput[] = useMemo(() => {
    return parseAddresses(pasted).map(({ raw, label }) => {
      const det = detectAddress(raw);
      return {
        raw_address: raw,
        chain: det.chain,
        valid: det.valid,
        reason: det.reason,
        label_from_source: label,
      };
    });
  }, [pasted]);

  const counts = useMemo(() => {
    const by: Record<string, number> = {};
    let valid = 0;
    for (const a of parsed) {
      if (a.valid) valid++;
      by[a.chain] = (by[a.chain] ?? 0) + 1;
    }
    return { total: parsed.length, valid, invalid: parsed.length - valid, by };
  }, [parsed]);

  const handleSampleClick = useCallback(() => {
    setPasted(SAMPLE_WALLET);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setPasted(text);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const handleAnalyze = useCallback(() => {
    const validAddresses = parsed.filter((a) => a.valid);
    if (validAddresses.length === 0) return;
    onAnalyze({
      name: name.trim() || 'Untitled wallet',
      description,
      source,
      source_provenance: sourceProvenance,
      color,
      addresses: validAddresses,
      config: DEFAULT_WALLET_ANALYSIS_CONFIG,
    });
  }, [parsed, name, description, source, sourceProvenance, color, onAnalyze]);

  return (
    <div className="grid grid-cols-2 gap-6 p-6 max-w-6xl mx-auto">
      {/* Left: metadata */}
      <section className="space-y-4">
        <Field label="WALLET NAME">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. John Doe \u2014 seized Ledger Nano"
            className="w-full text-sm px-2.5 py-1.5 rounded border border-context-100 focus:outline-none focus:border-context-400"
          />
        </Field>

        <Field label="SOURCE">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as WalletSource)}
            className="w-full text-sm px-2 py-1.5 rounded border border-context-100 focus:outline-none focus:border-context-400 bg-white"
          >
            {WALLET_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-context-500 mt-1">{WALLET_SOURCES.find((s) => s.id === source)?.hint}</p>
        </Field>

        <Field label="CHAIN-OF-CUSTODY / PROVENANCE">
          <textarea
            value={sourceProvenance}
            onChange={(e) => setSourceProvenance(e.target.value)}
            rows={3}
            placeholder="Warrant #, who handed it over, when, who recorded the hash..."
            className="w-full text-sm px-2.5 py-1.5 rounded border border-context-100 focus:outline-none focus:border-context-400"
          />
        </Field>

        <Field label="DESCRIPTION (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="One-line context for teammates."
            className="w-full text-sm px-2.5 py-1.5 rounded border border-context-100 focus:outline-none focus:border-context-400"
          />
        </Field>

        <Field label="WALLET COLOR (rings the addresses on canvas)">
          <div className="space-y-2">
            {COLOR_GROUPS.map((g) => (
              <div key={g.label} className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-context-500 w-14">{g.label}</span>
                {g.values.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={clsx(
                      'size-6 rounded-full border-2 transition',
                      color === c ? 'border-context-900 scale-110' : 'border-white shadow-sm',
                    )}
                    style={{ backgroundColor: COLOR_HEX[c] }}
                    title={c}
                  />
                ))}
              </div>
            ))}
          </div>
        </Field>
      </section>

      {/* Right: address intake */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] uppercase tracking-wide text-context-500">
            ADDRESSES (one per line, or CSV: address,label)
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSampleClick}
              className="text-[11px] text-markup-600 hover:underline"
            >
              Load sample
            </button>
            <label className="inline-flex items-center gap-1 text-[11px] text-context-600 cursor-pointer hover:text-context-900">
              <Upload className="size-3" />
              Upload CSV
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
            </label>
            {pasted && (
              <button
                type="button"
                onClick={() => setPasted('')}
                className="text-[11px] text-context-500 hover:text-taint-600 inline-flex items-center gap-1"
              >
                <Trash2 className="size-3" /> Clear
              </button>
            )}
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="relative"
        >
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={14}
            spellCheck={false}
            placeholder={"Drop a CSV, or paste addresses here:\n\n0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1\nbc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,Victim cold wallet\n..."}
            className="w-full text-[12px] font-mono px-2.5 py-2 rounded border border-context-100 focus:outline-none focus:border-context-400"
          />
        </div>

        {/* Validation summary */}
        {parsed.length > 0 && (
          <div className="rounded border border-context-100 bg-context-50/40 p-3 text-[12px]">
            <div className="flex items-center gap-3 mb-2">
              <span className="font-semibold text-context-900">{counts.total} parsed</span>
              <span className="text-clean-700">{counts.valid} valid</span>
              {counts.invalid > 0 && (
                <span className="text-taint-700">{counts.invalid} invalid (will be skipped)</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(counts.by).map(([chain, n]) => (
                <span
                  key={chain}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wide bg-white border border-context-100"
                >
                  <span className={clsx('size-1.5 rounded-full', chainColor(chain))} />
                  {chain} \u00b7 {n}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={busy || counts.valid === 0}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded bg-markup-600 text-white font-semibold text-sm hover:bg-markup-700 disabled:bg-context-200 disabled:cursor-not-allowed"
        >
          <Play className="size-4" />
          Analyze {counts.valid > 0 ? `${counts.valid} address${counts.valid === 1 ? '' : 'es'}` : ''}
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide text-context-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function chainColor(chain: string): string {
  switch (chain) {
    case 'eth': return 'bg-markup-500';
    case 'btc': return 'bg-elevated-500';
    case 'sol': return 'bg-privacy-500';
    case 'tron': return 'bg-taint-500';
    case 'unknown': return 'bg-context-400';
    default: return 'bg-clean-500';
  }
}

const SAMPLE_WALLET = `# Suspect's seized Ledger Nano \u2014 23 addresses across BTC + ETH
# Format: address,optional label
0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1,LedgerLive ETH #1
0x4838B106FCe9647Bdf1E7877BF73cE8B0BAD5f97,LedgerLive ETH #2
0x28C6c06298d514Db089934071355E5743bf21d60,LedgerLive ETH #3
0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503,LedgerLive ETH #4
0xa910f92AcDAf488fa6eF02174fb86208Ad7722ba,LedgerLive ETH #5
bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh,Native segwit #1
bc1q9d4ywgfnd8h43da5tpcxcn6ajv590cg6d3tg6axemvljvt2k76zs50tv4q,Native segwit #2
bc1pmzfrwwndsqmk5yh69yjr5lfgfg4ev8c0tsc06e,Taproot test
3FZbgi29cpjq2GjdwV8eyHuJJnkLtktZc5,P2SH legacy
1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa,Satoshi memorial probe
0xdAC17F958D2ee523a2206206994597C13D831ec7,Possibly Tether contract \u2014 verify
0x6B175474E89094C44Da98b954EedeAC495271d0F,Possibly DAI contract \u2014 verify
0x5754284f345afc66a98fbB0a0Afe71e0F007B949,Tornado Cash 10-ETH? \u2014 verify
TJYeasTPa6gpEEfYYsa1fAR7H6ZNbQa1KE,TRON USDT
TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm,TRON USDT
not-a-real-address,Sanity check \u2014 should be flagged invalid
junk_input_xyz,Another sanity probe
`;
