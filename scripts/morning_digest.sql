-- ============================================================================
-- Weekday-morning digest — tracer performance + API usage across all agencies
-- ============================================================================
-- Intended to be run by a scheduled task (cron) at 12:30 UTC weekdays. Returns
-- a single row of metrics covering the prior 24h, plus per-agency breakouts in
-- companion queries. Safe to run repeatedly (read-only).

-- ── Top-line numbers (last 24h) ─────────────────────────────────────────────
WITH window AS (SELECT now() - interval '24 hours' AS since)
SELECT
  -- Tracer
  (SELECT COUNT(*) FROM belief.trace_jobs, window WHERE queued_at >= since)                            AS trace_jobs_queued,
  (SELECT COUNT(*) FROM belief.trace_jobs, window WHERE completed_at >= since AND status = 'completed') AS trace_jobs_completed,
  (SELECT COUNT(*) FROM belief.trace_jobs, window WHERE status = 'failed' AND COALESCE(completed_at, queued_at) >= since) AS trace_jobs_failed,
  (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::numeric, 0)
   FROM belief.trace_jobs, window WHERE completed_at >= since AND status = 'completed')                AS trace_avg_wall_ms,
  (SELECT ROUND(SUM(total_budget_spent_usd)::numeric, 4)
   FROM belief.trace_jobs, window WHERE completed_at >= since)                                          AS trace_total_spend_usd,
  (SELECT SUM(total_atoms_emitted)
   FROM belief.trace_jobs, window WHERE completed_at >= since)                                          AS trace_atoms_emitted,

  -- Capability router (API usage proxy)
  (SELECT COUNT(*) FROM belief.provider_resolutions, window WHERE resolved_at >= since)                AS router_calls,
  (SELECT COUNT(*) FROM belief.provider_resolutions, window WHERE resolved_at >= since AND cache_hit)  AS router_cache_hits,
  (SELECT COUNT(*) FROM belief.provider_resolutions, window WHERE resolved_at >= since AND NOT cache_hit) AS router_provider_calls,
  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE cache_hit) / NULLIF(COUNT(*), 0), 1)
   FROM belief.provider_resolutions, window WHERE resolved_at >= since)                                AS router_cache_hit_pct,
  (SELECT COUNT(*) FROM belief.provider_resolutions, window WHERE resolved_at >= since AND error IS NOT NULL) AS router_errors,

  -- Packs
  (SELECT COUNT(*) FROM belief.reproducibility_packs, window WHERE built_at >= since)                  AS packs_built,
  (SELECT COUNT(*) FROM belief.reproducibility_packs, window WHERE finalized_at >= since)              AS packs_finalized,

  -- New agencies
  (SELECT COUNT(*) FROM belief.agencies, window WHERE created_at >= since AND deleted_at IS NULL)      AS agencies_created;

-- ── Per-agency breakout (top 10 by activity) ───────────────────────────────
WITH window AS (SELECT now() - interval '24 hours' AS since)
SELECT
  COALESCE(t.agency_id, r.agency_id) AS agency_id,
  COUNT(DISTINCT t.id) AS trace_jobs,
  SUM(t.total_atoms_emitted)         AS atoms,
  ROUND(SUM(t.total_budget_spent_usd)::numeric, 4) AS spend_usd,
  COUNT(DISTINCT r.id) AS router_calls,
  COUNT(DISTINCT r.id) FILTER (WHERE r.error IS NOT NULL) AS errors
FROM (SELECT id, agency_id, total_atoms_emitted, total_budget_spent_usd FROM belief.trace_jobs, window WHERE completed_at >= since) t
FULL OUTER JOIN (SELECT id, agency_id, error FROM belief.provider_resolutions, window WHERE resolved_at >= since) r
  ON t.agency_id = r.agency_id
GROUP BY COALESCE(t.agency_id, r.agency_id)
ORDER BY COUNT(*) DESC
LIMIT 10;

-- ── Termination distribution (last 24h) ─────────────────────────────────────
WITH window AS (SELECT now() - interval '24 hours' AS since)
SELECT termination_reason, COUNT(*) AS n
FROM belief.trace_jobs, window
WHERE completed_at >= since AND termination_reason IS NOT NULL
GROUP BY termination_reason
ORDER BY n DESC;

-- ── Capability mix (which APIs ran the most) ────────────────────────────────
WITH window AS (SELECT now() - interval '24 hours' AS since)
SELECT
  capability,
  provider_id,
  COUNT(*) AS calls,
  COUNT(*) FILTER (WHERE cache_hit) AS cache_hits,
  COUNT(*) FILTER (WHERE error IS NOT NULL) AS errors,
  ROUND(AVG(latency_ms)::numeric, 0) AS avg_latency_ms
FROM belief.provider_resolutions, window
WHERE resolved_at >= since
GROUP BY capability, provider_id
ORDER BY calls DESC;
