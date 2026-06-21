/**
 * Natural-language query parser (v1.1 §6.7).
 *
 * Phase-1 minimum: regex-based heuristic that recognises four intents
 *   - forward_trace   "where did X go?", "trace from X", "follow X"
 *   - backward_trace  "where did X come from?", "trace to X"
 *   - between         "from X to Y", "between X and Y", "path from X to Y"
 *   - cluster_share   "X% share of cluster Y", "cluster share for X"
 *
 * Addresses are extracted with chain-aware regexes (evm 0x..., btc bc1...,
 * btc 1.../3..., generic chain:addr forms). A confidence is returned so
 * the UI can render an "I think you meant…" chip — never silently dispatch.
 *
 * A BYOK LLM parser via the capability-router can be plugged in later; the
 * service composes the LLM parser then falls back to this heuristic.
 */

import type { NlIntent, SubjectRef } from '@chainsight/shared-types';

export interface NlParseOutput {
  intent: NlIntent | null;
  unresolved_terms: string[];
  parser_confidence: number;
}

/* ─── address extractors ───────────────────────────────────────────────── */

const EVM_ADDR_RE  = /\b0x[a-fA-F0-9]{40}\b/g;
const BTC_BECH32_RE = /\bbc1[ac-hj-np-z02-9]{8,87}\b/gi;
const BTC_LEGACY_RE = /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g;
// Pre-formed subject refs: `<chain>_(addr|tx|cluster):<id>` or legacy `eth:0x...` / `btc:1...`
const CHAIN_ADDR_RE = /\b(?:eth|btc|tron|solana|evm:[0-9]+|btc:[a-z0-9-]+|sol:[a-z0-9-]+)_(?:addr|tx|cluster):[a-zA-Z0-9]{4,}\b/g;
const LEGACY_CHAIN_RE = /\b(?:eth|btc|tron|solana):(?:0x[a-fA-F0-9]{40}|[a-km-zA-HJ-NP-Z1-9]{25,44}|bc1[ac-hj-np-z02-9]{8,87})\b/g;

export interface ExtractedAddress {
  raw: string;
  subject_ref: SubjectRef;
}

export function extractAddresses(text: string): ExtractedAddress[] {
  const found: ExtractedAddress[] = [];
  const seen = new Set<string>();

  const push = (raw: string, subject_ref: string) => {
    const key = subject_ref.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ raw, subject_ref: subject_ref as SubjectRef });
  };

  // Pre-formed chain:addr forms first (both v1.1 `evm:1_addr:` and legacy `eth:0x...`)
  for (const m of text.matchAll(CHAIN_ADDR_RE))   push(m[0], m[0].toLowerCase());
  for (const m of text.matchAll(LEGACY_CHAIN_RE)) push(m[0], m[0].toLowerCase());
  // EVM raw 0x — assume evm:1 (mainnet) unless caller overrides
  for (const m of text.matchAll(EVM_ADDR_RE))   push(m[0], `evm:1_addr:${m[0].toLowerCase()}`);
  // BTC bech32
  for (const m of text.matchAll(BTC_BECH32_RE)) push(m[0], `btc:mainnet_addr:${m[0].toLowerCase()}`);
  // BTC legacy P2PKH/P2SH
  for (const m of text.matchAll(BTC_LEGACY_RE)) push(m[0], `btc:mainnet_addr:${m[0]}`);

  return found;
}

/* ─── intent classifier ────────────────────────────────────────────────── */

const FORWARD_RE  = /\b(forward|forwards?|where (did|does).*go|trace from|follow|downstream|outflow)\b/i;
const BACKWARD_RE = /\b(backward|backwards?|where (did|does).*(come|originate)|trace to|upstream|inflow|source of)\b/i;
const BETWEEN_RE  = /\b(between|from .* to|path .* to|connect.* to)\b/i;
const CLUSTER_RE  = /\b(cluster (share|portion|stake)|share of cluster|fraction.*cluster|(\d+(?:\.\d+)?\s*%))\b/i;
const UNTIL_EX_RE = /\b(until|to)\s+(an?\s+)?(exchange|cex|fiat\s*off-?ramp|mixer)\b/i;

export function parseHeuristic(prompt: string, fromHint?: SubjectRef): NlParseOutput {
  const addrs = extractAddresses(prompt);
  const unresolved = collectUnresolvedTerms(prompt, addrs);

  // Cluster_share intent: must mention "cluster" or a percentage AND an address
  if (CLUSTER_RE.test(prompt) && addrs.length > 0) {
    const pctMatch = prompt.match(/(\d+(?:\.\d+)?)\s*%/);
    const threshold = pctMatch ? Number(pctMatch[1]) : 50;
    return {
      intent: {
        kind: 'cluster_share',
        cluster_ref: addrs[0]!.subject_ref,
        threshold_pct: threshold,
      },
      unresolved_terms: unresolved,
      parser_confidence: 0.7,
    };
  }

  // Between intent: two addresses + connecting language
  if (addrs.length >= 2 && BETWEEN_RE.test(prompt)) {
    return {
      intent: { kind: 'between', from: addrs[0]!.subject_ref, to: addrs[1]!.subject_ref },
      unresolved_terms: unresolved,
      parser_confidence: 0.85,
    };
  }

  // Forward trace
  if (FORWARD_RE.test(prompt)) {
    const from = addrs[0]?.subject_ref ?? fromHint;
    if (from) {
      const untilMatch = UNTIL_EX_RE.exec(prompt);
      const until_kind = untilMatch ? mapUntilKind(untilMatch[3]!) : undefined;
      return {
        intent: { kind: 'forward_trace', from, ...(until_kind ? { until_kind } : {}) },
        unresolved_terms: unresolved,
        parser_confidence: addrs.length > 0 ? 0.8 : 0.55,
      };
    }
  }

  // Backward trace
  if (BACKWARD_RE.test(prompt)) {
    const to = addrs[0]?.subject_ref;
    if (to) {
      return {
        intent: { kind: 'backward_trace', to },
        unresolved_terms: unresolved,
        parser_confidence: 0.8,
      };
    }
  }

  // Fallback: if exactly one address and a from_hint differs, between
  if (addrs.length === 1 && fromHint && fromHint !== addrs[0]!.subject_ref) {
    return {
      intent: { kind: 'between', from: fromHint, to: addrs[0]!.subject_ref },
      unresolved_terms: unresolved,
      parser_confidence: 0.5,
    };
  }

  // Final fallback: one address only → forward trace from it
  if (addrs.length === 1) {
    return {
      intent: { kind: 'forward_trace', from: addrs[0]!.subject_ref },
      unresolved_terms: unresolved,
      parser_confidence: 0.4,
    };
  }

  return { intent: null, unresolved_terms: unresolved, parser_confidence: 0 };
}

function mapUntilKind(raw: string): 'exchange' | 'mixer' | 'fiat_offramp' {
  const r = raw.toLowerCase();
  if (r.includes('mixer')) return 'mixer';
  if (r.includes('fiat') || r.includes('offramp') || r.includes('off-ramp')) return 'fiat_offramp';
  return 'exchange';
}

function collectUnresolvedTerms(prompt: string, addrs: ExtractedAddress[]): string[] {
  // Words wrapped in single or double quotes that didn't resolve to an address.
  const quoted = Array.from(prompt.matchAll(/["']([^"']{2,40})["']/g)).map((m) => m[1]!);
  const addrRaws = new Set(addrs.map((a) => a.raw.toLowerCase()));
  return quoted.filter((q) => !addrRaws.has(q.toLowerCase()));
}
