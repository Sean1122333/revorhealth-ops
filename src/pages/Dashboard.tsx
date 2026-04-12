import { useState, useEffect } from "react";
import { Phone, IndianRupee, CalendarCheck, HeartPulse, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "../lib/supabase";
import StatCard from "../components/StatCard";
import type { DailyLog, Client } from "../types";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState("all");
  const [stats, setStats] = useState({ calls: 0, collections: 0, confirmations: 0, ccm: 0 });
  const [weeklyData, setWeeklyData] = useState<any[]>([]);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [feed, setFeed] = useState<DailyLog[]>([]);

  useEffect(() => {
    supabase.from("rh_clients").select("*").order("name").then(({ data }) => {
      if (data) setClients(data);
    });
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedClient]);

  async function fetchData() {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    // Today's stats
    let q = supabase.from("rh_daily_logs").select("*").eq("date", today);
    if (selectedClient !== "all") q = q.eq("client_id", selectedClient);
    const { data: todayLogs } = await q;

    if (todayLogs) {
      setStats({
        calls: todayLogs.reduce((s, l) => s + (l.calls_made || 0), 0),
        collections: todayLogs.filter(l => l.service_type === "payment").reduce((s, l) => s + (l.amount_collected || 0), 0),
        confirmations: todayLogs.filter(l => l.service_type === "appointment" && l.outcome === "confirmed").length,
        ccm: todayLogs.filter(l => l.service_type === "ccm").length,
      });
    }

    // Weekly data (last 7 days)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    let wq = supabase.from("rh_daily_logs").select("date, calls_made, amount_collected, service_type").gte("date", weekAgo).order("date");
    if (selectedClient !== "all") wq = wq.eq("client_id", selectedClient);
    const { data: weekLogs } = await wq;

    if (weekLogs) {
      const byDate: Record<string, { calls: number; collections: number }> = {};
      for (const l of weekLogs) {
        const d = l.date;
        if (!byDate[d]) byDate[d] = { calls: 0, collections: 0 };
        byDate[d].calls += l.calls_made || 0;
        byDate[d].collections += l.amount_collected || 0;
      }
      setWeeklyData(
        Object.entries(byDate).map(([date, v]) => ({
          date: new Date(date).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
          ...v,
        }))
      );
    }

    // Leaderboard
    let lq = supabase.from("rh_daily_logs").select("agent_id, calls_made, rh_agents(name)").eq("date", today);
    if (selectedClient !== "all") lq = lq.eq("client_id", selectedClient);
    const { data: leaderLogs } = await lq;

    if (leaderLogs) {
      const byAgent: Record<string, { name: string; calls: number }> = {};
      for (const l of leaderLogs as any[]) {
        const id = l.agent_id;
        if (!byAgent[id]) byAgent[id] = { name: l.rh_agents?.name ?? "Unknown", calls: 0 };
        byAgent[id].calls += l.calls_made || 0;
      }
      setLeaderboard(
        Object.values(byAgent).sort((a, b) => b.calls - a.calls).slice(0, 8)
      );
    }

    // Activity feed
    let fq = supabase.from("rh_daily_logs").select("*, rh_agents(name), rh_clients(name)").order("created_at", { ascending: false }).limit(10);
    if (selectedClient !== "all") fq = fq.eq("client_id", selectedClient);
    const { data: feedData } = await fq;
    if (feedData) setFeed(feedData as any);

    setLoading(false);
  }

  if (loading && feed.length === 0) {
    return <div className="flex items-center justify-center h-screen text-slate-400"><Loader2 className="animate-spin mr-2" size={20} />Loading dashboard...</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Operations Dashboard</h1>
          <p className="text-sm text-slate-500">Real-time performance metrics</p>
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
        <StatCard icon={<Phone size={20} />} label="Total Calls Today" value={stats.calls} change={12} />
        <StatCard icon={<IndianRupee size={20} />} label="Collections Today" value={stats.collections} prefix="₹" change={8} />
        <StatCard icon={<CalendarCheck size={20} />} label="Confirmations" value={stats.confirmations} change={-3} />
        <StatCard icon={<HeartPulse size={20} />} label="CCM Check-ins" value={stats.ccm} change={15} />
      </div>

      {/* Charts + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Weekly Chart */}
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

        {/* Leaderboard */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Agent Leaderboard</h2>
          <div className="space-y-3">
            {leaderboard.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">No data for today</p>
            ) : (
              leaderboard.map((agent, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${i < 3 ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-700">{agent.name}</span>
                  </div>
                  <span className="text-sm font-semibold text-slate-900">{agent.calls}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Recent Activity</h2>
        <div className="space-y-2">
          {feed.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-4">No recent activity</p>
          ) : (
            feed.map((log) => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                <div>
                  <span className="text-sm text-slate-700 font-medium">{(log as any).rh_agents?.name ?? "Agent"}</span>
                  <span className="text-xs text-slate-400 mx-2">|</span>
                  <span className="text-xs text-slate-500">{log.service_type} — {log.calls_made} calls</span>
                  {log.amount_collected > 0 && <span className="text-xs text-emerald-600 ml-2">₹{log.amount_collected.toLocaleString("en-IN")}</span>}
                </div>
                <span className="text-[10px] text-slate-400">{(log as any).rh_clients?.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
