-- ============================================================
-- RevorHealth — 7-Stage Reshape Migration (Blueprint §1–3)
-- Run ONCE in Supabase SQL Editor against the live project.
-- Does NOT drop tables or touch auth.users — auth-linked
-- staff records are preserved. Only dummy data is reseeded.
-- ============================================================


-- ── 1. Add new schema columns to work_items ──────────────────
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS raw_status        text,       -- §2: raw claim_status value
  ADD COLUMN IF NOT EXISTS denial_category   text,       -- §3: denial sub-classification
  ADD COLUMN IF NOT EXISTS denial_appealable boolean;    -- §3: true for the 5 appealable categories


-- ── 2. Clear all dummy work data ─────────────────────────────
DELETE FROM activity_log;
DELETE FROM work_items;


-- ── 3. Null all staff team assignments ───────────────────────
--    Required before modifying teams to satisfy the FK constraint.
UPDATE staff SET team_id = NULL;


-- ── 4. Delete obsolete teams (no longer map to a stage) ──────
DELETE FROM teams WHERE slug IN ('charge_entry','coding','claims_submission','reporting');


-- ── 5. Rename / reshape surviving teams → 7 new stage slugs ──
-- Old eligibility → submitted
UPDATE teams SET name = 'Submitted Claims', slug = 'submitted',  display_order = 1 WHERE slug = 'eligibility';
-- payment_posting slug unchanged, update order
UPDATE teams SET                                                   display_order = 2 WHERE slug = 'payment_posting';
-- denial_management slug unchanged
UPDATE teams SET                                                   display_order = 3 WHERE slug = 'denial_management';
-- appeals slug unchanged
UPDATE teams SET                                                   display_order = 4 WHERE slug = 'appeals';
-- ar_follow_up slug unchanged
UPDATE teams SET                                                   display_order = 5 WHERE slug = 'ar_follow_up';
-- patient_collections → collections
UPDATE teams SET name = 'Collections',      slug = 'collections', display_order = 6 WHERE slug = 'patient_collections';
-- credentialing → on_hold
UPDATE teams SET name = 'On Hold',          slug = 'on_hold',     display_order = 7 WHERE slug = 'credentialing';


-- ── 6. Reassign demo auth-linked staff to valid new teams ─────
-- lead.eligibility → submitted (team was renamed, slug changed)
-- assoc.charge     → submitted (was charge_entry)
-- lead.coding      → denial_management
-- senior.ar        → ar_follow_up (slug unchanged)
-- manager          → no team (unchanged)
UPDATE staff SET team_id = (SELECT id FROM teams WHERE slug = 'submitted')
  WHERE email IN ('lead.eligibility@demo.rcm', 'assoc.charge@demo.rcm');

UPDATE staff SET team_id = (SELECT id FROM teams WHERE slug = 'denial_management')
  WHERE email = 'lead.coding@demo.rcm';

UPDATE staff SET team_id = (SELECT id FROM teams WHERE slug = 'ar_follow_up')
  WHERE email = 'senior.ar@demo.rcm';


-- ── 7. Round-robin distribute remaining unassigned staff ──────
DO $$
DECLARE
  team_arr  uuid[];
  staff_arr uuid[];
  i         integer;
BEGIN
  -- 7 teams in display order
  SELECT ARRAY(SELECT id FROM teams ORDER BY display_order) INTO team_arr;

  -- All staff not yet assigned (excludes manager + 4 demo-assigned above)
  SELECT ARRAY(
    SELECT id FROM staff
    WHERE team_id IS NULL AND role != 'manager'
    ORDER BY email
  ) INTO staff_arr;

  FOR i IN 1..COALESCE(array_length(staff_arr, 1), 0) LOOP
    UPDATE staff
    SET team_id = team_arr[((i - 1) % array_length(team_arr, 1)) + 1]
    WHERE id = staff_arr[i];
  END LOOP;
END;
$$;


-- ── 8. Reseed work_items + activity_log ───────────────────────
DO $$
DECLARE
  -- 7 stages in STAGE_ORDER (matches src/types/index.ts)
  stage_slugs   text[]    := ARRAY[
    'submitted','denial_management','appeals',
    'ar_follow_up','collections','on_hold','payment_posting'
  ];
  stage_counts  integer[] := ARRAY[150, 120, 55, 70, 20, 15, 35];
  stage_min_val numeric[]  := ARRAY[200,  500,  800,  400, 150, 100, 300];
  stage_max_val numeric[]  := ARRAY[1500, 8000, 12000, 6000, 2000, 3000, 5000];
  stage_min_days integer[] := ARRAY[1, 10, 15, 5, 30, 5, 1];
  stage_max_days integer[] := ARRAY[5, 50, 70, 40, 95, 30, 5];

  first_names text[] := ARRAY[
    'James','Maria','Robert','Patricia','John','Jennifer','Michael','Linda',
    'William','Barbara','David','Susan','Richard','Jessica','Joseph','Sarah',
    'Thomas','Karen','Charles','Lisa','Christopher','Nancy','Daniel','Betty',
    'Matthew','Sandra','Anthony','Ashley','Mark','Kimberly','Donald','Donna',
    'Steven','Emily','Paul','Carol','Andrew','Michelle','Kenneth','Amanda',
    'George','Melissa'
  ];
  last_names text[] := ARRAY[
    'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
    'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
    'Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson',
    'White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson'
  ];

  client_ids        uuid[];
  stage_staff       uuid[];
  i                 integer;
  j                 integer;
  slug              text;
  item_count        integer;
  new_item_id       uuid;
  chosen_client     uuid;
  chosen_staff      uuid;
  chosen_status     text;
  chosen_value      numeric;
  chosen_days       integer;
  chosen_raw_status text;
  chosen_denial_cat text;
  chosen_appealable boolean;
  patient_name      text;
  created_ts        timestamptz;
  updated_ts        timestamptz;
  actor_id_val      uuid;
  rnd               float;
  fn_len            integer := 42;
  ln_len            integer := 30;
  staff_len         integer;

BEGIN
  SELECT ARRAY(SELECT id FROM clients ORDER BY random()) INTO client_ids;

  FOR i IN 1..array_length(stage_slugs, 1) LOOP
    slug       := stage_slugs[i];
    item_count := stage_counts[i];

    -- Collect associate + senior_associate IDs for this stage's team
    SELECT ARRAY(
      SELECT s.id FROM staff s
      JOIN teams t ON t.id = s.team_id
      WHERE t.slug = slug AND s.role IN ('associate','senior_associate')
    ) INTO stage_staff;
    staff_len := COALESCE(array_length(stage_staff, 1), 0);

    FOR j IN 1..item_count LOOP

      -- Random client
      chosen_client := client_ids[1 + (floor(random() * array_length(client_ids, 1)))::integer];

      -- 80% assigned to a staff member, 20% unassigned
      IF staff_len > 0 AND random() > 0.2 THEN
        chosen_staff := stage_staff[1 + (floor(random() * staff_len))::integer];
      ELSE
        chosen_staff := NULL;
      END IF;

      -- Weighted item status
      rnd := random();
      chosen_status := CASE
        WHEN rnd < 0.28 THEN 'pending'
        WHEN rnd < 0.62 THEN 'in_progress'
        WHEN rnd < 0.78 THEN 'ready_for_next'
        WHEN rnd < 0.91 THEN 'completed'
        ELSE                  'on_hold'
      END;

      -- Claim value (aged items in denial/appeals have higher value)
      chosen_value := stage_min_val[i]
        + (floor(random() * (stage_max_val[i] - stage_min_val[i])))::numeric;

      -- Days in stage (older as claims progress through denial/AR)
      chosen_days := stage_min_days[i]
        + (floor(random() * (stage_max_days[i] - stage_min_days[i])))::integer;

      -- ── §2: raw_status per stage (realistic dummy claim_status values) ──
      IF slug = 'submitted' THEN
        -- Weighted: 'Sent' is ~80% of real submitted claims
        chosen_raw_status := (ARRAY[
          'Sent','Sent','Sent','Sent','Transmit','Accepted','Print',
          'Claim in Process','Claim Pending'
        ])[1 + (floor(random() * 9))::integer];

      ELSIF slug = 'denial_management' THEN
        -- Weighted: 'Denied' is ~95% of real denied claims
        chosen_raw_status := (ARRAY[
          'Denied','Denied','Denied','Denied','Denied',
          'Recoup','Failed','Reversed Duplicate Claim','Ovrpymt'
        ])[1 + (floor(random() * 9))::integer];

      ELSIF slug = 'appeals' THEN
        IF random() < 0.88 THEN chosen_raw_status := 'Appeal Sent';
        ELSE chosen_raw_status := 'Medical Records Sent'; END IF;

      ELSIF slug = 'ar_follow_up' THEN
        chosen_raw_status := (ARRAY[
          'A/R Corrected Claim Sent','A/R Insurance Reprocessing','Resubmit',
          'A/R Follow Up Needed','A/R Kari F/U Needed'
        ])[1 + (floor(random() * 5))::integer];

      ELSIF slug = 'collections'     THEN chosen_raw_status := 'Collections';
      ELSIF slug = 'on_hold'         THEN chosen_raw_status := 'Hold';
      ELSIF slug = 'payment_posting' THEN chosen_raw_status := 'Payment Posting Pending';
      END IF;

      -- ── §3: denial_category + denial_appealable (denial_management only) ──
      IF slug = 'denial_management' THEN
        IF random() < 0.70 THEN
          -- Non-appealable: contractual / processing / terminal write-offs
          chosen_denial_cat := (ARRAY[
            '3831CA - Contractual','3831CA - Contractual','3831CA - Processing',
            'Duplicate','Non-Covered Service','Exceeds Frequency',
            'Bad Debt','Same/Similar','Rent or Purchase Guidelines','In Facility'
          ])[1 + (floor(random() * 10))::integer];
          chosen_appealable := false;
        ELSE
          -- Appealable: authorization / necessity / filing / documentation / wrong payer
          chosen_denial_cat := (ARRAY[
            'No Authorization','Not Medically Necessary','Beyond Filing Limit',
            'No Documentation to Support','Incorrect Insurance Billed'
          ])[1 + (floor(random() * 5))::integer];
          chosen_appealable := true;
        END IF;
      ELSE
        chosen_denial_cat  := NULL;
        chosen_appealable  := NULL;
      END IF;

      -- Fake patient name (no real PHI)
      patient_name :=
        first_names[1 + (floor(random() * fn_len))::integer]
        || ' ' ||
        last_names[1  + (floor(random() * ln_len))::integer];

      -- Timestamps spread over the last 90 days
      created_ts := now()
        - ((floor(random() * 90))::text || ' days')::interval
        - ((floor(random() * 8))::text  || ' hours')::interval;
      updated_ts := created_ts
        + ((floor(random() * chosen_days))::text || ' days')::interval;

      INSERT INTO work_items (
        client_id, patient_fake_name, current_stage, status,
        assigned_to, value, days_in_stage, created_at, updated_at,
        raw_status, denial_category, denial_appealable
      ) VALUES (
        chosen_client, patient_name, slug, chosen_status,
        chosen_staff, chosen_value, chosen_days, created_ts, updated_ts,
        chosen_raw_status, chosen_denial_cat, chosen_appealable
      )
      RETURNING id INTO new_item_id;

      -- Activity log entry for every non-pending item
      IF chosen_status != 'pending' THEN

        SELECT s.id INTO actor_id_val
        FROM staff s
        JOIN teams t ON t.id = s.team_id
        WHERE t.slug = slug
        ORDER BY random()
        LIMIT 1;

        IF actor_id_val IS NOT NULL THEN
          INSERT INTO activity_log (
            work_item_id, actor_id, action, from_value, to_value, created_at
          ) VALUES (
            new_item_id, actor_id_val, 'status_changed', 'pending', chosen_status,
            created_ts + interval '2 hours'
          );
        END IF;

        -- ~30% also get a reassignment log entry
        IF random() < 0.30 AND staff_len > 1 THEN
          INSERT INTO activity_log (
            work_item_id, actor_id, action, from_value, to_value, created_at
          ) VALUES (
            new_item_id, actor_id_val, 'reassigned', 'unassigned', patient_name,
            created_ts + interval '4 hours'
          );
        END IF;

      END IF;

    END LOOP; -- j
  END LOOP;   -- i
END;
$$;


-- ── DONE ─────────────────────────────────────────────────────
-- Teams:      7 (submitted, payment_posting, denial_management,
--               appeals, ar_follow_up, collections, on_hold)
-- Work items: ~465 across 7 stages
-- New columns: raw_status, denial_category, denial_appealable
-- Auth users:  unchanged — existing links preserved
-- ─────────────────────────────────────────────────────────────
