/**
 * MemoryKv: in-process key/value store implementing the small subset of
 * Redis commands ChainSight's caches and circuit breaker use.
 *
 * Replaces Redis for caching. Each process (API, worker) keeps its own
 * copy, which is acceptable: everything stored here is a cache or a
 * provider-health hint, never a source of truth. Durable data lives in
 * Postgres (atoms, events, belief.cache_entries).
 *
 * Supported: get, set (with 'EX' seconds), del, expire, hmget, hset, sadd,
 * smembers, multi().set/sadd/expire.exec(). Entries are evicted on read
 * after their TTL, and a size cap evicts the oldest entries first.
 */

export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): Promise<'OK'>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
  hmget(key: string, ...fields: string[]): Promise<Array<string | null>>;
  hset(key: string, values: Record<string, string | number>): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
  multi(): KvPipeline;
}

export interface KvPipeline {
  set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): KvPipeline;
  sadd(key: string, ...members: string[]): KvPipeline;
  expire(key: string, ttlSeconds: number): KvPipeline;
  exec(): Promise<Array<[Error | null, unknown]>>;
}

type Value = string | Map<string, string> | Set<string>;

interface Entry {
  value: Value;
  expiresAt: number | null;
}

export interface MemoryKvOptions {
  /** Max keys before the oldest are evicted. Default 50,000. */
  maxKeys?: number;
  now?: () => number;
}

export class MemoryKv implements KvStore {
  private readonly data = new Map<string, Entry>();
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(opts: MemoryKvOptions = {}) {
    this.maxKeys = opts.maxKeys ?? 50_000;
    this.now = opts.now ?? (() => Date.now());
  }

  get size(): number {
    return this.data.size;
  }

  private live(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt <= this.now()) {
      this.data.delete(key);
      return undefined;
    }
    return e;
  }

  private write(key: string, value: Value, expiresAt: number | null): void {
    // Re-insert so Map order reflects recency; evict oldest past the cap.
    this.data.delete(key);
    this.data.set(key, { value, expiresAt });
    while (this.data.size > this.maxKeys) {
      const oldest = this.data.keys().next().value;
      if (oldest === undefined) break;
      this.data.delete(oldest);
    }
  }

  private ttlAt(ttlSeconds?: number): number | null {
    return ttlSeconds && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : null;
  }

  async get(key: string): Promise<string | null> {
    const e = this.live(key);
    return e && typeof e.value === 'string' ? e.value : null;
  }

  async set(key: string, value: string, mode?: 'EX', ttlSeconds?: number): Promise<'OK'> {
    this.write(key, value, mode === 'EX' ? this.ttlAt(ttlSeconds) : null);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }

  async expire(key: string, ttlSeconds: number): Promise<number> {
    const e = this.live(key);
    if (!e) return 0;
    e.expiresAt = this.ttlAt(ttlSeconds);
    return 1;
  }

  async hmget(key: string, ...fields: string[]): Promise<Array<string | null>> {
    const e = this.live(key);
    const m = e && e.value instanceof Map ? e.value : null;
    return fields.map((f) => m?.get(f) ?? null);
  }

  async hset(key: string, values: Record<string, string | number>): Promise<number> {
    const e = this.live(key);
    const m = e && e.value instanceof Map ? e.value : new Map<string, string>();
    let added = 0;
    for (const [f, v] of Object.entries(values)) {
      if (!m.has(f)) added++;
      m.set(f, String(v));
    }
    this.write(key, m, e?.expiresAt ?? null);
    return added;
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    const e = this.live(key);
    const s = e && e.value instanceof Set ? e.value : new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) added++;
      s.add(m);
    }
    this.write(key, s, e?.expiresAt ?? null);
    return added;
  }

  async smembers(key: string): Promise<string[]> {
    const e = this.live(key);
    return e && e.value instanceof Set ? [...e.value] : [];
  }

  multi(): KvPipeline {
    const ops: Array<() => Promise<unknown>> = [];
    const pipe: KvPipeline = {
      set: (k, v, mode, ttl) => {
        ops.push(() => this.set(k, v, mode, ttl));
        return pipe;
      },
      sadd: (k, ...m) => {
        ops.push(() => this.sadd(k, ...m));
        return pipe;
      },
      expire: (k, ttl) => {
        ops.push(() => this.expire(k, ttl));
        return pipe;
      },
      exec: async () => {
        const out: Array<[Error | null, unknown]> = [];
        for (const op of ops) {
          try {
            out.push([null, await op()]);
          } catch (e) {
            out.push([e as Error, null]);
          }
        }
        return out;
      },
    };
    return pipe;
  }
}
