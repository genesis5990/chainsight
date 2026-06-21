/**
 * ProviderCircuitBreaker — Redis-backed per-install breaker.
 *
 * State machine (v1.0 Backend §1.7 + §8.2):
 *
 *   closed     → trips → open      after FAILURE_THRESHOLD failures within FAILURE_WINDOW
 *   open       → after  → half_open after RESET_TIMEOUT ms
 *   half_open  → success → closed
 *   half_open  → failure → open (reset timeout restarts)
 *
 * Storage: a small Redis hash per install. Operations are best-effort —
 * Redis outages MUST NOT crash the router.
 */

import type Redis from 'ioredis';

export const FAILURE_THRESHOLD = 5;
export const FAILURE_WINDOW_MS = 60_000;
export const RESET_TIMEOUT_MS = 30_000;

export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerSnapshot {
  state: BreakerState;
  recent_failures: number;
  opened_at_ms: number | null;
}

export interface CircuitBreakerOptions {
  /** Override default failure threshold (default 5). */
  failure_threshold?: number;
  /** Override default failure window in ms (default 60_000). */
  failure_window_ms?: number;
  /** Override default reset timeout in ms (default 30_000). */
  reset_timeout_ms?: number;
  /** Inject a clock for tests. */
  now?: () => number;
}

/**
 * Per-install breaker. Instances are cheap; construct one per resolve() call.
 */
export class ProviderCircuitBreaker {
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private readonly key: string;

  constructor(
    private readonly install_id: string,
    private readonly redis: Redis | null,
    opts: CircuitBreakerOptions = {},
  ) {
    this.threshold = opts.failure_threshold ?? FAILURE_THRESHOLD;
    this.windowMs = opts.failure_window_ms ?? FAILURE_WINDOW_MS;
    this.resetMs = opts.reset_timeout_ms ?? RESET_TIMEOUT_MS;
    this.now = opts.now ?? (() => Date.now());
    this.key = `chainsight:cb:${install_id}`;
  }

  async snapshot(): Promise<BreakerSnapshot> {
    if (!this.redis) {
      return { state: 'closed', recent_failures: 0, opened_at_ms: null };
    }
    try {
      const fields = await this.redis.hmget(this.key, 'state', 'recent_failures', 'opened_at_ms', 'last_failure_at_ms');
      const state = (fields[0] as BreakerState | null) ?? 'closed';
      const recent_failures = Number(fields[1] ?? 0);
      const opened_at_ms = fields[2] ? Number(fields[2]) : null;
      const last_failure_at_ms = fields[3] ? Number(fields[3]) : null;

      // Decay failure count if last failure is outside the window
      if (last_failure_at_ms !== null && this.now() - last_failure_at_ms > this.windowMs) {
        return { state, recent_failures: 0, opened_at_ms };
      }
      return { state, recent_failures, opened_at_ms };
    } catch {
      // Redis down → fail-open (allow calls)
      return { state: 'closed', recent_failures: 0, opened_at_ms: null };
    }
  }

  /**
   * Whether a new call is allowed right now. Side-effect: if the breaker
   * is `open` past the reset timeout, transitions to `half_open` and
   * allows the call (the next success/failure decides closed vs open).
   */
  async isOpen(): Promise<boolean> {
    const snap = await this.snapshot();
    if (snap.state === 'closed') return false;
    if (snap.state === 'half_open') return false;
    // open: check reset timeout
    if (snap.opened_at_ms !== null && this.now() - snap.opened_at_ms >= this.resetMs) {
      await this.transitionToHalfOpen();
      return false;
    }
    return true;
  }

  async recordSuccess(): Promise<void> {
    if (!this.redis) return;
    try {
      // On success: clear failures, return to closed
      await this.redis.hset(this.key, {
        state: 'closed',
        recent_failures: 0,
        opened_at_ms: '',
      });
      // Keep the hash around so we can audit but expire eventually
      await this.redis.expire(this.key, 24 * 60 * 60);
    } catch { /* ignore */ }
  }

  async recordFailure(): Promise<void> {
    if (!this.redis) return;
    try {
      const now = this.now();
      const snap = await this.snapshot();
      const failures = snap.recent_failures + 1;
      const updates: Record<string, string | number> = {
        recent_failures: failures,
        last_failure_at_ms: now,
      };
      if (failures >= this.threshold) {
        updates.state = 'open';
        updates.opened_at_ms = now;
      }
      await this.redis.hset(this.key, updates);
      await this.redis.expire(this.key, 24 * 60 * 60);
    } catch { /* ignore */ }
  }

  private async transitionToHalfOpen(): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.hset(this.key, { state: 'half_open' });
    } catch { /* ignore */ }
  }
}
