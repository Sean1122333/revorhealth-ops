import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { WorkItem } from '../types';
import {
  STAGE_LABELS,
  STAGE_COLORS,
  STAGE_ORDER,
  TERMINAL_STAGE,
  getNextStage,
  SERVICE_LINE_COLORS,
} from '../types';
import { ChevronRight, RefreshCw } from 'lucide-react';

function StageBadge({ stage }: { stage: string }) {
  const color = STAGE_COLORS[stage] ?? 'bg-slate-100 text-slate-600';
  const label = STAGE_LABELS[stage] ?? stage;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}

type TeamStageSummary = { claim_count: number; total_billed: number; avg_days: number };
type ViewMode = 'team' | 'assigned';

export default function MyQueue() {
  const { staff } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [summary, setSummary] = useState<TeamStageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('team');

  async function fetchItems(mode: ViewMode) {
    if (!staff?.group_id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const [slugsRes, summaryRes] = await Promise.all([
      supabase.from('teams').select('slug').eq('group_id', staff.group_id),
      mode === 'team'
        ? supabase.rpc('team_stage_summary')
        : supabase.rpc('my_assigned_summary'),
    ]);
    if (slugsRes.error) console.error('[MyQueue] slugs error:', slugsRes.error.message);
    if (summaryRes.error) console.error('[MyQueue] summary error:', summaryRes.error.message);

    setSummary((summaryRes.data as TeamStageSummary) ?? null);

    const stageSlugs = (slugsRes.data ?? []).map(r => r.slug).filter(s => s !== TERMINAL_STAGE);
    if (!stageSlugs.length) { setItems([]); setLoading(false); return; }

    // One query per stage in the group — no shared 500-row limit
    const stageResults = await Promise.all(
      stageSlugs.map(slug => {
        let q = supabase
          .from('work_items')
          .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
          .eq('current_stage', slug)
          .in('source_schema', ['A', 'B'])
          .order('created_at', { ascending: true })
          .limit(500);
        if (mode === 'assigned') q = q.eq('assigned_to', staff!.id);
        return q;
      })
    );

    const allItems = stageResults.flatMap((r, i) => {
      if (r.error) console.error(`[MyQueue] fetch error (${stageSlugs[i]}):`, r.error.message);
      return (r.data ?? []) as WorkItem[];
    });

    setItems(allItems);
    setLoading(false);
  }

  useEffect(() => { fetchItems(viewMode); }, [staff, viewMode]);

  async function advance(item: WorkItem) {
    if (!getNextStage(item.current_stage)) return;
    setAdvancing(item.id);
    setAdvanceError(null);
    const { data, error } = await supabase.rpc('advance_work_item', {
      p_item_id: item.id,
      p_expected_stage: item.current_stage,
    });
    if (error) {
      console.error('[MyQueue] advance_work_item:', error.message);
      setAdvanceError(
        error.message === 'stage_mismatch'
          ? 'This claim was modified by someone else — refresh and try again.'
          : error.message === 'stage_not_in_group'
          ? 'You don\'t have permission to advance this claim.'
          : 'Something went wrong — refresh and try again.',
      );
    } else if (data?.error) {
      console.error('[MyQueue] advance_work_item data.error:', data.error);
      setAdvanceError('Something went wrong — refresh and try again.');
    }
    setAdvancing(null);
    await fetchItems(viewMode);
  }

  const stagesPresent = [...new Set(items.map(i => i.current_stage))].sort(
    (a, b) => STAGE_ORDER.indexOf(a as never) - STAGE_ORDER.indexOf(b as never)
  );
  const displayed = stageFilter ? items.filter(i => i.current_stage === stageFilter) : items;
  const claimCount = summary?.claim_count ?? items.length;
  const totalValue = summary?.total_billed ?? items.reduce((s, i) => s + (i.billed_amount ?? 0), 0);

  return (
    <div className="p-6 bg-[#FAFAF8] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#141B2E]">My Queue</h1>
          <p className="text-[#5B6472] text-sm mt-0.5">
            {claimCount.toLocaleString()} open {claimCount === 1 ? 'claim' : 'claims'} ·{' '}
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })} total
            {viewMode === 'assigned' && ' · assigned to me'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-[#E5E7EB] bg-[#FAFAF8] overflow-hidden text-xs font-medium">
            <button
              onClick={() => setViewMode('team')}
              className={`px-3 py-1.5 transition-colors ${
                viewMode === 'team'
                  ? 'bg-[#141B2E] text-white'
                  : 'text-[#5B6472] hover:text-[#141B2E] hover:bg-[#F5F5F2]'
              }`}
            >
              Team Queue
            </button>
            <button
              onClick={() => setViewMode('assigned')}
              className={`px-3 py-1.5 transition-colors ${
                viewMode === 'assigned'
                  ? 'bg-[#141B2E] text-white'
                  : 'text-[#5B6472] hover:text-[#141B2E] hover:bg-[#F5F5F2]'
              }`}
            >
              My Assigned
            </button>
          </div>
          <button
            onClick={() => fetchItems(viewMode)}
            className="flex items-center gap-1.5 text-[#5B6472] hover:text-[#141B2E] text-sm transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Advance error banner */}
      {advanceError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{advanceError}</span>
          <button onClick={() => setAdvanceError(null)} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Stage filter */}
      {stagesPresent.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setStageFilter('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              !stageFilter
                ? 'bg-[#141B2E] text-white'
                : 'bg-[#FAFAF8] border border-[#E5E7EB] text-[#5B6472] hover:bg-[#F5F5F2]'
            }`}
          >
            All
          </button>
          {stagesPresent.map(s => (
            <button
              key={s}
              onClick={() => setStageFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                stageFilter === s
                  ? 'bg-[#141B2E] text-white'
                  : 'bg-[#FAFAF8] border border-[#E5E7EB] text-[#5B6472] hover:bg-[#F5F5F2]'
              }`}
            >
              {STAGE_LABELS[s] ?? s} ({items.filter(i => i.current_stage === s).length})
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
        {loading ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">No open items</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Invoice Ref</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Client</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Service Line</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Stage</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Value</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Days in Stage</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {displayed.map(item => {
                const next = getNextStage(item.current_stage);
                const days = item.days_in_stage ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-[#F5F5F2] transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-mono text-[#141B2E]">{item.invoice_ref ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-[#5B6472]">{item.clients?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {item.service_line ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
                          {item.service_line}
                        </span>
                      ) : <span className="text-[#5B6472] opacity-30">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={item.current_stage} />
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums text-right text-[#141B2E]">
                      ${(item.billed_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                          {advancing === item.id ? 'Moving…' : (
                            <>Mark done <ChevronRight size={12} /></>
                          )}
                        </button>
                      ) : (
                        <span className="text-[#5B6472] text-xs">Final stage</span>
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
