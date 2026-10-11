#!/usr/bin/env python3
"""
RevorHealth RCM Import Script
Imports Schema A (Denials by Date, de-identified) and Schema B (AR Manager Report)
into the work_items table via Supabase REST API.

Usage:
    python3 scripts/import_rcm.py [--schema-a PATH] [--schema-b PATH] [--dry-run]

Environment (reads from .env or shell):
    VITE_SUPABASE_URL       e.g. https://xxx.supabase.co
    VITE_SUPABASE_ANON_KEY  anon/public key
    IMPORT_EMAIL            Supabase auth email  (required — no default)
    IMPORT_PASSWORD         Supabase auth password (required — no default)

PHI boundary: only non-PHI columns are read. Patient name, DOB, MRN, address,
insurance ID, and diagnosis columns are never loaded or processed.
"""

import argparse
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import requests

# ── Environment ───────────────────────────────────────────────────────────────
def _load_dotenv():
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip())

_load_dotenv()

SUPABASE_URL  = os.environ.get('VITE_SUPABASE_URL', '').rstrip('/')
ANON_KEY      = os.environ.get('VITE_SUPABASE_ANON_KEY', '')
IMPORT_EMAIL  = os.environ.get('IMPORT_EMAIL',    '')
IMPORT_PASS   = os.environ.get('IMPORT_PASSWORD', '')

BATCH_SIZE = 500
TODAY      = date.today()

# Default file paths (override with CLI args)
DEFAULT_SCHEMA_A = str(Path.home() / 'Downloads' / 'Denials by Date_20260707(in) (1).csv')
DEFAULT_SCHEMA_B = str(Path.home() / "Downloads/Sixapart AR Manager Report- April'26 (1)(Sheet1).csv")

# ── PHI-safe column lists ─────────────────────────────────────────────────────
# NEVER add patient_full_name, patient_first/last_name, patient_dob, patient_mrn,
# patient_address, patient_*phone, patient_insurance_*, diagnosis codes, etc.
SCHEMA_A_COLS = [
    'invoice_number',
    'claim_status',
    'denial_category',
    'billed',
    'denial_item_balance',
    'claim_date_billed',
    'denial_posted_date',
    'patient_team',
    'invoice_company_name',
]

SCHEMA_B_COLS = [
    'InvoiceNumber',
    'BillingStatus',
    'status codes',
    'TotalBilledAmount',
    'ClaimBalance',
    'AR Days',
    'LastFollowupDate',
    'Therapy',
    'Line_of_business',
    'BillingProviderName',
]

# ── Stage mappings ────────────────────────────────────────────────────────────
CLAIM_STATUS_MAP = {
    'Sent':                       'submitted',
    'Transmit':                   'submitted',
    'Print':                      'submitted',
    'Claim Pending':              'submitted',
    'Accepted':                   'submitted',
    'CLAIM IN PROCESS':           'submitted',
    'Denied':                     'denial_management',
    'RECOUP':                     'denial_management',
    'REVERSED DUPLICATE CLAIM':   'denial_management',
    'OVRPYMT':                    'denial_management',
    'Failed':                     'denial_management',
    'APPEAL SENT':                'appeals',
    'MEDICAL RECORDS SENT':       'appeals',
    'A/R CORRECTED CLAIM SENT':   'ar_follow_up',
    'A/R INSURANCE REPROCESSING': 'ar_follow_up',
    'Resubmit':                   'ar_follow_up',
    'A/R Kari F/U Needed':        'ar_follow_up',
    'A/R FOLLOW UP NEEDED':       'ar_follow_up',
    'PAYMENT POSTING PENDING':    'payment_posting',
    'COLLECTIONS':                'collections',
    'Hold':                       'on_hold',
}

BILLING_STATUS_MAP = {
    'Sent':             'submitted',
    'CLAIM IN PROCESS': 'submitted',
    'Denied':           'denial_management',
    'APPEAL SENT':      'appeals',
    'Resubmit':         'ar_follow_up',
    'Edit':             'ar_follow_up',
    'Hold':             'on_hold',
}

STATUS_CODE_MAP = {
    'Zero Balance':                        'payment_posting',
    'Claim Paid less than 30 Days':        'payment_posting',
    'Claim Paid greater than 30 Days':     'payment_posting',
    'Claim Processed towards Deductible':  'payment_posting',
    'Claim Processed towards Coinsurance': 'payment_posting',
    'Claim processed towards offset':      'payment_posting',
    'Contractual Adjustment':              'payment_posting',
    'Small Balance':                       'payment_posting',
    'Credit Balance':                      'payment_posting',
    'Appeal Upheld':                       'payment_posting',
    'Claim In Process':                    'submitted',
    'Claim not on file':                   'ar_follow_up',
    'Primary Claim Not Processed':         'ar_follow_up',
    'INCORRECT POSTING':                   'ar_follow_up',
    'Incorrect Posting':                   'ar_follow_up',
    'Received Underpayment':               'ar_follow_up',
    'Claim Paid to another Provider':      'ar_follow_up',
    'Claim Submitted to Incorrect Address':'ar_follow_up',
    'Client Working':                      'on_hold',
    'Account Lock':                        'on_hold',
    'Supply Returned':                     'on_hold',
}


def map_schema_a_stage(claim_status: str) -> str:
    cs = (claim_status or '').strip()
    return CLAIM_STATUS_MAP.get(cs, 'submitted')


def map_schema_b_stage(billing_status: str, status_code: str) -> str:
    bs = (billing_status or '').strip()
    if bs in BILLING_STATUS_MAP:
        return BILLING_STATUS_MAP[bs]
    sc = (status_code or '').strip()
    if sc in STATUS_CODE_MAP:
        return STATUS_CODE_MAP[sc]
    if sc.upper().startswith('CLAIM DENIED'):
        return 'denial_management'
    return 'submitted'


# ── Service line mappings ─────────────────────────────────────────────────────
# patient_team is a free-text collector/team name; service line is derived by prefix.
def patient_team_to_service_line(team: str) -> str:
    t = (team or '').strip().upper()
    if not t:
        return 'Other'
    if 'CPAP' in t:
        return 'CPAP'
    if 'INFUSION' in t or 'INTAKE' in t:
        return 'Intake'
    if t.startswith('RESPIRATORY') or t in ('OXIMETRY', 'NIV'):
        return 'Respiratory'
    if 'RETAIL' in t or ('RESUPPLY' in t and 'CPAP' not in t):
        return 'Retail'
    return 'Other'


THERAPY_SL = {
    'PAPSETUP':   'CPAP', 'CPAP':      'CPAP', 'PAPSUPPLIES': 'CPAP',
    'CONC':       'Respiratory', 'NEB': 'Respiratory',
    'RESP-O2':    'Respiratory', 'Oxygen': 'Respiratory',
    'OSTOMY':     'Retail', 'INCON':   'Retail', 'UROLO':    'Retail',
    'MASTECT':    'Retail', 'DIABETIC':'Retail', 'OTC':      'Retail',
    'SUCTION':    'Retail', 'ORTHO':   'Retail', 'SEATLIFT': 'Retail',
    'TRILOGY':    'Retail', 'Rehab':   'Retail',
}
LOB_SL = {
    'PAP': 'CPAP', 'PAP SETUP': 'CPAP',
    'Oxygen': 'Respiratory',
    'DME RESUPPLY': 'Retail', 'Intake/Retail': 'Intake', 'Rehab': 'Retail',
}

def therapy_to_service_line(therapy: str, lob: str) -> str:
    t = (therapy or '').strip()
    if t in THERAPY_SL:
        return THERAPY_SL[t]
    l = (lob or '').strip()
    if l in LOB_SL:
        return LOB_SL[l]
    return 'Other'


# ── denial_appealable from denial_category ────────────────────────────────────
_APPEALABLE = {
    '7000WO - No Authorization',
    '7000WO - Incorrect Insurance Billed',
    '7000WO - Beyond Filing Limit',
    '7000WO - Not Medically Necessary',
    '7000WO - No Documentation to Support',
}

def derive_appealable(denial_category: str):
    dc = (denial_category or '').strip()
    if not dc:
        return None
    return dc in _APPEALABLE


# ── Client name mapping: Schema B provider → Schema A company name ────────────
PROVIDER_TO_CLIENT = {
    'Augusta PAP':                  'Kennebec Pharmacy and Home-Augusta',
    'Augusta Oxygen':               'Kennebec Pharmacy and Home-Augusta',
    'Augusta Resupply 42':          'Kennebec Pharmacy and Home-Augusta',
    'Augusta HME 15':               'Kennebec Pharmacy and Home-Augusta',
    'Augusta Specialty WheelChair': 'Kennebec Pharmacy and Home-Augusta',
    'Augusta Retail 40':            'Kennebec Pharmacy and Home-Augusta',
    'xAugusta PAP':                 'Kennebec Pharmacy and Home-Augusta',
    'Brunswick PAP':                'Kennebec Pharmacy and Home-Brunswick',
    'Brunswick Oxygen':             'Kennebec Pharmacy and Home-Brunswick',
    'South Portland PAP 33':        'Kennebec Pharmacy and Home-South Portland',
    'Auburn PAP 35':                'Kennebec Pharmacy and Home-Auburn',
    'Rockport Retail':              'Kennebec Pharmacy and Home-Rockport',
    'Rockport Oxygen':              'Kennebec Pharmacy and Home-Rockport',
}

# SQL to add real clients if they don't exist in the DB yet
CLIENTS_SQL = """\
-- Run this in Supabase SQL Editor if import_rcm.py reports missing clients:
INSERT INTO clients (name, specialty, location) VALUES
  ('Kennebec Pharmacy and Home-Augusta',      'DME / Home Health', 'Augusta, ME'),
  ('Kennebec Pharmacy and Home-Brunswick',    'DME / Home Health', 'Brunswick, ME'),
  ('Kennebec Pharmacy and Home-South Portland','DME / Home Health','South Portland, ME'),
  ('Kennebec Pharmacy and Home-Auburn',       'DME / Home Health', 'Auburn, ME'),
  ('Kennebec Pharmacy and Home-Rockport',     'DME / Home Health', 'Rockport, ME')
ON CONFLICT (name) DO NOTHING;
"""

# ── Supabase REST helpers ─────────────────────────────────────────────────────
def _headers(token: str) -> dict:
    return {
        'apikey':        ANON_KEY,
        'Authorization': f'Bearer {token}',
        'Content-Type':  'application/json',
    }


def sign_in() -> str:
    r = requests.post(
        f'{SUPABASE_URL}/auth/v1/token?grant_type=password',
        headers={'apikey': ANON_KEY, 'Content-Type': 'application/json'},
        json={'email': IMPORT_EMAIL, 'password': IMPORT_PASS},
        timeout=15,
    )
    if not r.ok:
        sys.exit(f'Sign-in failed ({r.status_code}): {r.text[:200]}')
    return r.json()['access_token']


def fetch_clients(token: str) -> dict:
    """Returns {name: id} for all clients in DB."""
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/clients?select=id,name',
        headers=_headers(token),
        timeout=15,
    )
    r.raise_for_status()
    return {row['name']: row['id'] for row in r.json()}


def delete_seeded_rows(token: str, dry_run: bool) -> int:
    """Remove dummy seeded rows (invoice_ref like INV-XXXXXX) before real import."""
    # Fetch IDs first to report count
    r = requests.get(
        f'{SUPABASE_URL}/rest/v1/work_items?invoice_ref=like.INV-*&select=id',
        headers=_headers(token),
        timeout=30,
    )
    r.raise_for_status()
    count = len(r.json())
    if count == 0:
        return 0
    if dry_run:
        print(f'  [dry-run] would delete {count} seeded rows (INV-XXXXXX)')
        return count
    d = requests.delete(
        f'{SUPABASE_URL}/rest/v1/work_items?invoice_ref=like.INV-*',
        headers={**_headers(token), 'Prefer': 'return=minimal'},
        timeout=30,
    )
    d.raise_for_status()
    return count


def upsert_batch(token: str, rows: list, dry_run: bool) -> bool:
    if dry_run:
        return True
    r = requests.post(
        f'{SUPABASE_URL}/rest/v1/work_items?on_conflict=invoice_ref',
        headers={**_headers(token), 'Prefer': 'resolution=merge-duplicates,return=minimal'},
        json=rows,
        timeout=60,
    )
    if not r.ok:
        print(f'  Upsert error {r.status_code}: {r.text[:300]}')
        return False
    return True


# ── Amount parser ─────────────────────────────────────────────────────────────
def parse_amount(v) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    try:
        return round(float(str(v).replace(',', '').replace('$', '').strip()), 2)
    except (ValueError, TypeError):
        return 0.0


# ── Schema processors ─────────────────────────────────────────────────────────
def process_schema_a(filepath: str, client_map: dict) -> list:
    print(f'\nSchema A: {filepath}')
    df = pd.read_csv(
        filepath, dtype=str, encoding='latin-1',
        usecols=lambda c: c in SCHEMA_A_COLS,
    )
    df = df.fillna('')   # all string cols → '' so .strip() never hits a float NaN
    print(f'  Loaded {len(df):,} raw rows')

    df['denial_posted_date'] = pd.to_datetime(df['denial_posted_date'], errors='coerce')
    df['claim_date_billed']  = pd.to_datetime(df['claim_date_billed'],  errors='coerce')

    # Dedup: keep latest denial_posted_date per invoice_number
    df = (df.sort_values('denial_posted_date', ascending=False, na_position='last')
            .drop_duplicates(subset='invoice_number', keep='first'))
    print(f'  {len(df):,} rows after dedup on invoice_number')

    rows, skipped_no_ref, skipped_no_client = [], 0, 0

    for _, r in df.iterrows():
        invoice_ref = (r.get('invoice_number') or '').strip()
        if not invoice_ref or invoice_ref == 'nan':
            skipped_no_ref += 1
            continue

        company    = (r.get('invoice_company_name') or '').strip()
        client_id  = client_map.get(company)
        if not client_id:
            skipped_no_client += 1
            continue

        days = 0
        cbd  = r.get('claim_date_billed')
        if pd.notna(cbd):
            days = max(0, (TODAY - cbd.date()).days)

        dc = (r.get('denial_category') or '').strip() or None
        if dc == 'nan':
            dc = None

        cs = (r.get('claim_status') or '').strip()

        rows.append({
            'invoice_ref':     invoice_ref,
            'client_id':       client_id,
            'patient_fake_name': '[imported]',
            'current_stage':   map_schema_a_stage(cs),
            'status':          'in_progress',
            'billed_amount':   parse_amount(r.get('billed')),
            'balance_amount':  parse_amount(r.get('denial_item_balance')),
            'days_in_stage':   days,
            'raw_status':      cs or None,
            'denial_category': dc,
            'denial_appealable': derive_appealable(dc),
            'service_line':    patient_team_to_service_line(r.get('patient_team')),
            'source_schema':   'A',
            # Internal sort key for cross-schema dedup (stripped before upsert)
            '_sort_ts': r['denial_posted_date'].timestamp()
                        if pd.notna(r.get('denial_posted_date')) else 0,
        })

    print(f'  {len(rows):,} valid rows  |  '
          f'{skipped_no_ref} skipped (no invoice_number)  |  '
          f'{skipped_no_client} skipped (unknown client)')
    return rows


def process_schema_b(filepath: str, client_map: dict) -> list:
    print(f'\nSchema B: {filepath}')
    df = pd.read_csv(
        filepath, dtype=str, encoding='latin-1',
        usecols=lambda c: c in SCHEMA_B_COLS,
    )
    df = df.fillna('')
    print(f'  Loaded {len(df):,} raw rows')

    df['LastFollowupDate'] = pd.to_datetime(df['LastFollowupDate'], errors='coerce')

    df = (df.sort_values('LastFollowupDate', ascending=False, na_position='last')
            .drop_duplicates(subset='InvoiceNumber', keep='first'))
    print(f'  {len(df):,} rows after dedup on InvoiceNumber')

    rows, skipped_no_ref, skipped_no_client = [], 0, 0

    for _, r in df.iterrows():
        invoice_ref = (r.get('InvoiceNumber') or '').strip()
        if not invoice_ref or invoice_ref == 'nan':
            skipped_no_ref += 1
            continue

        provider    = (r.get('BillingProviderName') or '').strip()
        client_name = PROVIDER_TO_CLIENT.get(provider)
        client_id   = client_map.get(client_name) if client_name else None
        if not client_id:
            skipped_no_client += 1
            continue

        ar_days = 0
        raw_ar  = r.get('AR Days')
        if raw_ar and str(raw_ar).strip() not in ('', 'nan'):
            try:
                ar_days = max(0, int(float(str(raw_ar).strip())))
            except (ValueError, TypeError):
                pass

        bs = (r.get('BillingStatus') or '').strip()
        sc = (r.get('status codes')  or '').strip()

        rows.append({
            'invoice_ref':     invoice_ref,
            'client_id':       client_id,
            'patient_fake_name': '[imported]',
            'current_stage':   map_schema_b_stage(bs, sc),
            'status':          'in_progress',
            'billed_amount':   parse_amount(r.get('TotalBilledAmount')),
            'balance_amount':  parse_amount(r.get('ClaimBalance')),
            'days_in_stage':   ar_days,
            'raw_status':      bs or sc or None,
            'denial_category': None,
            'denial_appealable': None,
            'service_line':    therapy_to_service_line(r.get('Therapy'),
                                                       r.get('Line_of_business')),
            'source_schema':   'B',
            '_sort_ts': r['LastFollowupDate'].timestamp()
                        if pd.notna(r.get('LastFollowupDate')) else 0,
        })

    print(f'  {len(rows):,} valid rows  |  '
          f'{skipped_no_ref} skipped (no InvoiceNumber)  |  '
          f'{skipped_no_client} skipped (unknown provider)')
    return rows


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='RevorHealth RCM importer')
    parser.add_argument('--schema-a', default=DEFAULT_SCHEMA_A,
                        help='Path to Schema A (Denials by Date, de-identified) CSV')
    parser.add_argument('--schema-b', default=DEFAULT_SCHEMA_B,
                        help='Path to Schema B (AR Manager Report) CSV')
    parser.add_argument('--dry-run', action='store_true',
                        help='Transform and report counts without writing to Supabase')
    args = parser.parse_args()

    if not SUPABASE_URL or not ANON_KEY:
        sys.exit('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env')
    if not IMPORT_EMAIL or not IMPORT_PASS:
        sys.exit('Set IMPORT_EMAIL and IMPORT_PASSWORD in .env (no defaults — see docstring)')

    print(f'Target: {SUPABASE_URL}')
    print(f'Mode:   {"DRY RUN" if args.dry_run else "LIVE"}')

    # ── Auth ──────────────────────────────────────────────────────────────────
    print(f'\nSigning in as {IMPORT_EMAIL}…')
    token = sign_in()
    print('  OK')

    # ── Client map ────────────────────────────────────────────────────────────
    print('\nFetching clients…')
    client_map = fetch_clients(token)
    print(f'  {len(client_map)} clients in DB')

    required = {
        'Kennebec Pharmacy and Home-Augusta',
        'Kennebec Pharmacy and Home-Brunswick',
        'Kennebec Pharmacy and Home-South Portland',
        'Kennebec Pharmacy and Home-Auburn',
        'Kennebec Pharmacy and Home-Rockport',
    }
    missing = required - set(client_map.keys())
    if missing:
        print('\nMissing clients — run this SQL in Supabase SQL Editor first:\n')
        print(CLIENTS_SQL)
        sys.exit(1)
    print('  All required Kennebec clients found')

    # ── Clear seeded dummy rows ───────────────────────────────────────────────
    print('\nRemoving seeded dummy rows (invoice_ref LIKE INV-%)…')
    n_deleted = delete_seeded_rows(token, args.dry_run)
    print(f'  {"Would remove" if args.dry_run else "Removed"} {n_deleted} seeded rows')

    # ── Process files ─────────────────────────────────────────────────────────
    all_rows: list = []

    if Path(args.schema_a).exists():
        all_rows += process_schema_a(args.schema_a, client_map)
    else:
        print(f'\nSchema A not found, skipping: {args.schema_a}')

    if Path(args.schema_b).exists():
        all_rows += process_schema_b(args.schema_b, client_map)
    else:
        print(f'\nSchema B not found, skipping: {args.schema_b}')

    if not all_rows:
        sys.exit('No rows to import.')

    # ── Cross-schema dedup: keep latest by _sort_ts per invoice_ref ───────────
    print(f'\nCross-schema dedup on {len(all_rows):,} combined rows…')
    all_rows.sort(key=lambda r: r['_sort_ts'], reverse=True)
    seen: set = set()
    deduped: list = []
    for row in all_rows:
        ref = row['invoice_ref']
        if ref not in seen:
            seen.add(ref)
            deduped.append(row)
    print(f'  {len(deduped):,} unique invoice_refs')

    # Strip internal sort key before upsert
    for row in deduped:
        del row['_sort_ts']

    # ── Upsert in batches ─────────────────────────────────────────────────────
    total  = len(deduped)
    errors = 0
    print(f'\nUpserting {total:,} rows in batches of {BATCH_SIZE}…')

    for start in range(0, total, BATCH_SIZE):
        batch = deduped[start:start + BATCH_SIZE]
        end   = min(start + BATCH_SIZE, total)
        ok    = upsert_batch(token, batch, args.dry_run)
        status = 'ok' if ok else 'ERROR'
        print(f'  [{start+1:>6}–{end:>6}] {status}')
        if not ok:
            errors += 1

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f'\n{"="*50}')
    print(f'{"DRY RUN — " if args.dry_run else ""}Import complete')
    print(f'  Rows upserted : {total:,}')
    print(f'  Batch errors  : {errors}')
    print(f'  Seeded removed: {n_deleted}')
    if errors:
        print('  WARNING: some batches failed — check output above')
    print('='*50)


if __name__ == '__main__':
    main()
