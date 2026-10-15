/**
 * Pathfinder result cache (v1.1 §6.9).
 *
 * `paths:{case_id}:{recipe_hash}` with 5-minute TTL. Two queries with the
 * same recipe inputs collide on this key and hit Redis; different inputs
 * produce different keys so no explicit invalidation is needed.
 */

import type { KvStore } from '@chainsight/shared-types';
import type { PathResult } from '@chainsight/shared-types';

const DEFAULT_TTL_SECONDS = 300;

export interface PathResultCache {
  get(case_id: string, recipe_hash: string): Promise<PathResult[] | null>;
  set(case_id: string, recipe_hash: string, paths: PathResult[]): Promise<void>;
  /** Drop every cached result for a case (its graph changed). */
  invalidateCase?(case_id: string): Promise<void>;
}

export class RedisPathResultCache implements PathResultCache {
  constructor(
    private readonly redis: KvStore | null,
    private readonly ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ) {}

  async get(case_id: string, recipe_hash: string): Promise<PathResult[] | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.key(case_id, recipe_hash));
      if (!raw) return null;
      return JSON.parse(raw) as PathResult[];
    } catch {
      return null;
    }
  }

  async set(case_id: string, recipe_hash: string, paths: PathResult[]): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.set(this.key(case_id, recipe_hash), JSON.stringify(paths), 'EX', this.ttlSeconds);
    } catch { /* best-effort */ }
  }

  private key(case_id: string, recipe_hash: string): string {
    return `paths:${case_id}:${recipe_hash}`;
  }
}

/**
 * In-process result cache with a size cap and per-case invalidation. The
 * default for API processes: the pathfinder clears a case's entries when
 * the worker reports a graph update (belief.case_stream 'graph-updated').
 */
export class MemoryPathResultCache implements PathResultCache {
  private readonly store = new Map<string, PathResult[]>();

  constructor(private readonly maxEntries: number = 2000) {}

  async get(case_id: string, recipe_hash: string): Promise<PathResult[] | null> {
    return this.store.get(`${case_id}|${recipe_hash}`) ?? null;
  }
  async set(case_id: string, recipe_hash: string, paths: PathResult[]): Promise<void> {
    const key = `${case_id}|${recipe_hash}`;
    this.store.delete(key);
    this.store.set(key, paths);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }
  async invalidateCase(case_id: string): Promise<void> {
    const prefix = `${case_id}|`;
    for (const k of [...this.store.keys()]) if (k.startsWith(prefix)) this.store.delete(k);
  }
}
