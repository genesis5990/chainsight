/**
 * Shape materialized case edges (belief.case_subgraph_edges) into the
 * canvas graph (CanvasCaseGraph) plus a flat transfer list. Pure: no I/O.
 */

export interface EdgeRow {
  id: string;
  chain: string;
  from_subject: string;
  to_subject: string;
  edge_kind: string;
  tx_ref: string;
  edge_index: number;
  block_height: number;
  block_time: string;
  value_minor: string;
}

/** Native units per chain prefix, for display. Token amounts stay raw. */
function nativeSymbol(chain: string): { symbol: string; decimals: number } {
  if (chain === 'evm:137') return { symbol: 'POL', decimals: 18 };
  if (chain === 'evm:56') return { symbol: 'BNB', decimals: 18 };
  if (chain.startsWith('evm:')) return { symbol: 'ETH', decimals: 18 };
  if (chain.startsWith('btc')) return { symbol: 'BTC', decimals: 8 };
  return { symbol: '', decimals: 0 };
}

function formatUnits(minor: string, decimals: number): string {
  if (decimals === 0) return minor;
  const neg = minor.startsWith('-');
  const digits = (neg ? minor.slice(1) : minor).replace(/^0+/, '') || '0';
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, '').slice(0, 6);
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '');
}

export function toCanvasGraph(case_id: string, rows: EdgeRow[], truncated: boolean) {
  const addresses = new Map<string, { id: string; address: string; in: number; out: number }>();
  const txs = new Map<string, { id: string; tx_hash: string; chain: string; block_height: number; block_time: string; total: bigint; kinds: Set<string> }>();
  const edges: Array<Record<string, unknown>> = [];

  const addr = (ref: string) => {
    let a = addresses.get(ref);
    if (!a) {
      a = { id: ref, address: ref, in: 0, out: 0 };
      addresses.set(ref, a);
    }
    return a;
  };

  for (const r of rows) {
    const value = BigInt(String(r.value_minor).split('.')[0] || '0');
    const from = addr(r.from_subject);
    const to = addr(r.to_subject);
    from.out++;
    to.in++;
    let t = txs.get(r.tx_ref);
    if (!t) {
      t = {
        id: r.tx_ref,
        tx_hash: r.tx_ref.split('_tx:')[1] ?? r.tx_ref,
        chain: r.chain,
        block_height: Number(r.block_height),
        block_time: r.block_time,
        total: 0n,
        kinds: new Set(),
      };
      txs.set(r.tx_ref, t);
    }
    t.total += value;
    t.kinds.add(r.edge_kind);

    const isToken = r.edge_kind !== 'tx_native';
    const { symbol, decimals } = nativeSymbol(r.chain);
    const shown = isToken ? `${r.value_minor} (token units)` : `${formatUnits(String(value), decimals)} ${symbol}`.trim();
    const base = { absolute_value_native: shown, raw_value_minor: String(value), edge_kind: r.edge_kind, share_of_parent_tx: 1 };
    edges.push({ ...base, id: `${r.id}:in`, source: from.id, target: t.id });
    edges.push({ ...base, id: `${r.id}:out`, source: t.id, target: to.id });
  }

  // share_of_parent_tx: this edge's value over its transaction's total.
  for (const e of edges) {
    const tx = txs.get(String(e.id).endsWith(':in') ? String(e.target) : String(e.source));
    if (tx && tx.total > 0n) e.share_of_parent_tx = Number((BigInt(String(e.raw_value_minor)) * 10_000n) / tx.total) / 10_000;
  }

  // Flat list of observed transfers for the evidence table under the graph.
  const transfers = rows.map((r) => {
    const isToken = r.edge_kind !== 'tx_native';
    const { symbol, decimals } = nativeSymbol(r.chain);
    const raw = String(r.value_minor).split('.')[0] || '0';
    return {
      tx_hash: r.tx_ref.split('_tx:')[1] ?? r.tx_ref,
      chain: r.chain,
      block_height: Number(r.block_height),
      block_time: r.block_time,
      from: r.from_subject.split('_addr:')[1] ?? r.from_subject,
      to: r.to_subject.split('_addr:')[1] ?? r.to_subject,
      edge_kind: r.edge_kind,
      amount: isToken ? `${raw} (token units)` : `${formatUnits(raw, decimals)} ${symbol}`.trim(),
      raw_value_minor: raw,
    };
  });

  const nodes = [
    ...[...addresses.values()].map((a) => ({
      kind: 'address' as const,
      id: a.id,
      address: a.address,
      label: shortAddr(a.address),
      family: 'context' as const,
      entity_icon: 'unattributed' as const,
      marker_icons: [],
      tags: [`in ${a.in}`, `out ${a.out}`],
    })),
    ...[...txs.values()].map((t) => ({
      kind: 'transaction' as const,
      id: t.id,
      tx_hash: t.tx_hash,
      chain: t.chain,
      block_height: t.block_height,
      block_timestamp: t.block_time,
      activity_icon: 'transfer' as const,
      marker_icons: [],
      family: 'context' as const,
      total_value_native: t.kinds.size === 1 && t.kinds.has('tx_native')
        ? `${formatUnits(t.total.toString(), nativeSymbol(t.chain).decimals)} ${nativeSymbol(t.chain).symbol}`
        : undefined,
    })),
  ];

  return {
    case_id,
    case_name: `Case ${case_id.slice(0, 8)}`,
    nodes,
    edges,
    paths: [],
    marks: [],
    active_methodology: 'fifo',
    last_refreshed_at: new Date().toISOString(),
    transfers,
    stats: { addresses: addresses.size, transactions: txs.size, transfers: rows.length, truncated },
  };
}

function shortAddr(ref: string): string {
  const a = ref.split('_addr:')[1] ?? ref;
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
