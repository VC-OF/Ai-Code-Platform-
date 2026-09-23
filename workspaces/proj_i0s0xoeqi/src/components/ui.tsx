"use client";

import { clsx } from "clsx";

export function Card({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("card p-5", className)} {...rest}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "red" | "green" | "blue" | "amber" | "gray";
}) {
  const colors: Record<string, string> = {
    red: "text-shu-600 bg-shu-50",
    green: "text-green-700 bg-green-50",
    blue: "text-ai-600 bg-ai-50",
    amber: "text-amber-700 bg-amber-50",
    gray: "text-sumi-700 bg-sumi-50",
  };
  return (
    <div className="card p-5 flex items-start gap-3">
      <div
        className={clsx(
          "w-10 h-10 rounded-lg flex items-center justify-center font-semibold",
          colors[accent ?? "gray"]
        )}
      >
        {label.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-sumi-500 font-medium">
          {label}
        </div>
        <div className="text-2xl font-semibold text-sumi-900 leading-tight mt-0.5">
          {value}
        </div>
        {hint && <div className="text-xs text-sumi-500 mt-1">{hint}</div>}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-sumi-900 tracking-tight">
          {title}
        </h1>
        {subtitle && <p className="text-sumi-600 mt-1">{subtitle}</p>}
      </div>
      <div className="flex gap-2 flex-wrap">{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon = "🌸",
}: {
  title: string;
  description?: string;
  icon?: string;
}) {
  return (
    <div className="card p-10 text-center">
      <div className="text-4xl mb-2">{icon}</div>
      <h3 className="font-semibold text-sumi-900">{title}</h3>
      {description && (
        <p className="text-sumi-600 text-sm mt-1">{description}</p>
      )}
    </div>
  );
}
