/**
 * Pathfinder result cache (v1.1 §6.9).
 *
 * `paths:{case_id}:{recipe_hash}` with 5-minute TTL. Two queries with the
 * same recipe inputs collide on this key and hit Redis; different inputs
 * produce different keys so no explicit invalidation is needed.
 */

import type Redis from 'ioredis';
import type { PathResult } from '@chainsight/shared-types';

const DEFAULT_TTL_SECONDS = 300;

export interface PathResultCache {
  get(case_id: string, recipe_hash: string): Promise<PathResult[] | null>;
  set(case_id: string, recipe_hash: string, paths: PathResult[]): Promise<void>;
}

export class RedisPathResultCache implements PathResultCache {
  constructor(
    private readonly redis: Redis | null,
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

/** In-memory implementation for tests. */
export class MemoryPathResultCache implements PathResultCache {
  private readonly store = new Map<string, PathResult[]>();

  async get(case_id: string, recipe_hash: string): Promise<PathResult[] | null> {
    return this.store.get(`${case_id}|${recipe_hash}`) ?? null;
  }
  async set(case_id: string, recipe_hash: string, paths: PathResult[]): Promise<void> {
    this.store.set(`${case_id}|${recipe_hash}`, paths);
  }
}
