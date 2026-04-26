import { useState, useEffect } from "react";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";

export default function Reports() {
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalCalls: 0, totalCollections: 0, totalLogs: 0, avgCalls: 0 });

  useEffect(() => { fetchReport(); }, [startDate, endDate]);

  async function fetchReport() {
    setLoading(true);
    const { data: logs } = await supabase.from("rh_daily_logs")
      .select("*, rh_agents(name), rh_clients(name)")
      .gte("date", startDate).lte("date", endDate)
      .order("date", { ascending: false });

    if (logs) {
      setData(logs);
      const totalCalls = logs.reduce((s, l) => s + (l.calls_made || 0), 0);
      const totalCollections = logs.reduce((s, l) => s + (l.amount_collected || 0), 0);
      setSummary({
        totalCalls, totalCollections, totalLogs: logs.length,
        avgCalls: logs.length > 0 ? Math.round(totalCalls / logs.length) : 0,
      });
    }
    setLoading(false);
  }

  function downloadCsv() {
    const headers = "Date,Agent,Client,Service,Calls Made,Connected,Outcome,Amount\n";
    const rows = data.map((l) =>
      `${l.date},${l.rh_agents?.name ?? ""},${l.rh_clients?.name ?? ""},${l.service_type},${l.calls_made},${l.calls_connected},${l.outcome},${l.amount_collected}`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `revorhealth-report-${startDate}-${endDate}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
          <p className="text-sm text-slate-500">Performance reports and exports</p>
        </div>
        <button onClick={downloadCsv} disabled={data.length === 0} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
          <Download size={16} /> Export CSV
        </button>
      </div>

      {/* Date Range */}
      <div className="flex items-center gap-3 mb-6">
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
        <span className="text-slate-400">to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white" />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Logs", value: summary.totalLogs },
          { label: "Total Calls", value: summary.totalCalls.toLocaleString("en-IN") },
          { label: "Collections", value: `$${summary.totalCollections.toLocaleString("en-IN")}` },
          { label: "Avg Calls/Log", value: summary.avgCalls },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
            <div className="text-xl font-bold text-slate-900">{s.value}</div>
            <div className="text-xs text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {["Date", "Agent", "Client", "Service", "Calls", "Connected", "Outcome", "Amount"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin mx-auto" /></td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-8 text-slate-400">No data for selected period</td></tr>
            ) : data.slice(0, 100).map((l) => (
              <tr key={l.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-2.5 text-slate-700">{l.date}</td>
                <td className="px-4 py-2.5 font-medium text-slate-900">{l.rh_agents?.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-500">{l.rh_clients?.name ?? "—"}</td>
                <td className="px-4 py-2.5"><span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 capitalize">{l.service_type}</span></td>
                <td className="px-4 py-2.5 text-slate-700">{l.calls_made}</td>
                <td className="px-4 py-2.5 text-slate-700">{l.calls_connected}</td>
                <td className="px-4 py-2.5 capitalize text-slate-500">{l.outcome}</td>
                <td className="px-4 py-2.5 text-slate-700">{l.amount_collected > 0 ? `$${l.amount_collected.toLocaleString("en-IN")}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
