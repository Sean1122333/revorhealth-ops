import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
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
import { RefreshCw, TrendingUp, TrendingDown, Clock, DollarSign, ChevronRight, ChevronUp, ChevronDown, LayoutGrid, List } from 'lucide-react';

// ── KPI type (returned by kpi_summary() RPC) ───────────────────────────────
type KpiData = {
  total: number; open: number;
  clean_rate: number; denial_rate: number;
  total_billed: number; total_balance: number; collections_mtd: number;
  ar_0_30: number; ar_31_60: number; ar_61_90: number; ar_91_120: number; ar_120_plus: number;
  ar_0_30_dollars: number; ar_31_60_dollars: number; ar_61_90_dollars: number;
  ar_91_120_dollars: number; ar_120_plus_dollars: number;
  credit_balance_total: number;
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
    <div className="border-t-2 border-[#E5E7EB] pt-5 pb-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.1em]">{label}</div>
          <div className="text-2xl font-mono tabular-nums text-[#141B2E] mt-2">{value}</div>
        </div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center opacity-60 ${color}`}>
          <Icon size={16} />
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
    <div className="bg-white rounded border border-[#E5E7EB] p-3 hover:border-[#2DD4BF] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[#141B2E] text-xs truncate">{item.invoice_ref ?? '—'}</div>
        </div>
        <div className={`text-[10px] font-mono tabular-nums shrink-0 ${days > 10 ? 'text-red-500' : days > 5 ? 'text-amber-500' : 'text-[#5B6472]'}`}>
          {days}d
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-[#5B6472] truncate">{item.clients?.name ?? '—'}</div>
      {item.service_line && (
        <span className={`mt-1 inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${SERVICE_LINE_COLORS[item.service_line] ?? 'bg-slate-100 text-slate-500'}`}>
          {item.service_line}
        </span>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-mono tabular-nums text-[#141B2E]">
          ${(item.billed_amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
        {next && (
          <button
            disabled={advancing === item.id}
            onClick={() => onAdvance(item)}
            className="flex items-center gap-0.5 text-[10px] text-[#2DD4BF] hover:text-teal-700 font-medium transition-colors disabled:opacity-40"
          >
            {advancing === item.id ? '…' : <><ChevronRight size={11} />Next</>}
          </button>
        )}
      </div>
    </div>
  );
}

type TableSortKey = 'invoice_ref' | 'payer' | 'days_in_stage' | 'billed_amount' | 'balance_amount';
type TableSort = { key: TableSortKey; dir: 'asc' | 'desc' };

const TABLE_COLS: { key: TableSortKey; label: string; right?: boolean }[] = [
  { key: 'invoice_ref',    label: 'Invoice' },
  { key: 'payer',          label: 'Payer' },
  { key: 'days_in_stage',  label: 'Age',     right: true },
  { key: 'billed_amount',  label: 'Billed',  right: true },
  { key: 'balance_amount', label: 'Balance', right: true },
];

function KanbanTable({ items, sort, onSort, onAdvance, advancing }: {
  items: WorkItem[];
  sort: TableSort;
  onSort: (key: TableSortKey) => void;
  onAdvance: (item: WorkItem) => void;
  advancing: string | null;
}) {
  const sorted = [...items].sort((a, b) => {
    const av = sort.key === 'payer' ? (a.payer ?? '') : ((a as unknown as Record<string, number | string>)[sort.key] ?? 0);
    const bv = sort.key === 'payer' ? (b.payer ?? '') : ((b as unknown as Record<string, number | string>)[sort.key] ?? 0);
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="bg-[#FAFAF8] overflow-x-auto min-h-24">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#E5E7EB]">
            {TABLE_COLS.map(({ key, label, right }) => (
              <th
                key={key}
                onClick={() => onSort(key)}
                className={`px-2 py-2 text-[10px] font-semibold text-[#5B6472] uppercase tracking-wide cursor-pointer hover:text-[#141B2E] select-none whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
              >
                <span className="inline-flex items-center gap-0.5">
                  {label}
                  {sort.key === key
                    ? sort.dir === 'asc' ? <ChevronUp size={9} className="text-[#2DD4BF]" /> : <ChevronDown size={9} className="text-[#2DD4BF]" />
                    : <ChevronUp size={9} className="text-[#E5E7EB]" />}
                </span>
              </th>
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB]">
          {sorted.length === 0 && (
            <tr><td colSpan={6} className="py-6 text-center text-[#5B6472]">Empty</td></tr>
          )}
          {sorted.map(item => {
            const next = getNextStage(item.current_stage);
            const days = item.days_in_stage ?? 0;
            return (
              <tr key={item.id} className="hover:bg-[#F5F5F2] transition-colors">
                <td className="px-2 py-1.5 font-mono text-[#141B2E]">{item.invoice_ref ?? '—'}</td>
                <td className="px-2 py-1.5 text-[#5B6472] max-w-[96px] truncate">{item.payer ?? '—'}</td>
                <td className={`py-1.5 pl-2 pr-2 font-mono tabular-nums text-right border-l-2 ${days > 10 ? 'border-red-400' : days > 5 ? 'border-amber-400' : 'border-transparent'}`}>
                  <span className="text-[#5B6472]">{days}</span>
                </td>
                <td className="px-2 py-1.5 font-mono tabular-nums text-right text-[#141B2E]">${(item.billed_amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                <td className="px-2 py-1.5 font-mono tabular-nums text-right text-[#141B2E]">${(item.balance_amount ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</td>
                <td className="px-2 py-1.5">
                  {next && (
                    <button
                      disabled={advancing === item.id}
                      onClick={() => onAdvance(item)}
                      className="flex items-center gap-0.5 text-[#2DD4BF] hover:text-teal-700 font-medium transition-colors disabled:opacity-40"
                    >
                      {advancing === item.id ? '…' : <><ChevronRight size={10} />Next</>}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  const [itemsByStage, setItemsByStage] = useState<Record<string, WorkItem[]>>({});
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [serviceLineFilter, setServiceLineFilter] = useState('');
  const [viewModeOverrides, setViewModeOverrides] = useState<Record<string, 'cards' | 'table'>>({});
  const [tableSorts, setTableSorts] = useState<Record<string, TableSort>>({});

  function getViewMode(stage: string): 'cards' | 'table' {
    if (stage in viewModeOverrides) return viewModeOverrides[stage];
    return (stageCounts[stage] ?? 0) > 50 ? 'table' : 'cards';
  }

  function getTableSort(stage: string): TableSort {
    return tableSorts[stage] ?? { key: 'days_in_stage', dir: 'desc' };
  }

  function handleTableSort(stage: string, key: TableSortKey) {
    setTableSorts(prev => {
      const cur = prev[stage] ?? { key: 'days_in_stage', dir: 'desc' };
      return { ...prev, [stage]: { key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc' } };
    });
  }

  const KANBAN_STAGES = STAGE_ORDER.filter(s => s !== TERMINAL_STAGE);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    // KPIs + stage counts server-side; one scoped query per kanban stage in parallel.
    const stageQuery = (stage: string) =>
      supabase
        .from('work_items')
        .select('*, clients(name), assigned_staff:staff!assigned_to(full_name)')
        .in('source_schema', ['A', 'B'])
        .eq('current_stage', stage)
        .order('days_in_stage', { ascending: false })
        .limit(500);

    const [kpiRes, stageCountsRes, ...stageResults] = await Promise.all([
      supabase.rpc('kpi_summary'),
      supabase.rpc('stage_counts'),
      ...KANBAN_STAGES.map(stageQuery),
    ]);

    const newItemsByStage: Record<string, WorkItem[]> = {};
    KANBAN_STAGES.forEach((stage, i) => {
      const res = stageResults[i];
      if (res.error) console.error(`[Pipeline] ${stage}:`, res.error.message);
      else console.log(`[Pipeline] ${stage}:`, res.data?.length ?? 0, 'rows');
      newItemsByStage[stage] = (res.data as WorkItem[]) ?? [];
    });

    setKpi((kpiRes.data as KpiData) ?? null);
    setStageCounts((stageCountsRes.data as Record<string, number>) ?? {});
    setItemsByStage(newItemsByStage);
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function advance(item: WorkItem) {
    if (!getNextStage(item.current_stage)) return;
    setAdvancing(item.id);
    setAdvanceError(null);
    const { data, error } = await supabase.rpc('advance_work_item', {
      p_item_id: item.id,
      p_expected_stage: item.current_stage,
    });
    if (error) {
      console.error('[Pipeline] advance_work_item:', error.message);
      setAdvanceError(
        error.message === 'stage_mismatch'
          ? 'This claim was modified by someone else — refresh and try again.'
          : error.message === 'stage_not_in_group'
          ? 'You don\'t have permission to advance this claim.'
          : 'Something went wrong — refresh and try again.',
      );
    } else if (data?.error) {
      console.error('[Pipeline] advance_work_item data.error:', data.error);
      setAdvanceError('Something went wrong — refresh and try again.');
    }
    setAdvancing(null);
    await fetchItems();
  }

  const arBuckets = kpi ? [
    { label: '0–30d',   count: kpi.ar_0_30,    dollars: kpi.ar_0_30_dollars    },
    { label: '31–60d',  count: kpi.ar_31_60,   dollars: kpi.ar_31_60_dollars   },
    { label: '61–90d',  count: kpi.ar_61_90,   dollars: kpi.ar_61_90_dollars   },
    { label: '91–120d', count: kpi.ar_91_120,  dollars: kpi.ar_91_120_dollars  },
    { label: '120d+',   count: kpi.ar_120_plus, dollars: kpi.ar_120_plus_dollars },
  ] : [];

  // Build kanban columns from per-stage buckets, applying service line filter client-side
  const allColumns = KANBAN_STAGES.map(stage => ({
    stage,
    label: STAGE_LABELS[stage],
    items: (itemsByStage[stage] ?? []).filter(i => !serviceLineFilter || i.service_line === serviceLineFilter),
  }));

  return (
    <div className="p-6 bg-[#FAFAF8] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-[#141B2E]">Pipeline</h1>
          <p className="text-[#5B6472] text-sm mt-0.5">
            {kpi?.total.toLocaleString() ?? '—'} total · {kpi?.open.toLocaleString() ?? '—'} open
            {serviceLineFilter ? ` · ${allColumns.reduce((n, c) => n + c.items.length, 0)} ${serviceLineFilter}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={serviceLineFilter}
            onChange={e => setServiceLineFilter(e.target.value)}
            className="text-sm border border-[#E5E7EB] rounded-md px-3 py-1.5 text-[#5B6472] bg-[#FAFAF8] focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <option value="">All service lines</option>
            {SERVICE_LINES.map(sl => (
              <option key={sl} value={sl}>{sl}</option>
            ))}
          </select>
          <button
            onClick={fetchItems}
            className="flex items-center gap-1.5 text-[#5B6472] hover:text-[#141B2E] text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Advance error banner */}
      {advanceError && (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{advanceError}</span>
          <button
            onClick={() => setAdvanceError(null)}
            className="shrink-0 text-red-400 hover:text-red-600"
            aria-label="Dismiss"
          >✕</button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-8 mb-10">
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

        {/* AR Aging */}
        <div className="border-t-2 border-[#E5E7EB] pt-5 pb-4">
          <div className="flex items-start justify-between mb-3">
            <div className="text-[10px] font-semibold text-[#5B6472] uppercase tracking-[0.1em]">AR Aging</div>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 text-amber-500 opacity-60">
              <Clock size={16} />
            </div>
          </div>
          <div className="space-y-1.5">
            {arBuckets.map(b => (
              <div key={b.label} className="flex items-center justify-between text-xs gap-2">
                <span className="text-[#5B6472] shrink-0">{b.label}</span>
                <span className="font-mono tabular-nums text-[#141B2E] text-right">
                  {b.count.toLocaleString()} · ${b.dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
          {kpi && (
            <div className="mt-3 pt-3 border-t border-[#E5E7EB] flex items-center justify-between text-xs">
              <span className="text-[#5B6472]">Credits / overpayments</span>
              <span className="font-mono tabular-nums text-[#5B6472]">
                ${kpi.credit_balance_total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}
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
        <div className="py-16 text-center text-[#5B6472] text-sm">Loading pipeline…</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {allColumns.map(({ stage, label, items: colItems }) => {
            const mode = getViewMode(stage);
            return (
              <div key={stage} className={`flex-shrink-0 ${mode === 'table' ? 'w-[480px]' : 'w-48'}`}>
                <div className={`rounded-t-lg px-3 py-2 flex items-center justify-between ${STAGE_COLORS[stage] ?? 'bg-slate-100 text-slate-600'}`}>
                  <span className="text-xs font-semibold truncate">{label}</span>
                  <div className="flex items-center gap-1.5 ml-1 shrink-0">
                    <span className="text-xs font-bold opacity-80">{stageCounts[stage] ?? colItems.length}</span>
                    <button
                      onClick={() => setViewModeOverrides(p => ({ ...p, [stage]: 'cards' }))}
                      title="Cards view"
                      className={`transition-opacity ${mode === 'cards' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                    >
                      <LayoutGrid size={11} />
                    </button>
                    <button
                      onClick={() => setViewModeOverrides(p => ({ ...p, [stage]: 'table' }))}
                      title="Table view"
                      className={`transition-opacity ${mode === 'table' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                    >
                      <List size={11} />
                    </button>
                  </div>
                </div>
                {mode === 'table' ? (
                  <KanbanTable
                    items={colItems}
                    sort={getTableSort(stage)}
                    onSort={key => handleTableSort(stage, key)}
                    onAdvance={advance}
                    advancing={advancing}
                  />
                ) : (
                  <div className="bg-[#F0F0EC] rounded-b-lg p-2 space-y-2 min-h-24">
                    {colItems.length === 0 && (
                      <div className="py-6 text-center text-[#5B6472] text-xs">Empty</div>
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
