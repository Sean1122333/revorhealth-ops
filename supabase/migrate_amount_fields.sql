-- ============================================================
-- RevorHealth — Replace value with billed_amount + balance_amount
--               and add server-side kpi_summary() RPC
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- Run in Supabase SQL Editor.
-- ============================================================

-- ── 1. Add new amount columns ─────────────────────────────
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS billed_amount  numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_amount numeric(10,2) NOT NULL DEFAULT 0;

-- ── 2. Migrate: copy value → billed_amount where not yet set ──
-- No-op if value was already $0 (common on first import due to ClaimBalance bug).
-- Re-import should populate billed_amount directly after this migration runs.
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
    'ar_0_5',         COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 0 AND 5),
    'ar_6_15',        COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 6 AND 15),
    'ar_16_30',       COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage BETWEEN 16 AND 30),
    'ar_31_plus',     COUNT(*) FILTER (
                        WHERE current_stage <> 'payment_posting'
                          AND days_in_stage > 30)
  )
  FROM work_items
$$;

GRANT EXECUTE ON FUNCTION kpi_summary() TO authenticated;
