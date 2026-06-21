/**
 * Trace job persistence + idempotency dedupe + cancellation flag.
 *
 * Reads/writes belief.trace_jobs via Supabase service-role client.
 */

import type {
  CaseId,
  TerminationReason,
  TraceJob,
  TraceJobStatus,
  TraceMode,
} from '@chainsight/shared-types';

export interface TraceJobStore {
  /**
   * Insert a queued job. If a row with (case_id, idempotency_key) already
   * exists, returns { deduplicated: true, existing_id }.
   */
  insertQueued(input: TraceJobInsertInput): Promise<TraceJobInsertResult>;

  markRunning(job_id: string): Promise<void>;
  markCancelled(job_id: string): Promise<void>;
  markCompleted(job_id: string, summary: TraceJobCompletion): Promise<void>;
  markFailed(job_id: string, error: string): Promise<void>;

  byId(job_id: string): Promise<TraceJobStatus | null>;
  isCancelled(job_id: string): Promise<boolean>;
  listForCase(case_id: CaseId, limit?: number): Promise<TraceJobStatus[]>;
}

export interface TraceJobInsertInput {
  job_id: string;
  case_id: CaseId;
  initiated_by_id: string;
  mode: TraceMode;
  origin: string[];
  direction: string;
  methodology: string;
  params: Record<string, unknown>;
  idempotency_key: string;
}

export interface TraceJobInsertResult {
  job_id: string;
  deduplicated: boolean;
}

export interface TraceJobCompletion {
  total_hops: number;
  total_atoms_emitted: number;
  total_budget_spent_usd: number;
  provider_response_hashes: string[];
  termination_reason: TerminationReason;
  completed_at: string;
}

/* ─── Supabase impl ────────────────────────────────────────────────────── */

export interface SupabaseTraceJobClient {
  schema(name: string): {
    from(table: string): SupabaseTable;
  };
}

interface SupabaseTable {
  insert(row: Record<string, unknown>, opts?: { returning?: string }): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string; code?: string } | null }>;
  update(row: Record<string, unknown>): {
    eq(col: string, val: unknown): Promise<{ error: { message: string } | null }>;
  };
  select(cols: string): SupabaseSelect;
}

interface SupabaseSelect {
  eq(col: string, val: unknown): {
    eq?(col: string, val: unknown): unknown;
    order?(col: string, opts?: { ascending?: boolean }): {
      limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
    };
    limit(n: number): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  };
}

export class SupabaseTraceJobStore implements TraceJobStore {
  constructor(private readonly client: SupabaseTraceJobClient) {}

  async insertQueued(input: TraceJobInsertInput): Promise<TraceJobInsertResult> {
    const row = {
      id: input.job_id,
      case_id: input.case_id,
      initiated_by_id: input.initiated_by_id,
      mode: input.mode,
      origin: input.origin,
      direction: input.direction,
      methodology: input.methodology,
      params: input.params,
      idempotency_key: input.idempotency_key,
      status: 'queued',
    };
    const { error } = await this.client.schema('belief').from('trace_jobs').insert(row);
    if (error) {
      // Unique violation on (case_id, idempotency_key) → look up existing job.
      const isUniqueViolation = error.code === '23505' || /duplicate key|unique/i.test(error.message);
      if (isUniqueViolation) {
        const existing = await this.byIdemKey(input.case_id, input.idempotency_key);
        if (existing) return { job_id: existing.job_id, deduplicated: true };
      }
      throw new Error(`trace_jobs insert failed: ${error.message}`);
    }
    return { job_id: input.job_id, deduplicated: false };
  }

  async markRunning(job_id: string): Promise<void> {
    await this.client.schema('belief').from('trace_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', job_id);
  }

  async markCancelled(job_id: string): Promise<void> {
    await this.client.schema('belief').from('trace_jobs').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', job_id);
  }

  async markCompleted(job_id: string, c: TraceJobCompletion): Promise<void> {
    await this.client.schema('belief').from('trace_jobs').update({
      status: 'completed',
      completed_at: c.completed_at,
      total_hops: c.total_hops,
      total_atoms_emitted: c.total_atoms_emitted,
      total_budget_spent_usd: c.total_budget_spent_usd,
      provider_response_hashes: c.provider_response_hashes,
      termination_reason: c.termination_reason,
    }).eq('id', job_id);
  }

  async markFailed(job_id: string, error: string): Promise<void> {
    await this.client.schema('belief').from('trace_jobs').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error,
    }).eq('id', job_id);
  }

  async byId(job_id: string): Promise<TraceJobStatus | null> {
    try {
      const { data, error } = await this.client.schema('belief').from('trace_jobs')
        .select('id, case_id, mode, status, queued_at, started_at, completed_at, cancelled_at, total_hops, total_atoms_emitted, total_budget_spent_usd, termination_reason, error')
        .eq('id', job_id).maybeSingle();
      if (error || !data) return null;
      return mapRow(data);
    } catch { return null; }
  }

  async isCancelled(job_id: string): Promise<boolean> {
    const s = await this.byId(job_id);
    return s?.status === 'cancelled';
  }

  async listForCase(case_id: CaseId, limit = 50): Promise<TraceJobStatus[]> {
    try {
      const sel = this.client.schema('belief').from('trace_jobs')
        .select('id, case_id, mode, status, queued_at, started_at, completed_at, cancelled_at, total_hops, total_atoms_emitted, total_budget_spent_usd, termination_reason, error')
        .eq('case_id', case_id);
      const ordered = (sel.order ? sel.order('queued_at', { ascending: false }) : null);
      const res = ordered ? await ordered.limit(limit) : await sel.limit(limit);
      const { data, error } = res;
      if (error || !data) return [];
      return data.map(mapRow);
    } catch { return []; }
  }

  private async byIdemKey(case_id: CaseId, idempotency_key: string): Promise<TraceJobStatus | null> {
    try {
      const sel = this.client.schema('belief').from('trace_jobs')
        .select('id, case_id, mode, status, queued_at, started_at, completed_at, cancelled_at, total_hops, total_atoms_emitted, total_budget_spent_usd, termination_reason, error')
        .eq('case_id', case_id);
      // eq chain supports a second .eq via overloaded type
      const inner = (sel.eq ? sel.eq('idempotency_key', idempotency_key) : null) as { maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>; } | null;
      if (!inner) return null;
      const { data, error } = await inner.maybeSingle();
      if (error || !data) return null;
      return mapRow(data);
    } catch { return null; }
  }
}

/** Build a TraceJob's UNIQUE-row id deterministically from the idem key. */
export function deriveJobId(idempotency_key: string): string {
  // RFC4122-ish UUID v7-like layout from the first 32 hex chars of the idem key
  // (already BLAKE3) — keeps the id stable across dedupe lookups.
  const k = idempotency_key.replace(/[^0-9a-f]/gi, '').padEnd(32, '0');
  return `${k.slice(0, 8)}-${k.slice(8, 12)}-7${k.slice(13, 16)}-8${k.slice(17, 20)}-${k.slice(20, 32)}`;
}

function mapRow(row: Record<string, unknown>): TraceJobStatus {
  return {
    job_id: String(row.id),
    case_id: String(row.case_id) as TraceJobStatus['case_id'],
    mode: row.mode as TraceJobStatus['mode'],
    status: row.status as TraceJobStatus['status'],
    queued_at: String(row.queued_at),
    started_at: (row.started_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    cancelled_at: (row.cancelled_at as string | null) ?? null,
    total_hops: Number(row.total_hops ?? 0),
    total_atoms_emitted: Number(row.total_atoms_emitted ?? 0),
    total_budget_spent_usd: Number(row.total_budget_spent_usd ?? 0),
    termination_reason: (row.termination_reason as TraceJobStatus['termination_reason']) ?? null,
    error: (row.error as string | null) ?? null,
  };
}

/** Map a request to a TraceJob shape using the resolved job_id. */
export function buildTraceJob(input: {
  job_id: string;
  case_id: CaseId;
  initiated_by_id: string;
  agency_id: string;
  idempotency_key: string;
  mode: TraceMode;
  origin: string[];
  direction: 'forward' | 'backward' | 'both';
  max_hops_per_path: number;
  max_total_hops: number;
  branching_cap: number;
  budget_usd: number;
  methodology: 'fifo' | 'lifo' | 'proportional';
  taint_threshold: number;
  terminate_at_kinds: TraceJob['terminate_at_kinds'];
  terminate_at_subjects?: TraceJob['terminate_at_subjects'];
  emit_progress_every_n_hops: number;
}): TraceJob {
  return {
    job_id: input.job_id,
    case_id: input.case_id,
    initiated_by_id: input.initiated_by_id,
    agency_id: input.agency_id,
    idempotency_key: input.idempotency_key,
    mode: input.mode,
    origin: input.origin as TraceJob['origin'],
    direction: input.direction,
    max_hops_per_path: input.max_hops_per_path,
    max_total_hops: input.max_total_hops,
    branching_cap: input.branching_cap,
    budget_usd: input.budget_usd,
    methodology: input.methodology,
    taint_threshold: input.taint_threshold,
    terminate_at_kinds: input.terminate_at_kinds,
    terminate_at_subjects: input.terminate_at_subjects,
    emit_progress_every_n_hops: input.emit_progress_every_n_hops,
  };
}
