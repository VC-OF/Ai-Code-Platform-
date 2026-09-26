/**
 * Client-safe permission constants shared by the agent loop, safeExec and
 * the /permissions slash command. Keep this file free of Node imports.
 */

/** Tools that pause for user approval in manual execution mode. */
export const APPROVAL_REQUIRED_TOOLS = [
  'edit_file',
  'create_file',
  'append_file',
  'replace_lines',
  'delete_file',
  'run_command',
  'docker_run',
  'deploy_app',
  'execute_code',
  'notebook_edit',
  'run_notebook',
  'save_memory',
  'spawn_agent',
  'http_request',
  'plot_data',
] as const;

/** Binaries run_command may invoke on the host (local sandbox mode). */
export const HOST_ALLOWED_BINS = [
  // Node
  'node', 'npm', 'pnpm', 'yarn', 'bun',
  // TypeScript / Lint
  'tsc', 'eslint', 'prettier',
  // Test runners
  'jest', 'vitest', 'mocha', 'jasmine',
  // Build tools
  'vite', 'webpack', 'rollup', 'esbuild', 'turbo',
  // Python
  'python', 'python3', 'pip', 'pip3', 'uv', 'pytest', 'ruff',
  // Scientific / numerical toolchains
  'julia', 'Rscript', 'octave', 'jupyter',
  // Native compilers (C / C++ / Fortran)
  'gcc', 'g++', 'cc', 'c++', 'clang', 'clang++', 'gfortran',
  // TeX
  'latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber',
  // Rust
  'cargo', 'rustc', 'rustfmt',
  // Go
  'go', 'gofmt',
  // JVM
  'java', 'javac', 'mvn', 'gradle',
  // Other runtimes / build tools
  'dotnet', 'deno', 'ruby', 'bundle', 'php', 'composer',
  'make', 'cmake', 'sqlite3',
  // Git (limited)
  'git',
  // Safe UNIX utils
  'ls', 'cat', 'find', 'grep', 'head',
  'tail', 'wc', 'echo', 'pwd', 'which',
  'mkdir', 'touch', 'cp', 'mv',
  'diff', 'sort', 'uniq', 'tr', 'cut', 'stat', 'du', 'nproc',
] as const;

/** git subcommands allowed through run_command on the host. */
export const HOST_ALLOWED_GIT_SUBCOMMANDS = [
  'status', 'log', 'diff', 'show',
  'add', 'commit', 'checkout', 'reset',
  'init', 'rev-parse', 'stash',
] as const;

/** Human-readable summary of what safeExec blocks on the host. */
export const HOST_BLOCKED_SUMMARY = [
  'Any binary not on the allowlist',
  'Shell chaining, pipes, redirection and command substitution (;, &&, ||, |, <, >, $(), backticks)',
  'Arguments touching .env files, /etc, /proc, /sys, /dev, ~/.ssh, ~/.aws, ~/.config',
  'node -e/--eval/-p/-r/--import and any node flag other than --version/--help',
  'Inline code flags for interpreters (python -c, julia -e, Rscript -e, octave --eval, php -r, deno eval)',
  'find -exec/-delete/-fprint and other action primaries',
  'git -c/--config-env overrides, git config writes, and --output/-o file writes',
];
