import { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  accent?: "brand" | "emerald" | "amber" | "red";
  hint?: string;
}

const accents: Record<string, string> = {
  brand: "bg-brand-50 text-brand-700",
  emerald: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
};

export default function StatCard({
  label,
  value,
  icon,
  accent = "brand",
  hint,
}: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
          {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
        </div>
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${accents[accent]}`}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}
