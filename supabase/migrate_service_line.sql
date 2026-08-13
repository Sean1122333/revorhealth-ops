-- ============================================================
-- RevorHealth — Add service_line to work_items
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + WHERE IS NULL guard.
-- Run in Supabase SQL Editor after migrate_7_stages.sql.
-- ============================================================

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS service_line text
  CHECK (service_line IN ('CPAP','Respiratory','Retail','Intake','Other'));

-- Populate dummy data with weighted distribution:
-- CPAP ~65%, Respiratory ~10%, Retail ~12%, Intake ~8%, Other ~5%
-- Uses a single random() per row (lateral subquery) for correct weighting.
UPDATE work_items
SET service_line = (
  SELECT CASE
    WHEN r < 0.65 THEN 'CPAP'
    WHEN r < 0.75 THEN 'Respiratory'
    WHEN r < 0.87 THEN 'Retail'
    WHEN r < 0.95 THEN 'Intake'
    ELSE                'Other'
  END
  FROM (SELECT random() AS r) rnd
)
WHERE service_line IS NULL;
