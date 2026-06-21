/**
 * Min-heap priority queue for frontier expansion (v1.1 §7.5).
 *
 * Lower priority_score is popped first. Stable secondary tie-breaker on
 * (hop_index, node) keeps traversal deterministic across runs.
 */

import type { FrontierEntry } from '@chainsight/shared-types';

export class FrontierQueue {
  private readonly heap: FrontierEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: FrontierEntry): void {
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): FrontierEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const root = this.heap[0]!;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  peek(): FrontierEntry | undefined {
    return this.heap[0];
  }

  clear(): void {
    this.heap.length = 0;
  }

  toArray(): FrontierEntry[] {
    return this.heap.slice();
  }

  private less(a: FrontierEntry, b: FrontierEntry): boolean {
    if (a.priority_score !== b.priority_score) return a.priority_score < b.priority_score;
    if (a.hop_index !== b.hop_index) return a.hop_index < b.hop_index;
    return a.node < b.node;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.heap[i]!, this.heap[parent]!)) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent]!, this.heap[i]!];
        i = parent;
      } else break;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = i * 2 + 1;
      const r = i * 2 + 2;
      let best = i;
      if (l < n && this.less(this.heap[l]!, this.heap[best]!)) best = l;
      if (r < n && this.less(this.heap[r]!, this.heap[best]!)) best = r;
      if (best === i) break;
      [this.heap[i], this.heap[best]] = [this.heap[best]!, this.heap[i]!];
      i = best;
    }
  }
}

/**
 * Compute a frontier priority score per spec §7.5:
 *
 *   score = hop_index - 0.5 * log10(total_taint_minor)
 *
 * Lower score = expand sooner. High-value branches at shallow hops have
 * the lowest scores so they expand first.
 */
export function frontierPriority(hop_index: number, total_taint_minor: bigint): number {
  if (total_taint_minor <= 0n) return hop_index + 100; // sink unfunded branches
  const log10 = Math.log10(Number(total_taint_minor));
  return hop_index * 1.0 - log10 * 0.5;
}
