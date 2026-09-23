"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Mail, Lock, Hash, Loader2 } from "lucide-react";
import { useSession } from "@/hooks/useSession";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, refresh } = useSession();
  const [mode, setMode] = useState<"email" | "regno">("email");
  const [email, setEmail] = useState("");
  const [regno, setRegno] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace(`/${user.role}`);
    }
  }, [user, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "email"
            ? { email, password }
            : { registrationNumber: regno, password }
        ),
      });
      const j = await r.json();
      if (!r.ok) {
        setErr(j.error ?? "Login failed");
        return;
      }
      await refresh();
      router.push(`/${j.user.role}`);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setBusy(false);
    }
  }

  function fillDemo(kind: "admin" | "invigilator" | "candidate") {
    setMode("email");
    setPassword("password123");
    if (kind === "admin") setEmail("admin@jexam.jp");
    if (kind === "invigilator") setEmail("invigilator@jexam.jp");
    if (kind === "candidate") setEmail("candidate001@jexam.jp");
  }

  return (
    <div className="bg-washi min-h-screen flex flex-col">
      <header className="px-6 py-5">
        <Link href="/" className="inline-flex items-center gap-2 text-sumi-900">
          <div className="w-8 h-8 rounded-md bg-sumi-900 text-kinari flex items-center justify-center font-bold">
            JL
          </div>
          <span className="font-semibold">Japanese Exam Platform</span>
        </Link>
      </header>

      <main className="flex-1 grid lg:grid-cols-2 max-w-6xl w-full mx-auto px-6 pb-12 gap-10 items-center">
        <div className="hidden lg:block">
          <span className="stamp text-sm mb-4 inline-block">
            日本語能力試験
          </span>
          <h1 className="text-4xl font-bold text-sumi-900 leading-tight">
            Sign in to take or proctor an examination.
          </h1>
          <p className="text-sumi-600 mt-3 max-w-md">
            Use one of the demo accounts on the right. Every role has a
            different view of the platform, so you can experience the candidate
            exam, the invigilator live monitor, and the admin panel.
          </p>
          <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
            {["admin", "invigilator", "candidate"].map((k) => (
              <button
                key={k}
                onClick={() => fillDemo(k as any)}
                className="card p-3 text-left hover:shadow-jp-lg transition group"
              >
                <div className="text-[10px] uppercase tracking-wider text-shu-600 font-semibold">
                  {k}
                </div>
                <div className="text-xs font-mono mt-1 text-sumi-700 group-hover:text-sumi-900 truncate">
                  {k === "admin"
                    ? "admin@jexam.jp"
                    : k === "invigilator"
                      ? "invigilator@jexam.jp"
                      : "candidate001@jexam.jp"}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs text-sumi-500 mt-3">
            Click a card to autofill credentials.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="card p-7 shadow-jp-lg max-w-md w-full mx-auto"
        >
          <h2 className="text-xl font-semibold text-sumi-900">Welcome back</h2>
          <p className="text-sm text-sumi-500">
            Sign in with email or registration number.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-1 p-1 bg-sumi-100 rounded-lg text-sm">
            <button
              type="button"
              onClick={() => setMode("email")}
              className={`py-1.5 rounded-md transition ${mode === "email" ? "bg-white shadow text-sumi-900 font-medium" : "text-sumi-500"}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setMode("regno")}
              className={`py-1.5 rounded-md transition ${mode === "regno" ? "bg-white shadow text-sumi-900 font-medium" : "text-sumi-500"}`}
            >
              Reg. Number
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {mode === "email" ? (
              <Field icon={<Mail className="w-4 h-4" />} label="Email">
                <input
                  type="email"
                  className="input"
                  placeholder="you@jexam.jp"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Field>
            ) : (
              <Field
                icon={<Hash className="w-4 h-4" />}
                label="Registration Number"
              >
                <input
                  type="text"
                  className="input"
                  placeholder="JLPT-2025-001"
                  value={regno}
                  onChange={(e) => setRegno(e.target.value)}
                  required
                />
              </Field>
            )}
            <Field icon={<Lock className="w-4 h-4" />} label="Password">
              <input
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </div>

          {err && (
            <div className="mt-3 text-sm text-shu-600 bg-shu-50 border border-shu-100 px-3 py-2 rounded-lg">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary w-full mt-5"
          >
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Sign in <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-xs text-sumi-500 mt-4 text-center">
            Demo password for all accounts:{" "}
            <code className="font-mono bg-sumi-100 px-1.5 py-0.5 rounded">
              password123
            </code>
          </p>
        </form>
      </main>
    </div>
  );
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs text-sumi-600 font-medium flex items-center gap-1.5 mb-1.5">
        {icon} {label}
      </span>
      {children}
    </label>
  );
}
