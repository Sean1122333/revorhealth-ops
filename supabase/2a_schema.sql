-- ============================================================
-- RevorHealth — 3-Group Restructure: 2a SCHEMA (additive only)
--
-- Does NOT touch any RLS policy. Existing policies remain
-- active and unchanged until 2c_policies.sql runs.
--
-- Run order:
--   0. Fill rollback_3_groups.sql [PASTE] markers from snapshot 0C.
--   1. Run this file (2a_schema.sql).
--   2. Run assign_groups.py --dry-run, review, then live
--        (staff.group_id populated while old policies still active — no gap).
--   3. Run 2c_policies.sql (single BEGIN/COMMIT — atomic policy swap).
--   4. Deploy frontend immediately after 2c.
--   5. Login matrix; on pass, run VALIDATE CONSTRAINT (see footer).
-- ============================================================

BEGIN;

-- ──────────────────────────────────────────────────────────
-- STEP 1: team_groups table + 3 groups
-- ──────────────────────────────────────────────────────────

CREATE TABLE team_groups (
  id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text     NOT NULL UNIQUE,
  slug          text     NOT NULL UNIQUE,
  display_order smallint NOT NULL DEFAULT 0
);

INSERT INTO team_groups (name, slug, display_order) VALUES
  ('Submission & Payment Posting', 'submission_payment', 1),
  ('Denials & Appeals',            'denials_appeals',    2),
  ('AR Follow-up & Collections',   'ar_collections',     3);


-- ──────────────────────────────────────────────────────────
-- STEP 2: group_id on teams (backfill by stage slug)
-- ──────────────────────────────────────────────────────────

ALTER TABLE teams ADD COLUMN group_id uuid REFERENCES team_groups(id);

UPDATE teams SET group_id = (SELECT id FROM team_groups WHERE slug = 'submission_payment')
  WHERE slug IN ('submitted', 'payment_posting');

UPDATE teams SET group_id = (SELECT id FROM team_groups WHERE slug = 'denials_appeals')
  WHERE slug IN ('denial_management', 'appeals');

UPDATE teams SET group_id = (SELECT id FROM team_groups WHERE slug = 'ar_collections')
  WHERE slug IN ('ar_follow_up', 'collections', 'on_hold');

CREATE INDEX idx_teams_group ON teams(group_id);


-- ──────────────────────────────────────────────────────────
-- STEP 3: group_id on staff
--
-- NOT VALID: existing rows exempt until VALIDATE CONSTRAINT
-- runs post login-matrix (see footer). team_id NOT dropped.
-- ──────────────────────────────────────────────────────────

ALTER TABLE staff ADD COLUMN group_id uuid REFERENCES team_groups(id);

ALTER TABLE staff ADD CONSTRAINT staff_group_required
  CHECK (role = 'manager' OR group_id IS NOT NULL) NOT VALID;

CREATE INDEX idx_staff_group ON staff(group_id);


-- ──────────────────────────────────────────────────────────
-- STEP 4: SECURITY DEFINER helpers
--
-- current_staff_group_id(): SECURITY DEFINER to avoid RLS
-- recursion when the staff table queries itself in a policy.
--
-- current_staff_stage_slugs(): all stage slugs for the
-- caller's group. Used by 2c policies and advance_work_item.
--
-- current_staff_team_slug() / current_staff_team_id() are
-- NOT modified here — dropped only after login matrix passes.
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_staff_group_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT group_id FROM staff WHERE auth_user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION current_staff_group_id() TO authenticated;


CREATE OR REPLACE FUNCTION current_staff_stage_slugs()
RETURNS text[] LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT ARRAY(
    SELECT t.slug
    FROM teams t
    WHERE t.group_id = (SELECT group_id FROM staff WHERE auth_user_id = auth.uid())
  )
$$;

GRANT EXECUTE ON FUNCTION current_staff_stage_slugs() TO authenticated;


-- ──────────────────────────────────────────────────────────
-- STEP 5: advance_work_item(p_item_id, p_expected_stage)
--
-- SECURITY DEFINER — bypasses RLS for UPDATE + activity_log.
-- REVOKE ALL FROM PUBLIC, anon — callable only by authenticated.
--
-- p_expected_stage: caller passes item.current_stage from the
--   UI. FOR UPDATE locks the row before any check proceeds.
--   If DB stage differs (concurrent change), raises only
--   'stage_mismatch' — no internal DB state exposed to caller.
--
-- Non-managers: current_stage must be in caller's group's slugs
--   (check on FROM stage only — cross-group advance allowed).
--   Raises only 'stage_not_in_group' on failure.
--
-- These are the only two intentional error codes surfaced to
-- the frontend. All other guard conditions (unauthenticated,
-- item not found, terminal stage) produce standard Postgres
-- errors that the frontend maps to a generic message.
--
-- STAGE_ORDER defined here must stay in sync with
--   STAGE_ORDER in src/types/index.ts.
-- ──────────────────────────────────────────────────────────

-- Drop old single-param version if it was ever created in dev
DROP FUNCTION IF EXISTS advance_work_item(uuid);

CREATE OR REPLACE FUNCTION advance_work_item(p_item_id uuid, p_expected_stage text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_stage_order  text[] := ARRAY[
    'submitted', 'denial_management', 'appeals',
    'ar_follow_up', 'collections', 'on_hold', 'payment_posting'
  ];
  v_staff_id     uuid;
  v_role         text;
  v_group_id     uuid;
  v_group_stages text[];
  v_current      text;
  v_next         text;
  v_idx          int;
  v_from_label   text;
  v_to_label     text;
BEGIN
  -- 1. Resolve caller
  SELECT id, role, group_id
  INTO v_staff_id, v_role, v_group_id
  FROM staff WHERE auth_user_id = auth.uid();

  IF v_staff_id IS NULL THEN
    RAISE EXCEPTION 'stage_not_in_group';
  END IF;

  IF v_role NOT IN ('associate', 'senior_associate', 'team_lead', 'manager') THEN
    RAISE EXCEPTION 'stage_not_in_group';
  END IF;

  -- 2. Lock row before any check
  SELECT current_stage INTO v_current
  FROM work_items WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_mismatch';
  END IF;

  -- 3. Concurrency guard — only 'stage_mismatch', no DB state exposed
  IF v_current <> p_expected_stage THEN
    RAISE EXCEPTION 'stage_mismatch' USING HINT = 'Refresh and try again';
  END IF;

  -- 4. Group authorization (managers bypass)
  IF v_role <> 'manager' THEN
    SELECT ARRAY(SELECT t.slug FROM teams t WHERE t.group_id = v_group_id)
    INTO v_group_stages;

    IF NOT (v_current = ANY(v_group_stages)) THEN
      RAISE EXCEPTION 'stage_not_in_group';
    END IF;
  END IF;

  -- 5. Compute next stage; return error object for terminal stage
  --    (not a RAISE — frontend receives data.error, not an error object)
  v_idx := array_position(v_stage_order, v_current);
  IF v_idx IS NULL OR v_idx >= array_length(v_stage_order, 1) THEN
    RETURN json_build_object('error', 'no_next_stage', 'current', v_current);
  END IF;
  v_next := v_stage_order[v_idx + 1];

  -- 6. Advance
  UPDATE work_items
  SET current_stage = v_next, updated_at = now()
  WHERE id = p_item_id;

  -- 7. Activity log with human-readable labels
  v_from_label := CASE v_current
    WHEN 'submitted'         THEN 'Submitted'
    WHEN 'denial_management' THEN 'Denial Management'
    WHEN 'appeals'           THEN 'Appeals'
    WHEN 'ar_follow_up'      THEN 'AR Follow-Up'
    WHEN 'collections'       THEN 'Collections'
    WHEN 'on_hold'           THEN 'On Hold'
    WHEN 'payment_posting'   THEN 'Payment Posting'
    ELSE v_current
  END;
  v_to_label := CASE v_next
    WHEN 'submitted'         THEN 'Submitted'
    WHEN 'denial_management' THEN 'Denial Management'
    WHEN 'appeals'           THEN 'Appeals'
    WHEN 'ar_follow_up'      THEN 'AR Follow-Up'
    WHEN 'collections'       THEN 'Collections'
    WHEN 'on_hold'           THEN 'On Hold'
    WHEN 'payment_posting'   THEN 'Payment Posting'
    ELSE v_next
  END;

  INSERT INTO activity_log (work_item_id, actor_id, action, from_value, to_value, notes)
  VALUES (
    p_item_id, v_staff_id, 'stage_advanced', v_current, v_next,
    'Moved from ' || v_from_label || ' to ' || v_to_label
  );

  RETURN json_build_object('from_stage', v_current, 'to_stage', v_next);
END;
$$;

REVOKE ALL ON FUNCTION advance_work_item(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION advance_work_item(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION advance_work_item(uuid, text) TO authenticated;

COMMIT;


-- ──────────────────────────────────────────────────────────
-- POST-MATRIX (run after login matrix passes, not before):
-- ──────────────────────────────────────────────────────────
-- ALTER TABLE staff VALIDATE CONSTRAINT staff_group_required;
-- DROP FUNCTION IF EXISTS current_staff_team_slug();
-- DROP FUNCTION IF EXISTS current_staff_team_id();
