import { useState } from "react";
import { Database, Loader2, CheckCircle, AlertTriangle } from "lucide-react";
import { seedDatabase } from "../lib/seed";

export default function Seed() {
  const [seeding, setSeeding] = useState(false);
  const [result, setResult] = useState<{ clients: number; agents: number; logs: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSeed() {
    if (!confirm("This will insert seed data into Supabase. Continue?")) return;
    setSeeding(true);
    setError(null);
    setResult(null);
    try {
      const res = await seedDatabase();
      if (res) setResult(res);
      else setError("Seed returned no data — check Supabase tables exist");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="p-6 max-w-lg mx-auto mt-20">
      <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm text-center space-y-5">
        <div className="w-14 h-14 rounded-xl bg-teal-50 flex items-center justify-center mx-auto">
          <Database size={28} className="text-teal-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Seed Database</h1>
          <p className="text-sm text-slate-500 mt-1">
            Insert 30 days of realistic demo data: 3 clients, 8 agents, and 300+ daily logs.
          </p>
        </div>

        <button
          onClick={handleSeed}
          disabled={seeding}
          className="w-full py-3 bg-teal-600 text-white rounded-lg font-medium text-sm hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {seeding ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
          {seeding ? "Seeding..." : "Seed Now"}
        </button>

        {result && (
          <div className="flex items-start gap-3 text-left bg-emerald-50 rounded-lg p-4">
            <CheckCircle size={18} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-emerald-800">Seed Complete</p>
              <p className="text-xs text-emerald-600 mt-1">
                {result.clients} clients, {result.agents} agents, {result.logs} daily logs created.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 text-left bg-red-50 rounded-lg p-4">
            <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-red-800">Seed Failed</p>
              <p className="text-xs text-red-600 mt-1">{error}</p>
            </div>
          </div>
        )}

        <p className="text-[10px] text-slate-400">
          Make sure Supabase tables (rh_clients, rh_agents, rh_daily_logs) are created first.
        </p>
      </div>
    </div>
  );
}
