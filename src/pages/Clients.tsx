import { useState, useEffect } from "react";
import { Plus, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Client } from "../types";

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", type: "hospital", location: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchClients(); }, []);

  async function fetchClients() {
    const { data } = await supabase.from("rh_clients").select("*").order("name");
    if (data) setClients(data);
    setLoading(false);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await supabase.from("rh_clients").insert({ name: form.name, type: form.type, location: form.location, status: "active" });
    setSaving(false);
    setShowForm(false);
    setForm({ name: "", type: "hospital", location: "" });
    fetchClients();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-sm text-slate-500">{clients.length} healthcare facilities</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          <Plus size={16} /> Add Client
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm mb-6 grid grid-cols-1 md:grid-cols-4 gap-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Facility name" required className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">
            <option value="hospital">Hospital</option><option value="clinic">Clinic</option><option value="practice">Practice</option>
          </select>
          <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location" className="px-3 py-2 border border-slate-200 rounded-lg text-sm" />
          <button type="submit" disabled={saving} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin mx-auto" /> : "Save"}
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-8 text-slate-400"><Loader2 size={16} className="animate-spin mx-auto" /></div>
        ) : clients.map((c) => (
          <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <h3 className="font-semibold text-slate-900">{c.name}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{c.status}</span>
            </div>
            <div className="space-y-1 text-sm text-slate-500">
              <p>Type: <span className="text-slate-700 capitalize">{c.type}</span></p>
              <p>Location: <span className="text-slate-700">{c.location || "—"}</span></p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
