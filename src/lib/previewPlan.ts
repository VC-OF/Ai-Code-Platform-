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

export type RunPlan = NodePlan | StaticPlan | PythonPlan | NonePlan | UnsupportedPlan;

export interface DetectOptions {
  /** Whether a Python interpreter can be used (host check or docker image) */
  pythonAvailable?: boolean;
}

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
function detectPythonWeb(root: string): PythonPlan | null {
  const reqs = (() => {
    try {
      return fs.readFileSync(path.join(root, "requirements.txt"), "utf8").toLowerCase();
    } catch {
      return "";
    }
  })();
  if (isFile(path.join(root, "manage.py"))) {
    return { kind: "python", framework: "django", dir: "", entry: "manage.py", hasRequirements: !!reqs };
  }
  for (const entry of ["app.py", "main.py", "server.py", "wsgi.py"]) {
    const file = path.join(root, entry);
    if (!isFile(file)) continue;
    let src = "";
    try {
      src = fs.readFileSync(file, "utf8");
    } catch {}
    if (/\bfrom\s+fastapi\b|\bimport\s+fastapi\b/.test(src) || (reqs.includes("fastapi") && !/flask/.test(src))) {
      return { kind: "python", framework: "fastapi", dir: "", entry, hasRequirements: !!reqs };
    }
    if (/\bfrom\s+flask\b|\bimport\s+flask\b/.test(src) || reqs.includes("flask")) {
      return { kind: "python", framework: "flask", dir: "", entry, hasRequirements: !!reqs };
    }
  }
  return null;
}

// ─── Non-web project types ───────────────────────────────────────────────────
function detectUnsupported(root: string): UnsupportedPlan | null {
  const has = (f: string) => isFile(path.join(root, f));
  const inBackend = (f: string) => isFile(path.join(root, "backend", f));
  if (has("Cargo.toml")) {
    return {
      kind: "unsupported",
      reason: "This is a Rust project, not a web app, so there is nothing to show in the browser.",
      hint: "This is a Rust command-line project — run it from the terminal with `cargo run`.",
    };
  }
  if (has("pom.xml") || has("build.gradle") || has("build.gradle.kts") || inBackend("pom.xml") || inBackend("build.gradle")) {
    const maven = has("pom.xml") || inBackend("pom.xml");
    return {
      kind: "unsupported",
      reason: "This is a Java project. The preview can only run JavaScript and static web apps.",
      hint: maven
        ? "Run it from the terminal with `./mvnw spring-boot:run` (or `mvn spring-boot:run`) in the Maven project folder."
        : "Run it from the terminal with `./gradlew bootRun`.",
    };
  }
  if (has("go.mod")) {
    return {
      kind: "unsupported",
      reason: "This is a Go project. The preview can only run JavaScript and static web apps.",
      hint: "Run it from the terminal with `go run .`.",
    };
  }
  const py = listDir(root).filter((f) => f.endsWith(".py"));
  if (py.length) {
    return {
      kind: "unsupported",
      reason: "This project contains Python scripts but no Flask, FastAPI or Django web app to preview.",
      hint: `Run a script from the terminal, e.g. \`python ${py[0]}\`.`,
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

  // 3. Python web apps
  const py = detectPythonWeb(root);
  if (py) {
    if (opts.pythonAvailable) return py;
    return {
      kind: "unsupported",
      reason: `This is a Python (${py.framework}) web app, but Python isn't available to the preview.`,
      hint: "Install Python 3 and make sure `python --version` works, then start the preview again.",
    };
  }

  // 4. Backend-only JS projects
  const backendOnly = findBackend(root, "__none__", null);
  if (backendOnly) {
    return {
      kind: "unsupported",
      reason: "This project only has a backend API — there's no web frontend to show in the preview.",
      hint: `Run the API from the terminal with \`npm run ${backendOnly.script}\` in ${backendOnly.dir}/, or ask the agent to add a frontend.`,
    };
  }

  // 5. Other languages / non-web projects
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
