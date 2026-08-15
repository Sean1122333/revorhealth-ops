-- ============================================================
-- RevorHealth — Add invoice_ref to work_items
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + WHERE IS NULL guard
-- on the UPDATE; constraint add guarded by pg_constraint check.
-- ============================================================

-- ── PHI boundary / import mapping note ───────────────────────
--
-- This dashboard stores OPERATIONAL METADATA ONLY — no PHI.
-- Claims are identified by invoice_ref (the source invoice number).
--
-- REAL DATA IMPORT — column mapping (Blueprint §4):
--   invoice_number / invoice_claim_number  →  work_items.invoice_ref  ✓
--   claim_status                           →  work_items.current_stage (via §2 mapping)  ✓
--   denial_category                        →  work_items.denial_category  ✓
--   billed / expected / denial_item_balance →  work_items.value / billed_amount / balance  ✓
--   patient_team                           →  staff / team lookup  ✓
--
-- MUST NOT import — these are PHI and must never enter this DB:
--   patient_name, patient_first_name, patient_last_name
--   patient_address, patient_city, patient_state, patient_zip
--   patient_dob (date of birth)
--   patient_mrn (medical record number)
--   patient_ssn, patient_insurance_id, patient_member_id
--   diagnosis_code, procedure_code (if linked to an identified patient)
--   referring_provider_name, referring_provider_npi
--   Any field that, alone or combined, could identify a specific patient
--
-- The patient_fake_name column remains in the schema for dummy-data
-- purposes only and is never rendered in the UI. It must not be
-- populated from real data on import.
-- ─────────────────────────────────────────────────────────────


-- ── 1. Add column ─────────────────────────────────────────────
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS invoice_ref text;


-- ── 2. Populate all NULL rows with unique refs ────────────────
-- Generates INV-100001, INV-100002, … ordered by created_at.
-- WHERE IS NULL guard makes this a no-op on re-run.
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM work_items
  WHERE invoice_ref IS NULL
)
UPDATE work_items
SET invoice_ref = 'INV-' || LPAD((100000 + n.rn)::text, 6, '0')
FROM numbered n
WHERE work_items.id = n.id;


-- ── 3. Add UNIQUE constraint (guarded — safe to re-run) ───────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_items_invoice_ref_key'
  ) THEN
    ALTER TABLE work_items
      ADD CONSTRAINT work_items_invoice_ref_key UNIQUE (invoice_ref);
  END IF;
END;
$$;
