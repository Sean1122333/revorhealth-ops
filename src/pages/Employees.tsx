import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import type { Staff, Role } from '../types';
import { RefreshCw, Pencil, X, Check } from 'lucide-react';

type StaffRow = Staff & { group: { name: string; slug: string } | null };

const ROLE_LABELS: Record<Role, string> = {
  manager:          'Manager',
  team_lead:        'Team Lead',
  senior_associate: 'Sr. Associate',
  associate:        'Associate',
};

const STATUS_STYLES: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  on_leave: 'bg-amber-100 text-amber-700',
  exited:   'bg-slate-100 text-slate-500',
};

const STATUS_LABELS: Record<string, string> = {
  active:   'Active',
  on_leave: 'On Leave',
  exited:   'Exited',
};

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? 'active';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[s] ?? 'bg-slate-100 text-slate-500'}`}>
      {STATUS_LABELS[s] ?? s}
    </span>
  );
}

interface EditState {
  shift: string;
  join_date: string;
  phone: string;
  status: string;
}

export default function Employees() {
  const { staff: me } = useAuth();
  const isManager = me?.role === 'manager';

  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ shift: '', join_date: '', phone: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function fetchRows() {
    setLoading(true);
    const { data, error } = await supabase
      .from('staff')
      .select('*, group:team_groups(name, slug)')
      .order('full_name');
    if (error) console.error('[Employees] fetch:', error.message);
    setRows((data ?? []) as StaffRow[]);
    setLoading(false);
  }

  useEffect(() => { fetchRows(); }, []);

  function startEdit(row: StaffRow) {
    setEditingId(row.id);
    setSaveError(null);
    setEditState({
      shift:     row.shift     ?? '',
      join_date: row.join_date ?? '',
      phone:     row.phone     ?? '',
      status:    row.status    ?? 'active',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setSaveError(null);
  }

  async function saveEdit(row: StaffRow) {
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from('staff')
      .update({
        shift:     editState.shift     || null,
        join_date: editState.join_date || null,
        phone:     editState.phone     || null,
        status:    editState.status,
      })
      .eq('id', row.id);
    setSaving(false);
    if (error) {
      console.error('[Employees] save:', error.message);
      setSaveError('Save failed — ' + error.message);
      return;
    }
    setEditingId(null);
    await fetchRows();
  }

  // Unique groups for filter dropdown
  const groups = [...new Map(
    rows.filter(r => r.group).map(r => [r.group!.slug, r.group!.name])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const displayed = rows.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.full_name.toLowerCase().includes(q) && !r.email.toLowerCase().includes(q)) return false;
    }
    if (groupFilter && r.group?.slug !== groupFilter) return false;
    if (statusFilter && (r.status ?? 'active') !== statusFilter) return false;
    return true;
  });

  return (
    <div className="p-6 bg-[#FAFAF8] min-h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-[#141B2E]">Employees</h1>
          <p className="text-[#5B6472] text-sm mt-0.5">{rows.length} staff members</p>
        </div>
        <button
          onClick={fetchRows}
          className="flex items-center gap-1.5 text-[#5B6472] hover:text-[#141B2E] text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="shrink-0 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <input
          type="text"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#141B2E] placeholder-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-teal-400 w-56"
        />
        <select
          value={groupFilter}
          onChange={e => setGroupFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#5B6472] focus:outline-none focus:ring-1 focus:ring-teal-400"
        >
          <option value="">All groups</option>
          {groups.map(([slug, name]) => (
            <option key={slug} value={slug}>{name}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-[#E5E7EB] rounded-md bg-white text-[#5B6472] focus:outline-none focus:ring-1 focus:ring-teal-400"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="on_leave">On Leave</option>
          <option value="exited">Exited</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border-t border-b border-[#E5E7EB]">
        {loading ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">Loading…</div>
        ) : displayed.length === 0 ? (
          <div className="py-16 text-center text-[#5B6472] text-sm">No employees found</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Email</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Role</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Group</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Shift</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Join Date</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Phone</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[#5B6472] tracking-[0.08em]">Status</th>
                {isManager && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {displayed.map(row => {
                const isEditing = editingId === row.id;
                return (
                  <tr key={row.id} className={`transition-colors ${isEditing ? 'bg-[#F5F5F2]' : 'hover:bg-[#F5F5F2]'}`}>
                    <td className="px-4 py-3 font-medium text-[#141B2E]">{row.full_name}</td>
                    <td className="px-4 py-3 text-[#5B6472]">{row.email}</td>
                    <td className="px-4 py-3 text-[#5B6472]">{ROLE_LABELS[row.role] ?? row.role}</td>
                    <td className="px-4 py-3 text-[#5B6472]">{row.group?.name ?? <span className="opacity-30">—</span>}</td>

                    {/* Editable: shift */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editState.shift}
                          onChange={e => setEditState(s => ({ ...s, shift: e.target.value }))}
                          placeholder="e.g. 9–5"
                          className="w-28 px-2 py-1 text-xs border border-[#E5E7EB] rounded bg-white text-[#141B2E] focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      ) : (
                        <span className="text-[#5B6472]">{row.shift ?? <span className="opacity-30">—</span>}</span>
                      )}
                    </td>

                    {/* Editable: join_date */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editState.join_date}
                          onChange={e => setEditState(s => ({ ...s, join_date: e.target.value }))}
                          className="px-2 py-1 text-xs border border-[#E5E7EB] rounded bg-white text-[#141B2E] focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      ) : (
                        <span className="text-[#5B6472]">{row.join_date ?? <span className="opacity-30">—</span>}</span>
                      )}
                    </td>

                    {/* Editable: phone */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editState.phone}
                          onChange={e => setEditState(s => ({ ...s, phone: e.target.value }))}
                          placeholder="+1 555 000 0000"
                          className="w-36 px-2 py-1 text-xs border border-[#E5E7EB] rounded bg-white text-[#141B2E] focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      ) : (
                        <span className="text-[#5B6472]">{row.phone ?? <span className="opacity-30">—</span>}</span>
                      )}
                    </td>

                    {/* Editable: status */}
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editState.status}
                          onChange={e => setEditState(s => ({ ...s, status: e.target.value }))}
                          className="px-2 py-1 text-xs border border-[#E5E7EB] rounded bg-white text-[#141B2E] focus:outline-none focus:ring-1 focus:ring-teal-400"
                        >
                          <option value="active">Active</option>
                          <option value="on_leave">On Leave</option>
                          <option value="exited">Exited</option>
                        </select>
                      ) : (
                        <StatusBadge status={row.status} />
                      )}
                    </td>

                    {/* Action column — managers only */}
                    {isManager && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <span className="inline-flex items-center gap-2">
                            <button
                              disabled={saving}
                              onClick={() => saveEdit(row)}
                              className="inline-flex items-center gap-0.5 text-teal-600 hover:text-teal-800 text-xs font-medium disabled:opacity-40 transition-colors"
                            >
                              <Check size={12} />
                              {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="inline-flex items-center gap-0.5 text-[#5B6472] hover:text-[#141B2E] text-xs transition-colors"
                            >
                              <X size={12} />
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => startEdit(row)}
                            className="inline-flex items-center gap-1 text-[#5B6472] hover:text-[#141B2E] text-xs transition-colors"
                          >
                            <Pencil size={12} />
                            Edit
                          </button>
                        )}
                      </td>
                    )}
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
