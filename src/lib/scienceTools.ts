import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { z } from "zod";
import { safeResolve } from "./safeResolve";
import { safeExec, CommandError, isDockerMode } from "./safeExec";
import { ensureOpenCodeIgnored, openCodePath } from "./openCodeDir";
import {
  editNotebook,
  emptyNotebook,
  formatNotebook,
  notebookErrors,
  parseNotebook,
  serializeNotebook,
  type CellType,
  type Notebook,
} from "./notebooks";

/**
 * Agent tools for quantitative / scientific work: run a code snippet with
 * figure capture, look at an image, edit and execute Jupyter notebooks, and
 * save durable notes to project memory. Schemas (OpenAI function format),
 * zod validators and the executor live here; tools.ts / toolValidator.ts
 * only spread them in.
 */

export interface ScienceToolResult {
  success: boolean;
  output: string;
  summary: string;
  error?: string;
  suggestion?: string;
  changedFile?: string;
  extra?: Record<string, unknown>;
  structured?: { passed?: boolean; errorCount?: number };
  /** data: URL of an image to attach to the conversation (view_image).
   *  The agent loop attaches it only when the model accepts images. */
  attachImage?: string;
}

/** The subset of tools.ts' TurnContext these tools touch. */
export interface ScienceTurnContext {
  filesRead: Set<string>;
  filesEdited: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
}

// ─── Languages ─────────────────────────────────────────────────────────────────

export type CodeLanguage = "python" | "javascript" | "shell" | "julia" | "r" | "c" | "cpp" | "fortran";

export const CODE_LANGUAGES: CodeLanguage[] = ["python", "javascript", "shell", "julia", "r", "c", "cpp", "fortran"];

interface LanguageSpec {
  ext: string;
  label: string;
  /** Needs the docker sandbox: a compiled binary or `sh` can't be launched
   *  through the host allowlist */
  dockerOnly?: boolean;
}

const LANGUAGES: Record<CodeLanguage, LanguageSpec> = {
  python:     { ext: "py",  label: "Python" },
  javascript: { ext: "js",  label: "JavaScript (Node)" },
  shell:      { ext: "sh",  label: "shell", dockerOnly: true },
  julia:      { ext: "jl",  label: "Julia" },
  r:          { ext: "R",   label: "R" },
  c:          { ext: "c",   label: "C", dockerOnly: true },
  cpp:        { ext: "cpp", label: "C++", dockerOnly: true },
  fortran:    { ext: "f90", label: "Fortran", dockerOnly: true },
};

/**
 * Runs the user's script via runpy so tracebacks keep main.py line numbers,
 * and saves every matplotlib figure still open at exit as figure-N.png in
 * the run directory (plt.show() is a no-op under the Agg backend).
 */
export const PYTHON_RUNNER = `import atexit, os, runpy, sys
os.environ.setdefault("MPLBACKEND", "Agg")
_fig_dir = os.environ.get("OC_FIGURE_DIR") or os.path.dirname(os.path.abspath(__file__))

def _oc_save_figures():
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return
    for i, num in enumerate(plt.get_fignums(), 1):
        try:
            plt.figure(num).savefig(os.path.join(_fig_dir, "figure-%d.png" % i), dpi=110, bbox_inches="tight")
        except Exception as exc:  # noqa: BLE001
            print("[figure %d not saved: %s]" % (i, exc), file=sys.stderr)

atexit.register(_oc_save_figures)
_target = sys.argv[1]
sys.argv = [_target] + sys.argv[2:]
sys.path.insert(0, os.getcwd())
runpy.run_path(_target, run_name="__main__")
`;

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

export const SCIENCE_TOOL_SCHEMAS = [
  fn(
    "execute_code",
    "Run a self-contained code snippet and return its output. Languages: python (NumPy/SciPy/SymPy/pandas/matplotlib in the sandbox image; any matplotlib figures still open at exit are saved as PNGs and reported back), javascript (Node), julia, r, and — Docker sandbox only — shell, c, cpp, fortran (compiled with gcc/g++/gfortran -O2, then run). The snippet runs from the workspace root with its files in a scratch directory under .open-code/scratch/ ($OC_RUN_DIR), so it can read project files and write results anywhere in the workspace. Use it for calculations, checking a derivation numerically, quick simulations, plots and data inspection; put code that belongs in the project into files with create_file and verify it with run_tests instead. Not for long-running servers.",
    {
      language: { type: "string", enum: CODE_LANGUAGES, description: "Language of the snippet" },
      code: { type: "string", description: "The complete program to run" },
      timeout_seconds: { type: "integer", description: "Kill the run after this many seconds (1-900, default 120)" },
      description: { type: "string", description: "Short label of what the run checks, shown in the UI (optional)" },
    },
    ["language", "code"]
  ),
  fn(
    "view_image",
    "Look at an image file in the workspace (png/jpg/gif/webp, up to 8 MB): a plot produced by execute_code, a screenshot, or an asset. With a multimodal model the image itself is attached to the conversation so you can inspect axes, trends and artifacts; otherwise only its dimensions come back — then judge results from the numbers instead.",
    { path: { type: "string", description: "Workspace-relative image path, e.g. '.open-code/scratch/run-…/figure-1.png' or 'results/spectrum.png'" } },
    ["path"]
  ),
  fn(
    "notebook_edit",
    "Edit one cell of a Jupyter notebook (.ipynb). action 'replace' rewrites cell cell_index (its outputs are cleared), 'insert' adds a new cell at cell_index (0 = first, N = append; creates the notebook when it does not exist yet), 'delete' removes it. read_file shows a notebook as 0-indexed cells with their outputs — read it before editing an existing notebook.",
    {
      path: { type: "string", description: "Workspace-relative .ipynb path" },
      action: { type: "string", enum: ["replace", "insert", "delete"] },
      cell_index: { type: "integer", description: "0-based cell index" },
      cell_type: { type: "string", enum: ["code", "markdown", "raw"], description: "Cell type (default: code for insert, unchanged for replace)" },
      source: { type: "string", description: "Cell source for replace/insert" },
    },
    ["path", "action", "cell_index"]
  ),
  fn(
    "run_notebook",
    "Execute a Jupyter notebook in place (jupyter nbconvert --execute) and report every cell's outputs and errors. Needs jupyter in the sandbox image or on the host. Use it after notebook_edit to get real outputs into the notebook.",
    {
      path: { type: "string", description: "Workspace-relative .ipynb path" },
      timeout_seconds: { type: "integer", description: "Time budget in seconds (10-900, default 300)" },
    },
    ["path"]
  ),
  fn(
    "save_memory",
    "Save a durable one-line note to the project's memory (AGENTS.md, '## Memory' section): a convention or gotcha you discovered, a decision and its reason, a verified fact about the problem domain, or a user preference. Memory is part of the system prompt in every later turn, so keep it short, factual and worth remembering. Never store secrets or transient state.",
    { text: { type: "string", description: "The note (one sentence)" } },
    ["text"]
  ),
];

const relPath = z.string().min(1).max(500);
export const SCIENCE_ZOD_SCHEMAS = {
  execute_code: z.object({
    language: z.enum(CODE_LANGUAGES as [CodeLanguage, ...CodeLanguage[]]),
    code: z.string().min(1).max(200_000),
    timeout_seconds: z.number().int().min(1).max(900).optional(),
    description: z.string().max(120).optional(),
  }),
  view_image: z.object({
    path: relPath.regex(/\.(png|jpe?g|gif|webp)$/i, "path must be a .png, .jpg, .gif or .webp file"),
  }),
  notebook_edit: z.object({
    path: relPath.regex(/\.ipynb$/i, "path must end in .ipynb"),
    action: z.enum(["replace", "insert", "delete"]),
    cell_index: z.number().int().min(0),
    cell_type: z.enum(["code", "markdown", "raw"]).optional(),
    source: z.string().max(200_000).optional(),
  }),
  run_notebook: z.object({
    path: relPath.regex(/\.ipynb$/i, "path must end in .ipynb"),
    timeout_seconds: z.number().int().min(10).max(900).optional(),
  }),
  save_memory: z.object({
    text: z.string().min(5).max(500),
  }),
};

export function isScienceTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SCIENCE_ZOD_SCHEMAS, name);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const MAX_RUN_OUTPUT = 12_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACH_BYTES = 6 * 1024 * 1024;
const KEEP_RUN_DIRS = 40;
const IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;

function clip(s: string, max = MAX_RUN_OUTPUT): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.4);
  const tail = max - head;
  return `${s.slice(0, head)}\n...[truncated ${s.length - max} chars]...\n${s.slice(-tail)}`;
}

function ok(output: string, summary: string, rest: Partial<ScienceToolResult> = {}): ScienceToolResult {
  return { success: true, output, summary, ...rest };
}

function fail(error: string, summary: string, suggestion?: string): ScienceToolResult {
  return { success: false, output: `Error: ${error}${suggestion ? `\n${suggestion}` : ""}`, summary, error, suggestion };
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

export function imageUrl(projectId: string, rel: string): string {
  return `/api/workspace/image?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(rel)}`;
}

function kb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Width/height from the file header (no image library needed). */
export function imageDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    // PNG: 8-byte signature, IHDR length+type, then width/height
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    // GIF
    if (buf.length >= 10 && buf.toString("ascii", 0, 3) === "GIF") {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    // JPEG: walk the markers to the first SOFn
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xff) { i++; continue; }
        const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return null;
    }
    // WebP
    if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      const chunk = buf.toString("ascii", 12, 16);
      if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === "VP8L") {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
  } catch {
    // fall through
  }
  return null;
}

function mimeFor(rel: string): string {
  const ext = rel.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
}

// Probed once per process: `python` (Windows) vs `python3` (Linux/macOS)
let hostPython: string | null | undefined;

async function resolvePython(workspace: string, signal?: AbortSignal): Promise<string> {
  if (isDockerMode()) {
    // A project venv makes its dependencies importable
    return (await exists(path.join(workspace, ".venv", "bin", "python"))) ? ".venv/bin/python" : "python3";
  }
  if (hostPython) return hostPython;
  for (const bin of ["python", "python3"]) {
    const probe = await safeExec(`${bin} --version`, workspace, { timeoutMs: 15_000, signal }).catch(() => null);
    if (probe && probe.code === 0 && !probe.timedOut) {
      hostPython = bin;
      return bin;
    }
  }
  hostPython = null;
  throw new Error(
    "Python was not found on the host (tried `python` and `python3`). Install Python 3 or run the platform with SANDBOX_MODE=docker."
  );
}

/** Reset the cached host python probe (tests). */
export function resetPythonProbe(): void {
  hostPython = undefined;
}

function quoteArg(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

async function pruneRunDirs(scratchAbs: string): Promise<void> {
  try {
    const entries = (await fs.readdir(scratchAbs, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && e.name.startsWith("run-"))
      .map((e) => e.name)
      .sort();
    const stale = entries.slice(0, Math.max(0, entries.length - KEEP_RUN_DIRS));
    await Promise.all(stale.map((name) => fs.rm(path.join(scratchAbs, name), { recursive: true, force: true })));
  } catch {
    // best effort
  }
}

// ─── execute_code ──────────────────────────────────────────────────────────────

async function executeCode(
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext,
  projectId: string,
  signal?: AbortSignal
): Promise<ScienceToolResult> {
  const language = args.language as CodeLanguage;
  const spec = LANGUAGES[language];
  const docker = isDockerMode();
  if (spec.dockerOnly && !docker) {
    return fail(
      `${spec.label} snippets need the Docker sandbox (SANDBOX_MODE=docker): the host allowlist cannot launch ${language === "shell" ? "a shell" : "a compiled binary"}.`,
      `${spec.label} run unavailable on the host`,
      language === "shell"
        ? "Use run_command with an allowlisted binary, or write the logic in python/javascript for execute_code."
        : "Write the computation in python (NumPy/SciPy) or javascript instead, or compile with run_command (gcc/g++/gfortran) and inspect the build output."
    );
  }

  const code = String(args.code);
  const timeoutSec = Math.min(900, Math.max(1, Math.round(Number(args.timeout_seconds) || 120)));
  const description = typeof args.description === "string" ? args.description.trim().slice(0, 120) : "";

  const runId = `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${crypto.randomBytes(3).toString("hex")}`;
  const runRel = openCodePath("scratch", `run-${runId}`);
  const runAbs = safeResolve(workspace, runRel);
  await fs.mkdir(runAbs, { recursive: true });
  const mainName = `main.${spec.ext}`;
  const mainRel = `${runRel}/${mainName}`;
  await fs.writeFile(path.join(runAbs, mainName), code.endsWith("\n") ? code : `${code}\n`, "utf8");

  let command: string;
  switch (language) {
    case "python": {
      const py = await resolvePython(workspace, signal);
      await fs.writeFile(path.join(runAbs, "_oc_runner.py"), PYTHON_RUNNER, "utf8");
      command = `${py} ${runRel}/_oc_runner.py ${mainRel}`;
      break;
    }
    case "javascript": command = `node ${mainRel}`; break;
    case "julia":      command = `julia ${mainRel}`; break;
    case "r":          command = `Rscript ${mainRel}`; break;
    case "shell":      command = `sh ${mainRel}`; break;
    case "c":          command = `gcc -O2 -std=c11 -o ${runRel}/run ${mainRel} -lm && ${runRel}/run`; break;
    case "cpp":        command = `g++ -O2 -std=c++17 -o ${runRel}/run ${mainRel} && ${runRel}/run`; break;
    case "fortran":    command = `gfortran -O2 -o ${runRel}/run ${mainRel} && ${runRel}/run`; break;
  }

  const mplConfig = docker ? `/workspace/${openCodePath("mplconfig")}` : path.join(workspace, openCodePath("mplconfig"));
  await fs.mkdir(path.join(workspace, openCodePath("mplconfig")), { recursive: true }).catch(() => {});
  const env: Record<string, string> = {
    OC_RUN_DIR: runRel,
    OC_FIGURE_DIR: runRel,
    MPLBACKEND: "Agg",
    MPLCONFIGDIR: mplConfig,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
  };

  const started = Date.now();
  let res: Awaited<ReturnType<typeof safeExec>>;
  try {
    res = await safeExec(command, workspace, { env, signal, timeoutMs: timeoutSec * 1000 });
  } catch (err) {
    if (err instanceof CommandError) {
      const missing = /spawn \S+ ENOENT/.test(err.message);
      return fail(
        missing
          ? `${spec.label} is not installed on the host (${err.message}).`
          : err.message,
        `${spec.label} run failed to start`,
        missing
          ? "Install the toolchain on the host, or run the platform with SANDBOX_MODE=docker and build the sandbox image (npm run sandbox:build)."
          : undefined
      );
    }
    throw err;
  }
  ctx.commandsRun.push(`execute_code:${language}`);
  const durationMs = Date.now() - started;

  const entries = await fs.readdir(runAbs).catch(() => [] as string[]);
  const images: { path: string; url: string; bytes: number }[] = [];
  const others: string[] = [];
  for (const name of entries.sort()) {
    if (IMAGE_RE.test(name)) {
      const st = await fs.stat(path.join(runAbs, name)).catch(() => null);
      images.push({ path: `${runRel}/${name}`, url: imageUrl(projectId, `${runRel}/${name}`), bytes: st?.size ?? 0 });
    } else if (![mainName, "_oc_runner.py", "run"].includes(name)) {
      others.push(name);
    }
  }

  await ensureOpenCodeIgnored(workspace);
  await pruneRunDirs(path.dirname(runAbs));

  const success = res.code === 0 && !res.timedOut;
  const lines: string[] = [
    `${spec.label} — exit ${res.code}${res.timedOut ? ` (TIMED OUT after ${timeoutSec}s; the process was killed)` : ""} in ${(durationMs / 1000).toFixed(1)}s`,
    "--- stdout ---",
    res.stdout || "(empty)",
  ];
  if (res.stderr) lines.push("--- stderr ---", res.stderr);
  if (images.length) {
    lines.push(
      `Figures (${images.length}):`,
      ...images.map((i) => `- ${i.path} (${kb(i.bytes)})`),
      "Inspect a figure with view_image. Copy deliverable figures into the project (e.g. results/) — the run directory is scratch space."
    );
  }
  if (others.length) lines.push(`Other files written in the run dir: ${others.join(", ")}`);
  lines.push(`Run dir: ${runRel}`);

  return {
    success,
    output: clip(lines.join("\n")),
    summary:
      `${spec.label} run ${success ? "succeeded" : res.timedOut ? "timed out" : `failed (exit ${res.code})`}` +
      `${images.length ? `, ${images.length} figure${images.length > 1 ? "s" : ""}` : ""}${description ? ` — ${description}` : ""}`,
    error: success ? undefined : res.timedOut ? "Timed out" : `exit ${res.code}`,
    extra: { images, runDir: runRel, exitCode: res.code, language, timedOut: res.timedOut, description },
  };
}

// ─── view_image ────────────────────────────────────────────────────────────────

async function viewImage(
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext,
  projectId: string
): Promise<ScienceToolResult> {
  const rel = String(args.path).replace(/\\/g, "/");
  const full = safeResolve(workspace, rel);
  const st = await fs.stat(full).catch(() => null);
  if (!st || !st.isFile()) return fail(`No such image: ${rel}`, "Image not found", "Check the path with list_files or glob_files.");
  if (st.size > MAX_IMAGE_BYTES) return fail(`${rel} is ${kb(st.size)} — larger than the 8 MB limit.`, "Image too large");

  const buf = await fs.readFile(full);
  const dims = imageDimensions(buf);
  const mime = mimeFor(rel);
  ctx.filesRead.add(rel);

  const attach = buf.length <= MAX_ATTACH_BYTES ? `data:${mime};base64,${buf.toString("base64")}` : undefined;
  const size = dims ? `${dims.width}x${dims.height}` : "unknown dimensions";
  return ok(
    `Image ${rel}: ${size}, ${kb(buf.length)} (${mime}).${attach ? "" : " Too large to attach to the conversation."}`,
    `Viewed ${rel} (${size})`,
    {
      attachImage: attach,
      extra: {
        imageUrl: imageUrl(projectId, rel),
        path: rel,
        width: dims?.width,
        height: dims?.height,
        bytes: buf.length,
      },
    }
  );
}

// ─── Notebooks ─────────────────────────────────────────────────────────────────

async function notebookEdit(
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext
): Promise<ScienceToolResult> {
  const rel = String(args.path).replace(/\\/g, "/");
  const full = safeResolve(workspace, rel);
  const action = args.action as "replace" | "insert" | "delete";

  let nb: Notebook;
  let existed = true;
  try {
    nb = parseNotebook(await fs.readFile(full, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" && action === "insert") {
      nb = emptyNotebook();
      existed = false;
    } else {
      return fail(err instanceof Error ? err.message : String(err), `Notebook edit failed — ${rel}`);
    }
  }

  if (existed && !ctx.filesRead.has(rel) && !ctx.filesEdited.has(rel) && !ctx.filesCreated.has(rel)) {
    return fail(
      `Must read '${rel}' before editing it.`,
      "Notebook edit rejected — notebook not read",
      `Call read_file with path '${rel}' first (it lists the cells with their indexes).`
    );
  }

  let edited: ReturnType<typeof editNotebook>;
  try {
    edited = editNotebook(nb, {
      action,
      index: Number(args.cell_index),
      cellType: args.cell_type as CellType | undefined,
      source: typeof args.source === "string" ? args.source : undefined,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), `Notebook edit failed — ${rel}`);
  }

  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, serializeNotebook(edited.notebook), "utf8");
  if (existed) ctx.filesEdited.add(rel);
  else ctx.filesCreated.add(rel);

  return ok(
    `${edited.description} in ${rel}${existed ? "" : " (new notebook)"}. Run it with run_notebook to populate outputs.`,
    `${edited.description} — ${rel}`,
    { changedFile: rel }
  );
}

async function runNotebook(
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext,
  signal?: AbortSignal
): Promise<ScienceToolResult> {
  const rel = String(args.path).replace(/\\/g, "/");
  const full = safeResolve(workspace, rel);
  if (!(await exists(full))) return fail(`No such notebook: ${rel}`, "Notebook not found");

  const budget = Math.min(900, Math.max(10, Math.round(Number(args.timeout_seconds) || 300)));
  const jupyter =
    isDockerMode() && (await exists(path.join(workspace, ".venv", "bin", "jupyter"))) ? ".venv/bin/jupyter" : "jupyter";
  const command =
    `${jupyter} nbconvert --to notebook --execute --inplace --ExecutePreprocessor.timeout=${budget} ${quoteArg(rel)}`;

  let res: Awaited<ReturnType<typeof safeExec>>;
  try {
    res = await safeExec(command, workspace, {
      signal,
      timeoutMs: Math.min(900_000, (budget + 60) * 1000),
      env: { MPLBACKEND: "Agg", PYTHONIOENCODING: "utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(
      /ENOENT/.test(msg) ? "jupyter is not installed where commands run." : msg,
      "Notebook run failed to start",
      "Install it (pip install jupyter nbconvert ipykernel) or build the sandbox image (npm run sandbox:build); alternatively run the cell code with execute_code."
    );
  }
  ctx.commandsRun.push(command);
  ctx.filesEdited.add(rel);
  ctx.filesRead.add(rel);

  let nb: Notebook | null = null;
  try {
    nb = parseNotebook(await fs.readFile(full, "utf8"));
  } catch {
    nb = null;
  }
  const errors = nb ? notebookErrors(nb) : [];
  const passed = res.code === 0 && !res.timedOut && errors.length === 0;

  const lines: string[] = [
    `Executed ${rel}: exit ${res.code}${res.timedOut ? " (timed out)" : ""}, ${nb ? `${nb.cells.length} cells, ` : ""}${errors.length} error${errors.length === 1 ? "" : "s"}`,
  ];
  for (const e of errors) lines.push(`- cell ${e.index}: ${e.ename}: ${e.evalue}${e.traceback ? `\n${e.traceback}` : ""}`);
  if (res.stderr && (!passed || !nb)) lines.push("--- nbconvert stderr ---", clip(res.stderr, 3_000));
  if (nb) lines.push("", formatNotebook(nb, { maxCellChars: 800, maxOutputChars: 1_200 }));

  return {
    success: passed,
    output: clip(lines.join("\n"), 16_000),
    summary: passed
      ? `Notebook ✓ ${rel} ran clean${nb ? ` (${nb.cells.length} cells)` : ""}`
      : `Notebook ✗ ${rel}: ${errors.length ? `${errors.length} cell error(s)` : res.timedOut ? "timed out" : `exit ${res.code}`}`,
    error: passed ? undefined : errors[0] ? `${errors[0].ename}: ${errors[0].evalue}` : `exit ${res.code}`,
    changedFile: rel,
    structured: { passed, errorCount: errors.length },
  };
}

// ─── save_memory ───────────────────────────────────────────────────────────────

const MEMORY_HEADING = "## Memory";

/** Append a bullet under `## Memory` (creating the section at the end). */
export function appendMemoryLine(current: string, text: string): { next: string; added: boolean } {
  const line = `- ${text.replace(/\s*\n\s*/g, " ").trim()}`;
  const lines = current.split(/\r?\n/);
  if (lines.some((l) => l.trim() === line)) return { next: current, added: false };

  const headingIdx = lines.findIndex((l) => l.trim() === MEMORY_HEADING);
  if (headingIdx === -1) {
    const body = current.replace(/\s+$/, "");
    return { next: `${body}${body ? "\n\n" : ""}${MEMORY_HEADING}\n${line}\n`, added: true };
  }
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) { end = i; break; }
  }
  let insertAt = end;
  while (insertAt > headingIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, line);
  const next = lines.join("\n");
  return { next: next.endsWith("\n") ? next : `${next}\n`, added: true };
}

async function saveMemory(args: Record<string, unknown>, workspace: string, ctx: ScienceTurnContext): Promise<ScienceToolResult> {
  const text = String(args.text).replace(/\s*\n\s*/g, " ").trim();
  const full = safeResolve(workspace, "AGENTS.md");
  let current = "";
  try {
    current = await fs.readFile(full, "utf8");
  } catch {
    current = "";
  }
  const { next, added } = appendMemoryLine(current, text);
  if (!added) return ok(`Already in memory: ${text}`, "Memory unchanged (duplicate)");
  await fs.writeFile(full, next, "utf8");
  ctx.filesEdited.add("AGENTS.md");
  return ok(
    `Saved to AGENTS.md (${MEMORY_HEADING}): ${text}\nIt is part of the system prompt from the next turn on.`,
    `Remembered: ${text.slice(0, 70)}${text.length > 70 ? "…" : ""}`,
    { changedFile: "AGENTS.md" }
  );
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeScienceTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  ctx: ScienceTurnContext,
  projectId: string,
  signal?: AbortSignal
): Promise<ScienceToolResult> {
  try {
    switch (name) {
      case "execute_code": return await executeCode(args, workspace, ctx, projectId, signal);
      case "view_image": return await viewImage(args, workspace, ctx, projectId);
      case "notebook_edit": return await notebookEdit(args, workspace, ctx);
      case "run_notebook": return await runNotebook(args, workspace, ctx, signal);
      case "save_memory": return await saveMemory(args, workspace, ctx);
      default: return fail(`Unknown tool ${name}`, "Unknown tool");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(msg, `${name} failed`, err instanceof CommandError ? "The command was rejected by the sandbox." : undefined);
  }
}
