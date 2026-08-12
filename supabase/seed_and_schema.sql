-- ============================================================
-- RevorHealth RCM Ops — Schema + Seed (7-Stage, Blueprint §1–3)
-- Fresh project: paste into SQL Editor and run once.
-- Then create the 5 demo auth users in Dashboard →
-- Authentication → Users (see NEXT STEP at the bottom).
-- ============================================================

DROP TABLE IF EXISTS activity_log, work_items, payments, staff, clients, teams CASCADE;


-- ──────────────────────────────────────────────────────────
-- 1. TABLES
-- ──────────────────────────────────────────────────────────

CREATE TABLE teams (
  id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text     NOT NULL UNIQUE,
  slug          text     NOT NULL UNIQUE,
  display_order smallint NOT NULL DEFAULT 0
);

CREATE TABLE staff (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid    UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name    text    NOT NULL,
  email        text    NOT NULL UNIQUE,
  role         text    NOT NULL CHECK (role IN ('associate','senior_associate','team_lead','manager')),
  team_id      uuid    REFERENCES teams(id),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id         uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text    NOT NULL,
  specialty  text    NOT NULL,
  location   text    NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE work_items (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid          NOT NULL REFERENCES clients(id),
  patient_fake_name  text          NOT NULL,
  current_stage      text          NOT NULL,
  status             text          NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','in_progress','ready_for_next','completed','on_hold')),
  assigned_to        uuid          REFERENCES staff(id),
  value              numeric(10,2) NOT NULL DEFAULT 0,
  days_in_stage      smallint      NOT NULL DEFAULT 0,
  -- Blueprint §2: raw claim_status value before stage mapping
  raw_status         text,
  -- Blueprint §3: denial sub-classification (denial_management only)
  denial_category    text,
  denial_appealable  boolean,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid         REFERENCES work_items(id) ON DELETE SET NULL,
  amount      numeric(10,2) NOT NULL DEFAULT 0,
  adjustment  numeric(10,2) NOT NULL DEFAULT 0,
  tax         numeric(10,2) NOT NULL DEFAULT 0,
  paid_at     timestamptz   NOT NULL DEFAULT now(),
  created_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES staff(id) ON DELETE SET NULL,
  action       text NOT NULL
               CHECK (action IN ('status_changed','reassigned','stage_advanced','note_added')),
  from_value   text,
  to_value     text,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);


-- ──────────────────────────────────────────────────────────
-- 2. INDEXES
-- ──────────────────────────────────────────────────────────

CREATE INDEX idx_staff_auth        ON staff(auth_user_id);
CREATE INDEX idx_staff_team        ON staff(team_id);
CREATE INDEX idx_work_stage        ON work_items(current_stage);
CREATE INDEX idx_work_assigned     ON work_items(assigned_to);
CREATE INDEX idx_work_status       ON work_items(status);
CREATE INDEX idx_work_client       ON work_items(client_id);
CREATE INDEX idx_work_created      ON work_items(created_at);
CREATE INDEX idx_activity_item     ON activity_log(work_item_id);
CREATE INDEX idx_activity_actor    ON activity_log(actor_id);
CREATE INDEX idx_activity_created  ON activity_log(created_at);
CREATE INDEX idx_payments_paid     ON payments(paid_at);


-- ──────────────────────────────────────────────────────────
-- 3. HELPER FUNCTIONS
-- SECURITY DEFINER to bypass RLS on the staff table
-- (avoids infinite recursion in policies that read staff).
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_staff_role()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT role FROM staff WHERE auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION current_staff_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT id FROM staff WHERE auth_user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION current_staff_team_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT team_id FROM staff WHERE auth_user_id = auth.uid()
$$;

-- Returns the slug of the calling user's team (used in work_items policies).
CREATE OR REPLACE FUNCTION current_staff_team_slug()
RETURNS text LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public AS $$
  SELECT t.slug
  FROM staff s
  JOIN teams t ON t.id = s.team_id
  WHERE s.auth_user_id = auth.uid()
$$;


-- ──────────────────────────────────────────────────────────
-- 4. TRIGGERS
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_items_updated_at
BEFORE UPDATE ON work_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Link Supabase Auth user to pre-seeded staff record on creation.
CREATE OR REPLACE FUNCTION link_auth_to_staff()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  UPDATE staff
  SET auth_user_id = NEW.id
  WHERE email = NEW.email
    AND auth_user_id IS NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION link_auth_to_staff();


-- ──────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ──────────────────────────────────────────────────────────

ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff        ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- ── teams ────────────────────────────────────────────────
CREATE POLICY "teams: authenticated read"
ON teams FOR SELECT
USING (current_staff_id() IS NOT NULL);

-- ── staff ────────────────────────────────────────────────
CREATE POLICY "staff: read own row"
ON staff FOR SELECT
USING (auth_user_id = auth.uid());

CREATE POLICY "staff: read own team"
ON staff FOR SELECT
USING (
  current_staff_role() IN ('senior_associate','team_lead','manager')
  AND team_id = current_staff_team_id()
);

CREATE POLICY "staff: manager read all"
ON staff FOR SELECT
USING (current_staff_role() = 'manager');

-- ── clients ──────────────────────────────────────────────
CREATE POLICY "clients: authenticated read"
ON clients FOR SELECT
USING (current_staff_id() IS NOT NULL);

-- ── work_items ───────────────────────────────────────────
CREATE POLICY "work_items: associate read assigned"
ON work_items FOR SELECT
USING (
  current_staff_role() = 'associate'
  AND assigned_to = current_staff_id()
);

CREATE POLICY "work_items: team read by stage"
ON work_items FOR SELECT
USING (
  current_staff_role() IN ('senior_associate','team_lead')
  AND current_stage = current_staff_team_slug()
);

CREATE POLICY "work_items: manager read all"
ON work_items FOR SELECT
USING (current_staff_role() = 'manager');

CREATE POLICY "work_items: associate update assigned"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'associate'
  AND assigned_to = current_staff_id()
)
WITH CHECK (
  current_staff_role() = 'associate'
  AND assigned_to = current_staff_id()
);

CREATE POLICY "work_items: senior_associate update stage"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'senior_associate'
  AND current_stage = current_staff_team_slug()
)
WITH CHECK (
  current_staff_role() = 'senior_associate'
  AND current_stage = current_staff_team_slug()
);

CREATE POLICY "work_items: team_lead update stage"
ON work_items FOR UPDATE
USING (
  current_staff_role() = 'team_lead'
  AND current_stage = current_staff_team_slug()
)
WITH CHECK (
  current_staff_role() = 'team_lead'
  AND current_stage = current_staff_team_slug()
);

CREATE POLICY "work_items: manager update all"
ON work_items FOR UPDATE
USING (current_staff_role() = 'manager')
WITH CHECK (current_staff_role() = 'manager');

CREATE POLICY "work_items: manager insert"
ON work_items FOR INSERT
WITH CHECK (current_staff_role() = 'manager');

-- ── payments ─────────────────────────────────────────────
CREATE POLICY "payments: authenticated read"
ON payments FOR SELECT
USING (current_staff_id() IS NOT NULL);

-- ── activity_log ─────────────────────────────────────────
CREATE POLICY "activity_log: team_lead read stage"
ON activity_log FOR SELECT
USING (
  current_staff_role() = 'team_lead'
  AND work_item_id IN (
    SELECT id FROM work_items
    WHERE current_stage = current_staff_team_slug()
  )
);

CREATE POLICY "activity_log: manager read all"
ON activity_log FOR SELECT
USING (current_staff_role() = 'manager');

CREATE POLICY "activity_log: insert own actions"
ON activity_log FOR INSERT
WITH CHECK (
  actor_id = current_staff_id()
  AND current_staff_id() IS NOT NULL
);


-- ──────────────────────────────────────────────────────────
-- 6. SEED DATA — TEAMS (7 stages, Blueprint §1)
-- ──────────────────────────────────────────────────────────

INSERT INTO teams (name, slug, display_order) VALUES
  ('Submitted Claims',   'submitted',         1),
  ('Payment Posting',    'payment_posting',    2),
  ('Denial Management',  'denial_management',  3),
  ('Appeals',            'appeals',            4),
  ('AR Follow-Up',       'ar_follow_up',       5),
  ('Collections',        'collections',        6),
  ('On Hold',            'on_hold',            7);


-- ──────────────────────────────────────────────────────────
-- 7. SEED DATA — CLIENTS (20 fictional US practices)
-- ──────────────────────────────────────────────────────────

INSERT INTO clients (name, specialty, location) VALUES
  ('Sunrise Family Practice',        'Family Medicine',    'Phoenix, AZ'),
  ('Blue Ridge Orthopedics',         'Orthopedics',        'Asheville, NC'),
  ('Harbor View Internal Medicine',  'Internal Medicine',  'Portland, ME'),
  ('Cascade Cardiology Group',       'Cardiology',         'Seattle, WA'),
  ('Prairie Health Clinic',          'General Practice',   'Des Moines, IA'),
  ('Magnolia Women''s Health',       'OB/GYN',             'Atlanta, GA'),
  ('Summit Pediatrics',              'Pediatrics',         'Denver, CO'),
  ('Lakewood Dermatology',           'Dermatology',        'Cleveland, OH'),
  ('Cypress Urgent Care Centers',    'Urgent Care',        'Houston, TX'),
  ('Ridgeline Neurology',            'Neurology',          'Salt Lake City, UT'),
  ('Oceanside Physical Therapy',     'Physical Therapy',   'San Diego, CA'),
  ('Pinecrest Behavioral Health',    'Behavioral Health',  'Burlington, VT'),
  ('Keystone Gastroenterology',      'Gastroenterology',   'Pittsburgh, PA'),
  ('Silver City Oncology',           'Oncology',           'Albuquerque, NM'),
  ('Brookhaven Radiology Partners',  'Radiology',          'Long Island, NY'),
  ('Meadowbrook ENT Associates',     'ENT',                'Nashville, TN'),
  ('Riverside Endocrinology',        'Endocrinology',      'Sacramento, CA'),
  ('Willowbrook Rheumatology',       'Rheumatology',       'Madison, WI'),
  ('Falcon Ridge Sports Medicine',   'Sports Medicine',    'Charlotte, NC'),
  ('Coastal Eye Associates',         'Ophthalmology',      'Boca Raton, FL');


-- ──────────────────────────────────────────────────────────
-- 8. SEED DATA — STAFF (50 people across 7 teams)
-- auth_user_id is NULL; the trigger fills it when the
-- 5 demo auth users are created in the Auth dashboard.
-- ──────────────────────────────────────────────────────────

-- ── 1 Manager (no team) ──────────────────────────────────
INSERT INTO staff (full_name, email, role, team_id) VALUES
  ('Sarah Chen', 'manager@demo.rcm', 'manager', NULL);

-- ── 7 Team Leads (2 are demo auth users) ─────────────────
INSERT INTO staff (full_name, email, role, team_id)
  SELECT 'Marcus Webb',    'lead.eligibility@demo.rcm',        'team_lead', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Priya Sharma',   'lead.coding@demo.rcm',             'team_lead', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Aisha Thompson', 'lead.payment@revorhealth.com',     'team_lead', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Ben Kowalski',   'lead.appeals@revorhealth.com',     'team_lead', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Raj Patel',      'lead.ar@revorhealth.com',          'team_lead', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Yemi Adeyemi',   'lead.collections@revorhealth.com', 'team_lead', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Caitlin Ross',   'lead.onhold@revorhealth.com',      'team_lead', id FROM teams WHERE slug='on_hold';

-- ── 7 Senior Associates (1 is a demo auth user) ──────────
INSERT INTO staff (full_name, email, role, team_id)
  SELECT 'Fatima Al-Hassan', 'sr.submitted@revorhealth.com',   'senior_associate', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Brenda Walsh',     'sr.denial@revorhealth.com',      'senior_associate', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Omar Khalid',      'sr.payment@revorhealth.com',     'senior_associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Carlos Vega',      'sr.appeals@revorhealth.com',     'senior_associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Jordan Taylor',    'senior.ar@demo.rcm',             'senior_associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Imani Foster',     'sr.collections@revorhealth.com', 'senior_associate', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Hannah Kim',       'sr.onhold@revorhealth.com',      'senior_associate', id FROM teams WHERE slug='on_hold';

-- ── 35 Associates (5 per team, 1 is a demo auth user) ────
INSERT INTO staff (full_name, email, role, team_id)
  -- Submitted (5, incl. demo user Elena Rodriguez)
  SELECT 'Elena Rodriguez', 'assoc.charge@demo.rcm',       'associate', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Ryan Murphy',     'a.sub1@revorhealth.com',      'associate', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Jessica Chan',    'a.sub2@revorhealth.com',      'associate', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Brandon Lee',     'a.sub3@revorhealth.com',      'associate', id FROM teams WHERE slug='submitted'         UNION ALL
  SELECT 'Grace Liu',       'a.sub4@revorhealth.com',      'associate', id FROM teams WHERE slug='submitted'         UNION ALL
  -- Denial Management (5)
  SELECT 'Jasper Chen',     'a.den1@revorhealth.com',      'associate', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Sasha Williams',  'a.den2@revorhealth.com',      'associate', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Olivia Brown',    'a.den3@revorhealth.com',      'associate', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Liam Davis',      'a.den4@revorhealth.com',      'associate', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Emma White',      'a.den5@revorhealth.com',      'associate', id FROM teams WHERE slug='denial_management' UNION ALL
  -- Payment Posting (5)
  SELECT 'Zoe Anderson',    'a.pay1@revorhealth.com',      'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Caleb Moore',     'a.pay2@revorhealth.com',      'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Eric Hoffman',    'a.pay3@revorhealth.com',      'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Sophia Martin',   'a.pay4@revorhealth.com',      'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Noah Wilson',     'a.pay5@revorhealth.com',      'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  -- Appeals (5)
  SELECT 'Victor Torres',   'a.app1@revorhealth.com',      'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Lucas Garcia',    'a.app2@revorhealth.com',      'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Amara Johnson',   'a.app3@revorhealth.com',      'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Tyler Scott',     'a.app4@revorhealth.com',      'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Diana Park',      'a.app5@revorhealth.com',      'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  -- AR Follow-Up (5)
  SELECT 'Aaliyah Jackson', 'a.ar1@revorhealth.com',       'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Hunter Hill',     'a.ar2@revorhealth.com',       'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Leila Nazari',    'a.ar3@revorhealth.com',       'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Rachel Stern',    'a.ar4@revorhealth.com',       'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Matthew Brown',   'a.ar5@revorhealth.com',       'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  -- Collections (5)
  SELECT 'Mia Robinson',    'a.coll1@revorhealth.com',     'associate', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Isaiah Thomas',   'a.coll2@revorhealth.com',     'associate', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Nadia Petrov',    'a.coll3@revorhealth.com',     'associate', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Samuel Okafor',   'a.coll4@revorhealth.com',     'associate', id FROM teams WHERE slug='collections'       UNION ALL
  SELECT 'Kevin O''Brien',  'a.coll5@revorhealth.com',     'associate', id FROM teams WHERE slug='collections'       UNION ALL
  -- On Hold (5)
  SELECT 'Natalie Cruz',    'a.hold1@revorhealth.com',     'associate', id FROM teams WHERE slug='on_hold'           UNION ALL
  SELECT 'Derek Nguyen',    'a.hold2@revorhealth.com',     'associate', id FROM teams WHERE slug='on_hold'           UNION ALL
  SELECT 'Mark Johnson',    'a.hold3@revorhealth.com',     'associate', id FROM teams WHERE slug='on_hold'           UNION ALL
  SELECT 'Ashley Kim',      'a.hold4@revorhealth.com',     'associate', id FROM teams WHERE slug='on_hold'           UNION ALL
  SELECT 'Daniel Park',     'a.hold5@revorhealth.com',     'associate', id FROM teams WHERE slug='on_hold';


-- ──────────────────────────────────────────────────────────
-- 9. SEED DATA — WORK ITEMS + ACTIVITY LOG (~465 items)
-- 7 stages, §2 raw_status, §3 denial_category/appealable
-- ──────────────────────────────────────────────────────────

DO $$
DECLARE
  -- Stage config in STAGE_ORDER (matches src/types/index.ts)
  stage_slugs   text[]    := ARRAY[
    'submitted','denial_management','appeals',
    'ar_follow_up','collections','on_hold','payment_posting'
  ];
  stage_counts  integer[] := ARRAY[150, 120, 55, 70, 20, 15, 35];
  -- Claim value ranges per stage (denial/appeals higher = contested amounts)
  stage_min_val numeric[]  := ARRAY[200,  500,  800,  400, 150, 100, 300];
  stage_max_val numeric[]  := ARRAY[1500, 8000, 12000, 6000, 2000, 3000, 5000];
  -- Days-in-stage ranges (aging increases as claims sit)
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

    SELECT ARRAY(
      SELECT s.id FROM staff s
      JOIN teams t ON t.id = s.team_id
      WHERE t.slug = slug AND s.role IN ('associate','senior_associate')
    ) INTO stage_staff;
    staff_len := COALESCE(array_length(stage_staff, 1), 0);

    FOR j IN 1..item_count LOOP

      chosen_client := client_ids[1 + (floor(random() * array_length(client_ids, 1)))::integer];

      IF staff_len > 0 AND random() > 0.2 THEN
        chosen_staff := stage_staff[1 + (floor(random() * staff_len))::integer];
      ELSE
        chosen_staff := NULL;
      END IF;

      rnd := random();
      chosen_status := CASE
        WHEN rnd < 0.28 THEN 'pending'
        WHEN rnd < 0.62 THEN 'in_progress'
        WHEN rnd < 0.78 THEN 'ready_for_next'
        WHEN rnd < 0.91 THEN 'completed'
        ELSE                  'on_hold'
      END;

      chosen_value := stage_min_val[i]
        + (floor(random() * (stage_max_val[i] - stage_min_val[i])))::numeric;

      chosen_days := stage_min_days[i]
        + (floor(random() * (stage_max_days[i] - stage_min_days[i])))::integer;

      -- §2: raw_status — plausible claim_status values per stage
      IF slug = 'submitted' THEN
        chosen_raw_status := (ARRAY[
          'Sent','Sent','Sent','Sent','Transmit','Accepted','Print',
          'Claim in Process','Claim Pending'
        ])[1 + (floor(random() * 9))::integer];
      ELSIF slug = 'denial_management' THEN
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

      -- §3: denial_category + denial_appealable (denial_management only)
      IF slug = 'denial_management' THEN
        IF random() < 0.70 THEN
          chosen_denial_cat := (ARRAY[
            '3831CA - Contractual','3831CA - Contractual','3831CA - Processing',
            'Duplicate','Non-Covered Service','Exceeds Frequency',
            'Bad Debt','Same/Similar','Rent or Purchase Guidelines','In Facility'
          ])[1 + (floor(random() * 10))::integer];
          chosen_appealable := false;
        ELSE
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

      patient_name :=
        first_names[1 + (floor(random() * fn_len))::integer]
        || ' ' ||
        last_names[1  + (floor(random() * ln_len))::integer];

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

      IF chosen_status != 'pending' THEN
        SELECT s.id INTO actor_id_val
        FROM staff s
        JOIN teams t ON t.id = s.team_id
        WHERE t.slug = slug
        ORDER BY random()
        LIMIT 1;

        IF actor_id_val IS NOT NULL THEN
          INSERT INTO activity_log (work_item_id, actor_id, action, from_value, to_value, created_at)
          VALUES (new_item_id, actor_id_val, 'status_changed', 'pending', chosen_status,
                  created_ts + interval '2 hours');
        END IF;

        IF random() < 0.30 AND staff_len > 1 THEN
          INSERT INTO activity_log (work_item_id, actor_id, action, from_value, to_value, created_at)
          VALUES (new_item_id, actor_id_val, 'reassigned', 'unassigned', patient_name,
                  created_ts + interval '4 hours');
        END IF;
      END IF;

    END LOOP;
  END LOOP;
END;
$$;


-- ──────────────────────────────────────────────────────────
-- 10. SEED DATA — PAYMENTS (Collections MTD for Pipeline KPI)
-- ──────────────────────────────────────────────────────────

INSERT INTO payments (amount, adjustment, paid_at)
SELECT
  (300 + (random() * 4700))::numeric(10,2),
  (random() * 500)::numeric(10,2),
  now() - ((random() * 60)::text || ' days')::interval
FROM generate_series(1, 120);


-- ──────────────────────────────────────────────────────────
-- DONE.
-- Tables:     teams, staff, clients, work_items, payments, activity_log
-- Seed rows:  7 teams, 20 clients, 50 staff, ~465 work items,
--             120 payment records, ~280 activity log entries
-- RLS:        enabled on all 6 tables
-- Triggers:   set_updated_at, link_auth_to_staff
--
-- NEXT STEP: Create 5 auth users in Supabase Dashboard →
-- Authentication → Users → Add user:
--
--   manager@demo.rcm           Demo1234!   Manager
--   lead.eligibility@demo.rcm  Demo1234!   Team Lead, Submitted
--   lead.coding@demo.rcm       Demo1234!   Team Lead, Denial Management
--   senior.ar@demo.rcm         Demo1234!   Senior Associate, AR Follow-Up
--   assoc.charge@demo.rcm      Demo1234!   Associate, Submitted
--
-- The trigger auto-links them to their staff records on creation.
-- ──────────────────────────────────────────────────────────
