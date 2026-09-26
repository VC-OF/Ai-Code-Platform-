#!/usr/bin/env node
/**
 * open-code — headless CLI for a running Open Code platform.
 *
 *   open-code -p "prompt" [--project <id|name>] [--new <name>] [--model m]
 *             [--mode auto|manual|plan] [--output-format text|json|stream-json]
 *             [--continue] [--server URL]
 *   open-code projects
 *   open-code status <project>
 *
 * Talks HTTP to the server (default http://localhost:3000, or --server /
 * OPEN_CODE_URL). Sends AUTH_TOKEN as x-api-key when set, and an Origin
 * header matching the server so the CSRF check accepts POSTs.
 *
 * Exit codes: 0 completed, 1 error / cancelled, 2 max_steps / timeout.
 * Plain Node ESM, no dependencies. Pure helpers are exported for tests.
 */
import fs from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const USAGE = `Usage:
  open-code -p "prompt" [options]     Run one agent turn
  open-code projects                  List projects
  open-code status <project>          Show whether an agent is running

Options:
  -p, --prompt <text>        Prompt to send (or pipe it on stdin)
  --project <id|name>        Existing project (id, exact or unique partial title)
  --new <name>               Create a new project with this title
  -c, --continue             Use the most recently updated project
  --model <model>            Model id
  --mode <auto|manual|plan>  Execution mode (default auto)
  --output-format <fmt>      text (default) | json | stream-json
  --server <url>             Platform URL (default $OPEN_CODE_URL or http://localhost:3000)
  -h, --help                 Show this help`;

const OUTPUT_FORMATS = ["text", "json", "stream-json"];
const MODES = ["auto", "manual", "plan"];

/** Parse argv (without node + script). Throws Error with a user-facing message. */
export function parseArgs(argv, env = {}) {
  const opts = {
    command: "run",
    prompt: undefined,
    project: undefined,
    newProject: undefined,
    model: undefined,
    mode: "auto",
    outputFormat: "text",
    continue: false,
    server: env.OPEN_CODE_URL || "http://localhost:3000",
    help: false,
    positional: [],
  };
  const needValue = (flag, i) => {
    const v = argv[i + 1];
    if (v === undefined || (v.startsWith("-") && v.length > 1 && flag !== "-p" && flag !== "--prompt")) {
      throw new Error(`${flag} requires a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith("--") ? a.indexOf("=") : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const take = () => {
      if (inline !== undefined) return inline;
      const v = needValue(flag, i);
      i++;
      return v;
    };
    switch (flag) {
      case "-p": case "--prompt": opts.prompt = take(); break;
      case "--project": opts.project = take(); break;
      case "--new": opts.newProject = take(); break;
      case "--model": opts.model = take(); break;
      case "--mode": opts.mode = take(); break;
      case "--output-format": opts.outputFormat = take(); break;
      case "--server": opts.server = take(); break;
      case "-c": case "--continue": opts.continue = true; break;
      case "-h": case "--help": opts.help = true; break;
      default:
        if (a.startsWith("-") && a !== "-") throw new Error(`Unknown option: ${a}`);
        opts.positional.push(a);
    }
  }
  if (!MODES.includes(opts.mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
  if (!OUTPUT_FORMATS.includes(opts.outputFormat)) {
    throw new Error(`--output-format must be one of ${OUTPUT_FORMATS.join(", ")}`);
  }
  const [first, ...rest] = opts.positional;
  if (first === "projects") {
    opts.command = "projects";
  } else if (first === "status") {
    opts.command = "status";
    opts.project = rest[0] ?? opts.project;
    if (!opts.project) throw new Error("status needs a project: open-code status <project>");
  } else if (first !== undefined && opts.prompt === undefined) {
    // `open-code "do x"` is shorthand for -p
    opts.prompt = opts.positional.join(" ");
  } else if (first !== undefined) {
    throw new Error(`Unexpected argument: ${first}`);
  }
  if ([opts.project, opts.newProject, opts.continue || undefined].filter(Boolean).length > 1 && opts.command === "run") {
    throw new Error("Use only one of --project, --new and --continue");
  }
  try {
    const u = new URL(opts.server);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`Invalid --server URL: ${opts.server}`);
  }
  return opts;
}

/** Exit code for a done reason (undefined → the stream ended without one). */
export function exitCodeFor(reason) {
  if (reason === "completed") return 0;
  if (reason === "max_steps" || reason === "timeout") return 2;
  return 1;
}

function compactArgs(args) {
  if (!args || typeof args !== "object") return "";
  const pick = args.path ?? args.command ?? args.url ?? args.query ?? args.pattern ?? args.name ?? args.title ?? args.number;
  const s = pick !== undefined ? String(pick) : JSON.stringify(args);
  const one = s.replace(/\s+/g, " ");
  return one.length > 100 ? `${one.slice(0, 97)}...` : one;
}

/**
 * Text-mode rendering of one event: { stdout?, stderr? } strings to write.
 * Assistant text goes to stdout, tool/status lines to stderr.
 */
export function formatEvent(event) {
  if (!event || typeof event !== "object") return {};
  switch (event.type) {
    case "text_delta":
      return { stdout: String(event.delta ?? "") };
    case "tool_start":
      return { stderr: `> ${event.toolName}${event.args ? ` ${compactArgs(event.args)}` : ""}\n` };
    case "tool_end": {
      const ok = event.result?.success !== false;
      return { stderr: `  ${ok ? "ok" : "failed"}: ${String(event.result?.summary ?? "").slice(0, 200)}\n` };
    }
    case "tool_error":
      return { stderr: `  error in ${event.toolName}: ${String(event.error ?? "").slice(0, 300)}\n` };
    case "user_input_request":
      return { stderr: `? ${event.question}${Array.isArray(event.options) && event.options.length ? ` [${event.options.join(" / ")}]` : ""}\n` };
    case "error":
      return { stderr: `error: ${event.message}\n` };
    case "done":
      return {
        stderr: `\n[done: ${event.reason}, ${Array.isArray(event.filesChanged) ? event.filesChanged.length : 0} files changed, ${event.totalTokens ?? 0} tokens, ${Math.round((event.durationMs ?? 0) / 1000)}s]\n`,
      };
    default:
      return {};
  }
}

/** Accumulates the run into the `--output-format json` result. */
export function createResultCollector() {
  let text = "";
  let lastText = null;
  let done = null;
  const errors = [];
  return {
    push(event) {
      if (event.type === "text_delta") text += event.delta ?? "";
      else if (event.type === "text_done" && typeof event.content === "string") lastText = event.content;
      else if (event.type === "error") errors.push(String(event.message));
      else if (event.type === "done") done = event;
    },
    result(durationMs) {
      return {
        result: (lastText ?? text).trim(),
        reason: done?.reason ?? (errors.length ? "error" : "incomplete"),
        filesChanged: done?.filesChanged ?? [],
        tokens: done?.totalTokens ?? 0,
        durationMs: done?.durationMs ?? durationMs,
        ...(errors.length ? { errors } : {}),
      };
    },
    get reason() {
      return done?.reason;
    },
  };
}

/** Split an NDJSON byte stream into parsed objects (bad lines are skipped). */
export async function* readNdjson(body) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of body) {
    buf += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {}
    }
  }
  const tail = buf.trim();
  if (tail) {
    try {
      yield JSON.parse(tail);
    } catch {}
  }
}

// ─── HTTP client ───────────────────────────────────────────────────────────────

export function createClient(server, env = {}, fetchImpl = globalThis.fetch) {
  const base = new URL(server);
  const origin = base.origin;
  const headers = (extra = {}) => ({
    Origin: origin,
    ...(env.AUTH_TOKEN ? { "x-api-key": env.AUTH_TOKEN } : {}),
    ...extra,
  });
  const url = (p) => new URL(p, base).toString();
  const call = async (method, p, body) => {
    let res;
    try {
      res = await fetchImpl(url(p), {
        method,
        headers: headers(body !== undefined ? { "Content-Type": "application/json" } : {}),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(`Cannot reach Open Code at ${origin} (${err?.cause?.code || err?.message || err}). Is the server running?`);
    }
    return res;
  };
  const json = async (method, p, body) => {
    const res = await call(method, p, body);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) throw new Error("Unauthorized — set AUTH_TOKEN to the server's token.");
      throw new Error(data.error || `${method} ${p} failed: ${res.status}`);
    }
    return data;
  };
  return {
    listProjects: async () => (await json("GET", "/api/projects")).projects ?? [],
    createProject: async (title) => (await json("POST", "/api/projects", { title })).project,
    status: (projectId) => json("GET", `/api/chat/status?projectId=${encodeURIComponent(projectId)}`),
    answer: (projectId, answer) => json("POST", "/api/chat/input", { projectId, answer }),
    chat: async (body) => {
      const res = await call("POST", "/api/chat", body);
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) throw new Error("Unauthorized — set AUTH_TOKEN to the server's token.");
        throw new Error(data.error || `POST /api/chat failed: ${res.status}`);
      }
      return res.body;
    },
  };
}

/** Pick a project by exact id, exact title, or unique title substring. */
export function resolveProject(query, projects) {
  const q = String(query).trim().toLowerCase();
  const exact = projects.find((p) => p.id.toLowerCase() === q || String(p.title ?? "").toLowerCase() === q);
  if (exact) return exact;
  const matches = projects.filter((p) => String(p.title ?? "").toLowerCase().includes(q));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`'${query}' matches several projects: ${matches.map((p) => `${p.title} (${p.id})`).join(", ")}`);
  }
  throw new Error(`No project matches '${query}'. List them with: open-code projects`);
}

async function readStdin(stdin) {
  let data = "";
  for await (const chunk of stdin) data += chunk;
  return data;
}

function ask(question, io) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: io.stdin, output: io.stderr });
    rl.question(`${question}\n> `, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/** Run the CLI. Returns the process exit code. */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const interactive = io.interactive ?? Boolean(stdin.isTTY);
  const now = io.now ?? (() => Date.now());

  let opts;
  try {
    opts = parseArgs(argv, env);
  } catch (err) {
    stderr.write(`open-code: ${err.message}\n\n${USAGE}\n`);
    return 1;
  }
  if (opts.help) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  const client = createClient(opts.server, env, io.fetch);
  try {
    if (opts.command === "projects") {
      const projects = await client.listProjects();
      if (opts.outputFormat !== "text") {
        stdout.write(`${JSON.stringify(projects)}\n`);
      } else if (!projects.length) {
        stdout.write("No projects.\n");
      } else {
        for (const p of projects) stdout.write(`${p.id}\t${p.title}\n`);
      }
      return 0;
    }

    if (opts.command === "status") {
      const project = resolveProject(opts.project, await client.listProjects());
      const st = await client.status(project.id);
      if (opts.outputFormat !== "text") stdout.write(`${JSON.stringify({ projectId: project.id, ...st })}\n`);
      else stdout.write(`${project.title} (${project.id}): ${st.running ? `running — ${st.status}` : "idle"}\n`);
      return 0;
    }

    // ── run ──
    let prompt = opts.prompt;
    if (prompt === undefined && !interactive) prompt = (await readStdin(stdin)).trim();
    if (!prompt) {
      stderr.write(`open-code: a prompt is required (-p "..." or on stdin)\n\n${USAGE}\n`);
      return 1;
    }

    let project;
    if (opts.newProject) {
      project = await client.createProject(opts.newProject);
    } else if (opts.project) {
      project = resolveProject(opts.project, await client.listProjects());
    } else {
      const projects = await client.listProjects();
      if (opts.continue) {
        project = [...projects].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        if (!project) throw new Error("No projects to continue. Use --new <name>.");
      } else {
        project = await client.createProject(prompt.replace(/\s+/g, " ").slice(0, 40));
      }
    }
    if (!project?.id) throw new Error("Could not resolve a project");
    if (opts.outputFormat === "text") stderr.write(`[project ${project.title ?? ""} (${project.id})]\n`);

    const started = now();
    const body = await client.chat({
      projectId: project.id,
      messages: [{ role: "user", content: prompt }],
      mode: opts.mode,
      ...(opts.model ? { model: opts.model } : {}),
    });

    const collector = createResultCollector();
    let failure = null;
    for await (const event of readNdjson(body)) {
      collector.push(event);
      if (opts.outputFormat === "stream-json") {
        stdout.write(`${JSON.stringify(event)}\n`);
      } else if (opts.outputFormat === "text") {
        const out = formatEvent(event);
        if (out.stdout) stdout.write(out.stdout);
        if (out.stderr) stderr.write(out.stderr);
      }
      if (event.type === "user_input_request") {
        if (!interactive) {
          failure = `The agent asked a question but stdin is not interactive: ${event.question}\nRe-run in a terminal, or with a prompt that doesn't need clarification.`;
          break;
        }
        const answer = await (io.ask ?? ask)(String(event.question ?? ""), { stdin, stderr });
        await client.answer(project.id, answer);
      }
      if (event.type === "done") break;
    }

    if (failure) {
      stderr.write(`open-code: ${failure}\n`);
      if (opts.outputFormat === "json") stdout.write(`${JSON.stringify({ ...collector.result(now() - started), reason: "error", error: failure })}\n`);
      return 1;
    }
    if (opts.outputFormat === "json") stdout.write(`${JSON.stringify(collector.result(now() - started))}\n`);
    else if (opts.outputFormat === "text" && !collector.reason) stderr.write("\nopen-code: stream ended without a done event\n");
    return exitCodeFor(collector.reason);
  } catch (err) {
    stderr.write(`open-code: ${err?.message ?? err}\n`);
    return 1;
  }
}

function isDirectRun() {
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
