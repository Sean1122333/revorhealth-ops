import { useState, useEffect, useCallback } from "react";
import { Phone, DollarSign, CalendarCheck, HeartPulse, Loader2, RefreshCw, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "../lib/supabase";
import { isBusinessDay, getHolidayName } from "../lib/seed";
import StatCard from "../components/StatCard";
import type { DailyLog, Client } from "../types";

function isBusinessHours(): boolean {
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = est.getHours();
  return h >= 8 && h < 18 && isBusinessDay(est);
}

function getESTTime(): string {
  return new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState("all");
  const [stats, setStats] = useState({ calls: 0, collections: 0, confirmations: 0, ccm: 0 });
  const [prevStats, setPrevStats] = useState({ calls: 0, collections: 0, confirmations: 0, ccm: 0 });
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [feed, setFeed] = useState<DailyLog[]>([]);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [estTime, setEstTime] = useState(getESTTime());
  const [bizHours, setBizHours] = useState(isBusinessHours());

  // Live EST clock
  useEffect(() => {
    const iv = setInterval(() => {
      setEstTime(getESTTime());
      setBizHours(isBusinessHours());
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    supabase.from("rh_clients").select("*").order("name").then(({ data }) => {
      if (data) setClients(data);
    });
  }, []);

  const fetchData = useCallback(async () => {
    try {
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    // Today's stats
    let q = supabase.from("rh_daily_logs").select("*").eq("date", today);
    if (selectedClient !== "all") q = q.eq("client_id", selectedClient);
    const { data: todayLogs } = await q;

    // Yesterday for comparison
    let yq = supabase.from("rh_daily_logs").select("*").eq("date", yesterday);
    if (selectedClient !== "all") yq = yq.eq("client_id", selectedClient);
    const { data: yesterdayLogs } = await yq;

    if (todayLogs) {
      setStats({
        calls: todayLogs.reduce((s, l) => s + (l.calls_made || 0), 0),
        collections: todayLogs.filter(l => l.service_type === "payment").reduce((s, l) => s + (l.amount_collected || 0), 0),
        confirmations: todayLogs.filter(l => l.service_type === "appointment" && l.outcome === "confirmed").length,
        ccm: todayLogs.filter(l => l.service_type === "ccm").length,
      });
    }
    if (yesterdayLogs) {
      setPrevStats({
        calls: yesterdayLogs.reduce((s, l) => s + (l.calls_made || 0), 0),
        collections: yesterdayLogs.filter(l => l.service_type === "payment").reduce((s, l) => s + (l.amount_collected || 0), 0),
        confirmations: yesterdayLogs.filter(l => l.service_type === "appointment" && l.outcome === "confirmed").length,
        ccm: yesterdayLogs.filter(l => l.service_type === "ccm").length,
      });
    }

    // Weekly data
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    let wq = supabase.from("rh_daily_logs").select("date, calls_made, amount_collected").gte("date", weekAgo).order("date");
    if (selectedClient !== "all") wq = wq.eq("client_id", selectedClient);
    const { data: weekLogs } = await wq;

    if (weekLogs) {
      const byDate: Record<string, { calls: number; collections: number }> = {};
      for (const l of weekLogs) {
        if (!byDate[l.date]) byDate[l.date] = { calls: 0, collections: 0 };
        byDate[l.date].calls += l.calls_made || 0;
        byDate[l.date].collections += l.amount_collected || 0;
      }
      setWeeklyData(
        Object.entries(byDate).map(([date, v]) => ({
          date: new Date(date).toLocaleDateString("en-US", { weekday: "short", day: "numeric" }),
          ...v,
        }))
      );
    }

    // Leaderboard
    let lq = supabase.from("rh_daily_logs").select("agent_id, calls_made, amount_collected, rh_agents(name)").eq("date", today);
    if (selectedClient !== "all") lq = lq.eq("client_id", selectedClient);
    const { data: leaderLogs } = await lq;

    if (leaderLogs) {
      const byAgent: Record<string, { name: string; calls: number; collected: number }> = {};
      for (const l of leaderLogs as any[]) {
        const id = l.agent_id;
        if (!byAgent[id]) byAgent[id] = { name: l.rh_agents?.name ?? "Agent", calls: 0, collected: 0 };
        byAgent[id].calls += l.calls_made || 0;
        byAgent[id].collected += l.amount_collected || 0;
      }
      setLeaderboard(Object.values(byAgent).sort((a, b) => b.calls - a.calls).slice(0, 10));
    }

    // Activity feed
    let fq = supabase.from("rh_daily_logs").select("*, rh_agents(name), rh_clients(name)").order("created_at", { ascending: false }).limit(12);
    if (selectedClient !== "all") fq = fq.eq("client_id", selectedClient);
    const { data: feedData } = await fq;
    if (feedData) setFeed(feedData as any);

    setLastUpdated(new Date());
    } catch (err) {
      console.error("[dashboard] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedClient]);

  useEffect(() => {
    fetchData().then(() => {
      // If no data yet (seed may be running), retry after 5 seconds
      setTimeout(() => { if (feed.length === 0) fetchData(); }, 5000);
    });
  }, [fetchData]);

  // Auto-refresh every 3 minutes
  useEffect(() => {
    const iv = setInterval(fetchData, 180000);
    return () => clearInterval(iv);
  }, [fetchData]);

  function changePct(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  }

  if (loading && feed.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-slate-400 gap-3">
        <Loader2 className="animate-spin" size={24} />
        <span className="text-sm">Connecting to RevorHealth...</span>
        <span className="text-xs text-slate-300">Loading operations data</span>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Holiday / Off-hours Banner */}
      {(() => {
        const today = new Date();
        const todayStr = today.toISOString().split("T")[0]!;
        const holiday = getHolidayName(todayStr);
        const weekend = today.getDay() === 0 || today.getDay() === 6;
        if (holiday) return (
          <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2">
            <span className="text-amber-600 text-sm font-medium">Holiday — No Operations</span>
            <span className="text-amber-500 text-xs">({holiday})</span>
          </div>
        );
        if (weekend) return (
          <div className="mb-4 px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl">
            <span className="text-slate-500 text-sm font-medium">Weekend — Operations resume Monday</span>
          </div>
        );
        return null;
      })()}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-xs text-slate-400">
              Last updated {lastUpdated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
              <button onClick={fetchData} className="ml-2 text-teal-500 hover:text-teal-600 inline-flex items-center gap-1"><RefreshCw size={10} />Refresh</button>
            </p>
            <div className="flex items-center gap-1.5 text-xs">
              <Clock size={10} className="text-slate-400" />
              <span className="font-mono text-slate-500">{estTime} EST</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${bizHours ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                {bizHours ? "LIVE" : "AFTER HOURS"}
              </span>
            </div>
          </div>
        </div>
        <select
          value={selectedClient}
          onChange={(e) => setSelectedClient(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <option value="all">All Clients</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Phone size={20} />} label="Total Calls Today" value={stats.calls} change={changePct(stats.calls, prevStats.calls)} />
        <StatCard icon={<DollarSign size={20} />} label="Collections Today" value={stats.collections} prefix="$" change={changePct(stats.collections, prevStats.collections)} />
        <StatCard icon={<CalendarCheck size={20} />} label="Appointments Confirmed" value={stats.confirmations} change={changePct(stats.confirmations, prevStats.confirmations)} />
        <StatCard icon={<HeartPulse size={20} />} label="CCM Check-ins" value={stats.ccm} change={changePct(stats.ccm, prevStats.ccm)} />
      </div>

      {/* Charts + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Weekly Activity</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Bar dataKey="calls" fill="#0d9488" radius={[4, 4, 0, 0]} name="Calls" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Leaderboard</h2>
          <div className="space-y-2.5">
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No data for today</p>
            ) : (
              leaderboard.map((agent, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${i < 3 ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
                    <span className="text-sm text-slate-700 truncate max-w-[120px]">{agent.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-slate-900">{agent.calls}</span>
                    {agent.collected > 0 && <span className="text-[10px] text-emerald-600 ml-2">${agent.collected.toLocaleString()}</span>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Recent Activity</h2>
          <span className="text-[10px] text-slate-400">Auto-updates every 3 min</span>
        </div>
        <div className="space-y-1">
          {feed.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No recent activity</p>
          ) : (
            feed.map((log) => (
              <div key={log.id} className="flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${log.service_type === "payment" ? "bg-emerald-400" : log.service_type === "appointment" ? "bg-blue-400" : "bg-purple-400"}`} />
                  <div>
                    <span className="text-sm text-slate-700 font-medium">{(log as any).rh_agents?.name}</span>
                    <span className="text-xs text-slate-400 ml-2">{log.calls_made} calls · {log.outcome}</span>
                    {log.amount_collected > 0 && <span className="text-xs text-emerald-600 ml-2 font-medium">${log.amount_collected.toLocaleString()}</span>}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-400">{(log as any).rh_clients?.name}</span>
                  <span className="text-[10px] text-slate-300 ml-2">{timeAgo(log.created_at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
