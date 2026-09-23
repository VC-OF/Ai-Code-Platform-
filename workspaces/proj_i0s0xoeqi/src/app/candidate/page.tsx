"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { Card, PageHeader, StatCard, EmptyState } from "@/components/ui";
import { useSession } from "@/hooks/useSession";
import { fmtDate, relTime, statusColor } from "@/lib/format";
import {
  Calendar,
  BookOpen,
  Trophy,
  Bell,
  ChevronRight,
  ShieldCheck,
  Play,
  FileText,
  GraduationCap,
} from "lucide-react";
import type { Exam, ExamAttempt } from "@/lib/types";

export default function CandidateDashboard() {
  const { user, loading } = useSession();
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    const [e, a] = await Promise.all([
      fetch("/api/exams").then((r) => r.json()),
      fetch("/api/attempts/mine")
        .then((r) => r.json())
        .catch(() => ({ attempts: [] })),
    ]);
    setExams(e.exams ?? []);
    setAttempts(a.attempts ?? []);
    setRefreshing(false);
  }
  useEffect(() => {
    if (user) load();
  }, [user]);

  if (loading || !user) return null;
  const liveExam = exams.find((e) => e.status === "live");
  const upcoming = exams.filter((e) => e.status === "scheduled");
  const completed = attempts.filter(
    (a) => a.status === "completed" || a.status === "terminated"
  );

  return (
    <div className="bg-washi min-h-screen">
      <TopBar
        title="日本語試験プラットフォーム"
        subtitle="Candidate Dashboard"
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <PageHeader
          title={`こんにちは, ${user.fullName.split(" ")[0]} さん`}
          subtitle={
            user.fullNameJa
              ? `Welcome back, ${user.fullNameJa}`
              : "Welcome to your examination portal."
          }
        >
          <button
            onClick={load}
            className="btn-outline text-sm"
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </PageHeader>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Available exams"
            value={exams.length}
            accent="blue"
            hint="Assigned to you"
          />
          <StatCard
            label="Live now"
            value={liveExam ? 1 : 0}
            accent="red"
            hint={liveExam ? liveExam.title : "No live exam"}
          />
          <StatCard
            label="Completed"
            value={completed.length}
            accent="green"
            hint="In this period"
          />
          <StatCard
            label="Average score"
            value={
              completed.length === 0
                ? "—"
                : `${Math.round(completed.reduce((s, a) => s + (a.percentage ?? 0), 0) / completed.length)}%`
            }
            accent="amber"
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-6 mt-8">
          <div className="lg:col-span-2 space-y-6">
            {liveExam && (
              <section>
                <SectionHeader
                  icon={<Play className="w-4 h-4" />}
                  title="Active examination"
                  subtitle="Your exam is ready to begin."
                />
                <Card className="border-l-4 border-l-shu-600 shadow-jp-lg">
                  <div className="flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="badge-red">● Live</span>
                        <span className="badge-blue">{liveExam.level}</span>
                        <span className="text-xs text-sumi-500">
                          {liveExam.durationMinutes} min
                        </span>
                      </div>
                      <h3 className="text-lg font-semibold text-sumi-900">
                        {liveExam.title}
                      </h3>
                      <p className="text-sm text-sumi-600 mt-0.5">
                        {liveExam.titleJa}
                      </p>
                      <p className="text-sm text-sumi-600 mt-2 line-clamp-2">
                        {liveExam.description}
                      </p>
                    </div>
                    <Link
                      href={`/candidate/exam/${liveExam.id}`}
                      className="btn-shu px-5 py-2.5 text-base"
                    >
                      Start examination <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </Card>
              </section>
            )}

            <section>
              <SectionHeader
                icon={<Calendar className="w-4 h-4" />}
                title="Upcoming exams"
                subtitle="Exams scheduled for you."
              />
              {upcoming.length === 0 ? (
                <EmptyState
                  title="No upcoming exams"
                  description="When an administrator schedules an exam, it will appear here."
                  icon="🗓"
                />
              ) : (
                <div className="space-y-3">
                  {upcoming.map((e) => (
                    <Card key={e.id} className="hover:shadow-jp-lg transition">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-sumi-100 flex items-center justify-center">
                          <BookOpen className="w-5 h-5 text-sumi-700" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sumi-900 truncate">
                              {e.title}
                            </h3>
                            <span className="badge-gray">{e.level}</span>
                          </div>
                          <p className="text-xs text-sumi-500">{e.titleJa}</p>
                          <p className="text-xs text-sumi-500 mt-1">
                            Window: {fmtDate(e.startWindowStart)} –{" "}
                            {fmtDate(e.startWindowEnd)}
                          </p>
                        </div>
                        <span className="badge-amber">{e.status}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionHeader
                icon={<Trophy className="w-4 h-4" />}
                title="Previous results"
                subtitle="Your exam history."
              />
              {completed.length === 0 ? (
                <EmptyState
                  title="No results yet"
                  description="Complete an exam to see your results here."
                  icon="🏯"
                />
              ) : (
                <div className="space-y-3">
                  {completed.map((a) => (
                    <Link key={a.id} href={`/candidate/report/${a.id}`}>
                      <Card className="hover:shadow-jp-lg transition">
                        <div className="flex items-center gap-4">
                          <div
                            className={`w-12 h-12 rounded-lg flex items-center justify-center ${a.passed ? "bg-green-100 text-green-700" : "bg-shu-50 text-shu-600"}`}
                          >
                            <Trophy className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">
                                {a.candidateName}
                              </span>
                              <span
                                className={`badge-${statusColor(a.status)}`}
                              >
                                {a.status.replace("_", " ")}
                              </span>
                            </div>
                            <div className="text-xs text-sumi-500">
                              {a.endedAt
                                ? `Submitted ${relTime(a.endedAt)}`
                                : "In progress"}{" "}
                              · Score:{" "}
                              <span className="font-semibold text-sumi-900">
                                {a.score ?? 0}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-2xl font-bold text-sumi-900">
                              {a.percentage ?? 0}%
                            </div>
                            <div className="text-[10px] text-sumi-500">
                              score
                            </div>
                          </div>
                          <ChevronRight className="w-4 h-4 text-sumi-400" />
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="space-y-6">
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck className="w-4 h-4 text-sumi-700" />
                <h3 className="font-semibold">Exam rules</h3>
              </div>
              <ul className="text-sm text-sumi-600 space-y-1.5">
                <li>• Run in full-screen mode</li>
                <li>• Do not switch tabs or apps</li>
                <li>• No copy, paste, or right-click</li>
                <li>• DevTools are blocked</li>
                <li>• Keep your face visible to the webcam</li>
                <li>• Auto-submit at the time limit</li>
              </ul>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Bell className="w-4 h-4 text-shu-600" />
                <h3 className="font-semibold">Notifications</h3>
              </div>
              <div className="space-y-2 text-sm">
                <Notification
                  color="green"
                  title="Welcome to J-Exam"
                  body="Your account is ready. A live examination is available now."
                  time="just now"
                />
                <Notification
                  color="amber"
                  title="Profile complete"
                  body="Your registration number is verified."
                  time="2h ago"
                />
              </div>
            </Card>

            <Card>
              <div className="flex items-center gap-2 mb-2">
                <GraduationCap className="w-4 h-4 text-ai-600" />
                <h3 className="font-semibold">Profile</h3>
              </div>
              <Row k="Name" v={user.fullName} />
              {user.fullNameJa && <Row k="日本語" v={user.fullNameJa} />}
              <Row k="Email" v={user.email} />
              {user.registrationNumber && (
                <Row k="Reg. No." v={user.registrationNumber} />
              )}
              <Row
                k="Role"
                v={<span className="capitalize">{user.role}</span>}
              />
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <h2 className="text-lg font-semibold text-sumi-900 flex items-center gap-2">
          {icon} {title}
        </h2>
        {subtitle && <p className="text-xs text-sumi-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm border-b last:border-0 border-sumi-100">
      <span className="text-sumi-500">{k}</span>
      <span className="text-sumi-900 font-medium text-right">{v}</span>
    </div>
  );
}

function Notification({
  color,
  title,
  body,
  time,
}: {
  color: "green" | "amber" | "red" | "blue";
  title: string;
  body: string;
  time: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className={`w-2 h-2 mt-1.5 rounded-full bg-${color}-500`} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sumi-900">{title}</div>
        <div className="text-sumi-600 text-xs">{body}</div>
        <div className="text-sumi-400 text-[10px] mt-0.5">{time}</div>
      </div>
    </div>
  );
}
