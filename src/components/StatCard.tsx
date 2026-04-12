import type { ReactNode } from "react";

interface Props {
  icon: ReactNode;
  label: string;
  value: string | number;
  change?: number;
  prefix?: string;
}

export default function StatCard({ icon, label, value, change, prefix }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center text-teal-600">
          {icon}
        </div>
        {change != null && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${change >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
            {change >= 0 ? "+" : ""}{change}%
          </span>
        )}
      </div>
      <div className="text-2xl font-bold text-slate-900">{prefix}{typeof value === "number" ? value.toLocaleString("en-IN") : value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
