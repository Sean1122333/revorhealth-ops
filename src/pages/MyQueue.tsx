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

export default function MyQueue() {
  const { staff } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState('');

  async function fetchItems() {
    if (!staff) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from('work_items')
      .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
      .eq('assigned_to', staff.id)
      .neq('current_stage', TERMINAL_STAGE)
      .order('created_at', { ascending: true });
    if (error) console.error('[MyQueue] fetch error:', error.message);
    setItems(data ?? []);
    setLoading(false);
  }

  useEffect(() => { fetchItems(); }, [staff]);

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
    await fetchItems();
  }

  const stagesPresent = [...new Set(items.map(i => i.current_stage))].sort(
    (a, b) => STAGE_ORDER.indexOf(a as never) - STAGE_ORDER.indexOf(b as never)
  );
  const displayed = stageFilter ? items.filter(i => i.current_stage === stageFilter) : items;
  const totalValue = items.reduce((s, i) => s + (i.billed_amount ?? 0), 0);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">My Queue</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {items.length} open {items.length === 1 ? 'claim' : 'claims'} ·{' '}
            ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })} total
          </p>
        </div>
        <button
          onClick={fetchItems}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Stage filter */}
      {stagesPresent.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setStageFilter('')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              !stageFilter
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
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
                  ? 'bg-slate-800 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {STAGE_LABELS[s] ?? s} ({items.filter(i => i.current_stage === s).length})
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">No open items</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Invoice Ref</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Service Line</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Stage</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Value</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Days in Stage</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {displayed.map(item => {
                const next = getNextStage(item.current_stage);
                const days = item.days_in_stage ?? 0;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{item.invoice_ref ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{item.clients?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      {item.service_line ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
                          {item.service_line}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <StageBadge stage={item.current_stage} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 font-medium">
                      ${(item.billed_amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
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
                          {advancing === item.id ? 'Moving…' : (
                            <>Mark done <ChevronRight size={12} /></>
                          )}
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">Final stage</span>
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
