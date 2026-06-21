import { describe, it, expect } from 'vitest';
import { FrontierQueue, frontierPriority } from '../src/priority_queue';
import type { FrontierEntry } from '@chainsight/shared-types';

function entry(node: string, hop: number, score: number): FrontierEntry {
  return {
    node: node as FrontierEntry['node'],
    carried_lots: [],
    hop_index: hop,
    parent_atom_id: null,
    priority_score: score,
  };
}

describe('FrontierQueue', () => {
  it('pops in priority order (lower first)', () => {
    const q = new FrontierQueue();
    q.push(entry('A', 0, 3));
    q.push(entry('B', 0, 1));
    q.push(entry('C', 0, 2));
    expect(q.pop()?.node).toBe('B');
    expect(q.pop()?.node).toBe('C');
    expect(q.pop()?.node).toBe('A');
    expect(q.pop()).toBeUndefined();
  });

  it('tie-breaks deterministically on (hop_index, node)', () => {
    const q = new FrontierQueue();
    q.push(entry('Z', 1, 5));
    q.push(entry('A', 1, 5));
    q.push(entry('A', 0, 5));
    expect(q.pop()?.node).toBe('A');     // hop 0 wins on tie
    expect(q.pop()?.node).toBe('A');     // (A, hop 1) before (Z, hop 1)
    expect(q.pop()?.node).toBe('Z');
  });

  it('size is consistent through push/pop', () => {
    const q = new FrontierQueue();
    expect(q.size).toBe(0);
    q.push(entry('A', 0, 1));
    q.push(entry('B', 0, 2));
    expect(q.size).toBe(2);
    q.pop();
    expect(q.size).toBe(1);
  });
});

describe('frontierPriority', () => {
  it('lower hop + higher value = lower score', () => {
    const shallowHigh = frontierPriority(0, 10n ** 19n);
    const deepLow = frontierPriority(5, 10n ** 12n);
    expect(shallowHigh).toBeLessThan(deepLow);
  });

  it('handles zero taint gracefully', () => {
    const score = frontierPriority(2, 0n);
    expect(Number.isFinite(score)).toBe(true);
  });
});
