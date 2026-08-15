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
import { ChevronRight, RefreshCw } from 'lucide-react';

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
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-slate-500 text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-800 mt-1">{value}</div>
      {sub && <div className="text-slate-400 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

export default function TeamQueue() {
  const { staff } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [members, setMembers] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  async function fetchData() {
    if (!staff?.team_id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // Step 1: get all team members
    const { data: membersData, error: membersError } = await supabase
      .from('staff')
      .select('*')
      .eq('team_id', staff.team_id);
    if (membersError) console.error('[TeamQueue] members error:', membersError.message);

    const teamMembers = membersData ?? [];
    setMembers(teamMembers);

    // Step 2: get work items assigned to any team member
    // (work_items has no team_id column — team is derived via assigned_to → staff.team_id)
    const memberIds = teamMembers.map(m => m.id);
    if (memberIds.length === 0) {
      setItems([]);
      setLoading(false);
      return;
    }

    const { data: itemsData, error: itemsError } = await supabase
      .from('work_items')
      .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
      .in('assigned_to', memberIds)
      .neq('current_stage', TERMINAL_STAGE)
      .order('created_at', { ascending: true });
    if (itemsError) console.error('[TeamQueue] items error:', itemsError.message);

    setItems(itemsData ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchData(); }, [staff]);

  async function advance(item: WorkItem) {
    const next = getNextStage(item.current_stage);
    if (!next) return;
    setAdvancing(item.id);
    await supabase
      .from('work_items')
      .update({ current_stage: next, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    await supabase.from('activity_log').insert({
      work_item_id: item.id,
      staff_id: staff!.id,
      action: 'stage_advance',
      stage: next,
      notes: `Moved from ${STAGE_LABELS[item.current_stage] ?? item.current_stage} to ${STAGE_LABELS[next] ?? next}`,
    });
    setAdvancing(null);
    await fetchData();
  }

  // KPIs
  const avgDays = items.length
    ? Math.round(items.reduce((s, i) => s + (i.days_in_stage ?? 0), 0) / items.length)
    : 0;
  const totalValue = items.reduce((s, i) => s + (i.value ?? 0), 0);
  const bottleneckStage = (() => {
    const counts: Record<string, number> = {};
    items.forEach(i => { counts[i.current_stage] = (counts[i.current_stage] ?? 0) + 1; });
    const max = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return max ? `${STAGE_LABELS[max[0]] ?? max[0]} (${max[1]})` : '—';
  })();
  const stageDistribution = STAGE_ORDER.filter(s => items.some(i => i.current_stage === s));

  const displayed = items.filter(i => {
    if (memberFilter && i.assigned_to !== memberFilter) return false;
    if (stageFilter && i.current_stage !== stageFilter) return false;
    return true;
  });

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Team Queue</h1>
          <p className="text-slate-500 text-sm mt-0.5">{members.length} members · {items.length} open claims</p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard label="Open Claims" value={items.length} />
        <KpiCard label="Total Value" value={`$${Math.round(totalValue / 1000)}k`} sub="in pipeline" />
        <KpiCard label="Avg Days in Stage" value={avgDays} sub="across open items" />
        <KpiCard label="Top Bottleneck" value={bottleneckStage} sub="by volume" />
      </div>

      {/* Stage distribution */}
      {stageDistribution.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Stage Distribution</div>
          <div className="flex gap-3 flex-wrap">
            {stageDistribution.map(s => {
              const count = items.filter(i => i.current_stage === s).length;
              return (
                <div key={s} className="flex items-center gap-1.5">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STAGE_COLORS[s] ?? 'bg-slate-100 text-slate-600'}`}>
                    {STAGE_LABELS[s]}
                  </span>
                  <span className="text-slate-500 text-xs">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={memberFilter}
          onChange={e => setMemberFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="">All members</option>
          {members.map(m => (
            <option key={m.id} value={m.id}>{m.full_name}</option>
          ))}
        </select>
        <select
          value={stageFilter}
          onChange={e => setStageFilter(e.target.value)}
          className="text-sm border border-slate-200 rounded-md px-3 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
        >
          <option value="">All stages</option>
          {stageDistribution.map(s => (
            <option key={s} value={s}>{STAGE_LABELS[s]}</option>
          ))}
        </select>
        {(memberFilter || stageFilter) && (
          <button
            onClick={() => { setMemberFilter(''); setStageFilter(''); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No items match filters</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Invoice Ref</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Assigned To</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Service Line</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Stage</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Value</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Days</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(item => {
                const next = getNextStage(item.current_stage);
                const days = item.days_in_stage ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{item.invoice_ref ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">
                      {item.assigned_staff?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.clients?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {item.service_line ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
                          {item.service_line}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3"><StageBadge stage={item.current_stage} /></td>
                    <td className="px-4 py-3 text-right text-slate-700 font-medium">
                      ${(item.value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium ${days > 10 ? 'text-red-500' : days > 5 ? 'text-amber-500' : 'text-slate-600'}`}>
                      {days}d
                    </td>
                    <td className="px-4 py-3 text-right">
                      {next ? (
                        <button
                          disabled={advancing === item.id}
                          onClick={() => advance(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {advancing === item.id ? 'Moving…' : <><ChevronRight size={12} /> Advance</>}
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">Final</span>
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
