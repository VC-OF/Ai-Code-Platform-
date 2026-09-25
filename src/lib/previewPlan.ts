/**
 * Preview run-plan detection.
 *
 * `detectRunPlan(root)` inspects a project workspace (read-only) and decides
 * HOW its preview should run: a Node dev server (optionally with a backend
 * process next to it), a static site, a Python web app, nothing yet, or a
 * project type we can't preview in the browser. It never executes anything,
 * so it is safe to unit-test against temp dirs.
 */
import fs from "fs";
import path from "path";

export type Framework =
  | "vite"
  | "next"
  | "react-scripts"
  | "astro"
  | "nuxt"
  | "unknown";

/**
 * One process to launch. `cmd`/`args` never contain untrusted shell text:
 * either a framework binary run via `npx --no-install` with args we built,
 * or `npm run <script>` (the script body is interpreted by npm, not us).
 */
export interface ProcessSpec {
  /** Directory relative to the workspace root ("" = root) */
  dir: string;
  cmd: "npx" | "npm";
  args: string[];
  framework: Framework;
  /** True when the port is only known from logs (unknown scripts) */
  portFromLogs: boolean;
  /** Extra env (on top of PORT/HOST for the web process) */
  env: Record<string, string>;
}

export interface NodePlan {
  kind: "node";
  framework: Framework;
  web: ProcessSpec;
  /** The "web" process is an API-only backend (no frontend in the project) */
  apiOnly?: boolean;
  /** Optional API server started alongside the frontend */
  api?: ProcessSpec;
  /** Dirs (relative) whose deps must be installed before starting */
  installDirs: string[];
  /** Dirs (relative) that depend on prisma → run `prisma generate` */
  prismaDirs: string[];
  /**
   * Prisma dirs whose datasource is SQLite: the schema can be applied locally
   * (`prisma db push`) so a fresh checkout has its tables
   */
  prismaSqliteDirs: string[];
}

export interface StaticPlan {
  kind: "static";
  /** Absolute directory to serve */
  dir: string;
  /** File served for "/" (relative to dir) */
  entry: string;
}

export interface PythonPlan {
  kind: "python";
  framework: "flask" | "fastapi" | "django";
  /** Directory relative to root */
  dir: string;
  /** Entry module/file, e.g. "app.py" */
  entry: string;
  hasRequirements: boolean;
}

export interface NonePlan {
  kind: "none";
  reason: string;
}

export interface UnsupportedPlan {
  kind: "unsupported";
  reason: string;
  hint: string;
}

/** A docker compose stack (always runs through docker, even in host mode) */
export interface ComposePlan {
  kind: "compose";
  /** Compose file, relative to the workspace root (may be in a direct child dir) */
  file: string;
  /** Directory of the compose file, relative to root ("" = root) */
  dir: string;
}

/** An API-only backend (no web UI) in a language other than Node */
export interface ServicePlan {
  kind: "service";
  lang: "java" | "go";
  /** Directory relative to root */
  dir: string;
  /** Java: build tool; Go: always "go" */
  tool: "maven" | "gradle" | "go";
  /** Java: wrapper script present (mvnw / gradlew) */
  wrapper: boolean;
  /** Java: Maven module (relative to dir) holding the Spring Boot app, for multi-module builds */
  module?: string;
  /** Java: required JDK major version */
  javaVersion?: number;
  /** Go: port hard-coded in the source (published instead of PORT) */
  fixedPort?: number;
}

/** A command-line program: not previewable, but runnable on demand */
export interface CliPlan {
  kind: "cli";
  lang: "rust" | "python" | "go";
  /** Directory relative to root */
  dir: string;
  /** Human readable command, e.g. "cargo run" */
  command: string;
  /** Python: entry script */
  entry?: string;
  hasRequirements?: boolean;
  reason: string;
}

export type RunPlan =
  | NodePlan
  | StaticPlan
  | PythonPlan
  | ComposePlan
  | ServicePlan
  | CliPlan
  | NonePlan
  | UnsupportedPlan;

export interface DetectOptions {
  /** Whether a Python interpreter can be used (host check or docker image) */
  pythonAvailable?: boolean;
  /** Docker is used for previews: enables compose / Java / Go / CLI plans */
  docker?: boolean;
  /** Ignore compose files (e.g. `docker compose config` rejected the file) */
  skipCompose?: boolean;
}

/** Shown in the preview for backends without a web UI */
export const API_ONLY_NOTE = "API server — no web UI; showing the root response";

export const EMPTY_REASON =
  "This project has no app yet. Ask the agent to build something first.";

const FRONTEND_DIRS = ["client", "frontend", "web", "apps/web", "app"];
const BACKEND_DIRS = ["server", "backend", "api", "apps/api", "apps/server"];
const STATIC_DIRS = ["", "public", "dist", "build", "www"];

/** Files that don't make a directory an "app" on their own */
const NON_SOURCE = /^(package(-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig(\..*)?\.json|agents\.md|readme(\..*)?|license(\..*)?|\.gitignore|\.env.*|\.npmrc|\.nvmrc|\.editorconfig|node_modules|\.git|\.npm-cache|\.preview|\.knowledge)$/i;

interface Pkg {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

function readPkg(dir: string): Pkg | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    return pkg && typeof pkg === "object" ? (pkg as Pkg) : null;
  } catch {
    return null;
  }
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function hasDep(pkg: Pkg, name: string): boolean {
  return !!(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

/** Does the directory contain anything beyond manifests / docs? */
function hasSource(dir: string): boolean {
  return listDir(dir).some((f) => !NON_SOURCE.test(f));
}

function runnableScript(pkg: Pkg | null): "dev" | "start" | null {
  if (!pkg?.scripts) return null;
  if (pkg.scripts.dev?.trim()) return "dev";
  if (pkg.scripts.start?.trim()) return "start";
  return null;
}

/** Scripts that just serve the directory as static files */
const STATIC_SCRIPT = /^(npx\s+(-y\s+|--yes\s+)?)?(serve|http-server|live-server|lite-server)(\s|$)/;

/** Scripts that orchestrate other dirs rather than run a server themselves */
function isOrchestrator(script: string): boolean {
  return /\bconcurrently\b|\bnpm-run-all\b|\brun-p\b|--workspace|--prefix|\bcd\s+\S+\s*&&|\bturbo\b|\blerna\b/.test(
    script
  );
}

/** Only keep extra CLI args that are plain flags/values (no shell syntax) */
function safeExtraArgs(tokens: string[]): string[] {
  return tokens.filter((t) => /^[\w@./:=,+-]+$/.test(t));
}

/** Remove port/host flags (and their values) from a tokenised command */
function stripFlags(tokens: string[], flags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const eq = t.indexOf("=");
    const name = eq > 0 ? t.slice(0, eq) : t;
    if (flags.includes(name)) {
      if (eq < 0 && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

/**
 * Build the web process for a directory. Known frameworks are launched
 * directly (with our port/host flags); anything else runs `npm run <script>`
 * with PORT/HOST env and the port is read from its logs.
 */
function buildWebSpec(dir: string, pkg: Pkg, script: "dev" | "start"): ProcessSpec {
  const body = pkg.scripts![script].trim();
  const simple = !/[;&|<>`$()]/.test(body);
  const tokens = body.split(/\s+/);
  let bin = tokens[0];
  let rest = tokens.slice(1);
  if (bin === "npx" && rest.length) {
    bin = rest[0];
    rest = rest.slice(1);
  }

  const npx = (framework: Framework, args: string[], env: Record<string, string> = {}): ProcessSpec => ({
    dir,
    cmd: "npx",
    args: ["--no-install", ...args],
    framework,
    portFromLogs: false,
    env,
  });

  if (simple && bin === "vite") {
    // `vite`, `vite dev`, `vite serve` → run the dev server
    const sub = rest[0] === "dev" || rest[0] === "serve" ? [rest[0]] : [];
    const extra = safeExtraArgs(stripFlags(rest.slice(sub.length), ["--port", "--host", "--strictPort", "--open"]));
    return npx("vite", ["vite", ...sub, ...extra, "--port", "{PORT}", "--strictPort", "--host", "0.0.0.0"]);
  }
  if (simple && bin === "next" && (rest[0] === "dev" || rest.length === 0)) {
    const extra = safeExtraArgs(stripFlags(rest.slice(1), ["-p", "--port", "-H", "--hostname"]));
    return npx("next", ["next", "dev", ...extra, "-p", "{PORT}", "-H", "0.0.0.0"]);
  }
  if (simple && bin === "react-scripts" && rest[0] === "start") {
    return npx("react-scripts", ["react-scripts", "start"], {
      HOST: "0.0.0.0",
      BROWSER: "none",
      // CRA + "proxy" + HOST crashes webpack-dev-server's allowedHosts check
      DANGEROUSLY_DISABLE_HOST_CHECK: "true",
    });
  }
  if (simple && bin === "astro" && (rest[0] === "dev" || rest.length === 0)) {
    return npx("astro", ["astro", "dev", "--port", "{PORT}", "--host", "0.0.0.0"]);
  }
  if (simple && (bin === "nuxt" || bin === "nuxi") && rest[0] === "dev") {
    return npx("nuxt", [bin, "dev", "--port", "{PORT}", "--host", "0.0.0.0"]);
  }

  // Unknown / composite script: let npm run it; PORT/HOST env hint the port
  const framework: Framework = hasDep(pkg, "vite") && /\bvite\b/.test(body) ? "vite" : "unknown";
  return {
    dir,
    cmd: "npm",
    args: ["run", script],
    framework,
    portFromLogs: true,
    env: { HOST: "0.0.0.0" },
  };
}

function buildApiSpec(dir: string, pkg: Pkg, scriptName: string): ProcessSpec {
  return {
    dir,
    cmd: "npm",
    args: ["run", scriptName],
    framework: "unknown",
    portFromLogs: false,
    env: {},
  };
}

/** Next.js needs at least one route file to render anything */
function hasNextPages(dir: string): boolean {
  const walk = (d: string, depth: number): boolean => {
    if (depth > 8) return false;
    for (const f of listDir(d)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = path.join(d, f);
      if (isDir(p)) {
        if (walk(p, depth + 1)) return true;
      } else if (/^(page|route)\.(t|j)sx?$/.test(f)) {
        return true;
      }
    }
    return false;
  };
  for (const base of ["app", "src/app"]) {
    if (walk(path.join(dir, base), 0)) return true;
  }
  for (const base of ["pages", "src/pages"]) {
    if (listDir(path.join(dir, base)).some((f) => /\.(t|j)sx?$|\.mdx?$/.test(f))) return true;
  }
  return false;
}

function findStatic(root: string): StaticPlan | null {
  for (const sub of STATIC_DIRS) {
    const dir = sub ? path.join(root, sub) : root;
    if (isFile(path.join(dir, "index.html"))) return { kind: "static", dir, entry: "index.html" };
  }
  const htmls = listDir(root).filter((f) => /\.html?$/i.test(f) && isFile(path.join(root, f)));
  if (htmls.length === 1) return { kind: "static", dir: root, entry: htmls[0] };
  if (htmls.length > 1) {
    const preferred = htmls.find((f) => /^(home|main|app|dashboard)\.html?$/i.test(f)) ?? htmls.sort()[0];
    return { kind: "static", dir: root, entry: preferred };
  }
  return null;
}

// ─── Python ──────────────────────────────────────────────────────────────────
const PY_DIRS = ["", "backend", "server", "api", "app", "src"];

function readText(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function detectPythonWebIn(root: string, dir: string): PythonPlan | null {
  const abs = dir ? path.join(root, dir) : root;
  const reqs = readText(path.join(abs, "requirements.txt")).toLowerCase();
  if (isFile(path.join(abs, "manage.py"))) {
    return { kind: "python", framework: "django", dir, entry: "manage.py", hasRequirements: !!reqs };
  }
  for (const entry of ["app.py", "main.py", "server.py", "wsgi.py"]) {
    const file = path.join(abs, entry);
    if (!isFile(file)) continue;
    const src = readText(file);
    if (/\bfrom\s+fastapi\b|\bimport\s+fastapi\b/.test(src) || (reqs.includes("fastapi") && !/flask/.test(src))) {
      return { kind: "python", framework: "fastapi", dir, entry, hasRequirements: !!reqs };
    }
    if (/\bfrom\s+flask\b|\bimport\s+flask\b/.test(src) || reqs.includes("flask")) {
      return { kind: "python", framework: "flask", dir, entry, hasRequirements: !!reqs };
    }
  }
  return null;
}

function detectPythonWeb(root: string): PythonPlan | null {
  for (const d of PY_DIRS) {
    if (d && !isDir(path.join(root, d))) continue;
    const plan = detectPythonWebIn(root, d);
    if (plan) return plan;
  }
  return null;
}

/** Pick the script a plain Python project would be run with */
export function pickPythonEntry(dir: string): string | null {
  const py = listDir(dir)
    .filter((f) => f.endsWith(".py") && isFile(path.join(dir, f)))
    .sort();
  if (!py.length) return null;
  for (const f of ["main.py", "app.py", "run.py", "cli.py", "__main__.py"]) if (py.includes(f)) return f;
  const guarded = py.find((f) => /__name__\s*==\s*["']__main__["']/.test(readText(path.join(dir, f))));
  return guarded ?? py[0];
}

// ─── Docker Compose ──────────────────────────────────────────────────────────
export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

function findCompose(root: string): ComposePlan | null {
  const inDir = (dir: string): ComposePlan | null => {
    const abs = dir ? path.join(root, dir) : root;
    const f = COMPOSE_FILES.find((n) => isFile(path.join(abs, n)));
    return f ? { kind: "compose", dir, file: dir ? `${dir}/${f}` : f } : null;
  };
  const top = inDir("");
  if (top) return top;
  for (const d of listDir(root).sort()) {
    if (d.startsWith(".") || d === "node_modules" || !isDir(path.join(root, d))) continue;
    const hit = inDir(d);
    if (hit) return hit;
  }
  return null;
}

export interface ComposePort {
  service: string;
  /** Port inside the container */
  target: number;
  /** Host port (undefined = docker picks one) */
  published?: number;
}

export interface ComposeCheck {
  ok: boolean;
  /** Why the stack was refused (security) */
  problems: string[];
  ports: ComposePort[];
}

type AnyObj = Record<string, unknown>;
const asObj = (v: unknown): AnyObj => (v && typeof v === "object" && !Array.isArray(v) ? (v as AnyObj) : {});

/** Normalise a host path for comparison (forward slashes, no trailing slash, `..` resolved) */
function normHostPath(p: string): string {
  let n = p.replace(/\\/g, "/");
  const drive = /^[a-z]:/i.test(n);
  n = path.posix.normalize(n).replace(/\/+$/, "");
  return drive ? n.toLowerCase() : n;
}

/** Is host path `p` the workspace root or inside it? (relative paths resolve against root) */
export function isInsideWorkspace(p: string, root: string): boolean {
  const abs = /^[a-z]:|^[\\/]/i.test(p) ? p : `${root.replace(/\\/g, "/")}/${p}`;
  const r = normHostPath(root);
  const t = normHostPath(abs);
  const rc = /^[a-z]:/i.test(root) ? r.toLowerCase() : r;
  const tc = /^[a-z]:/i.test(root) ? t.toLowerCase() : t;
  return tc === rc || tc.startsWith(rc + "/");
}

/**
 * Security + port analysis of a compose model. Designed for the *normalized*
 * JSON printed by `docker compose config --format json` (absolute bind
 * sources, long-form ports) but also accepts short syntax. Refuses anything
 * that could escape the workspace / sandbox.
 */
export function checkComposeConfig(config: unknown, workspaceRoot: string): ComposeCheck {
  const problems: string[] = [];
  const ports: ComposePort[] = [];
  const services = asObj(asObj(config).services);
  if (!Object.keys(services).length) problems.push("the compose file defines no services");
  for (const [name, raw] of Object.entries(services)) {
    const svc = asObj(raw);
    if (svc.privileged === true || svc.privileged === "true") problems.push(`service "${name}" uses privileged: true`);
    if (svc.network_mode === "host") problems.push(`service "${name}" uses network_mode: host`);
    if (svc.pid === "host") problems.push(`service "${name}" uses pid: host`);
    if (svc.ipc === "host") problems.push(`service "${name}" uses ipc: host`);
    if (svc.userns_mode === "host") problems.push(`service "${name}" uses userns_mode: host`);
    if (Array.isArray(svc.devices) && svc.devices.length) problems.push(`service "${name}" maps host devices`);
    const caps = Array.isArray(svc.cap_add) ? svc.cap_add.map((c) => String(c).toUpperCase()) : [];
    if (caps.some((c) => c === "ALL" || c === "SYS_ADMIN" || c === "CAP_SYS_ADMIN")) {
      problems.push(`service "${name}" adds dangerous capabilities (${caps.join(", ")})`);
    }
    const secOpt = Array.isArray(svc.security_opt) ? svc.security_opt.map(String) : [];
    if (secOpt.some((o) => /unconfined/i.test(o))) problems.push(`service "${name}" disables seccomp/apparmor`);

    const vols = Array.isArray(svc.volumes) ? svc.volumes : [];
    for (const v of vols) {
      let type = "";
      let source = "";
      if (typeof v === "string") {
        // short syntax "src:dst[:mode]" (Windows sources start with "C:")
        const parts = v.split(":");
        if (/^[a-z]$/i.test(parts[0]) && parts.length > 2) parts.splice(0, 2, `${parts[0]}:${parts[1]}`);
        source = parts.length > 1 ? parts[0] : "";
        type = !source ? "volume" : /^[.~/\\]|^[a-z]:/i.test(source) ? "bind" : "volume";
      } else {
        const o = asObj(v);
        type = String(o.type ?? "");
        source = String(o.source ?? "");
      }
      if (/docker\.sock/i.test(source)) {
        problems.push(`service "${name}" mounts the Docker socket`);
      } else if (type === "bind") {
        if (source.startsWith("~") || !isInsideWorkspace(source, workspaceRoot)) {
          problems.push(`service "${name}" bind-mounts a host path outside the project (${source})`);
        }
      } else if (type && type !== "volume" && type !== "tmpfs") {
        problems.push(`service "${name}" uses an unsupported volume type (${type})`);
      }
    }

    const plist = Array.isArray(svc.ports) ? svc.ports : [];
    for (const p of plist) {
      if (typeof p === "string" || typeof p === "number") {
        // short syntax "[ip:]host:container[/proto]"
        const [spec, proto] = String(p).split("/");
        if (proto && proto !== "tcp") continue;
        const parts = spec.split(":");
        const target = Number(parts[parts.length - 1]);
        const published = parts.length >= 2 ? Number(parts[parts.length - 2]) : undefined;
        if (Number.isInteger(target)) ports.push({ service: name, target, published: published || undefined });
      } else {
        const o = asObj(p);
        if (o.protocol && o.protocol !== "tcp") continue;
        const target = Number(o.target);
        const pub = o.published != null && o.published !== "" ? Number(String(o.published).split("-")[0]) : undefined;
        if (Number.isInteger(target)) ports.push({ service: name, target, published: pub || undefined });
      }
    }
  }
  return { ok: problems.length === 0, problems, ports };
}

/** Ports that are databases/caches/brokers, never the web UI */
const NON_HTTP_PORTS = new Set([
  5432, 3306, 6379, 27017, 9042, 5672, 1433, 1521, 11211, 9200, 9300, 2181, 9092, 4222, 25, 587, 1025,
]);
const WEB_NAMES = ["web", "frontend", "app", "client", "ui", "nginx", "gateway", "site"];

/** Choose the port the preview should show (null = no HTTP-looking port) */
export function pickComposeWebPort(ports: ComposePort[]): ComposePort | null {
  const web = ports.filter((p) => !NON_HTTP_PORTS.has(p.target));
  if (!web.length) return null;
  for (const n of WEB_NAMES) {
    const hit = web.find((p) => p.service.toLowerCase() === n);
    if (hit) return hit;
  }
  return web.find((p) => WEB_NAMES.some((n) => p.service.toLowerCase().includes(n))) ?? web[0];
}

// ─── Java / Go backends ──────────────────────────────────────────────────────
const JAVA_DIRS = ["", "backend", "server", "api", "app"];

function javaVersion(root: string, dir: string, build: string): number | undefined {
  const abs = dir ? path.join(root, dir) : root;
  for (const f of [path.join(abs, ".java-version"), path.join(root, ".java-version")]) {
    const m = readText(f).trim().match(/^(?:1\.)?(\d+)/);
    if (m) return Number(m[1]);
  }
  const m =
    build.match(/<java\.version>\s*(?:1\.)?(\d+)/) ??
    build.match(/<maven\.compiler\.(?:release|target)>\s*(?:1\.)?(\d+)/) ??
    build.match(/languageVersion\s*(?:=|\.set\()\s*JavaLanguageVersion\.of\((\d+)\)/) ??
    build.match(/sourceCompatibility\s*=\s*['"]?(?:JavaVersion\.VERSION_)?(?:1[._])?(\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Find the Maven module (relative dir) holding the @SpringBootApplication class */
function findBootModule(abs: string, pom: string): string | undefined {
  const modules = Array.from(pom.matchAll(/<module>\s*([^<\s]+)\s*<\/module>/g)).map((m) => m[1]);
  const hasBootMain = (d: string, depth = 0): boolean => {
    if (depth > 12) return false;
    for (const f of listDir(d)) {
      if (f === "target" || f.startsWith(".")) continue;
      const p = path.join(d, f);
      if (isDir(p)) {
        if (hasBootMain(p, depth + 1)) return true;
      } else if (f.endsWith(".java") && /@SpringBootApplication/.test(readText(p))) {
        return true;
      }
    }
    return false;
  };
  for (const m of modules) if (hasBootMain(path.join(abs, m, "src", "main"))) return m;
  // Conventional names, even if missing on disk (the build then reports it)
  return modules.find((m) => /^(app|application|api|server|web|boot)$/i.test(m)) ?? modules[modules.length - 1];
}

function detectJava(root: string): ServicePlan | UnsupportedPlan | null {
  for (const dir of JAVA_DIRS) {
    const abs = dir ? path.join(root, dir) : root;
    const pom = readText(path.join(abs, "pom.xml"));
    const gradle = readText(path.join(abs, "build.gradle")) || readText(path.join(abs, "build.gradle.kts"));
    if (!pom && !gradle) continue;
    if (!/spring-boot|org\.springframework\.boot/.test(pom || gradle)) {
      return {
        kind: "unsupported",
        reason: "This is a Java project without Spring Boot, so there is no web server to preview.",
        hint: pom ? "Build it from the terminal with `mvn package`." : "Run it from the terminal with `./gradlew run`.",
      };
    }
    if (pom) {
      const multi = /<packaging>\s*pom\s*<\/packaging>/.test(pom) && /<modules>/.test(pom);
      return {
        kind: "service",
        lang: "java",
        dir,
        tool: "maven",
        wrapper: isFile(path.join(abs, "mvnw")),
        module: multi ? findBootModule(abs, pom) : undefined,
        javaVersion: javaVersion(root, dir, pom),
      };
    }
    return {
      kind: "service",
      lang: "java",
      dir,
      tool: "gradle",
      wrapper: isFile(path.join(abs, "gradlew")),
      javaVersion: javaVersion(root, dir, gradle),
    };
  }
  return null;
}

const GO_SERVER = /\.ListenAndServe(TLS)?\(|\bgin\.(Default|New)\(|\becho\.New\(|\bfiber\.New\(|\bchi\.NewRouter\(/;

function detectGo(root: string): ServicePlan | CliPlan | null {
  for (const dir of ["", "backend", "server", "api"]) {
    const abs = dir ? path.join(root, dir) : root;
    if (!isFile(path.join(abs, "go.mod"))) continue;
    let server = false;
    let usesEnv = false;
    let fixedPort: number | undefined;
    const walk = (d: string, depth: number) => {
      if (depth > 6) return;
      for (const f of listDir(d)) {
        if (f === "vendor" || f.startsWith(".") || f === "node_modules") continue;
        const p = path.join(d, f);
        if (isDir(p)) walk(p, depth + 1);
        else if (f.endsWith(".go") && !f.endsWith("_test.go")) {
          const src = readText(p);
          if (GO_SERVER.test(src)) server = true;
          if (/Getenv\(\s*"PORT"\s*\)|LookupEnv\(\s*"PORT"\s*\)/.test(src)) usesEnv = true;
          const m = src.match(/(?:ListenAndServe(?:TLS)?|\.Run|\.Start|\.Listen)\(\s*"(?:0\.0\.0\.0)?:(\d{2,5})"/);
          if (m && fixedPort === undefined) fixedPort = Number(m[1]);
        }
      }
    };
    walk(abs, 0);
    if (server) {
      return { kind: "service", lang: "go", dir, tool: "go", wrapper: false, fixedPort: usesEnv ? undefined : fixedPort };
    }
    return {
      kind: "cli",
      lang: "go",
      dir,
      command: "go run .",
      reason: "This is a Go command-line program, not a web server, so there is no page to preview.",
    };
  }
  return null;
}

/** Non-web programs that can be run on demand in a container (docker mode) */
function detectCli(root: string): CliPlan | null {
  if (isFile(path.join(root, "Cargo.toml"))) {
    return {
      kind: "cli",
      lang: "rust",
      dir: "",
      command: "cargo run",
      reason: "This is a Rust command-line program, not a web app, so there is no page to preview.",
    };
  }
  const entry = pickPythonEntry(root);
  if (entry) {
    return {
      kind: "cli",
      lang: "python",
      dir: "",
      entry,
      hasRequirements: isFile(path.join(root, "requirements.txt")),
      command: `python ${entry}`,
      reason: "This project contains Python scripts but no Flask, FastAPI or Django web app to preview.",
    };
  }
  return null;
}

// ─── Non-web project types (host mode) ───────────────────────────────────────
function detectUnsupported(root: string): UnsupportedPlan | null {
  const has = (f: string) => isFile(path.join(root, f));
  const inBackend = (f: string) => isFile(path.join(root, "backend", f));
  if (has("Cargo.toml")) {
    return {
      kind: "unsupported",
      reason: "This is a Rust project, not a web app, so there is nothing to show in the browser.",
      hint: "This is a Rust command-line project — run it from the terminal with `cargo run`, or turn on sandbox (Docker) mode to run it from here.",
    };
  }
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts") || inBackend("pom.xml") || inBackend("build.gradle")) {
    const maven = has("pom.xml") || inBackend("pom.xml");
    return {
      kind: "unsupported",
      reason: "This is a Java project. Java previews run only in sandbox (Docker) mode.",
      hint: maven
        ? "Run it from the terminal with `./mvnw spring-boot:run` (or `mvn spring-boot:run`) in the Maven project folder."
        : "Run it from the terminal with `./gradlew bootRun`.",
    };
  }
  if (has("go.mod")) {
    return {
      kind: "unsupported",
      reason: "This is a Go project. Go previews run only in sandbox (Docker) mode.",
      hint: "Run it from the terminal with `go run .`.",
    };
  }
  const entry = pickPythonEntry(root);
  if (entry) {
    return {
      kind: "unsupported",
      reason: "This project contains Python scripts but no Flask, FastAPI or Django web app to preview.",
      hint: `Run a script from the terminal, e.g. \`python ${entry}\`.`,
    };
  }
  return null;
}

/**
 * Pick the backend that should run beside a frontend in `frontDir`.
 * Returns the dir + script name, or null.
 */
function findBackend(
  root: string,
  frontDir: string,
  rootPkg: Pkg | null
): { dir: string; pkg: Pkg; script: string } | null {
  for (const sub of BACKEND_DIRS) {
    if (sub === frontDir) continue;
    const abs = path.join(root, sub);
    const pkg = readPkg(abs);
    const script = runnableScript(pkg);
    if (pkg && script && hasSource(abs)) return { dir: sub, pkg, script };
  }
  // Root package.json acting as the server (e.g. "server": "node server/index.js")
  if (frontDir && rootPkg?.scripts) {
    for (const name of ["server", "dev:server", "api", "dev:api", "backend"]) {
      const body = rootPkg.scripts[name];
      if (body && !isOrchestrator(body)) return { dir: "", pkg: rootPkg, script: name };
    }
  }
  return null;
}

export function detectRunPlan(root: string, opts: DetectOptions = {}): RunPlan {
  if (!isDir(root)) return { kind: "none", reason: EMPTY_REASON };

  const rootPkg = readPkg(root);
  const rootScript = runnableScript(rootPkg);
  const rootBody = rootScript ? rootPkg!.scripts![rootScript] : "";

  // 1. Frontend directory resolution
  let frontDir: string | null = null;
  const subFront = FRONTEND_DIRS.find((d) => {
    const abs = path.join(root, d);
    return runnableScript(readPkg(abs)) !== null && hasSource(abs);
  });
  const rootIsOrchestrator =
    !!rootPkg && (!!rootPkg.workspaces || (rootScript !== null && isOrchestrator(rootBody)));

  if (rootScript && !(rootIsOrchestrator && (subFront || rootPkg!.workspaces))) {
    frontDir = "";
  } else if (subFront) {
    frontDir = subFront;
  }

  // A static-file script ("npx serve .") → serve with our static server
  if (frontDir === "" && STATIC_SCRIPT.test(rootBody.trim())) {
    const st = findStatic(root);
    if (st) return st;
  }

  if (frontDir !== null) {
    const absFront = frontDir ? path.join(root, frontDir) : root;
    const pkg = frontDir ? readPkg(absFront)! : rootPkg!;
    const script = runnableScript(pkg)!;
    if (!hasSource(absFront)) {
      return {
        kind: "none",
        reason:
          "This project has a package.json but no app source files yet. Ask the agent to finish building it.",
      };
    }
    const web = buildWebSpec(frontDir, pkg, script);
    if (web.framework === "next" && !hasNextPages(absFront)) {
      return {
        kind: "none",
        reason:
          "This Next.js project has no pages yet (no app/**/page or pages/ files). Ask the agent to add a page.",
      };
    }
    const backend = findBackend(root, frontDir, rootPkg);
    const api = backend ? buildApiSpec(backend.dir, backend.pkg, backend.script) : undefined;

    const installDirs = [frontDir];
    if (backend && !installDirs.includes(backend.dir)) installDirs.unshift(backend.dir);
    const prismaDirs = installDirs.filter((d) => {
      const p = d === "" ? rootPkg : readPkg(path.join(root, d));
      return !!p && (hasDep(p, "prisma") || hasDep(p, "@prisma/client"));
    });
    const prismaSqliteDirs = prismaDirs.filter((d) => {
      try {
        const schema = fs.readFileSync(path.join(root, d, "prisma", "schema.prisma"), "utf8");
        return /provider\s*=\s*"sqlite"/.test(schema);
      } catch {
        return false;
      }
    });
    return { kind: "node", framework: web.framework, web, api, installDirs, prismaDirs, prismaSqliteDirs };
  }

  // 2. Static sites
  const st = findStatic(root);
  if (st) return st;

  // 3. Docker Compose stacks (always run through docker)
  if (!opts.skipCompose) {
    const compose = findCompose(root);
    if (compose) return compose;
  }

  // 4. Python web apps
  const py = detectPythonWeb(root);
  if (py) {
    if (opts.pythonAvailable) return py;
    return {
      kind: "unsupported",
      reason: `This is a Python (${py.framework}) web app, but Python isn't available to the preview.`,
      hint: "Install Python 3 and make sure `python --version` works, then start the preview again.",
    };
  }

  // 5. Backend-only JS projects
  const backendOnly = findBackend(root, "__none__", null);
  if (backendOnly && opts.docker) {
    // npm workspaces: install at the root so local packages resolve
    const installDirs = rootPkg?.workspaces ? [""] : [backendOnly.dir];
    const prismaDirs =
      hasDep(backendOnly.pkg, "prisma") || hasDep(backendOnly.pkg, "@prisma/client") ? [backendOnly.dir] : [];
    const prismaSqliteDirs = prismaDirs.filter((d) =>
      /provider\s*=\s*"sqlite"/.test(readText(path.join(root, d, "prisma", "schema.prisma")))
    );
    const web: ProcessSpec = {
      ...buildApiSpec(backendOnly.dir, backendOnly.pkg, backendOnly.script),
      env: { HOST: "0.0.0.0" },
    };
    return { kind: "node", framework: "unknown", web, apiOnly: true, installDirs, prismaDirs, prismaSqliteDirs };
  }
  if (backendOnly) {
    return {
      kind: "unsupported",
      reason: "This project only has a backend API — there's no web frontend to show in the preview.",
      hint: `Run the API from the terminal with \`npm run ${backendOnly.script}\` in ${backendOnly.dir}/, or ask the agent to add a frontend.`,
    };
  }

  // 6. Other languages / non-web projects
  if (opts.docker) {
    const java = detectJava(root);
    if (java) return java;
    const go = detectGo(root);
    if (go) return go;
    const cli = detectCli(root);
    if (cli) return cli;
  }
  const unsupported = detectUnsupported(root);
  if (unsupported) return unsupported;

  if (rootPkg || BACKEND_DIRS.some((d) => isFile(path.join(root, d, "package.json")))) {
    return {
      kind: "none",
      reason:
        "This project doesn't have a dev server or web page yet. Ask the agent to add a `dev` script or an index.html.",
    };
  }
  return { kind: "none", reason: EMPTY_REASON };
}

/** Substitute the chosen port into a process spec's args */
export function withPort(spec: ProcessSpec, port: number): string[] {
  return spec.args.map((a) => (a === "{PORT}" ? String(port) : a));
}

/** Pull a listening port out of a dev-server log line */
export function detectPortFromLog(text: string): number | null {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::(\d{2,5}))/i);
  if (m) return Number(m[1]);
  const m2 = text.match(/\b(?:listening|running|started|serving|available)\b[^\n]*?\bport\s*:?\s*(\d{2,5})\b/i);
  if (m2) return Number(m2[1]);
  return null;
}
