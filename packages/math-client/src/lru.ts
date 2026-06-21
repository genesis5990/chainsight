/**
 * Tiny LRU keyed by recipe_hash — Math results are pure functions of their
 * inputs, so the cache never needs invalidation.
 */

export class RecipeLru<V> {
  private readonly capacity: number;
  private readonly map: Map<string, V>;

  constructor(capacity = 10_000) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    // Refresh recency: delete + reinsert.
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    else if (this.map.size >= this.capacity) {
      // Drop the oldest entry.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
}
