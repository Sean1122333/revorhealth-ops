-- ============================================================
-- Add editable staff profile fields + Employees page policies
-- ============================================================

-- 1. New columns (idempotent)
ALTER TABLE staff ADD COLUMN IF NOT EXISTS shift     text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS join_date date;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS phone     text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS status    text DEFAULT 'active';

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_status_check;
ALTER TABLE staff ADD  CONSTRAINT staff_status_check
  CHECK (status IN ('active', 'on_leave', 'exited'));

-- Backfill existing rows to 'active' where NULL
UPDATE staff SET status = 'active' WHERE status IS NULL;


-- 2. Read policy: ALL authenticated users can see ALL staff rows
--    (additive with any existing policies — RLS policies are OR-combined)
DROP POLICY IF EXISTS "staff: all authenticated read" ON staff;
CREATE POLICY "staff: all authenticated read"
  ON staff FOR SELECT TO authenticated USING (true);


-- 3. Update policy: managers only
DROP POLICY IF EXISTS "staff: manager update" ON staff;
CREATE POLICY "staff: manager update"
  ON staff FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM staff s2 WHERE s2.auth_user_id = auth.uid()) = 'manager'
  )
  WITH CHECK (
    (SELECT role FROM staff s2 WHERE s2.auth_user_id = auth.uid()) = 'manager'
  );


-- 4. Column guard trigger: managers may only change the four editable fields.
--    All other columns are read-only at the DB level.
CREATE OR REPLACE FUNCTION staff_update_column_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'Column auth_user_id is read-only';
  END IF;
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    RAISE EXCEPTION 'Column full_name is read-only';
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Column email is read-only';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Column role is read-only';
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id THEN
    RAISE EXCEPTION 'Column team_id is read-only';
  END IF;
  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION 'Column group_id is read-only';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Column created_at is read-only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_update_column_guard ON staff;
CREATE TRIGGER staff_update_column_guard
  BEFORE UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION staff_update_column_guard();
