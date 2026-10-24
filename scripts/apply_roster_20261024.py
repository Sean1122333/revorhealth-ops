#!/usr/bin/env python3
"""
Roster reconciliation — 2026-10-24.

Dry-run by default. Add --live to apply.

Before --live, run the SQL block printed at startup in the Supabase SQL Editor.

Usage:
  set -a; source .env; set +a
  python3 scripts/apply_roster_20261024.py          # dry run
  python3 scripts/apply_roster_20261024.py --live   # apply
"""
import argparse, os, sys, time, textwrap
import requests

URL = os.environ.get("VITE_SUPABASE_URL") or "https://gfwxzeaamsxslfiptybx.supabase.co"
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
H   = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

# ── Roster ─────────────────────────────────────────────────────────────────────
# Keys = email prefix (before @revorhealth.com). Managers are never touched.
MANAGERS = {"sarah.chen", "sunny"}

ACTIVE_ROSTER = {
    # team leads
    "srinivas.matangi":       "team_lead",
    "selvia":                 "team_lead",
    # senior associates
    "nilesh.nana.dhende":     "senior_associate",
    "anand.narendra.singh":   "senior_associate",
    "mangkara.m.nongrum":     "senior_associate",
    "gimo.zhimomi":           "senior_associate",
    "sumit.ray":              "senior_associate",   # sheet: SUMIT RAI
    "darriel.peter":          "senior_associate",   # DEMOTED — role change via SQL
    "iqbal":                  "senior_associate",   # sheet: IQBAL AHMED SAYED
    "abhishek.chhetri":       "senior_associate",
    # associates
    "sebastian":              "associate",           # sheet: SEBASTIAN DIENGDOH
    "sahil.singh":            "associate",
    "joyce":                  "associate",
    "shangey":                "associate",
    "joe":                    "associate",           # sheet: JOE ROMARIO LYNGDOH
    "vikash.barman":          "associate",
    "nazim.lyngdoh":          "associate",
    "meena":                  "associate",
    "mohammed.riyaz.sayyed":  "associate",
    "kh.lovejoy":             "associate",           # sheet: JACK
    "mughaka.sumi":           "associate",
    "hunali.h.yeptho":        "associate",
    "wokali.awomi":           "associate",
    "lamthsaze.sangtam":      "associate",
    # hr
    "priyanka":               "hr",                  # role change via SQL
}

STAGE_GROUP = {
    "submitted":         "submission_payment",
    "payment_posting":   "submission_payment",
    "denial_management": "denials_appeals",
    "appeals":           "denials_appeals",
    "ar_follow_up":      "ar_collections",
    "collections":       "ar_collections",
    "on_hold":           "ar_collections",
}
GROUP_NAMES = {
    "submission_payment": "Submission & Payment Posting",
    "denials_appeals":    "Denials & Appeals",
    "ar_collections":     "AR Follow-up & Collections",
}


# ── API helpers ────────────────────────────────────────────────────────────────

def get_all(table, params):
    """Fetch all rows from a PostgREST table with offset pagination."""
    out, offset, limit = [], 0, 1000
    while True:
        r = requests.get(
            f"{URL}/rest/v1/{table}",
            headers=H,
            params={**params, "limit": limit, "offset": offset},
            timeout=30,
        )
        if r.status_code in (404, 416):
            break
        r.raise_for_status()
        batch = r.json()
        if not isinstance(batch, list):
            break
        out.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return out


def count_items(table, params):
    """Return exact row count via Content-Range header."""
    r = requests.get(
        f"{URL}/rest/v1/{table}",
        headers={**H, "Prefer": "count=exact", "Range": "0-0"},
        params={**params, "select": "id"},
        timeout=30,
    )
    if r.status_code == 416:
        return 0
    raw = r.headers.get("Content-Range", "*/0").split("/")[-1]
    return int(raw) if raw.isdigit() else 0


def patch_rows(table, filter_params, body):
    return requests.patch(
        f"{URL}/rest/v1/{table}",
        headers={**H, "Prefer": "return=minimal"},
        params=filter_params,
        json=body,
        timeout=60,
    )


def admin_users():
    users, page = [], 1
    while True:
        r = requests.get(f"{URL}/auth/v1/admin/users", headers=H,
                         params={"page": page, "per_page": 1000}, timeout=30)
        r.raise_for_status()
        batch = r.json().get("users", [])
        users.extend(batch)
        if len(batch) < 1000:
            return users
        page += 1


def table_exists(name):
    r = requests.get(f"{URL}/rest/v1/{name}", headers=H,
                     params={"select": "id", "limit": 1}, timeout=15)
    return r.status_code == 200


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", action="store_true")
    a = ap.parse_args()

    if not KEY:
        sys.exit("Set SUPABASE_SERVICE_ROLE_KEY first (set -a; source .env; set +a).")

    # ── Step 0: Print mandatory SQL ────────────────────────────────────────────
    print("=" * 72)
    print("STEP 0 — RUN THIS SQL IN THE SUPABASE SQL EDITOR BEFORE --live")
    print("=" * 72)
    print(textwrap.dedent("""
        -- A. Backup tables (idempotent)
        CREATE TABLE IF NOT EXISTS staff_backup_20261024
          AS SELECT * FROM staff;
        CREATE TABLE IF NOT EXISTS work_items_assign_backup_20261024
          AS SELECT id, assigned_to FROM work_items WHERE source_schema IN ('A','B');

        -- B. Add 'hr' to role CHECK constraint (safe if no constraint exists)
        ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
        ALTER TABLE staff ADD CONSTRAINT staff_role_check
          CHECK (role IN ('manager','team_lead','senior_associate','associate','hr'));

        -- C. Role changes — trigger blocks these; disable temporarily
        ALTER TABLE staff DISABLE TRIGGER staff_update_column_guard;

        UPDATE staff SET role = 'senior_associate'
          WHERE email = 'darriel.peter@revorhealth.com' AND role = 'team_lead';

        UPDATE staff SET role = 'hr', group_id = NULL, team_id = NULL
          WHERE email = 'priyanka@revorhealth.com';

        ALTER TABLE staff ENABLE TRIGGER staff_update_column_guard;
    """).strip())
    print()

    # ── Step 1: Check backup tables ────────────────────────────────────────────
    print("Checking backup tables...", end=" ", flush=True)
    staff_bak = table_exists("staff_backup_20261024")
    wi_bak    = table_exists("work_items_assign_backup_20261024")
    if staff_bak and wi_bak:
        print("both exist — OK")
    else:
        missing = [n for n, ok in [("staff_backup_20261024", staff_bak),
                                   ("work_items_assign_backup_20261024", wi_bak)] if not ok]
        print(f"MISSING: {', '.join(missing)}")
        if a.live:
            sys.exit("Run the Step 0 SQL first — backup tables are missing.")
        print("  (dry run — continuing without real backups)")
    print()

    # ── Fetch staff ────────────────────────────────────────────────────────────
    print("Fetching staff...", end=" ", flush=True)
    all_staff = get_all("staff", {"select": "id,full_name,email,role,group_id,status"})
    print(f"{len(all_staff)} rows")

    by_prefix = {(s.get("email") or "").split("@")[0].lower(): s for s in all_staff}

    manager_ids = {
        s["id"] for s in all_staff
        if s["role"] == "manager"
        or (s.get("email") or "").split("@")[0].lower() in MANAGERS
    }

    # Match active roster against DB
    active   = {}   # email_prefix -> {staff, target_role}
    not_found = []
    for pfx, role in ACTIVE_ROSTER.items():
        s = by_prefix.get(pfx)
        if s is None:
            not_found.append(pfx)
        else:
            active[pfx] = {"staff": s, "target_role": role}

    active_ids = {v["staff"]["id"] for v in active.values()}

    exited = [
        s for s in all_staff
        if s["id"] not in manager_ids and s["id"] not in active_ids
    ]

    # ── Print classification ───────────────────────────────────────────────────
    print()
    print("=" * 72)
    print(f"MANAGERS (untouched): {len(manager_ids)}")
    print("=" * 72)
    for s in sorted(all_staff, key=lambda x: x["full_name"]):
        if s["id"] in manager_ids:
            print(f"  {s['full_name']:<32} {s.get('email', '')}")

    print()
    print("=" * 72)
    print(f"ACTIVE ROSTER — {len(active)} matched, {len(not_found)} not found in DB")
    print("=" * 72)
    for pfx in sorted(active):
        info = active[pfx]
        s, target = info["staff"], info["target_role"]
        notes = []
        if s["role"] != target:
            notes.append(f"ROLE {s['role']} -> {target} [needs SQL]")
        if s.get("status") != "active":
            notes.append(f"status -> active")
        note_str = "  [" + ", ".join(notes) + "]" if notes else ""
        print(f"  {s['full_name']:<32} {s.get('email', ''):<44} {target}{note_str}")

    if not_found:
        print(f"\n  NOT FOUND IN DB ({len(not_found)}):")
        for p in not_found:
            print(f"    {p}@revorhealth.com")

    print()
    print("=" * 72)
    print(f"WILL BE EXITED — {len(exited)}")
    print("=" * 72)
    for s in sorted(exited, key=lambda x: x["full_name"]):
        print(f"  {s['full_name']:<32} {s.get('email', ''):<44} role={s['role']}  status={s.get('status', '?')}")

    # ── Fetch auth users ───────────────────────────────────────────────────────
    print()
    print("Fetching auth users...", end=" ", flush=True)
    auth_list = admin_users()
    auth_by_email = {(u.get("email") or "").lower(): u for u in auth_list}
    print(f"{len(auth_list)} total")

    to_ban = []
    for s in exited:
        em = (s.get("email") or "").lower()
        u = auth_by_email.get(em)
        if u:
            to_ban.append((u["id"], em, s["full_name"]))
        else:
            print(f"  (no auth record for {em})")
    print(f"  Auth bans queued: {len(to_ban)}")

    # ── Fetch groups ───────────────────────────────────────────────────────────
    groups_db  = get_all("team_groups", {"select": "id,slug,name"})
    gid_to_slug = {g["id"]: g["slug"] for g in groups_db}

    # Eligible workers for redistribution: active associates + senior_associates
    eligible_by_group = {slug: [] for slug in GROUP_NAMES}
    for pfx, info in active.items():
        s, target = info["staff"], info["target_role"]
        if target in ("associate", "senior_associate"):
            gslug = gid_to_slug.get(s.get("group_id"))
            if gslug in eligible_by_group:
                eligible_by_group[gslug].append(s)

    # IDs whose claims need redistribution: exited + priyanka (hr)
    priyanka_row = by_prefix.get("priyanka")
    reassign_from = {s["id"] for s in exited}
    if priyanka_row:
        reassign_from.add(priyanka_row["id"])

    # ── Fetch claims to reassign ───────────────────────────────────────────────
    print()
    print("Fetching claims to reassign...", end=" ", flush=True)
    id_list    = list(reassign_from)
    to_reassign = []
    CHUNK = 40
    for i in range(0, len(id_list), CHUNK):
        chunk_str = ",".join(id_list[i:i+CHUNK])
        rows = get_all("work_items", {
            "select": "id,current_stage,assigned_to",
            "assigned_to": f"in.({chunk_str})",
            "source_schema": "in.(A,B)",
            "order": "id",    # stable ordering required for offset pagination
        })
        to_reassign.extend(rows)
    print(f"{len(to_reassign):,} claims")

    # Group claims by group slug
    claims_by_group = {slug: [] for slug in GROUP_NAMES}
    stage_unknown   = []
    for w in to_reassign:
        gslug = STAGE_GROUP.get(w["current_stage"])
        if gslug:
            claims_by_group[gslug].append(w["id"])
        else:
            stage_unknown.append(w)
    if stage_unknown:
        print(f"  WARNING: {len(stage_unknown)} claims have unrecognised stages — will not be reassigned")

    # ── Current claim counts for active workers ────────────────────────────────
    print("Fetching current claim counts for active workers...", flush=True)
    current_counts = {}
    for pfx, info in active.items():
        s, target = info["staff"], info["target_role"]
        if target in ("associate", "senior_associate"):
            n = count_items("work_items", {
                "assigned_to": f"eq.{s['id']}",
                "source_schema": "in.(A,B)",
            })
            current_counts[s["id"]] = n
            print(f"  {s['full_name']:<32} {n:>6}")

    # ── Build redistribution plan ──────────────────────────────────────────────
    import heapq

    print()
    print("=" * 72)
    print("CLAIM REDISTRIBUTION PLAN")
    print("=" * 72)

    assignment_plan = {
        info["staff"]["id"]: []
        for info in active.values()
        if info["target_role"] in ("associate", "senior_associate")
    }

    for gslug, gname in GROUP_NAMES.items():
        workers = eligible_by_group[gslug]
        claims  = claims_by_group[gslug]

        print(f"\n  ── {gname} ──")
        print(f"  Claims to reassign: {len(claims):,}   Eligible workers: {len(workers)}")

        # Show which exited staff contributed claims
        for s in exited:
            cnt = sum(1 for w in to_reassign
                      if w["assigned_to"] == s["id"]
                      and STAGE_GROUP.get(w["current_stage"]) == gslug)
            if cnt:
                print(f"    FROM exited  {s['full_name']:<30} {cnt:>6}")
        if priyanka_row:
            cnt = sum(1 for w in to_reassign
                      if w["assigned_to"] == priyanka_row["id"]
                      and STAGE_GROUP.get(w["current_stage"]) == gslug)
            if cnt:
                print(f"    FROM hr      {priyanka_row['full_name']:<30} {cnt:>6}")

        if not workers:
            print("    WARNING: no eligible workers — these claims will remain on exited staff!")
            continue

        # Heap: (current_count, worker_id, worker_name)
        heap = [
            (current_counts.get(w["id"], 0), w["id"], w["full_name"])
            for w in workers
        ]
        heapq.heapify(heap)
        before = {wid: cnt for cnt, wid, _ in heap}

        for claim_id in claims:
            cnt, wid, wname = heapq.heappop(heap)
            assignment_plan[wid].append(claim_id)
            heapq.heappush(heap, (cnt + 1, wid, wname))

        print()
        print(f"  {'Name':<32} {'Before':>8}  {'Added':>8}  {'After':>8}")
        print(f"  {'-'*32} {'-'*8}  {'-'*8}  {'-'*8}")
        for cnt, wid, wname in sorted(heap, key=lambda x: x[2]):
            added = cnt - before.get(wid, 0)
            print(f"  {wname:<32} {before.get(wid, 0):>8}  {added:>8}  {cnt:>8}")

    total_in_plan = sum(len(v) for v in assignment_plan.values())

    print()
    print("=" * 72)
    print("DRY-RUN SUMMARY")
    print("=" * 72)
    print(f"  Staff total in DB:          {len(all_staff)}")
    print(f"  Managers (untouched):       {len(manager_ids)}")
    print(f"  Active roster matched:      {len(active)}")
    print(f"  Will be exited:             {len(exited)}")
    print(f"  Not found in DB:            {len(not_found)}")
    print(f"  Auth bans queued:           {len(to_ban)}")
    print(f"  Claims to reassign:         {len(to_reassign):,}")
    print(f"  Covered by plan:            {total_in_plan:,}")
    uncovered = len(to_reassign) - total_in_plan
    if uncovered:
        print(f"  UNCOVERED (no workers!):    {uncovered:,}")
    if not_found:
        print(f"\n  Missing from DB:")
        for p in not_found:
            print(f"    {p}@revorhealth.com")

    print()

    if not a.live:
        print("DRY RUN — nothing written.")
        print("1. Run the Step 0 SQL block in the SQL Editor.")
        print("2. Verify the plan above, then: python3 scripts/apply_roster_20261024.py --live")
        return

    # ═════════════════════════════════════════════════════════════════════════
    # LIVE
    # ═════════════════════════════════════════════════════════════════════════
    print("APPLYING LIVE CHANGES")
    print("=" * 72)

    # Set status=active for active roster
    print("\nSetting status=active for active roster...", flush=True)
    ok = bad = 0
    for pfx, info in active.items():
        s = info["staff"]
        r = patch_rows("staff", {"id": f"eq.{s['id']}"}, {"status": "active"})
        if r.ok:
            ok += 1
        else:
            bad += 1
            print(f"  FAIL {s['full_name']}: {r.text[:100]}")
    print(f"  {ok} ok, {bad} failed")

    # Set status=exited for departed staff
    print("Setting status=exited for departed staff...", flush=True)
    ok = bad = 0
    for s in exited:
        r = patch_rows("staff", {"id": f"eq.{s['id']}"}, {"status": "exited"})
        if r.ok:
            ok += 1
        else:
            bad += 1
            print(f"  FAIL {s['full_name']}: {r.text[:100]}")
    print(f"  {ok} ok, {bad} failed")

    # Ban auth logins
    print(f"\nBanning {len(to_ban)} auth accounts...", flush=True)
    ban_ok = ban_bad = 0
    for uid, email, name in to_ban:
        r = requests.put(
            f"{URL}/auth/v1/admin/users/{uid}",
            headers=H,
            json={"ban_duration": "876000h"},   # ~100 years
            timeout=30,
        )
        if r.ok:
            ban_ok += 1
        else:
            ban_bad += 1
            print(f"  FAIL ban {name}: {r.text[:100]}")
        time.sleep(0.04)
    print(f"  {ban_ok} banned, {ban_bad} failed")

    # Reassign claims
    print(f"\nReassigning {len(to_reassign):,} claims...", flush=True)
    reassign_ok = reassign_bad = 0
    BATCH = 100
    for wid, claim_ids in assignment_plan.items():
        for i in range(0, len(claim_ids), BATCH):
            batch = claim_ids[i:i + BATCH]
            r = patch_rows("work_items",
                           {"id": f"in.({','.join(batch)})"},
                           {"assigned_to": wid})
            if r.ok:
                reassign_ok += len(batch)
            else:
                reassign_bad += len(batch)
                print(f"  BATCH FAIL for {wid}: {r.text[:100]}")
    print(f"  {reassign_ok:,} ok, {reassign_bad:,} failed")

    # Verify
    print("\nVerifying...", flush=True)
    leftover = 0
    for sid in reassign_from:
        n = count_items("work_items", {"assigned_to": f"eq.{sid}", "source_schema": "in.(A,B)"})
        if n:
            name = next((s["full_name"] for s in all_staff if s["id"] == sid), sid)
            print(f"  WARNING: {name} still has {n} claims")
            leftover += n

    total_ab = count_items("work_items", {"source_schema": "in.(A,B)"})

    print()
    print("=" * 72)
    print("FINAL RESULTS")
    print("=" * 72)
    print(f"  Total A/B claims in DB:             {total_ab:,}")
    print(f"  Leftover on exited/HR staff:         {leftover}")
    print(f"  Reassignment failures:               {reassign_bad:,}")
    print(f"  Auth bans applied:                   {ban_ok}")
    sys.exit(1 if leftover or reassign_bad else 0)


if __name__ == "__main__":
    main()
