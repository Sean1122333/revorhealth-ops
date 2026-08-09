import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { LayoutGrid, ListTodo, Users, LogOut } from 'lucide-react';

const roleLabel: Record<string, string> = {
  manager: 'Manager',
  team_lead: 'Team Lead',
  senior_associate: 'Sr. Associate',
  associate: 'Associate',
};

export default function Layout() {
  const { staff, signOut } = useAuth();
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate('/login');
  }

  const navItems = (() => {
    if (!staff) return [];
    if (staff.role === 'manager') {
      return [{ to: '/pipeline', icon: LayoutGrid, label: 'Pipeline' }];
    }
    if (staff.role === 'team_lead') {
      return [{ to: '/team', icon: Users, label: 'Team Queue' }];
    }
    return [{ to: '/queue', icon: ListTodo, label: 'My Queue' }];
  })();

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <aside className="w-56 flex-shrink-0 bg-slate-900 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-700/60">
          <span className="text-white font-semibold text-base tracking-tight">
            Revōr<span className="text-teal-400">Health</span>
          </span>
          <span className="block text-slate-500 text-[10px] mt-0.5">Operations Platform</span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-teal-600/20 text-teal-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-700/60">
          <div className="text-white text-sm font-medium truncate">
            {staff?.full_name ?? '—'}
          </div>
          <div className="text-slate-400 text-xs mt-0.5">
            {staff ? roleLabel[staff.role] : ''}
          </div>
          <button
            onClick={handleSignOut}
            className="mt-3 flex items-center gap-2 text-slate-500 hover:text-slate-300 text-xs transition-colors"
          >
            <LogOut size={13} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
