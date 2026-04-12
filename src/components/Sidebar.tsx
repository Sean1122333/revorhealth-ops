import { NavLink } from "react-router-dom";
import { LayoutDashboard, ClipboardList, Users, Building2, FileBarChart } from "lucide-react";

const links = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/log", icon: ClipboardList, label: "Daily Log" },
  { to: "/agents", icon: Users, label: "Agents" },
  { to: "/clients", icon: Building2, label: "Clients" },
  { to: "/reports", icon: FileBarChart, label: "Reports" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 bg-slate-900 text-white flex flex-col shrink-0 min-h-screen">
      <div className="px-5 py-6 border-b border-slate-700/50">
        <h1 className="text-lg font-bold tracking-wide">
          <span className="text-teal-400">Revor</span>Health
        </h1>
        <p className="text-[10px] text-slate-400 mt-0.5">Operations Dashboard</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-teal-600/20 text-teal-400"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4 border-t border-slate-700/50">
        <p className="text-[10px] text-slate-500">v1.0 — RevorHealth Inc.</p>
      </div>
    </aside>
  );
}
