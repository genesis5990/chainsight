/**
 * CaseStream: live case events stored in Postgres (belief.case_stream).
 *
 * Replaces Redis pub/sub. Publishers append rows; readers poll for rows with
 * an id greater than the last one they saw. Rows are pruned after 24 hours;
 * durable history stays in belief.events.
 *
 * `publish(channel, message)` keeps the old Redis channel convention so
 * existing publishers only change their type, not their call sites:
 *
 *   case:<case_id>:<topic>[:<topic_key>]:<namespace>
 *
 *   case:<id>:trace:<job_id>:dev   → topic 'trace', topic_key <job_id>
 *   case:<id>:graph-updated:dev    → topic 'graph-updated'
 *
 * The trailing namespace is ignored: each environment has its own database.
 */

/** Anything that can publish a string message on a channel (the old Redis shape). */
export interface EventPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export interface CaseStreamRow {
  id: number;
  case_id: string;
  topic: string;
  topic_key: string | null;
  payload: unknown;
  created_at: string;
}

/** Minimal structural view of a supabase-js client (service role). */
export interface CaseStreamClient {
  schema(name: string): {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from(table: string): any;
    rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
}

export interface CaseStreamOptions {
  /** Poll interval for tail(). Default 1000 ms. */
  pollMs?: number;
  /** Max rows per poll. Default 200. */
  batch?: number;
  /** Logger for swallowed errors. Default console.warn. */
  warn?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export interface TailFilter {
  case_id?: string;
  topics?: string[];
  /** Start after this id. Default: the current latest id (live events only). */
  afterId?: number;
  signal?: AbortSignal;
}

export function parseChannel(channel: string): { case_id: string; topic: string; topic_key: string | null } | null {
  const parts = channel.split(':');
  if (parts.length < 4 || parts[0] !== 'case') return null;
  const case_id = parts[1]!;
  const topic = parts[2]!;
  const middle = parts.slice(3, -1);
  return { case_id, topic, topic_key: middle.length ? middle.join(':') : null };
}

export class CaseStream implements EventPublisher {
  private readonly pollMs: number;
  private readonly batch: number;
  private readonly warn: (msg: string, ctx?: Record<string, unknown>) => void;

  constructor(
    private readonly client: CaseStreamClient,
    opts: CaseStreamOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 1000;
    this.batch = opts.batch ?? 200;
    this.warn = opts.warn ?? ((msg, ctx) => console.warn(msg, ctx));
  }

  /** Redis-compatible publish. Never throws: event fan-out must not fail the caller. */
  async publish(channel: string, message: string): Promise<number> {
    const parsed = parseChannel(channel);
    if (!parsed) {
      this.warn('[case_stream] unrecognised channel, dropped', { channel });
      return 0;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      payload = { raw: message };
    }
    return this.append(parsed.case_id, parsed.topic, parsed.topic_key, payload);
  }

  /** Append one event. Never throws. Returns 1 on success, 0 on failure. */
  async append(case_id: string, topic: string, topic_key: string | null, payload: unknown): Promise<number> {
    try {
      const { error } = await this.client
        .schema('belief')
        .from('case_stream')
        .insert({ case_id, topic, topic_key, payload });
      if (error) {
        this.warn('[case_stream] append failed', { case_id, topic, error: error.message });
        return 0;
      }
      return 1;
    } catch (e) {
      this.warn('[case_stream] append threw', { case_id, topic, error: (e as Error).message });
      return 0;
    }
  }

  /** Highest id matching the filter, or 0. */
  async latestId(filter: Pick<TailFilter, 'case_id' | 'topics'> = {}): Promise<number> {
    let q = this.client.schema('belief').from('case_stream').select('id');
    if (filter.case_id) q = q.eq('case_id', filter.case_id);
    if (filter.topics?.length) q = q.in('topic', filter.topics);
    const { data, error } = await q.order('id', { ascending: false }).limit(1);
    if (error) throw new Error(`case_stream latestId failed: ${error.message}`);
    const row = (data as Array<{ id: number }> | null)?.[0];
    return row ? Number(row.id) : 0;
  }

  /** Rows after `afterId`, oldest first. */
  async readSince(afterId: number, filter: Pick<TailFilter, 'case_id' | 'topics'> = {}): Promise<CaseStreamRow[]> {
    let q = this.client
      .schema('belief')
      .from('case_stream')
      .select('id, case_id, topic, topic_key, payload, created_at')
      .gt('id', afterId);
    if (filter.case_id) q = q.eq('case_id', filter.case_id);
    if (filter.topics?.length) q = q.in('topic', filter.topics);
    const { data, error } = await q.order('id', { ascending: true }).limit(this.batch);
    if (error) throw new Error(`case_stream read failed: ${error.message}`);
    return ((data as CaseStreamRow[] | null) ?? []).map((r) => ({ ...r, id: Number(r.id) }));
  }

  /**
   * Async iterator over new rows. Polls every pollMs until the signal aborts.
   * Read errors are logged and retried on the next tick.
   */
  async *tail(filter: TailFilter = {}): AsyncIterable<CaseStreamRow> {
    const { signal } = filter;
    let cursor = filter.afterId;
    while (cursor === undefined && !signal?.aborted) {
      try {
        cursor = await this.latestId(filter);
      } catch (e) {
        this.warn('[case_stream] latestId failed, retrying', { error: (e as Error).message });
        await sleep(this.pollMs, signal);
      }
    }
    while (!signal?.aborted) {
      let rows: CaseStreamRow[] = [];
      try {
        rows = await this.readSince(cursor ?? 0, filter);
      } catch (e) {
        this.warn('[case_stream] poll failed, retrying', { error: (e as Error).message });
      }
      for (const row of rows) {
        if (signal?.aborted) return;
        cursor = row.id;
        yield row;
      }
      // A full batch means more may be waiting: read again immediately.
      if (rows.length < this.batch) await sleep(this.pollMs, signal);
    }
  }

  /** Delete rows older than `keep` (Postgres interval text). Returns rows removed. */
  async prune(keep = '24 hours'): Promise<number> {
    const { data, error } = await this.client.schema('belief').rpc('prune_case_stream', { p_keep: keep });
    if (error) throw new Error(`case_stream prune failed: ${error.message}`);
    return Number(data ?? 0);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
