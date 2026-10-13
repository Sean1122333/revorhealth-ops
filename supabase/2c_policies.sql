-- ============================================================
-- RevorHealth — 3-Group Restructure: 2c POLICIES + FUNCTIONS
--
-- Prerequisites:
--   • 2a_schema.sql committed (team_groups, group_id columns,
--     helper functions, advance_work_item in place).
--   • assign_groups.py run live (staff.group_id populated).
--
-- This is ONE BEGIN/COMMIT — atomic, no access gap between
-- dropping old policies and creating new ones.
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────
-- SECTION A: RLS policies
-- All drops use IF EXISTS — idempotent on re-run.
-- ──────────────────────────────────────────────────────────

-- ── work_items: read ──────────────────────────────────────
-- associate already included in live "team read by stage";
-- no separate associate-only policy needed.

DROP POLICY IF EXISTS "work_items: team read by stage" ON work_items;
CREATE POLICY "work_items: team read by stage"
ON work_items FOR SELECT
USING (
  current_staff_role() IN ('associate', 'senior_associate', 'team_lead')
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
);

-- ── work_items: update (per role) ─────────────────────────

DROP POLICY IF EXISTS "work_items: associate update stage" ON work_items;
CREATE POLICY "work_items: associate update stage"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'associate'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
)
WITH CHECK (
  current_staff_role() = 'associate'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
);

DROP POLICY IF EXISTS "work_items: senior_associate update stage" ON work_items;
CREATE POLICY "work_items: senior_associate update stage"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'senior_associate'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
)
WITH CHECK (
  current_staff_role() = 'senior_associate'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
);

DROP POLICY IF EXISTS "work_items: team_lead update stage" ON work_items;
CREATE POLICY "work_items: team_lead update stage"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'team_lead'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
)
WITH CHECK (
  current_staff_role() = 'team_lead'
  AND current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
);

-- ── activity_log: team_lead only ──────────────────────────

DROP POLICY IF EXISTS "activity_log: team_lead read stage" ON activity_log;
CREATE POLICY "activity_log: team_lead read stage"
ON activity_log FOR SELECT
USING (
  current_staff_role() = 'team_lead'
  AND work_item_id IN (
    SELECT id FROM work_items
    WHERE current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
  )
);

-- ── staff: senior_associate + team_lead only ──────────────
-- associate excluded. manager covered by "staff: manager read all".
-- current_staff_group_id() avoids RLS self-recursion on staff table.

DROP POLICY IF EXISTS "staff: read own team"  ON staff;
DROP POLICY IF EXISTS "staff: read own group" ON staff;
CREATE POLICY "staff: read own group"
ON staff FOR SELECT
USING (
  current_staff_role() IN ('senior_associate', 'team_lead')
  AND group_id = current_staff_group_id()
);

-- ── payments: team_lead read ──────────────────────────────
-- Live policy used current_staff_team_slug() — replaced with
-- current_staff_stage_slugs() for group-based access.
-- Confirm live qual from snapshot 0C if the live body differs.

DROP POLICY IF EXISTS "payments: team_lead read team" ON payments;
CREATE POLICY "payments: team_lead read team"
ON payments FOR SELECT
USING (
  current_staff_role() = 'team_lead'
  AND work_item_id IN (
    SELECT id FROM work_items
    WHERE current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
  )
);


-- ──────────────────────────────────────────────────────────
-- SECTION B: Function rewrites
-- ──────────────────────────────────────────────────────────

-- ── team_stage_summary ────────────────────────────────────
-- SECURITY INVOKER: RLS scopes the aggregate to caller's rows.
-- Explicit filter added for defence-in-depth (manager sees all
-- rows via RLS; filter keeps the aggregate meaningful for them).
-- COALESCE added so null totals return 0 instead of null.

CREATE OR REPLACE FUNCTION team_stage_summary()
RETURNS json
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT json_build_object(
    'claim_count', COUNT(*),
    'total_billed', COALESCE(SUM(billed_amount), 0),
    'avg_days',     COALESCE(ROUND(AVG(days_in_stage)), 0)
  )
  FROM work_items
  WHERE current_stage = ANY ((SELECT current_staff_stage_slugs())::text[])
    AND current_stage <> 'payment_posting'
    AND source_schema IN ('A', 'B')
$$;

GRANT EXECUTE ON FUNCTION team_stage_summary() TO authenticated;


-- ── team_lead_overview ────────────────────────────────────
-- Base: live body (LANGUAGE sql, STABLE, SECURITY DEFINER).
-- Changes from live:
--   team_sizes  CTE: GROUP BY group_id  (was team_id)
--   stage_stats CTE: JOIN teams t ON t.slug = w.current_stage,
--               GROUP BY t.group_id  (was GROUP BY current_stage)
--   Main query:  JOIN team_groups g ON g.id = tl.group_id
--               (was JOIN teams te ON te.id = tl.team_id)
-- Output keys identical to live: team_lead_name, team_name,
-- team_slug, team_size, open_claims, total_value, avg_age_days.

CREATE OR REPLACE FUNCTION team_lead_overview()
RETURNS json
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  WITH team_sizes AS (
    SELECT group_id, COUNT(*) AS team_size
    FROM staff
    GROUP BY group_id
  ),
  stage_stats AS (
    SELECT t.group_id,
           COUNT(*)                              AS open_claims,
           COALESCE(SUM(w.billed_amount), 0)     AS total_value,
           COALESCE(ROUND(AVG(w.days_in_stage)), 0) AS avg_age_days
    FROM work_items w
    JOIN teams t ON t.slug = w.current_stage
    WHERE w.current_stage <> 'payment_posting'
      AND w.source_schema IN ('A', 'B')
    GROUP BY t.group_id
  )
  SELECT CASE WHEN current_staff_role() = 'manager' THEN
    (SELECT json_agg(row_to_json(r)) FROM (
       SELECT tl.full_name               AS team_lead_name,
              g.name                     AS team_name,
              g.slug                     AS team_slug,
              COALESCE(ts.team_size, 0)    AS team_size,
              COALESCE(ss.open_claims, 0)  AS open_claims,
              COALESCE(ss.total_value, 0)  AS total_value,
              COALESCE(ss.avg_age_days, 0) AS avg_age_days
       FROM staff tl
       JOIN team_groups g ON g.id = tl.group_id
       LEFT JOIN team_sizes ts ON ts.group_id = tl.group_id
       LEFT JOIN stage_stats ss ON ss.group_id = tl.group_id
       WHERE tl.role = 'team_lead'
       ORDER BY ss.open_claims DESC NULLS LAST
    ) r)
  ELSE NULL END
$$;

GRANT EXECUTE ON FUNCTION team_lead_overview() TO authenticated;


-- ── staff_directory ───────────────────────────────────────
-- Base: live body (LANGUAGE sql, STABLE, NOT SECURITY DEFINER,
-- RETURNS json, with actions_count/advances/last_active).
-- One change from live:
--   LEFT JOIN team_groups g ON g.id = s.group_id
--   (was: LEFT JOIN teams t ON t.id = s.team_id)
-- Output key team_slug preserved (now = group slug).

CREATE OR REPLACE FUNCTION staff_directory()
RETURNS json
LANGUAGE sql STABLE
SET search_path = public AS $$
  SELECT json_agg(row_to_json(t)) FROM (
    SELECT s.full_name, s.role, g.slug AS team_slug,
           COALESCE(al.actions_count, 0) AS actions_count,
           COALESCE(al.advances, 0)      AS advances,
           al.last_active
    FROM staff s
    LEFT JOIN team_groups g ON g.id = s.group_id
    LEFT JOIN (
      SELECT actor_id,
             count(*)                                           AS actions_count,
             count(*) FILTER (WHERE action = 'stage_advanced') AS advances,
             max(created_at)                                    AS last_active
      FROM activity_log GROUP BY actor_id
    ) al ON al.actor_id = s.id
    ORDER BY s.full_name
  ) t
$$;

GRANT EXECUTE ON FUNCTION staff_directory() TO authenticated;

COMMIT;
