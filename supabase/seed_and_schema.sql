DROP TABLE IF EXISTS activity_log, work_items, staff, clients, teams CASCADE;
-- ============================================================
-- RevorHealth RCM Ops — Schema + Seed
-- New Supabase project. Paste this entire file into the
-- SQL Editor and run it once. Then create the 5 demo auth
-- users in Dashboard → Authentication → Users (see README).
-- ============================================================


-- ──────────────────────────────────────────────────────────
-- 1. TABLES
-- ──────────────────────────────────────────────────────────

CREATE TABLE teams (
  id            uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text     NOT NULL UNIQUE,
  slug          text     NOT NULL UNIQUE,
  display_order smallint NOT NULL DEFAULT 0
);

-- Staff owns its own UUID (not auth.uid()).
-- auth_user_id is populated by trigger when the auth user is created.
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
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid         NOT NULL REFERENCES clients(id),
  patient_fake_name text         NOT NULL,
  current_stage     text         NOT NULL,   -- matches teams.slug
  status            text         NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','ready_for_next','completed','on_hold')),
  assigned_to       uuid         REFERENCES staff(id),
  value             numeric(10,2) NOT NULL DEFAULT 0,
  days_in_stage     smallint     NOT NULL DEFAULT 0,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
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


-- ──────────────────────────────────────────────────────────
-- 3. HELPER FUNCTIONS
-- SECURITY DEFINER so they bypass RLS on the staff table
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

-- Auto-stamp updated_at on work_items.
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

-- When a Supabase Auth user is created, link them to the
-- pre-seeded staff record that shares the same email.
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
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- ── teams ────────────────────────────────────────────────
-- Any logged-in staff member can read all teams (needed for
-- stage labels, kanban headers, etc.).
CREATE POLICY "teams: authenticated read"
ON teams FOR SELECT
USING (current_staff_id() IS NOT NULL);

-- ── staff ────────────────────────────────────────────────
-- Every user can always read their own row.
CREATE POLICY "staff: read own row"
ON staff FOR SELECT
USING (auth_user_id = auth.uid());

-- Senior associates, team leads, and managers see their whole team.
CREATE POLICY "staff: read own team"
ON staff FOR SELECT
USING (
  current_staff_role() IN ('senior_associate','team_lead','manager')
  AND team_id = current_staff_team_id()
);

-- Manager sees every staff record.
CREATE POLICY "staff: manager read all"
ON staff FOR SELECT
USING (current_staff_role() = 'manager');

-- ── clients ──────────────────────────────────────────────
-- Read-only for all authenticated staff.
CREATE POLICY "clients: authenticated read"
ON clients FOR SELECT
USING (current_staff_id() IS NOT NULL);

-- ── work_items ───────────────────────────────────────────

-- Associate: only work items assigned directly to them.
CREATE POLICY "work_items: associate read assigned"
ON work_items FOR SELECT
USING (
  current_staff_role() = 'associate'
  AND assigned_to = current_staff_id()
);

-- Senior associate + team lead: all items in their team's stage.
CREATE POLICY "work_items: team read by stage"
ON work_items FOR SELECT
USING (
  current_staff_role() IN ('senior_associate','team_lead')
  AND current_stage = current_staff_team_slug()
);

-- Manager: all items.
CREATE POLICY "work_items: manager read all"
ON work_items FOR SELECT
USING (current_staff_role() = 'manager');

-- Associate: can UPDATE only items assigned to them
-- (the app restricts which columns can be changed).
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

-- Senior associate: can UPDATE any item in their stage
-- (includes reassigning assigned_to within the team).
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

-- Team lead: full update on items in their stage.
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

-- Manager: update anything.
CREATE POLICY "work_items: manager update all"
ON work_items FOR UPDATE
USING (current_staff_role() = 'manager')
WITH CHECK (current_staff_role() = 'manager');

-- Manager: insert new work items (for future manual intake).
CREATE POLICY "work_items: manager insert"
ON work_items FOR INSERT
WITH CHECK (current_staff_role() = 'manager');

-- ── activity_log ─────────────────────────────────────────

-- Team lead: read logs for items currently in their stage.
CREATE POLICY "activity_log: team_lead read stage"
ON activity_log FOR SELECT
USING (
  current_staff_role() = 'team_lead'
  AND work_item_id IN (
    SELECT id FROM work_items
    WHERE current_stage = current_staff_team_slug()
  )
);

-- Manager: read all.
CREATE POLICY "activity_log: manager read all"
ON activity_log FOR SELECT
USING (current_staff_role() = 'manager');

-- Any authenticated staff can insert their own action entries.
CREATE POLICY "activity_log: insert own actions"
ON activity_log FOR INSERT
WITH CHECK (
  actor_id = current_staff_id()
  AND current_staff_id() IS NOT NULL
);


-- ──────────────────────────────────────────────────────────
-- 6. SEED DATA — TEAMS
-- ──────────────────────────────────────────────────────────

INSERT INTO teams (name, slug, display_order) VALUES
  ('Eligibility & Verification', 'eligibility',        1),
  ('Charge Entry',               'charge_entry',        2),
  ('Medical Coding',             'coding',              3),
  ('Claims Submission',          'claims_submission',   4),
  ('Payment Posting',            'payment_posting',     5),
  ('AR Follow-Up',               'ar_follow_up',        6),
  ('Denial Management',          'denial_management',   7),
  ('Appeals',                    'appeals',             8),
  ('Patient Collections',        'patient_collections', 9),
  ('Credentialing',              'credentialing',      10),
  ('Reporting & Analytics',      'reporting',          11);


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
-- 8. SEED DATA — STAFF (50 people)
-- auth_user_id is NULL for all; the trigger fills it when
-- the 5 demo auth users are created in the dashboard.
-- ──────────────────────────────────────────────────────────

-- ── 1 Manager ────────────────────────────────────────────
INSERT INTO staff (full_name, email, role, team_id) VALUES
  ('Sarah Chen', 'manager@demo.rcm', 'manager', NULL);

-- ── 11 Team Leads (one per team) ─────────────────────────
-- 2 demo users included (lead.eligibility, lead.coding)
INSERT INTO staff (full_name, email, role, team_id)
  SELECT 'Marcus Webb',    'lead.eligibility@demo.rcm',       'team_lead', id FROM teams WHERE slug='eligibility'      UNION ALL
  SELECT 'Diana Park',     'lead.charge@revorhealth.com',     'team_lead', id FROM teams WHERE slug='charge_entry'     UNION ALL
  SELECT 'Priya Sharma',   'lead.coding@demo.rcm',            'team_lead', id FROM teams WHERE slug='coding'           UNION ALL
  SELECT 'Kevin O''Brien', 'lead.claims@revorhealth.com',     'team_lead', id FROM teams WHERE slug='claims_submission' UNION ALL
  SELECT 'Aisha Thompson', 'lead.payment@revorhealth.com',    'team_lead', id FROM teams WHERE slug='payment_posting'  UNION ALL
  SELECT 'Raj Patel',      'lead.ar@revorhealth.com',         'team_lead', id FROM teams WHERE slug='ar_follow_up'     UNION ALL
  SELECT 'Natalie Cruz',   'lead.denial@revorhealth.com',     'team_lead', id FROM teams WHERE slug='denial_management' UNION ALL
  SELECT 'Ben Kowalski',   'lead.appeals@revorhealth.com',    'team_lead', id FROM teams WHERE slug='appeals'          UNION ALL
  SELECT 'Yemi Adeyemi',   'lead.collections@revorhealth.com','team_lead', id FROM teams WHERE slug='patient_collections' UNION ALL
  SELECT 'Caitlin Ross',   'lead.credentialing@revorhealth.com','team_lead',id FROM teams WHERE slug='credentialing'   UNION ALL
  SELECT 'Derek Nguyen',   'lead.reporting@revorhealth.com',  'team_lead', id FROM teams WHERE slug='reporting';

-- ── 11 Senior Associates (one per team) ──────────────────
-- 1 demo user included (senior.ar)
INSERT INTO staff (full_name, email, role, team_id)
  SELECT 'Fatima Al-Hassan', 'sr.eligibility@revorhealth.com',  'senior_associate', id FROM teams WHERE slug='eligibility'       UNION ALL
  SELECT 'Tony Reyes',       'sr.charge@revorhealth.com',       'senior_associate', id FROM teams WHERE slug='charge_entry'      UNION ALL
  SELECT 'Mei Lin',          'sr.coding@revorhealth.com',       'senior_associate', id FROM teams WHERE slug='coding'            UNION ALL
  SELECT 'Layla Hassan',     'sr.claims@revorhealth.com',       'senior_associate', id FROM teams WHERE slug='claims_submission'  UNION ALL
  SELECT 'Omar Khalid',      'sr.payment@revorhealth.com',      'senior_associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Jordan Taylor',    'senior.ar@demo.rcm',              'senior_associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Brenda Walsh',     'sr.denial@revorhealth.com',       'senior_associate', id FROM teams WHERE slug='denial_management'  UNION ALL
  SELECT 'Carlos Vega',      'sr.appeals@revorhealth.com',      'senior_associate', id FROM teams WHERE slug='appeals'           UNION ALL
  SELECT 'Imani Foster',     'sr.collections@revorhealth.com',  'senior_associate', id FROM teams WHERE slug='patient_collections' UNION ALL
  SELECT 'Hannah Kim',       'sr.credentialing@revorhealth.com','senior_associate', id FROM teams WHERE slug='credentialing'     UNION ALL
  SELECT 'Alex Santos',      'sr.reporting@revorhealth.com',    'senior_associate', id FROM teams WHERE slug='reporting';

-- ── 27 Associates ─────────────────────────────────────────
-- 1 demo user included (assoc.charge)
INSERT INTO staff (full_name, email, role, team_id)
  -- Eligibility (4)
  SELECT 'Ryan Murphy',      'a.elig1@revorhealth.com',  'associate', id FROM teams WHERE slug='eligibility'       UNION ALL
  SELECT 'Jessica Chan',     'a.elig2@revorhealth.com',  'associate', id FROM teams WHERE slug='eligibility'       UNION ALL
  SELECT 'Brandon Lee',      'a.elig3@revorhealth.com',  'associate', id FROM teams WHERE slug='eligibility'       UNION ALL
  SELECT 'Grace Liu',        'a.elig4@revorhealth.com',  'associate', id FROM teams WHERE slug='eligibility'       UNION ALL
  -- Charge Entry (3 incl. demo user)
  SELECT 'Elena Rodriguez',  'assoc.charge@demo.rcm',    'associate', id FROM teams WHERE slug='charge_entry'      UNION ALL
  SELECT 'Sophia Martin',    'a.charge1@revorhealth.com','associate', id FROM teams WHERE slug='charge_entry'      UNION ALL
  SELECT 'Noah Wilson',      'a.charge2@revorhealth.com','associate', id FROM teams WHERE slug='charge_entry'      UNION ALL
  -- Coding (3)
  SELECT 'Olivia Brown',     'a.code1@revorhealth.com',  'associate', id FROM teams WHERE slug='coding'            UNION ALL
  SELECT 'Liam Davis',       'a.code2@revorhealth.com',  'associate', id FROM teams WHERE slug='coding'            UNION ALL
  SELECT 'Emma White',       'a.code3@revorhealth.com',  'associate', id FROM teams WHERE slug='coding'            UNION ALL
  -- Claims Submission (3)
  SELECT 'Lucas Garcia',     'a.claims1@revorhealth.com','associate', id FROM teams WHERE slug='claims_submission'  UNION ALL
  SELECT 'Amara Johnson',    'a.claims2@revorhealth.com','associate', id FROM teams WHERE slug='claims_submission'  UNION ALL
  SELECT 'Tyler Scott',      'a.claims3@revorhealth.com','associate', id FROM teams WHERE slug='claims_submission'  UNION ALL
  -- Payment Posting (3)
  SELECT 'Zoe Anderson',     'a.pay1@revorhealth.com',   'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Caleb Moore',      'a.pay2@revorhealth.com',   'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  SELECT 'Eric Hoffman',     'a.pay3@revorhealth.com',   'associate', id FROM teams WHERE slug='payment_posting'   UNION ALL
  -- AR Follow-Up (4)
  SELECT 'Aaliyah Jackson',  'a.ar1@revorhealth.com',    'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Hunter Hill',      'a.ar2@revorhealth.com',    'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Leila Nazari',     'a.ar3@revorhealth.com',    'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  SELECT 'Rachel Stern',     'a.ar4@revorhealth.com',    'associate', id FROM teams WHERE slug='ar_follow_up'      UNION ALL
  -- Denial Management (2)
  SELECT 'Jasper Chen',      'a.den1@revorhealth.com',   'associate', id FROM teams WHERE slug='denial_management'  UNION ALL
  SELECT 'Sasha Williams',   'a.den2@revorhealth.com',   'associate', id FROM teams WHERE slug='denial_management'  UNION ALL
  -- Appeals (1)
  SELECT 'Victor Torres',    'a.app1@revorhealth.com',   'associate', id FROM teams WHERE slug='appeals'           UNION ALL
  -- Patient Collections (2)
  SELECT 'Mia Robinson',     'a.coll1@revorhealth.com',  'associate', id FROM teams WHERE slug='patient_collections' UNION ALL
  SELECT 'Isaiah Thomas',    'a.coll2@revorhealth.com',  'associate', id FROM teams WHERE slug='patient_collections' UNION ALL
  -- Credentialing (1)
  SELECT 'Nadia Petrov',     'a.cred1@revorhealth.com',  'associate', id FROM teams WHERE slug='credentialing'     UNION ALL
  -- Reporting (1)
  SELECT 'Samuel Okafor',    'a.rep1@revorhealth.com',   'associate', id FROM teams WHERE slug='reporting';


-- ──────────────────────────────────────────────────────────
-- 9. SEED DATA — WORK ITEMS + ACTIVITY LOG
-- Generates ~505 work items distributed realistically
-- across 11 stages, then creates activity log entries
-- for every non-pending item.
-- ──────────────────────────────────────────────────────────

DO $$
DECLARE
  -- Stage configuration
  stage_slugs   text[]    := ARRAY[
    'eligibility','charge_entry','coding','claims_submission','payment_posting',
    'ar_follow_up','denial_management','appeals','patient_collections','credentialing','reporting'
  ];
  stage_counts  integer[] := ARRAY[80, 70, 65, 60, 55, 50, 40, 25, 35, 15, 10];
  -- Claim value ranges (min, max) per stage; reporting has no dollar value
  stage_min_val numeric[]  := ARRAY[150, 200, 300, 400,  500,  600,  800, 1000,  200,  500, 0];
  stage_max_val numeric[]  := ARRAY[350, 600, 900, 1400, 2200, 3500, 5000, 9000, 1800, 2500, 0];
  -- Days-in-stage ranges (items age as they move through the pipeline)
  stage_min_days integer[] := ARRAY[1, 1, 2,  1,  1,  5, 10, 15,  7, 30, 1];
  stage_max_days integer[] := ARRAY[4, 3, 6,  4,  5, 35, 50, 70, 95, 90, 7];

  -- Fake name pools (no real PHI)
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

  -- Working variables
  client_ids   uuid[];
  stage_staff  uuid[];
  i            integer;
  j            integer;
  slug         text;
  item_count   integer;
  new_item_id  uuid;
  chosen_client uuid;
  chosen_staff  uuid;
  chosen_status text;
  chosen_value  numeric;
  chosen_days   integer;
  patient_name  text;
  created_ts    timestamptz;
  updated_ts    timestamptz;
  actor_id_val  uuid;
  rnd           float;
  fn_len        integer := 40;
  ln_len        integer := 30;
  staff_len     integer;

BEGIN
  -- Load all client IDs
  SELECT ARRAY(SELECT id FROM clients ORDER BY random()) INTO client_ids;

  FOR i IN 1..array_length(stage_slugs, 1) LOOP
    slug       := stage_slugs[i];
    item_count := stage_counts[i];

    -- Collect associate + senior_associate IDs for this stage
    SELECT ARRAY(
      SELECT s.id
      FROM staff s
      JOIN teams t ON t.id = s.team_id
      WHERE t.slug = stage_slugs[i]
        AND s.role IN ('associate','senior_associate')
    ) INTO stage_staff;

    staff_len := COALESCE(array_length(stage_staff, 1), 0);

    FOR j IN 1..item_count LOOP

      -- Random client
      chosen_client := client_ids[1 + (floor(random() * array_length(client_ids, 1)))::integer];

      -- 80% assigned, 20% unassigned (sitting in the queue)
      IF staff_len > 0 AND random() > 0.2 THEN
        chosen_staff := stage_staff[1 + (floor(random() * staff_len))::integer];
      ELSE
        chosen_staff := NULL;
      END IF;

      -- Weighted status distribution
      rnd := random();
      chosen_status := CASE
        WHEN rnd < 0.28 THEN 'pending'
        WHEN rnd < 0.62 THEN 'in_progress'
        WHEN rnd < 0.78 THEN 'ready_for_next'
        WHEN rnd < 0.91 THEN 'completed'
        ELSE                  'on_hold'
      END;

      -- Claim value
      IF stage_max_val[i] = 0 THEN
        chosen_value := 0;
      ELSE
        chosen_value := stage_min_val[i]
          + (floor(random() * (stage_max_val[i] - stage_min_val[i])))::numeric;
      END IF;

      -- Days in stage (older items in later stages = more realistic AR aging)
      chosen_days := stage_min_days[i]
        + (floor(random() * (stage_max_days[i] - stage_min_days[i])))::integer;

      -- Fake patient name
      patient_name :=
        first_names[1 + (floor(random() * fn_len))::integer]
        || ' ' ||
        last_names[1  + (floor(random() * ln_len))::integer];

      -- Spread created_at over the last 90 days
      created_ts := now() - ((floor(random() * 90))::text || ' days')::interval
                          - ((floor(random() * 8))::text  || ' hours')::interval;
      updated_ts := created_ts + ((floor(random() * chosen_days))::text || ' days')::interval;

      INSERT INTO work_items (
        client_id, patient_fake_name, current_stage, status,
        assigned_to, value, days_in_stage, created_at, updated_at
      ) VALUES (
        chosen_client, patient_name, slug, chosen_status,
        chosen_staff, chosen_value, chosen_days, created_ts, updated_ts
      )
      RETURNING id INTO new_item_id;

      -- Activity log entry for every non-pending item
      IF chosen_status != 'pending' THEN

        -- Pick a random staff member from this stage to be the actor
        SELECT s.id INTO actor_id_val
        FROM staff s
        JOIN teams t ON t.id = s.team_id
        WHERE t.slug = stage_slugs[i]
        ORDER BY random()
        LIMIT 1;

        IF actor_id_val IS NOT NULL THEN
          INSERT INTO activity_log (work_item_id, actor_id, action, from_value, to_value, created_at)
          VALUES (
            new_item_id,
            actor_id_val,
            'status_changed',
            'pending',
            chosen_status,
            created_ts + interval '2 hours'
          );
        END IF;

        -- ~30% of non-pending items also have a reassignment entry
        IF random() < 0.30 AND staff_len > 1 THEN
          INSERT INTO activity_log (work_item_id, actor_id, action, from_value, to_value, created_at)
          VALUES (
            new_item_id,
            actor_id_val,
            'reassigned',
            'unassigned',
            patient_name,   -- storing patient ref as context
            created_ts + interval '4 hours'
          );
        END IF;

      END IF;

    END LOOP; -- j
  END LOOP;   -- i

END;
$$;


-- ──────────────────────────────────────────────────────────
-- DONE.
-- Tables created:  teams, staff, clients, work_items, activity_log
-- Seed rows:       11 teams, 20 clients, 50 staff, ~505 work items, ~300 activity log entries
-- RLS:             enabled on all 5 tables, 14 policies
-- Triggers:        set_updated_at, link_auth_to_staff
--
-- NEXT STEP: Create 5 auth users in Supabase Dashboard →
-- Authentication → Users → Add user:
--
--   manager@demo.rcm           Demo1234!   Manager
--   lead.eligibility@demo.rcm  Demo1234!   Team Lead, Eligibility
--   lead.coding@demo.rcm       Demo1234!   Team Lead, Coding
--   senior.ar@demo.rcm         Demo1234!   Senior Associate, AR Follow-Up
--   assoc.charge@demo.rcm      Demo1234!   Associate, Charge Entry
--
-- The trigger will auto-link them to their staff records on creation.
-- ──────────────────────────────────────────────────────────
