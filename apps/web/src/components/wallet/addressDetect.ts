/**
 * Tiny address-format detector. Phase 0 — heuristic only; Phase 1 will use
 * the real chain-data provider's validation responses.
 */

import type { WalletChain } from '@chainsight/shared-types';

const EVM = /^0x[a-fA-F0-9]{40}$/;
const BTC_BECH32 = /^bc1[ac-hj-np-z02-9]{6,87}$/i;
const BTC_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const SOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export interface DetectResult {
  chain: WalletChain;
  valid: boolean;
  reason?: string;
}

export function detectAddress(raw: string): DetectResult {
  const s = raw.trim();
  if (!s) return { chain: 'unknown', valid: false, reason: 'empty' };
  if (EVM.test(s)) return { chain: 'eth', valid: true };
  if (TRON.test(s)) return { chain: 'tron', valid: true };
  if (BTC_BECH32.test(s) || BTC_LEGACY.test(s)) return { chain: 'btc', valid: true };
  // SOL must come after TRON because TRON addresses start with T which is base58.
  if (SOL.test(s) && !TRON.test(s)) return { chain: 'sol', valid: true };
  return { chain: 'unknown', valid: false, reason: 'unrecognized format' };
}

/** Parse a multi-line textarea or CSV-ish blob into address inputs. */
export function parseAddresses(blob: string): { raw: string; label?: string }[] {
  const out: { raw: string; label?: string }[] = [];
  const seen = new Set<string>();
  for (const lineRaw of blob.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith('#')) continue;
    // CSV-ish: first column is address, second is label.
    const parts = line.split(/[,\t]/).map((p) => p.trim()).filter(Boolean);
    const addr = parts[0];
    if (!addr) continue;
    if (seen.has(addr)) continue;
    seen.add(addr);
    out.push({ raw: addr, label: parts[1] });
  }
  return out;
}
