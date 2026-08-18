import { useEffect, useState, useCallback } from 'react';
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

const SERVICE_LINES = ['CPAP', 'Respiratory', 'Retail', 'Intake', 'Other'] as const;
import { RefreshCw, TrendingUp, TrendingDown, Clock, DollarSign, ChevronRight } from 'lucide-react';

// ── KPI type (returned by kpi_summary() RPC) ───────────────────────────────
type KpiData = {
  total: number; open: number;
  clean_rate: number; denial_rate: number;
  total_billed: number; total_balance: number; collections_mtd: number;
  ar_0_5: number; ar_6_15: number; ar_16_30: number; ar_31_plus: number;
};

// ── Sub-components ────────────────────────────────────────────────────────
function KpiCard({
  label, value, icon: Icon, trend, color,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  trend?: 'up' | 'down';
  color: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-slate-500 text-xs font-medium uppercase tracking-wide">{label}</div>
          <div className="text-3xl font-bold text-slate-800 mt-1.5">{value}</div>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={18} />
        </div>
      </div>
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend === 'up' ? 'text-green-600' : 'text-red-500'}`}>
          {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend === 'up' ? 'Positive trend' : 'Needs attention'}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ item, onAdvance, advancing }: {
  item: WorkItem;
  onAdvance: (item: WorkItem) => void;
  advancing: string | null;
}) {
  const days = item.days_in_stage ?? 0;
  const next = getNextStage(item.current_stage);
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-slate-800 text-xs truncate">{item.invoice_ref ?? '—'}</div>
        </div>
        <div className={`text-[10px] font-medium shrink-0 ${days > 10 ? 'text-red-500' : days > 5 ? 'text-amber-500' : 'text-slate-400'}`}>
          {days}d
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-500 truncate">{item.clients?.name ?? '—'}</div>
      {item.service_line && (
        <span className={`mt-1 inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
          {item.service_line}
        </span>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">
          ${(item.billed_amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
        {next && (
          <button
            disabled={advancing === item.id}
            onClick={() => onAdvance(item)}
            className="flex items-center gap-0.5 text-[10px] text-teal-600 hover:text-teal-800 font-medium transition-colors disabled:opacity-40"
          >
            {advancing === item.id ? '…' : <><ChevronRight size={11} />Next</>}
          </button>
        )}
      </div>
    </div>
  );
}

function formatCurrency(amount: number): string {
  if (amount >= 1000) {
    const k = amount / 1000;
    const rounded = Math.round(k * 10) / 10;
    return `$${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return `$${Math.round(amount)}`;
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function Pipeline() {
  const { staff } = useAuth();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [serviceLineFilter, setServiceLineFilter] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    // KPIs computed server-side over full table (respects RLS).
    // Kanban fetches open items only, capped at 500 for display.
    const [kpiRes, workItemsRes] = await Promise.all([
      supabase.rpc('kpi_summary'),
      supabase
        .from('work_items')
        .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
        .neq('current_stage', TERMINAL_STAGE)
        .order('updated_at', { ascending: false })
        .limit(500),
    ]);
    console.log('[Pipeline] kpi:', kpiRes.error?.message ?? 'ok', '| work_items:', workItemsRes.data?.length ?? 0, 'rows | error:', workItemsRes.error?.message ?? 'none');
    setKpi((kpiRes.data as KpiData) ?? null);
    setItems(workItemsRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

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
      notes: `Manager: moved to ${STAGE_LABELS[next] ?? next}`,
    });
    setAdvancing(null);
    await fetchItems();
  }

  const arBuckets = kpi ? [
    { label: '0–5d',   count: kpi.ar_0_5     },
    { label: '6–15d',  count: kpi.ar_6_15    },
    { label: '16–30d', count: kpi.ar_16_30   },
    { label: '30d+',   count: kpi.ar_31_plus },
  ] : [];

  // Apply service_line filter before grouping into columns
  const displayItems = serviceLineFilter
    ? items.filter(i => i.service_line === serviceLineFilter)
    : items;

  // Group by stage — STAGE_ORDER defines column order
  const byStage = STAGE_ORDER.map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    items: displayItems.filter(i => i.current_stage === stage),
  }));

  // Catch any stages in DB not in STAGE_ORDER (shouldn't happen, but safe)
  const knownStages = new Set(STAGE_ORDER as readonly string[]);
  const unknownStages = [...new Set(displayItems.map(i => i.current_stage))].filter(s => !knownStages.has(s));
  const allColumns = [
    ...byStage,
    ...unknownStages.map(stage => ({ stage, label: stage, items: displayItems.filter(i => i.current_stage === stage) })),
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Pipeline</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {kpi?.total.toLocaleString() ?? '—'} total · {kpi?.open.toLocaleString() ?? '—'} open
            {serviceLineFilter ? ` · ${displayItems.length} ${serviceLineFilter}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={serviceLineFilter}
            onChange={e => setServiceLineFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-md px-3 py-1.5 text-slate-600 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="">All service lines</option>
            {SERVICE_LINES.map(sl => (
              <option key={sl} value={sl}>{sl}</option>
            ))}
          </select>
          <button
            onClick={fetchItems}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-600 text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="Clean Claim Rate"
          value={kpi ? `${kpi.clean_rate}%` : '—'}
          icon={TrendingUp}
          color="bg-green-50 text-green-600"
          trend={kpi ? (kpi.clean_rate >= 70 ? 'up' : 'down') : undefined}
        />
        <KpiCard
          label="Denial Rate"
          value={kpi ? `${kpi.denial_rate}%` : '—'}
          icon={TrendingDown}
          color="bg-red-50 text-red-500"
          trend={kpi ? (kpi.denial_rate <= 15 ? 'up' : 'down') : undefined}
        />
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-start justify-between mb-3">
            <div className="text-slate-500 text-xs font-medium uppercase tracking-wide">AR Aging</div>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-50 text-amber-500">
              <Clock size={18} />
            </div>
          </div>
          <div className="space-y-1.5">
            {arBuckets.map(b => (
              <div key={b.label} className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{b.label}</span>
                <span className="font-medium text-slate-700">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
        <KpiCard
          label="Collections MTD"
          value={formatCurrency(kpi?.collections_mtd ?? 0)}
          icon={DollarSign}
          color="bg-teal-50 text-teal-600"
        />
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Loading pipeline…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {allColumns.map(({ stage, label, items: colItems }) => (
            <div key={stage} className="flex-shrink-0 w-48">
              <div className={`rounded-t-lg px-3 py-2 flex items-center justify-between ${STAGE_COLORS[stage] ?? 'bg-slate-100 text-slate-600'}`}>
                <span className="text-xs font-semibold truncate">{label}</span>
                <span className="text-xs font-bold ml-1 opacity-80">{colItems.length}</span>
              </div>
              <div className="bg-slate-100 rounded-b-lg p-2 space-y-2 min-h-24">
                {colItems.length === 0 && (
                  <div className="py-6 text-center text-slate-300 text-xs">Empty</div>
                )}
                {colItems.map(item => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    onAdvance={advance}
                    advancing={advancing}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
