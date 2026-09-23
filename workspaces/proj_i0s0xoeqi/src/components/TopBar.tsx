"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useEffect } from "react";

const navByRole: Record<string, { href: string; label: string }[]> = {
  candidate: [
    { href: "/candidate", label: "Dashboard" },
    { href: "/candidate/exams", label: "My Exams" },
  ],
  admin: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/exams", label: "Examinations" },
    { href: "/admin/questions", label: "Question Bank" },
    { href: "/admin/monitor", label: "Live Monitor" },
  ],
  invigilator: [
    { href: "/invigilator", label: "Live Monitor" },
    { href: "/invigilator/reports", label: "Reports" },
  ],
};

export function TopBar({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const { user, loading, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  if (loading || !user) {
    return (
      <div className="h-16 border-b border-sumi-100 bg-white flex items-center justify-center text-sumi-500 text-sm">
        Loading…
      </div>
    );
  }
  const items = navByRole[user.role] ?? [];
  return (
    <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-sumi-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
        <Link href={`/${user.role}`} className="flex items-center gap-2 group">
          <div className="w-8 h-8 rounded-md bg-sumi-900 text-kinari flex items-center justify-center font-bold">
            JL
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sumi-900 group-hover:text-sumi-700 transition">
              {title}
            </div>
            {subtitle && (
              <div className="text-[11px] text-sumi-500 -mt-0.5">
                {subtitle}
              </div>
            )}
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-1 ml-4">
          {items.map((it) => {
            const active =
              pathname === it.href || pathname?.startsWith(it.href + "/");
            return (
              <Link
                key={it.href}
                href={it.href}
                className={clsx(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition",
                  active
                    ? "bg-sumi-900 text-kinari"
                    : "text-sumi-700 hover:bg-sumi-100"
                )}
              >
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:block text-right leading-tight">
            <div className="text-sm font-medium text-sumi-900">
              {user.fullName}
            </div>
            <div className="text-[11px] text-sumi-500 capitalize">
              {user.role}
              {user.registrationNumber ? ` · ${user.registrationNumber}` : ""}
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sumi-700 to-sumi-900 text-kinari flex items-center justify-center font-semibold">
            {user.fullName
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <button onClick={logout} className="btn-ghost text-sm">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
