import crossSpawn from 'cross-spawn';
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';

// ─── Whitelist ───────────────────────────────────────────────────────────────
const ALLOWED_BINS = new Set([
  // Node
  'node', 'npm', 'pnpm', 'yarn', 'bun',
  // TypeScript / Lint
  'tsc', 'eslint', 'prettier',
  // Test runners
  'jest', 'vitest', 'mocha', 'jasmine',
  // Build tools
  'vite', 'webpack', 'rollup', 'esbuild', 'turbo',
  // Git (limited)
  'git',
  // Safe UNIX utils
  'ls', 'cat', 'find', 'grep', 'head',
  'tail', 'wc', 'echo', 'pwd', 'which',
  'mkdir', 'touch', 'cp', 'mv',
]);

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
const ALLOWED_GIT_SUBCMDS = new Set([
  'status', 'log', 'diff', 'show',
  'add', 'commit', 'checkout', 'reset',
  'init', 'rev-parse', 'stash',
]);

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

// ─── Execution limits ────────────────────────────────────────────────────────
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
 * SANDBOX_IMAGE overrides the image (default node:20 — includes git).
 */
const PACKAGE_INSTALL_PATTERN =
  /\b(npm|pnpm|yarn|bun)\b\s+(install|ci|add|update|i\b)|\bnpx\b/;

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
  const image = process.env.SANDBOX_IMAGE || 'node:20-slim';
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
      '--memory', '1g',
      '--cpus', '1',
      '--pids-limit', '512',
      '-v', mount,
      '-w', '/workspace',
      '-e', 'HOME=/workspace',
      '-e', 'npm_config_cache=/workspace/.npm-cache',
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
    let stdout = '';
    let stderr = '';

    const proc = crossSpawn(invocation.bin, invocation.args, {
      cwd,
      env: dockerMode ? process.env : buildChildEnv(cwd, opts.env),
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch {}
      if (dockerMode) {
        // Killing the docker CLI doesn't reliably stop the container
        try { spawn('docker', ['kill', containerName]); } catch {}
      }
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 5000).unref();
    }, timeoutMs);

    const onAbort = () => {
      try { proc.kill('SIGTERM'); } catch {}
      if (dockerMode) {
        try { spawn('docker', ['kill', containerName]); } catch {}
      }
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      clearTimeout(killTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > LIMITS.maxOutputLen) {
        stdout = stdout.slice(0, LIMITS.maxOutputLen) + '\n[output truncated]';
        proc.kill('SIGTERM');
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > LIMITS.maxOutputLen) {
        stderr = stderr.slice(0, LIMITS.maxOutputLen) + '\n[output truncated]';
      }
    });

    proc.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
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
