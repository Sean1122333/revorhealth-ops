-- ============================================================
-- RevorHealth — Replace value with billed_amount + balance_amount,
--               add source_schema tracking, and kpi_summary() RPC
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Run AFTER migrate_clients.sql (import script requires client rows to exist).
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── 1. Add new amount + tracking columns ──────────────────
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS billed_amount  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_schema  text;          -- 'A', 'B', or 'seed'

-- ── 2. Migrate: copy value → billed_amount where not yet set ──
-- No-op if value was already $0 (common on first import due to ClaimBalance bug).
-- Re-import populates billed_amount directly after this migration runs.
UPDATE work_items
SET billed_amount = value
WHERE billed_amount = 0
  AND value IS NOT NULL
  AND value <> 0;

-- ── 3. Drop old value column ──────────────────────────────
-- Uncomment after confirming billed_amount is populated from re-import.
-- ALTER TABLE work_items DROP COLUMN IF EXISTS value;


-- ── 4. KPI summary RPC ────────────────────────────────────
--
-- SECURITY INVOKER: RLS applies normally, so:
--   manager         → aggregates across all work_items
--   team_lead /
--   senior_associate → aggregates scoped to their stage (via RLS policy)
--   associate        → aggregates scoped to their assigned items
--
-- collections_mtd: sourced from payments table (actual cash received this month,
-- separate from work_items amounts).
--
-- Call via: supabase.rpc('kpi_summary')
-- Returns a single JSON object.
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION kpi_summary()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total',          COUNT(*),
    'open',           COUNT(*) FILTER (WHERE current_stage <> 'payment_posting'),
    'clean_rate',     COALESCE(
                        ROUND(100.0
                          * COUNT(*) FILTER (WHERE current_stage = 'payment_posting')
                          / NULLIF(COUNT(*), 0)
                        ), 0),
    'denial_rate',    COALESCE(
                        ROUND(100.0
                          * COUNT(*) FILTER (WHERE current_stage IN ('denial_management','appeals'))
                          / NULLIF(COUNT(*), 0)
                        ), 0),
    'total_billed',   COALESCE(SUM(billed_amount), 0),
    'total_balance',  COALESCE(
                        SUM(balance_amount) FILTER (WHERE current_stage <> 'payment_posting'),
                        0),
    'collections_mtd',(
                        SELECT COALESCE(SUM(amount), 0)
                        FROM payments
                        WHERE paid_at >= date_trunc('month', now())
                      ),
    'ar_0_30',        COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 0 AND 30),
    'ar_31_60',       COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 31 AND 60),
    'ar_61_90',       COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 61 AND 90),
    'ar_91_120',      COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 91 AND 120),
    'ar_120_plus',    COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage > 120)
  )
  FROM work_items
  WHERE source_schema IN ('A', 'B')
$$;

GRANT EXECUTE ON FUNCTION kpi_summary() TO authenticated;


-- ── 5. Stage counts RPC ───────────────────────────────────────────────────
--
-- Returns a JSON object mapping each current_stage to its row count,
-- filtered to source_schema IN ('A','B') so old null-source rows are excluded.
-- Used by Pipeline.tsx to show true per-stage totals in kanban column headers,
-- independent of the 500-row display limit.
--
-- Call via: supabase.rpc('stage_counts')
-- Returns e.g. {"submitted": 25663, "denial_management": 3349, ...}
-- ──────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION stage_counts()
RETURNS json
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_object_agg(current_stage, cnt)
  FROM (
    SELECT current_stage, COUNT(*) AS cnt
    FROM work_items
    WHERE source_schema IN ('A', 'B')
    GROUP BY current_stage
  ) s
$$;

GRANT EXECUTE ON FUNCTION stage_counts() TO authenticated;
