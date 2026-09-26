import crossSpawn from 'cross-spawn';
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { HOST_ALLOWED_BINS, HOST_ALLOWED_GIT_SUBCOMMANDS } from './permissions';
import { getSandboxImage, sandboxCacheArgs } from './sandboxImage';

// ─── Whitelist ───────────────────────────────────────────────────────────────
const ALLOWED_BINS = new Set<string>(HOST_ALLOWED_BINS);

// ─── Blocked argument patterns (defense-in-depth for the "safe" utils) ───────
// NOTE: for 'node', the argument surface is instead validated by a strict
// ALLOWLIST (see validateNodeArgs) — a blocklist can never keep up with
// Node's flag surface (--eval=, --require=, --experimental-loader, --inspect,
// etc. all grant code execution or worse). This list remains as a second
// layer for the other allowed binaries.
const BLOCKED_ARG_PATTERNS = [
  /^--eval$/,
  /^-e$/,
  /^--print$/,
  /^-p$/,
  /^--require$/,
  /^-r$/,
  /^--import$/,
  /^-i$/,
  /^--interactive$/,
  /.*\.env/i,      // Any argument containing ".env" case-insensitively
  /\/etc\//,
  /\/proc\//,
  /\/sys\//,
  /~\/\.ssh/,
  /~\/\.aws/,
  /~\/\.config/,
  /\/dev\//,
  /\$\(/,          // Command substitution
  /`/,             // Backtick execution
  /&&/,            // Command chaining
  /\|\|/,          // Command chaining
  /;/,             // Command separation
  />/,             // Redirection (output)
  /</,             // Redirection (input)
  /\|/,            // Pipe (block for now)
];

// ─── Git-specific allowed subcommands ───────────────────────────────────────
const ALLOWED_GIT_SUBCMDS = new Set<string>(HOST_ALLOWED_GIT_SUBCOMMANDS);


// ─── git: block file-writing / config-override arguments ─────────────────────
// `--output` (diff/log/show) writes arbitrary files; `-o` does the same for
// diff/format-patch/archive; `git config` writes and `-c` overrides can set
// hooks/aliases/core.pager that execute code.
function validateGitArgs(args: string[]): void {
  const sub = args[0];
  if (sub === '-c' || sub?.startsWith('-c') || sub?.startsWith('--config-env')) {
    throw new CommandError('git -c / --config-env overrides are not allowed.');
  }
  if (sub === 'config') {
    const readForms = new Set(['--get', '--get-all', '--list', '-l', '--get-regexp']);
    if (!args.slice(1).some((a) => readForms.has(a))) {
      throw new CommandError('git config write forms are not allowed.');
    }
  }
  const oFlagSubs = new Set(['diff', 'format-patch', 'archive']);
  for (const arg of args.slice(1)) {
    if (arg === '--output' || arg.startsWith('--output=') || arg.startsWith('--output-directory')) {
      throw new CommandError(`git argument '${arg}' (writes files) is not allowed.`);
    }
    if (oFlagSubs.has(sub) && (arg === '-o' || /^-o./.test(arg))) {
      throw new CommandError(`git argument '${arg}' (writes files) is not allowed.`);
    }
  }
}
// ─── node: strict allowlist, not a blocklist ─────────────────────────────────
// A blocklist can't keep pace with Node's CLI (--eval=, -r=, --loader=,
// --inspect, --experimental-* all execute or expose arbitrary code). Instead,
// 'node' may be invoked in exactly two shapes: a single safe informational
// flag, or a single positional script path with no other arguments. This
// intentionally forbids passing args to the script — an accepted trade-off
// for safety over flexibility.
const NODE_SAFE_FLAGS = new Set(['--version', '-v', '--help', '-h']);

function validateNodeArgs(args: string[]): void {
  if (args.length !== 1) {
    throw new CommandError(
      "node must be called with exactly one argument: a safe flag " +
      `(${[...NODE_SAFE_FLAGS].join(', ')}) or a single script path`
    );
  }
  const [arg] = args;
  if (arg.startsWith('-') && !NODE_SAFE_FLAGS.has(arg)) {
    throw new CommandError(
      `node flag '${arg}' is not allowed. Allowed flags: ${[...NODE_SAFE_FLAGS].join(', ')}`
    );
  }
}

// ─── find: block action primaries that execute, write, or delete ────────────
// find's test/print primaries (-name, -type, -maxdepth, …) are safe filters;
// its action primaries can run arbitrary commands or mutate the filesystem
// and must be blocked outright — this is GNU find's complete list of them.
const FIND_BLOCKED_PRIMARIES = new Set([
  '-exec', '-execdir', '-ok', '-okdir',
  '-delete', '-fprint', '-fprint0', '-fprintf', '-fls',
]);

function validateFindArgs(args: string[]): void {
  for (const arg of args) {
    if (FIND_BLOCKED_PRIMARIES.has(arg)) {
      throw new CommandError(
        `find primary '${arg}' is not allowed — it can execute commands or modify files`
      );
    }
  }
}

// ─── Other interpreters: block inline-code flags ────────────────────────────
// Running a workspace script (python main.py) is fine; evaluating a code
// string passed on the command line (python -c, php -r, deno eval) on the
// host is not. ruby -e / perl-style -e is already caught by /^-e$/.
const INLINE_CODE_FLAGS: Record<string, RegExp> = {
  python: /^-c/, python3: /^-c/, php: /^-r$|^--run$/, deno: /^(eval|repl)$/,
  // julia -e/-E, Rscript -e, octave --eval: code strings on the command line
  julia: /^-[eE]$|^--eval/, Rscript: /^-e$/, octave: /^--eval/,
};

function validateInlineCodeArgs(bin: string, args: string[]): void {
  const re = INLINE_CODE_FLAGS[bin];
  if (!re) return;
  for (const arg of args) {
    if (re.test(arg)) {
      throw new CommandError(`${bin} '${arg}' (inline code execution) is not allowed on the host.`);
    }
  }
}

// ─── Execution limits────────────────────────────────────────────────────────
const LIMITS = {
  timeoutMs:    30_000,        // 30 seconds
  maxBuffer:    5 * 1024 * 1024, // 5 MB
  maxOutputLen: 50_000,        // Trim output to 50k chars
};

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
}

export interface SafeExecOptions {
  /** Extra env vars to expose to the child (e.g. decrypted project secrets).
   *  System-critical vars (PATH etc.) cannot be overridden. */
  env?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Text written to the child's stdin (hooks receive their JSON payload
   *  this way, like Claude Code hooks). Stdin is closed afterwards. */
  stdin?: string;
}

export class CommandError extends Error {
  constructor(
    message: string,
    public code?: number,
    public stderr?: string
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

// ─── Docker sandbox mode (opt-in) ────────────────────────────────────────────
/**
 * With SANDBOX_MODE=docker, every command runs in a throwaway container:
 * workspace mounted at /workspace, no network (except package-manager
 * installs, which need the registry), memory/cpu/pid caps. The allowlist
 * and argument checks above still apply before anything is containerized.
 *
 * Image: see getSandboxImage() (SANDBOX_IMAGE > open-code-sandbox:1 > node:20).
 */
const PACKAGE_INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\b\s+(install|ci|add|update|i\b)|\bnpx\b|\bpip3?\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\buv\s+(pip|sync|add|venv|lock|run)\b|\bcargo\s+(build|test|check|clippy|fetch|run|add|install|update|doc)\b|\bgo\s+(mod|get|build|test|vet|run|install)\b|\b(mvn|gradle|gradlew)\b|\bbundle\s+install\b|\bcomposer\s+(install|require|update)\b|\bdotnet\s+(restore|build|test)\b/;
// Network is also granted to toolchain builds above (cargo/go/mvn/gradle)
// because they resolve dependencies on demand.

/** $HOME inside sandbox containers (throwaway; caches live on /cache). */
export const SANDBOX_HOME = '/tmp/home';

export function isDockerMode(): boolean {
  return process.env.SANDBOX_MODE === 'docker';
}

/**
 * In docker mode the whole command string runs through `sh -c` INSIDE the
 * container, so full shell syntax (pipes, &&, redirection) is available —
 * the container is the security boundary, not the parser. The host shell
 * never interprets anything: docker receives argument arrays only.
 * Network is enabled just for package-manager installs.
 */
function buildDockerInvocation(
  command: string,
  cwd: string,
  containerName: string,
  extraEnv?: Record<string, string>
): { bin: string; args: string[] } {
  const image = getSandboxImage();
  const network = PACKAGE_INSTALL_PATTERN.test(command) ? 'bridge' : 'none';
  const mount = `${path.resolve(cwd).replace(/\\/g, '/')}:/workspace`;

  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(extraEnv ?? {})) {
    if (/^[A-Z0-9_]+$/i.test(key)) envFlags.push('-e', `${key}=${value}`);
  }

  return {
    bin: 'docker',
    args: [
      'run', '--rm', '--init',
      '--name', containerName,
      '--network', network,
      '--memory', '2g',
      '--cpus', '2',
      '--pids-limit', '512',
      '-v', mount,
      // Shared cargo/go/pip/maven caches (paths set by the polyglot image ENV)
      ...sandboxCacheArgs(),
      '-w', '/workspace',
      // HOME must NOT be the project dir: `cargo init/new` refuses to create
      // a package in $HOME. User-level installs still persist in the
      // workspace via PYTHONUSERBASE.
      '-e', `HOME=${SANDBOX_HOME}`,
      '-e', 'PYTHONUSERBASE=/workspace/.local',
      // npm cache on the shared Linux cache volume, not the bind-mounted
      // workspace: a cold install went from ~4 min to ~1 min on Windows
      '-e', 'npm_config_cache=/cache/npm',
      '-e', 'CI=true',
      ...envFlags,
      image,
      'sh', '-c', command,
    ],
  };
}

// ─── Sandboxed child environment ─────────────────────────────────────────────
function buildChildEnv(cwd: string, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  // Local project binaries (tsc, eslint, vitest…) resolve without npx
  const localBin = path.join(cwd, 'node_modules', '.bin');
  const basePath = process.env.PATH ?? process.env.Path ?? '/usr/bin:/bin';
  const fullPath = localBin + path.delimiter + basePath;

  const env: NodeJS.ProcessEnv = {
    ...extraEnv, // project secrets first — system vars below always win
    PATH: fullPath,
    NODE_ENV: process.env.NODE_ENV ?? 'development',
    HOME: cwd,  // Sandbox home to workspace
    TERM: 'dumb',
    npm_config_cache: path.join(cwd, '.npm-cache'),
  };

  if (process.platform === 'win32') {
    // Minimum set required for cmd shims, npm, and node-gyp-free installs
    env.Path = fullPath;
    env.SystemRoot = process.env.SystemRoot;
    env.ComSpec = process.env.ComSpec;
    env.PATHEXT = process.env.PATHEXT;
    env.APPDATA = process.env.APPDATA;
    env.LOCALAPPDATA = process.env.LOCALAPPDATA;
    env.TEMP = process.env.TEMP;
    env.TMP = process.env.TMP;
  }

  return env;
}

// ─── Main safe exec ──────────────────────────────────────────────────────────
export async function safeExec(
  command: string,
  cwd: string,
  opts: SafeExecOptions = {}
): Promise<ExecResult> {
  if (!command.trim()) {
    throw new CommandError('Empty command');
  }

  const dockerMode = isDockerMode();

  // Host mode: strict validation — allowlisted binaries, no shell operators.
  // Docker mode: the container is the boundary, so full shell is allowed
  // and validation is skipped.
  if (!dockerMode) {
    // 1. Parse command into bin + args
    const parts = parseCommand(command);
    if (!parts.length) {
      throw new CommandError('Empty command');
    }

    const [bin, ...args] = parts;

    // 2. Prevent path segments in bin
    if (bin.includes('/') || bin.includes('\\')) {
      throw new CommandError('Command path segments are not allowed.');
    }

    // 3. Check bin whitelist
    if (!ALLOWED_BINS.has(bin)) {
      throw new CommandError(
        `Command '${bin}' is not in the allowed list. ` +
        `Allowed: ${[...ALLOWED_BINS].join(', ')}`
      );
    }

    // 4. Check git subcommand
    if (bin === 'git') {
      const subCmd = args[0];
      if (!subCmd || !ALLOWED_GIT_SUBCMDS.has(subCmd)) {
        throw new CommandError(
          `Git subcommand '${subCmd}' is not allowed. ` +
          `Allowed: ${[...ALLOWED_GIT_SUBCMDS].join(', ')}`
        );
      }
    }

    // 5. Binary-specific allow/block lists for the two interpreters with a
    //    real code-execution surface via arguments
    if (bin === 'node') validateNodeArgs(args);
    if (bin === 'find') validateFindArgs(args);
    if (bin === 'git') validateGitArgs(args);
    validateInlineCodeArgs(bin, args);

    // 6. Check args for dangerous patterns. Long flags accept "--flag=value"
    //    as one argument — normalize to the flag portion too, so exact-match
    //    patterns like /^--eval$/ also catch "--eval=code" (defense in depth
    //    beyond the node-specific allowlist above, for any bin added later).
    for (const arg of args) {
      const eqIdx = arg.startsWith('-') ? arg.indexOf('=') : -1;
      const flagPart = eqIdx > 0 ? arg.slice(0, eqIdx) : null;
      for (const pattern of BLOCKED_ARG_PATTERNS) {
        if (pattern.test(arg) || (flagPart !== null && pattern.test(flagPart))) {
          throw new CommandError(
            `Argument '${arg}' contains forbidden pattern`
          );
        }
      }
    }
  }

  const timeoutMs = opts.timeoutMs ?? LIMITS.timeoutMs;

  // 6. Spawn without host-shell interpretation. cross-spawn resolves
  //    .cmd/.bat shims on Windows (npm, tsc, …) while still escaping
  //    arguments. In docker mode the command runs via sh -c inside a
  //    throwaway container instead.
  const containerName = `oc-sandbox-${crypto.randomBytes(6).toString('hex')}`;
  let invocation: { bin: string; args: string[] };
  if (dockerMode) {
    invocation = buildDockerInvocation(command, cwd, containerName, opts.env);
  } else {
    const parts = parseCommand(command);
    invocation = { bin: parts[0], args: parts.slice(1) };
  }

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let settled = false;
    // Output is capped (head + tail) but the process is NOT killed when it
    // is chatty — killing turned verbose-but-passing builds/tests into
    // failures and lost the summary they print last
    const stdoutBuf = new CappedOutput(LIMITS.maxOutputLen);
    const stderrBuf = new CappedOutput(LIMITS.maxOutputLen);

    const proc = crossSpawn(invocation.bin, invocation.args, {
      cwd,
      env: dockerMode ? process.env : buildChildEnv(cwd, opts.env),
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch {}
      if (dockerMode) {
        // Killing the docker CLI doesn't reliably stop the container
        try { spawn('docker', ['kill', containerName]).on('error', () => {}); } catch {}
      }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000).unref();
    }, timeoutMs);

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      if (dockerMode) {
        try { spawn('docker', ['kill', containerName]).on('error', () => {}); } catch {}
      }
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    proc.stdout?.on('data', (chunk: Buffer) => stdoutBuf.push(chunk.toString()));
    proc.stderr?.on('data', (chunk: Buffer) => stderrBuf.push(chunk.toString()));

    // Close stdin either way: a child that waits on it would hang until the
    // timeout (docker mode uses `sh -c` in a container, which stays attached)
    if (proc.stdin) {
      proc.stdin.on('error', () => {}); // EPIPE when the child never reads it
      if (opts.stdin) proc.stdin.end(opts.stdin);
      else proc.stdin.end();
    }

    proc.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: stdoutBuf.toString().trimEnd(),
        stderr: stderrBuf.toString().trimEnd(),
        code: code ?? 1,
        timedOut,
      });
    });

    proc.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new CommandError(`Process error: ${err.message}`));
    });
  });
}

// ─── Bounded output buffer ───────────────────────────────────────────────────
/** Keeps the first 40% and the last 60% of a stream once it exceeds `max`. */
export class CappedOutput {
  private head = '';
  private tail = '';
  private dropped = 0;
  private readonly headMax: number;
  private readonly tailMax: number;

  constructor(max: number) {
    this.headMax = Math.floor(max * 0.4);
    this.tailMax = max - this.headMax;
  }

  push(chunk: string): void {
    if (this.head.length < this.headMax) {
      const room = this.headMax - this.head.length;
      this.head += chunk.slice(0, room);
      chunk = chunk.slice(room);
    }
    if (!chunk) return;
    this.tail += chunk;
    if (this.tail.length > this.tailMax) {
      this.dropped += this.tail.length - this.tailMax;
      this.tail = this.tail.slice(-this.tailMax);
    }
  }

  toString(): string {
    return this.dropped
      ? `${this.head}\n[... ${this.dropped} chars of output truncated ...]\n${this.tail}`
      : this.head + this.tail;
  }
}

// ─── Command parser (handles quoted strings) ─────────────────────────────────
function parseCommand(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) parts.push(current);
  return parts;
}
