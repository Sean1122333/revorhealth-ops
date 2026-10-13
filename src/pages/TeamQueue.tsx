import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { WorkItem, Staff } from '../types';
import {
  STAGE_LABELS,
  STAGE_COLORS,
  STAGE_ORDER,
  TERMINAL_STAGE,
  getNextStage,
  SERVICE_LINE_COLORS,
} from '../types';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

function StageBadge({ stage }: { stage: string }) {
  const color = STAGE_COLORS[stage] ?? 'bg-slate-100 text-slate-600';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {STAGE_LABELS[stage] ?? stage}
    </span>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="border-t-2 border-[#E5E7EB] pt-5 pb-4">
      <div className="text-[10px] font-semibold text-[#5B6472] tracking-[0.1em]">{label}</div>
      <div className="text-2xl font-mono tabular-nums text-[#141B2E] mt-2">{value}</div>
      {sub && <div className="text-[#5B6472] text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

type TeamStageSummary = { claim_count: number; total_billed: number; avg_days: number };

export default function TeamQueue() {
  const { staff } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [members, setMembers] = useState<Staff[]>([]);
  const [summary, setSummary] = useState<TeamStageSummary | null>(null);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  async function fetchData() {
    if (!staff?.group_id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Step 1: members, group's stage slugs, KPI aggregate, stage counts — all in parallel
    const [membersRes, slugsRes, summaryRes, stageCountsRes] = await Promise.all([
      supabase.from('staff').select('*').eq('group_id', staff.group_id),
      supabase.from('teams').select('slug').eq('group_id', staff.group_id),
      supabase.rpc('team_stage_summary'),
      supabase.rpc('stage_counts'),
    ]);
    if (membersRes.error) console.error('[TeamQueue] members error:', membersRes.error.message);
    if (slugsRes.error) console.error('[TeamQueue] slugs error:', slugsRes.error.message);
    if (summaryRes.error) console.error('[TeamQueue] summary error:', summaryRes.error.message);
    if (stageCountsRes.error) console.error('[TeamQueue] stage_counts error:', stageCountsRes.error.message);

    setMembers(membersRes.data ?? []);
    setSummary((summaryRes.data as TeamStageSummary) ?? null);
    setStageCounts((stageCountsRes.data as Record<string, number>) ?? {});

    const stageSlugs = (slugsRes.data ?? []).map(r => r.slug).filter(s => s !== TERMINAL_STAGE);
    if (!stageSlugs.length) {
      setItems([]);
      setLoading(false);
      return;
    }

    // Step 2: one query per stage in the group — no shared 500-row limit
    const stageResults = await Promise.all(
      stageSlugs.map(slug =>
        supabase
          .from('work_items')
          .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
          .eq('current_stage', slug)
          .in('source_schema', ['A', 'B'])
          .order('days_in_stage', { ascending: false })
          .limit(500)
      )
    );

    const allItems = stageResults.flatMap((r, i) => {
      if (r.error) console.error(`[TeamQueue] items error (${stageSlugs[i]}):`, r.error.message);
      return (r.data ?? []) as WorkItem[];
    });

    setItems(allItems);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, [staff]);

  async function advance(item: WorkItem) {
    if (!getNextStage(item.current_stage)) return;
    setAdvancing(item.id);
    setAdvanceError(null);
    const { data, error } = await supabase.rpc('advance_work_item', {
      p_item_id: item.id,
      p_expected_stage: item.current_stage,
    });
    if (error) {
      console.error('[TeamQueue] advance_work_item:', error.message);
      setAdvanceError(
        error.message === 'stage_mismatch'
          ? 'This claim was modified by someone else — refresh and try again.'
          : error.message === 'stage_not_in_group'
          ? 'You don\'t have permission to advance this claim.'
          : 'Something went wrong — refresh and try again.',
      );
    } else if (data?.error) {
      console.error('[TeamQueue] advance_work_item data.error:', data.error);
      setAdvanceError('Something went wrong — refresh and try again.');
    }
    setAdvancing(null);
    await fetchData();
  }

  // KPIs — from server-side aggregate, not from the display-capped items array
  const claimCount = summary?.claim_count ?? 0;
  const totalValue = summary?.total_billed ?? 0;
  const avgDays    = summary?.avg_days ?? 0;
  const bottleneckStage = (() => {
    const entries = Object.entries(stageCounts).filter(([, n]) => n > 0);
    if (!entries.length) return '—';
    const max = entries.sort((a, b) => b[1] - a[1])[0];
    return `${STAGE_LABELS[max[0]] ?? max[0]} (${max[1].toLocaleString()})`;
  })();
  const stageDistribution = STAGE_ORDER.filter(s => (stageCounts[s] ?? 0) > 0);

  const displayed = items.filter(i => {
    if (memberFilter && i.assigned_to !== memberFilter) return false;
    if (stageFilter && i.current_stage !== stageFilter) return false;
    return true;
  });

  return (
    <div className="p-6 bg-[#FAFAF8] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#141B2E]">Team Queue</h1>
          <p className="text-[#5B6472] text-sm mt-0.5">{members.length} members · {claimCount.toLocaleString()} open claims</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 text-[#5B6472] hover:text-[#141B2E] text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Advance error banner */}
      {advanceError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{advanceError}</span>
          <button onClick={() => setAdvanceError(null)} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-8 mb-10">
        <KpiCard label="Open Claims" value={claimCount.toLocaleString()} />
        <KpiCard label="Total Value" value={`$${Math.round(totalValue / 1000)}k`} sub="in pipeline" />
        <KpiCard label="Avg Days in Stage" value={avgDays} sub="across open items" />
        <KpiCard label="Top Bottleneck" value={bottleneckStage} sub="by volume" />
      </div>

      {/* Stage distribution */}
      {stageDistribution.length > 0 && (
        <div className="border-t border-b border-[#E5E7EB] py-4 mb-6">
          <div className="text-[10px] font-semibold text-[#5B6472] tracking-[0.1em] mb-3">Stage distribution</div>
          <div className="flex gap-3 flex-wrap">
            {stageDistribution.map(s => (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[s] ?? 'bg-slate-100 text-slate-600'}`}>
                  {STAGE_LABELS[s]}
                </span>
                <span className="text-[#5B6472] text-xs">{(stageCounts[s] ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="relative">
          <select
            value={memberFilter}
            onChange={e => setMemberFilter(e.target.value)}
            className="appearance-none text-sm border border-[#E5E7EB] rounded-md pl-3 pr-7 py-1.5 text-[#5B6472] bg-[#FAFAF8] focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <option value="">All members</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5B6472] pointer-events-none" />
        </div>
        <div className="relative">
          <select
            value={stageFilter}
            onChange={e => setStageFilter(e.target.value)}
            className="appearance-none text-sm border border-[#E5E7EB] rounded-md pl-3 pr-7 py-1.5 text-[#5B6472] bg-[#FAFAF8] focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <option value="">All stages</option>
            {stageDistribution.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#5B6472] pointer-events-none" />
        </div>
        {(memberFilter || stageFilter) && (
          <button
            onClick={() => { setMemberFilter(''); setStageFilter(''); }}
            className="text-xs text-[#5B6472] hover:text-[#141B2E] underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
        {loading ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">No items match filters</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Invoice Ref</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Assigned To</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Client</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Service Line</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Stage</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Value</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Days</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {displayed.map(item => {
                const next = getNextStage(item.current_stage);
                const days = item.days_in_stage ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-[#F5F5F2] transition-colors">
                    <td className="px-4 py-3 font-mono text-[#141B2E]">{item.invoice_ref ?? '—'}</td>
                    <td className="px-4 py-3 text-[#5B6472] text-xs">
                      {item.assigned_staff?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-[#5B6472]">{item.clients?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {item.service_line ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
                          {item.service_line}
                        </span>
                      ) : <span className="text-[#5B6472] opacity-30">—</span>}
                    </td>
                    <td className="px-4 py-3"><StageBadge stage={item.current_stage} /></td>
                    <td className="px-4 py-3 font-mono tabular-nums text-right text-[#141B2E]">
                      ${(item.billed_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </td>
                    <td className={`px-4 py-3 font-mono tabular-nums text-right border-l-2 ${days > 10 ? 'border-red-400' : days > 5 ? 'border-amber-400' : 'border-transparent'}`}>
                      <span className="text-[#5B6472]">{days}d</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {next ? (
                        <button
                          disabled={advancing === item.id}
                          onClick={() => advance(item)}
                          className="flex items-center gap-0.5 text-[#2DD4BF] hover:text-teal-700 text-xs font-medium transition-colors disabled:opacity-40"
                        >
                          {advancing === item.id ? 'Moving…' : <><ChevronRight size={12} /> Advance</>}
                        </button>
                      ) : (
                        <span className="text-[#5B6472] text-xs">Final</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
