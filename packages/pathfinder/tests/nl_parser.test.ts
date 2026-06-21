/**
 * Heuristic NL parser tests.
 */

import { describe, it, expect } from 'vitest';
import { parseHeuristic, extractAddresses } from '../src/nl_parser';

describe('extractAddresses', () => {
  it('finds EVM 0x addresses', () => {
    const r = extractAddresses('follow money from 0x742d35cc6634c0532925a3b844bc9e7595f0beb1');
    expect(r).toHaveLength(1);
    expect(r[0]!.subject_ref).toBe('evm:1_addr:0x742d35cc6634c0532925a3b844bc9e7595f0beb1');
  });

  it('finds bech32 BTC addresses', () => {
    const r = extractAddresses('trace bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh forward');
    expect(r).toHaveLength(1);
    expect(r[0]!.subject_ref.startsWith('btc:mainnet_addr:bc1q')).toBe(true);
  });

  it('finds pre-formed chain:addr refs', () => {
    const r = extractAddresses('between evm:1_addr:0xabc and evm:1_addr:0xdef');
    expect(r).toHaveLength(2);
  });
});

describe('parseHeuristic', () => {
  it('parses forward_trace from natural prompt', () => {
    const r = parseHeuristic('where did the money go from 0x742d35cc6634c0532925a3b844bc9e7595f0beb1?');
    expect(r.intent?.kind).toBe('forward_trace');
    expect(r.parser_confidence).toBeGreaterThan(0.7);
  });

  it('parses backward_trace', () => {
    const r = parseHeuristic('where did 0x742d35cc6634c0532925a3b844bc9e7595f0beb1 come from?');
    expect(r.intent?.kind).toBe('backward_trace');
  });

  it('parses between when both addresses present', () => {
    const r = parseHeuristic('show me the path from 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa to 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(r.intent?.kind).toBe('between');
    expect(r.parser_confidence).toBeGreaterThan(0.8);
  });

  it('detects until_kind=exchange', () => {
    const r = parseHeuristic('forward trace 0x742d35cc6634c0532925a3b844bc9e7595f0beb1 until an exchange');
    expect(r.intent?.kind).toBe('forward_trace');
    if (r.intent?.kind === 'forward_trace') expect(r.intent.until_kind).toBe('exchange');
  });

  it('parses cluster_share with percentage', () => {
    const r = parseHeuristic('what is the 30% cluster share for 0xabcabcabcabcabcabcabcabcabcabcabcabcabca?');
    expect(r.intent?.kind).toBe('cluster_share');
    if (r.intent?.kind === 'cluster_share') expect(r.intent.threshold_pct).toBe(30);
  });

  it('uses from_hint when prompt has only target address', () => {
    const r = parseHeuristic('to 0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'evm:1_addr:0xaaaa' as never);
    expect(r.intent?.kind).toBe('between');
  });

  it('returns null intent when no address found', () => {
    const r = parseHeuristic('show me something interesting');
    expect(r.intent).toBeNull();
  });

  it('flags unresolved quoted terms', () => {
    const r = parseHeuristic('trace from "Ransom Crew" 0x742d35cc6634c0532925a3b844bc9e7595f0beb1');
    expect(r.unresolved_terms).toContain('Ransom Crew');
  });
});
