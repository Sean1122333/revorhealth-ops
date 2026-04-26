import { useState, useEffect } from "react";
import { CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Agent, Client } from "../types";

export default function DailyLog() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [form, setForm] = useState({
    agent_id: "", client_id: "", service_type: "payment",
    calls_made: "", calls_connected: "", outcome: "collected",
    amount_collected: "", notes: "",
  });

  useEffect(() => {
    supabase.from("rh_agents").select("*").eq("status", "active").order("name").then(({ data }) => { if (data) setAgents(data); });
    supabase.from("rh_clients").select("*").eq("status", "active").order("name").then(({ data }) => { if (data) setClients(data); });
  }, []);

  const update = (key: string, val: string) => setForm({ ...form, [key]: val });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.agent_id || !form.client_id) return alert("Select agent and client");
    setSaving(true);

    const { error } = await supabase.from("rh_daily_logs").insert({
      date: new Date().toISOString().split("T")[0],
      agent_id: form.agent_id,
      client_id: form.client_id,
      service_type: form.service_type,
      calls_made: parseInt(form.calls_made) || 0,
      calls_connected: parseInt(form.calls_connected) || 0,
      outcome: form.outcome,
      amount_collected: parseFloat(form.amount_collected) || 0,
      notes: form.notes,
    });

    setSaving(false);
    if (error) { alert("Error: " + error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
    setForm({ ...form, calls_made: "", calls_connected: "", amount_collected: "", notes: "" });
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Daily Activity Log</h1>
      <p className="text-sm text-slate-500 mb-6">Log your daily work — calls, collections, appointments, CCM</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
        {/* Agent & Client */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Agent</label>
            <select value={form.agent_id} onChange={(e) => update("agent_id", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">Select agent...</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.office})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Client</label>
            <select value={form.client_id} onChange={(e) => update("client_id", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              <option value="">Select client...</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Service Type */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Service Type</label>
          <div className="flex gap-2">
            {["payment", "appointment", "ccm"].map((t) => (
              <button key={t} type="button" onClick={() => update("service_type", t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${form.service_type === t ? "bg-teal-50 border-teal-500 text-teal-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                {t === "payment" ? "Payment Collection" : t === "appointment" ? "Appointment" : "CCM Check-in"}
              </button>
            ))}
          </div>
        </div>

        {/* Call Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Calls Made</label>
            <input type="number" value={form.calls_made} onChange={(e) => update("calls_made", e.target.value)} placeholder="0" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Calls Connected</label>
            <input type="number" value={form.calls_connected} onChange={(e) => update("calls_connected", e.target.value)} placeholder="0" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        </div>

        {/* Outcome */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Outcome</label>
          <select value={form.outcome} onChange={(e) => update("outcome", e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
            <option value="collected">Collected</option>
            <option value="confirmed">Confirmed</option>
            <option value="checked">Checked</option>
            <option value="no_answer">No Answer</option>
            <option value="voicemail">Voicemail</option>
          </select>
        </div>

        {/* Payment amount (conditional) */}
        {form.service_type === "payment" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount Collected ($)</label>
            <input type="number" value={form.amount_collected} onChange={(e) => update("amount_collected", e.target.value)} placeholder="0" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
        )}

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
          <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} rows={3} placeholder="Any additional notes..." className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none" />
        </div>

        {/* Submit */}
        <button type="submit" disabled={saving} className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-medium text-sm hover:bg-teal-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <CheckCircle size={16} /> : null}
          {saving ? "Saving..." : saved ? "Saved!" : "Submit Log"}
        </button>
      </form>
    </div>
  );
}
