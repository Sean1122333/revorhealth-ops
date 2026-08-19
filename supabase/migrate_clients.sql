-- ============================================================
-- RevorHealth — Add real Kennebec Pharmacy and Home client locations
--
-- Run this BEFORE migrate_amount_fields.sql and before import_rcm.py.
-- Safe to re-run: ON CONFLICT (name) DO NOTHING.
-- ============================================================

INSERT INTO clients (name, specialty, location) VALUES
  ('Kennebec Pharmacy and Home-Augusta',       'DME / Home Health', 'Augusta, ME'),
  ('Kennebec Pharmacy and Home-Brunswick',     'DME / Home Health', 'Brunswick, ME'),
  ('Kennebec Pharmacy and Home-South Portland','DME / Home Health', 'South Portland, ME'),
  ('Kennebec Pharmacy and Home-Auburn',        'DME / Home Health', 'Auburn, ME'),
  ('Kennebec Pharmacy and Home-Rockport',      'DME / Home Health', 'Rockport, ME')
ON CONFLICT (name) DO NOTHING;
