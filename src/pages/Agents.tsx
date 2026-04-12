import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Agent } from "../types";

export default function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "agent", office: "india", target_calls_daily: "50" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAgents(); }, []);

  async function fetchAgents() {
    const { data } = await supabase.from("rh_agents").select("*").order("name");
    if (data) setAgents(data);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from("rh_agents").insert({
      name: form.name, email: form.email, role: form.role, office: form.office,
      target_calls_daily: parseInt(form.target_calls_daily) || 50, status: "active",
    });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", email: "", role: "agent", office: "india", target_calls_daily: "50" });
    fetchAgents();
  }

  async function toggleStatus(agent: Agent) {
    await supabase.from("rh_agents").update({ status: agent.status === "active" ? "inactive" : "active" }).eq("id", agent.id);
    fetchAgents();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agents</h1>
          <p className="text-sm text-slate-500">{agents.length} total agents</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          <Plus size={16} /> Add Agent
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm mb-6 grid grid-cols-2 md:grid-cols-5 gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" required className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" type="email" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <select value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
            <option value="india">India</option><option value="us">US</option>
          </select>
          <input value={form.target_calls_daily} onChange={(e) => setForm({ ...form, target_calls_daily: e.target.value })} placeholder="Target" type="number" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button type="submit" disabled={saving} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Save"}
          </button>
        </form>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Office</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Target/Day</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-slate-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin mx-auto" /></td></tr>
            ) : agents.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-slate-900">{a.name}</td>
                <td className="px-4 py-3 text-slate-500">{a.email}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.office === "india" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>{a.office.toUpperCase()}</span></td>
                <td className="px-4 py-3 text-slate-700">{a.target_calls_daily}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{a.status}</span></td>
                <td className="px-4 py-3"><button onClick={() => toggleStatus(a)} className="text-xs text-teal-600 hover:underline">{a.status === "active" ? "Deactivate" : "Activate"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
