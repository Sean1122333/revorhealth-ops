import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { STAGE_LABELS } from '../types';
import { ChevronUp, ChevronDown, RefreshCw, AlertTriangle } from 'lucide-react';

// ── RPC return types ────────────────────────────────────────────────────────
type PayerRow = {
  payer: string;
  claim_count: number;
  total_balance: number;
  avg_age_days: number;
  denial_rate_pct: number;
};

type OldestClaim = {
  invoice_ref: string;
  payer: string;
  current_stage: string;
  claim_age_days: number;
  billed_amount: number;
  balance_amount: number;
};

type LegacySummary = {
  count: number;
  total_billed: number;
  total_balance: number;
  oldest_days: number;
};

type CollectorRow = {
  collector_name: string;
  collector_type: string;
  claim_count: number;
  total_balance: number;
  avg_age_days: number;
};

type TeamLeadOverviewRow = {
  team_lead_name: string;
  team_name: string;
  team_size: number;
  open_claims: number;
  total_value: number;
  avg_age_days: number;
};

type StaffDirectoryRow = {
  full_name: string;
  role: string;
  team_slug: string | null;
  actions_count: number;
  advances: number;
  last_active: string | null;
};

type StaffPerfRow = {
  full_name: string;
  role: string;
  actions_count: number;
  advances: number;
  last_active: string | null;
};

type ClaimsByMonthRow = {
  month: string;
  claim_count: number;
  total_billed: number;
  total_balance: number;
  denial_rate_pct: number;
};

type StaffActivityRow = {
  month: string;
  full_name: string;
  role: string;
  actions_count: number;
  advances: number;
};

// ── Sort helpers ────────────────────────────────────────────────────────────
type PayerSortKey = keyof PayerRow;
type SortDir = 'asc' | 'desc';

function SortIcon({ col, sortKey, sortDir }: { col: PayerSortKey; sortKey: PayerSortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <ChevronUp size={11} className="text-[#E5E7EB]" />;
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="text-[#2DD4BF]" />
    : <ChevronDown size={11} className="text-[#2DD4BF]" />;
}

function fmt$(n: number) {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMonth(s: string): string {
  // Handles 'YYYY-MM-DD' or 'YYYY-MM' from the RPC
  const d = new Date(s.length === 7 ? `${s}-01` : s);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmtK$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return fmt$(n);
}

// ── Shared table classes ────────────────────────────────────────────────────
const thBase = 'px-3 py-2.5 text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.08em] cursor-pointer select-none hover:text-[#141B2E] whitespace-nowrap';
const thLeft  = `${thBase} text-left`;
const thRight = `${thBase} text-right`;

// ── Main page ───────────────────────────────────────────────────────────────
export default function Reports() {
  const [payerRows, setPayerRows] = useState<PayerRow[]>([]);
  const [oldest, setOldest] = useState<OldestClaim[]>([]);
  const [legacy, setLegacy] = useState<LegacySummary | null>(null);
  const [collectors, setCollectors] = useState<CollectorRow[]>([]);
  const [staffPerf, setStaffPerf] = useState<StaffPerfRow[]>([]);
  const [claimsByMonth, setClaimsByMonth] = useState<ClaimsByMonthRow[]>([]);
  const [staffActivity, setStaffActivity] = useState<StaffActivityRow[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryRow[]>([]);
  const [teamLeadOverview, setTeamLeadOverview] = useState<TeamLeadOverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<PayerSortKey>('total_balance');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeTab, setActiveTab] = useState<'payers' | 'claims' | 'staff'>('payers');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [payerRes, oldestRes, legacyRes, collectorsRes, staffPerfRes,
           claimsByMonthRes, staffActivityRes, staffDirectoryRes, teamLeadRes] = await Promise.all([
      supabase.rpc('payer_report'),
      supabase.rpc('oldest_claims', { claim_limit: 25 }),
      supabase.rpc('legacy_claims_summary'),
      supabase.rpc('collector_team_summary'),
      supabase.rpc('staff_performance_summary'),
      supabase.rpc('claims_by_month'),
      supabase.rpc('staff_activity_by_month'),
      supabase.rpc('staff_directory'),
      supabase.rpc('team_lead_overview'),
    ]);
    console.log('[Reports] payer_report:', payerRes.error?.message ?? 'ok', payerRes.data?.length ?? 0, 'rows');
    console.log('[Reports] oldest_claims:', oldestRes.error?.message ?? 'ok', oldestRes.data?.length ?? 0, 'rows');
    console.log('[Reports] legacy_claims_summary:', legacyRes.error?.message ?? 'ok', legacyRes.data);
    console.log('[Reports] collector_team_summary:', collectorsRes.error?.message ?? 'ok', collectorsRes.data?.length ?? 0, 'rows');
    console.log('[Reports] staff_performance_summary:', staffPerfRes.error?.message ?? 'ok', staffPerfRes.data?.length ?? 0, 'rows');
    console.log('[Reports] claims_by_month:', claimsByMonthRes.error?.message ?? 'ok', claimsByMonthRes.data?.length ?? 0, 'rows');
    console.log('[Reports] staff_activity_by_month:', staffActivityRes.error?.message ?? 'ok', staffActivityRes.data?.length ?? 0, 'rows');
    console.log('[Reports] staff_directory:', staffDirectoryRes.error?.message ?? 'ok', staffDirectoryRes.data?.length ?? 0, 'rows');
    console.log('[Reports] team_lead_overview:', teamLeadRes.error?.message ?? 'ok', teamLeadRes.data?.length ?? 0, 'rows');
    setPayerRows((payerRes.data as PayerRow[]) ?? []);
    setOldest((oldestRes.data as OldestClaim[]) ?? []);
    setLegacy((legacyRes.data as LegacySummary) ?? null);
    setCollectors((collectorsRes.data as CollectorRow[]) ?? []);
    setStaffPerf((staffPerfRes.data as StaffPerfRow[]) ?? []);
    setClaimsByMonth((claimsByMonthRes.data as ClaimsByMonthRow[]) ?? []);
    setStaffActivity((staffActivityRes.data as StaffActivityRow[]) ?? []);
    setStaffDirectory((staffDirectoryRes.data as StaffDirectoryRow[]) ?? []);
    setTeamLeadOverview((teamLeadRes.data as TeamLeadOverviewRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  function toggleSort(key: PayerSortKey) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortedPayers = [...payerRows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === 'string'
      ? av.localeCompare(bv as string)
      : (av as number) - (bv as number);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="p-6 space-y-10 bg-[#FAFAF8] min-h-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#141B2E]">Reports</h1>
          <p className="text-[#5B6472] text-sm mt-0.5">Aggregate views across imported claims (source A + B)</p>
        </div>
        <button
          onClick={fetchAll}
          className="flex items-center gap-1.5 text-[#5B6472] hover:text-[#141B2E] text-sm transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-[#EDEDE9] rounded-lg p-1 w-fit">
        {(['payers', 'claims', 'staff'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-white text-[#141B2E] shadow-sm'
                : 'text-[#5B6472] hover:text-[#141B2E]'
            }`}
          >
            {tab === 'payers' ? 'Payers' : tab === 'claims' ? 'Claims' : 'Staff'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-20 text-center text-[#5B6472] text-sm">Loading reports…</div>
      ) : (
        <>
          {/* ── Payers tab ───────────────────────────────────────────────── */}
          {activeTab === 'payers' && <>

          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">By Payer</h2>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    {([
                      ['payer',           'Payer',          false],
                      ['claim_count',     'Claims',         true],
                      ['total_balance',   'Total Balance',  true],
                      ['avg_age_days',    'Avg Age (days)', true],
                      ['denial_rate_pct', 'Denial Rate',    true],
                    ] as [PayerSortKey, string, boolean][]).map(([key, label, right]) => (
                      <th key={key} className={right ? thRight : thLeft} onClick={() => toggleSort(key)}>
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {sortedPayers.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[#5B6472] text-xs">No data</td></tr>
                  ) : sortedPayers.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 text-[#141B2E] font-medium">{row.payer || '—'}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.claim_count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#141B2E]">{fmt$(row.total_balance)}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{Math.round(row.avg_age_days)}</td>
                      <td className={`px-3 py-2.5 border-l-2 text-right ${
                        row.denial_rate_pct >= 30 ? 'border-red-400'
                        : row.denial_rate_pct >= 15 ? 'border-amber-400'
                        : 'border-transparent'
                      }`}>
                        <span className="font-mono tabular-nums text-[#5B6472] text-xs">
                          {(row.denial_rate_pct ?? 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          </>}

          {/* ── Claims tab ───────────────────────────────────────────────── */}
          {activeTab === 'claims' && <>

          {/* ── Oldest Active Claims ─────────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">Oldest Active Claims</h2>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    {[
                      ['Invoice Ref',      false],
                      ['Payer',            false],
                      ['Stage',            false],
                      ['Claim Age (days)', true],
                      ['Billed',           true],
                      ['Balance',          true],
                    ].map(([h, right]) => (
                      <th key={h as string} className={right ? thRight : thLeft}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {oldest.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5B6472] text-xs">No data</td></tr>
                  ) : oldest.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 font-mono text-[#141B2E] text-xs">{row.invoice_ref || '—'}</td>
                      <td className="px-3 py-2.5 text-[#5B6472]">{row.payer || '—'}</td>
                      <td className="px-3 py-2.5 text-[#5B6472] text-xs">
                        {STAGE_LABELS[row.current_stage] ?? row.current_stage}
                      </td>
                      <td className={`px-3 py-2.5 font-mono tabular-nums text-right border-l-2 ${
                        row.claim_age_days > 1000 ? 'border-red-400'
                        : row.claim_age_days > 365 ? 'border-amber-400'
                        : 'border-transparent'
                      }`}>
                        <span className="text-[#141B2E]">{row.claim_age_days.toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472] text-xs">{fmt$(row.billed_amount)}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#141B2E] text-xs">{fmt$(row.balance_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Claims by Month ──────────────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">Claims by Month</h2>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    <th className={thLeft}>Month</th>
                    <th className={thRight}>Claims</th>
                    <th className={thRight}>Total Billed</th>
                    <th className={thRight}>Total Balance</th>
                    <th className={thRight}>Denial Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {claimsByMonth.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[#5B6472] text-xs">No data</td></tr>
                  ) : claimsByMonth.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 text-[#141B2E] font-medium">{fmtMonth(row.month)}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.claim_count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{fmtK$(row.total_billed)}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#141B2E]">{fmtK$(row.total_balance)}</td>
                      <td className={`px-3 py-2.5 border-l-2 text-right ${
                        row.denial_rate_pct >= 30 ? 'border-red-400'
                        : row.denial_rate_pct >= 15 ? 'border-amber-400'
                        : 'border-transparent'
                      }`}>
                        <span className="font-mono tabular-nums text-[#5B6472] text-xs">
                          {(row.denial_rate_pct ?? 0).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Legacy Claims ─────────────────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">Legacy Claims — Write-Off Review</h2>
            {legacy ? (
              <div className="border-l-4 border-amber-400 pl-5 py-4">
                <div className="flex items-start gap-2 mb-5">
                  <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-[#5B6472]">
                    Claims aged over 1,000 days — candidates for formal write-off review, not active collection targets.
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-6">
                  {[
                    { label: 'Claim Count',    value: legacy.count.toLocaleString() },
                    { label: 'Total Billed',   value: fmtK$(legacy.total_billed) },
                    { label: 'Total Balance',  value: fmtK$(legacy.total_balance) },
                    { label: 'Oldest Claim',   value: `${legacy.oldest_days.toLocaleString()} days` },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div className="text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.1em]">{label}</div>
                      <div className="text-xl font-mono tabular-nums text-[#141B2E] mt-1.5">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-[#5B6472] text-sm border-t border-[#E5E7EB]">No data</div>
            )}
          </section>

          </>}

          {/* ── Staff tab ────────────────────────────────────────────────── */}
          {activeTab === 'staff' && <>

          {/* ── Staff Directory ──────────────────────────────────────────── */}
          {(() => {
            const ROLE_ORDER: Record<string, number> = {
              manager: 0, team_lead: 1, senior_associate: 2, associate: 3,
            };
            const sorted = [...staffDirectory].sort((a, b) => {
              const rCmp = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
              return rCmp !== 0 ? rCmp : a.full_name.localeCompare(b.full_name);
            });
            return (
              <section>
                <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">Staff Directory</h2>
                <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
                  <table className="w-full text-sm">
                    <thead className="border-b border-[#E5E7EB]">
                      <tr>
                        <th className={thLeft}>Name</th>
                        <th className={thLeft}>Role</th>
                        <th className={thLeft}>Team</th>
                        <th className={thRight}>Actions</th>
                        <th className={thRight}>Advances</th>
                        <th className={thLeft}>Last Active</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E5E7EB]">
                      {sorted.length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5B6472] text-xs">No data</td></tr>
                      ) : sorted.map((row, i) => (
                        <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                          <td className="px-3 py-2.5 text-[#141B2E] font-medium">{row.full_name}</td>
                          <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.role}</td>
                          <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.team_slug ?? '—'}</td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.actions_count.toLocaleString()}</td>
                          <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.advances.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-[#5B6472] text-xs">
                            {row.last_active ? fmtDate(row.last_active) : 'Never'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}

          {/* ── Team Leads Overview ──────────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-2">Team Leads Overview</h2>
            <p className="text-xs text-[#5B6472] mb-4">
              Multiple leads on the same team show identical team-level numbers — this reflects shared oversight, not per-person duplication.
              Payment Posting shows 0 open claims by definition (it's the resolved stage).
            </p>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    <th className={thLeft}>Team Lead</th>
                    <th className={thLeft}>Team</th>
                    <th className={thRight}>Team Size</th>
                    <th className={thRight}>Open Claims</th>
                    <th className={thRight}>Total Value</th>
                    <th className={thRight}>Avg Age (days)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {teamLeadOverview.length === 0 ? (
                    <tr><td colSpan={6} className="px-3 py-8 text-center text-[#5B6472] text-xs">No data</td></tr>
                  ) : teamLeadOverview.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 text-[#141B2E] font-medium">{row.team_lead_name}</td>
                      <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.team_name}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.team_size.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#141B2E] font-medium">{row.open_claims.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#141B2E]">{fmtK$(row.total_value)}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{Math.round(row.avg_age_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── By Staff ─────────────────────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">By Staff</h2>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    <th className={thLeft}>Name</th>
                    <th className={thLeft}>Role</th>
                    <th className={thRight}>Actions</th>
                    <th className={thRight}>Advances</th>
                    <th className={thLeft}>Last Active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {staffPerf.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[#5B6472] text-xs">No activity recorded yet</td></tr>
                  ) : staffPerf.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 text-[#141B2E] font-medium">{row.full_name}</td>
                      <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.role}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.actions_count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.advances.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-[#5B6472] text-xs">{fmtDate(row.last_active)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Staff Activity by Month ───────────────────────────────────── */}
          <section>
            <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">Staff Activity by Month</h2>
            <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
              <table className="w-full text-sm">
                <thead className="border-b border-[#E5E7EB]">
                  <tr>
                    <th className={thLeft}>Month</th>
                    <th className={thLeft}>Name</th>
                    <th className={thLeft}>Role</th>
                    <th className={thRight}>Actions</th>
                    <th className={thRight}>Advances</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E7EB]">
                  {staffActivity.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-8 text-center text-[#5B6472] text-xs">No activity recorded yet</td></tr>
                  ) : staffActivity.map((row, i) => (
                    <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                      <td className="px-3 py-2.5 text-[#141B2E] font-medium">{fmtMonth(row.month)}</td>
                      <td className="px-3 py-2.5 text-[#141B2E]">{row.full_name}</td>
                      <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.role}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.actions_count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.advances.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── By Collector ─────────────────────────────────────────────── */}
          {collectors.length > 0 && (() => {
            const TEAM_NAME = 'Billing, KPHC Infusion';
            const teamRow   = collectors.find(r => r.collector_name === TEAM_NAME) ?? null;
            const individuals = collectors.filter(r => r.collector_name !== TEAM_NAME);
            return (
              <section>
                <h2 className="text-[10px] font-semibold text-[#5B6472] tracking-[0.12em] mb-4">By Collector</h2>

                {teamRow && (
                  <div className="border-t border-[#E5E7EB] pt-5 pb-6">
                    <div className="flex items-start justify-between mb-5">
                      <div>
                        <div className="text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.1em] mb-1">
                          Billing Team / Queue
                        </div>
                        <div className="text-base font-medium text-[#141B2E]">{teamRow.collector_name}</div>
                      </div>
                      <span className="text-[10px] text-[#5B6472] mt-1">Team queue — not an individual</span>
                    </div>
                    <div className="grid grid-cols-3 gap-8 border-l-2 border-[#2DD4BF] pl-5">
                      {[
                        { label: 'Claims',         value: teamRow.claim_count.toLocaleString() },
                        { label: 'Total Balance',  value: fmt$(teamRow.total_balance) },
                        { label: 'Avg Age (days)', value: Math.round(teamRow.avg_age_days).toLocaleString() },
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <div className="text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.1em]">{label}</div>
                          <div className="text-2xl font-mono tabular-nums text-[#141B2E] mt-1">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {individuals.length > 0 && (
                  <>
                    <p className="text-xs text-[#5B6472] mb-3">
                      These names appear only on legacy claims (avg age 2,500+ days) — likely historical records, not current staff assignments.
                    </p>
                    <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
                      <table className="w-full text-sm">
                        <thead className="border-b border-[#E5E7EB]">
                          <tr>
                            <th className={thLeft}>Name</th>
                            <th className={thLeft}>Type</th>
                            <th className={thRight}>Claims</th>
                            <th className={thRight}>Avg Age (days)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E5E7EB]">
                          {individuals.map((row, i) => (
                            <tr key={i} className="hover:bg-[#F5F5F2] transition-colors">
                              <td className="px-3 py-2.5 text-[#141B2E] font-medium">{row.collector_name}</td>
                              <td className="px-3 py-2.5 text-[#5B6472] text-xs">{row.collector_type}</td>
                              <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{row.claim_count.toLocaleString()}</td>
                              <td className="px-3 py-2.5 font-mono tabular-nums text-right text-[#5B6472]">{Math.round(row.avg_age_days)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </section>
            );
          })()}

          </>}

        </>
      )}
    </div>
  );
}
