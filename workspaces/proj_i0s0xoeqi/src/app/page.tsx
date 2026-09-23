import Link from "next/link";
import {
  ArrowRight,
  ShieldCheck,
  Activity,
  FileBarChart,
  Users,
  Eye,
  Lock,
} from "lucide-react";

export default function Home() {
  return (
    <div className="bg-washi min-h-screen">
      {/* Decorative top marquee */}
      <div className="bg-sumi-900 text-kinari text-xs marquee border-b border-sumi-800">
        <div className="marquee-track py-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              className="px-8 inline-flex items-center gap-6 opacity-80"
            >
              <span>日本語能力試験プラットフォーム</span>
              <span>·</span>
              <span>Secure Examination Environment</span>
              <span>·</span>
              <span>30+ Concurrent Candidates</span>
              <span>·</span>
              <span>JLPT N5 · N4 · N3 · N2 · N1</span>
              <span>·</span>
            </span>
          ))}
        </div>
      </div>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-20 sm:py-28 grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="flex items-center gap-2 mb-5">
              <span className="stamp text-sm">公式</span>
              <span className="text-xs uppercase tracking-[0.2em] text-sumi-500 font-medium">
                Web-Based · Secure · Real-Time
              </span>
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold text-sumi-900 leading-[1.05] tracking-tight">
              The Japanese <br />
              <span className="text-shu-600">Examination</span> Platform.
            </h1>
            <p className="text-lg text-sumi-600 mt-5 max-w-xl">
              Conduct JLPT-style examinations with full anti-cheating
              monitoring, automatic grading, and detailed candidate reports —
              all in a single secure web environment.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className="btn-primary text-base px-5 py-2.5">
                Sign in to continue <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="#features"
                className="btn-outline text-base px-5 py-2.5"
              >
                Explore features
              </Link>
            </div>
            <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
              <Stat label="Concurrent" value="30+" />
              <Stat label="Question types" value="6" />
              <Stat label="Sections" value="5" />
            </div>
          </div>

          {/* Decorative card stack */}
          <div className="relative h-[460px] hidden lg:block">
            <div className="absolute top-0 right-0 w-[330px] rotate-[6deg] card p-4 shadow-jp-lg">
              <div className="flex items-center justify-between text-xs text-sumi-500 mb-2">
                <span>文字・語彙</span>
                <span>Q 1 / 5</span>
              </div>
              <p className="text-sumi-900 font-jp text-lg leading-relaxed">
                学校の前に友達がいます。
              </p>
              <div className="mt-3 space-y-1.5 text-sm">
                {["がっこう", "がくこう", "がっこ", "がくこ"].map((c, i) => (
                  <div
                    key={c}
                    className={`px-2.5 py-1.5 rounded-md border ${i === 0 ? "border-sumi-900 bg-sumi-900 text-kinari" : "border-sumi-200 bg-white"}`}
                  >
                    {c}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute top-32 left-0 w-[300px] -rotate-[3deg] card p-4 shadow-jp-lg">
              <div className="flex items-center gap-2 text-xs mb-2">
                <span className="badge-red">⚠ Tab switch detected</span>
              </div>
              <div className="text-xs text-sumi-600">
                Attempt #att_2f8a · 3 switches total
              </div>
              <div className="text-[10px] text-sumi-400 mt-1">
                Last: 10:18:42 AM
              </div>
            </div>
            <div className="absolute bottom-0 right-12 w-[320px] rotate-[2deg] card p-4 shadow-jp-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Live candidates</span>
                <span className="badge-green">32 online</span>
              </div>
              {[
                "Haruto Sato",
                "Yuki Tanaka",
                "Aoi Watanabe",
                "Sakura Inoue",
              ].map((n, i) => (
                <div
                  key={n}
                  className="flex items-center justify-between text-sm py-1.5 border-t border-sumi-100"
                >
                  <span>{n}</span>
                  <span
                    className={
                      [
                        "badge-blue",
                        "badge-green",
                        "badge-amber",
                        "badge-blue",
                      ][i]
                    }
                  >
                    {["In progress", "Done", "Disconn.", "In progress"][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="bg-asanoha py-20 border-t border-sumi-100"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="text-sm font-medium text-shu-600 uppercase tracking-widest">
              Features
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mt-2 text-sumi-900">
              Everything you need for a secure exam
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Feature
              icon={<ShieldCheck className="w-5 h-5" />}
              title="Anti-cheating engine"
              desc="Full-screen enforcement, tab-switch detection, devtools & copy/paste blocking, suspicious-event logging."
            />
            <Feature
              icon={<Eye className="w-5 h-5" />}
              title="Live invigilator dashboard"
              desc="Server-Sent Events stream with 30+ candidates visible at once. Status, score, warnings, and event feed."
            />
            <Feature
              icon={<Activity className="w-5 h-5" />}
              title="Auto-save & auto-submit"
              desc="Answers persist every 10 seconds. The exam auto-submits when the timer reaches zero."
            />
            <Feature
              icon={<Users className="w-5 h-5" />}
              title="Multi-role auth"
              desc="Email / password + registration number login, simulated OTP, JWT sessions, role-based access."
            />
            <Feature
              icon={<FileBarChart className="w-5 h-5" />}
              title="Detailed reports"
              desc="Score, security events, website & app activity, search history, violation summary per candidate."
            />
            <Feature
              icon={<Lock className="w-5 h-5" />}
              title="Question bank & admin"
              desc="Build exams from a 6-type question bank, configure anti-cheating policy, assign candidates."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-sumi-900">
            Ready to run a secure examination?
          </h2>
          <p className="text-sumi-600 mt-3">
            Sign in with one of the demo accounts to try the candidate,
            invigilator, or admin experience.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-primary text-base px-5 py-2.5">
              Open login <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="mt-10 grid sm:grid-cols-3 gap-3 text-left">
            <DemoCard role="Admin" email="admin@jexam.jp" />
            <DemoCard role="Invigilator" email="invigilator@jexam.jp" />
            <DemoCard role="Candidate" email="candidate001@jexam.jp" />
          </div>
          <p className="text-xs text-sumi-500 mt-3">
            Password for all demo accounts:{" "}
            <code className="font-mono bg-sumi-100 px-1.5 py-0.5 rounded">
              password123
            </code>
          </p>
        </div>
      </section>

      <footer className="border-t border-sumi-100 py-8 text-center text-xs text-sumi-500">
        © 2025 Japanese Examination Platform · 日本語能力試験プラットフォーム
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-3 py-2 text-center">
      <div className="text-lg font-bold text-sumi-900">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-sumi-500">
        {label}
      </div>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="card p-5 hover:shadow-jp-lg transition-shadow">
      <div className="w-9 h-9 rounded-lg bg-sumi-900 text-kinari flex items-center justify-center mb-3">
        {icon}
      </div>
      <h3 className="font-semibold text-sumi-900">{title}</h3>
      <p className="text-sm text-sumi-600 mt-1">{desc}</p>
    </div>
  );
}

function DemoCard({ role, email }: { role: string; email: string }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider text-shu-600 font-semibold">
        {role}
      </div>
      <div className="text-sm font-mono mt-1 text-sumi-900">{email}</div>
    </div>
  );
}
