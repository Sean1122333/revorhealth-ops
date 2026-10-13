-- ============================================================
-- RevorHealth — Rollback: 3-Group Restructure
--
-- Run snapshot queries BEFORE the forward migration and fill
-- all [PASTE FROM SNAPSHOT] markers below from the output.
-- Do not hand-type policy expressions — copy them verbatim
-- from the pg_policies qual/with_check columns.
--
-- Snapshot queries (run in Supabase SQL Editor, save output):
--
--   -- 0A: functions referencing team_id / team_slug
--   SELECT proname, pg_get_functiondef(oid) AS definition
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND (prosrc ILIKE '%team_id%' OR prosrc ILIKE '%team_slug%'
--          OR prosrc ILIKE '%current_staff_team%')
--   ORDER BY proname;
--
--   -- 0B: all public function bodies (complete rollback source)
--   SELECT proname, pg_get_functiondef(oid) AS definition
--   FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--   ORDER BY proname;
--
--   -- 0C: all RLS policies
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--   ORDER BY tablename, policyname;
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────
-- 1. Drop all policies added or replaced by the migration
-- ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "work_items: team read by stage"            ON work_items;
DROP POLICY IF EXISTS "work_items: associate update stage"        ON work_items;
DROP POLICY IF EXISTS "work_items: senior_associate update stage" ON work_items;
DROP POLICY IF EXISTS "work_items: team_lead update stage"        ON work_items;
DROP POLICY IF EXISTS "activity_log: team_lead read stage"        ON activity_log;
DROP POLICY IF EXISTS "staff: read own group"                     ON staff;
DROP POLICY IF EXISTS "payments: team_lead read team"             ON payments;


-- ──────────────────────────────────────────────────────────
-- 2. Restore original policies
-- Paste qual/with_check VERBATIM from snapshot 0C.
-- ──────────────────────────────────────────────────────────

-- work_items: team read by stage (original)
CREATE POLICY "work_items: team read by stage"
ON work_items FOR SELECT
USING (
  [PASTE qual FROM snapshot 0C — tablename=work_items, policyname="work_items: team read by stage"]
);

-- work_items: associate update stage (existed live — restore if it existed pre-migration)
-- If it did not exist before the migration, omit this block.
CREATE POLICY "work_items: associate update stage"
ON work_items FOR UPDATE
USING (
  [PASTE qual FROM snapshot 0C]
)
WITH CHECK (
  [PASTE with_check FROM snapshot 0C]
);

-- work_items: senior_associate update stage (original)
CREATE POLICY "work_items: senior_associate update stage"
ON work_items FOR UPDATE
USING (
  [PASTE qual FROM snapshot 0C]
)
WITH CHECK (
  [PASTE with_check FROM snapshot 0C]
);

-- work_items: team_lead update stage (original)
CREATE POLICY "work_items: team_lead update stage"
ON work_items FOR UPDATE
USING (
  [PASTE qual FROM snapshot 0C]
)
WITH CHECK (
  [PASTE with_check FROM snapshot 0C]
);

-- activity_log: team_lead read stage (original)
CREATE POLICY "activity_log: team_lead read stage"
ON activity_log FOR SELECT
USING (
  [PASTE qual FROM snapshot 0C]
);

-- staff: read own team (original — note: policy name was "read own team", not "read own group")
CREATE POLICY "staff: read own team"
ON staff FOR SELECT
USING (
  [PASTE qual FROM snapshot 0C]
);

-- payments: team_lead read team (original)
CREATE POLICY "payments: team_lead read team"
ON payments FOR SELECT
USING (
  [PASTE qual FROM snapshot 0C]
);


-- ──────────────────────────────────────────────────────────
-- 3. Restore original RPC bodies
-- Paste pg_get_functiondef output VERBATIM from snapshot 0B.
-- ──────────────────────────────────────────────────────────

-- team_stage_summary() — verbatim live body:
CREATE OR REPLACE FUNCTION team_stage_summary()
RETURNS json
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT json_build_object(
    'claim_count', COUNT(*),
    'total_billed', SUM(billed_amount),
    'avg_days',     ROUND(AVG(days_in_stage))
  )
  FROM work_items
  WHERE current_stage = current_staff_team_slug()
    AND current_stage != 'payment_posting'
    AND source_schema IN ('A', 'B')
$$;

-- team_lead_overview() — verbatim live body:
CREATE OR REPLACE FUNCTION team_lead_overview()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH team_sizes AS (
    SELECT team_id, COUNT(*) as team_size FROM staff GROUP BY team_id
  ),
  stage_stats AS (
    SELECT current_stage, COUNT(*) as open_claims,
           COALESCE(SUM(billed_amount), 0) as total_value,
           COALESCE(ROUND(AVG(days_in_stage)), 0) as avg_age_days
    FROM work_items
    WHERE current_stage <> 'payment_posting' AND source_schema IN ('A','B')
    GROUP BY current_stage
  )
  SELECT CASE WHEN current_staff_role() = 'manager' THEN
    (SELECT json_agg(row_to_json(t)) FROM (
       SELECT tl.full_name as team_lead_name, te.name as team_name, te.slug as team_slug,
              COALESCE(ts.team_size, 0) as team_size,
              COALESCE(ss.open_claims, 0) as open_claims,
              COALESCE(ss.total_value, 0) as total_value,
              COALESCE(ss.avg_age_days, 0) as avg_age_days
       FROM staff tl
       JOIN teams te ON te.id = tl.team_id
       LEFT JOIN team_sizes ts ON ts.team_id = tl.team_id
       LEFT JOIN stage_stats ss ON ss.current_stage = te.slug
       WHERE tl.role = 'team_lead'
       ORDER BY open_claims DESC) t)
  ELSE NULL END
$$;

-- staff_directory() — verbatim live body:
CREATE OR REPLACE FUNCTION staff_directory()
RETURNS json
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT json_agg(row_to_json(t)) FROM (
    SELECT s.full_name, s.role, t.slug as team_slug,
           COALESCE(al.actions_count, 0) as actions_count,
           COALESCE(al.advances, 0) as advances, al.last_active
    FROM staff s
    LEFT JOIN teams t ON t.id = s.team_id
    LEFT JOIN (SELECT actor_id, count(*) as actions_count,
                      count(*) FILTER (WHERE action = 'stage_advanced') as advances,
                      max(created_at) as last_active
               FROM activity_log GROUP BY actor_id) al ON al.actor_id = s.id
    ORDER BY s.full_name) t
$$;


-- ──────────────────────────────────────────────────────────
-- 4. Drop new functions and schema objects
-- Note: current_staff_team_slug() and current_staff_team_id()
-- were NOT dropped by the forward migration, so they do not
-- need to be restored here.
-- ──────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS advance_work_item(uuid, text);
DROP FUNCTION IF EXISTS current_staff_stage_slugs();
DROP FUNCTION IF EXISTS current_staff_group_id();

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_group_required;
ALTER TABLE staff DROP COLUMN IF EXISTS group_id;
ALTER TABLE teams DROP COLUMN IF EXISTS group_id;
DROP TABLE IF EXISTS team_groups CASCADE;

COMMIT;
