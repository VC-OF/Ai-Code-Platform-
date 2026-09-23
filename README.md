# AI Code Platform

A working "AI coding workspace" like Lovable/v0/bolt.new: **Chat** (talk to
an agent) → **Code** (browse/edit generated files) → **Preview** (run the
app) → **Settings** (encrypted env vars). Multi-project, SQLite-backed,
with git checkpoints and per-turn verification.

## 1. Architecture

```
Frontend (Next.js 16 / React 19, single page + mobile layout)
  ├── Chat            — src/components/chat/ChatPanel.tsx (NDJSON stream consumer)
  ├── Editor          — src/components/editor/EditorPanel.tsx (Monaco via CodeTab)
  ├── Preview         — src/components/preview/PreviewPanel.tsx (iframe + terminal)
  └── Settings        — src/components/settings/SettingsPanel.tsx (masked env vars)

Backend (Next.js API routes, Node runtime)
  ├── /api/chat            — starts/subscribes to the background agent (NDJSON)
  ├── /api/chat/cancel     — cancel a running turn
  ├── /api/chat/status     — poll agent status
  ├── /api/files (+revert) — file tree, content, write, git-restore
  ├── /api/git/*           — checkpoint list + hard revert (validated shas)
  ├── /api/command         — terminal commands (allowlisted via safeExec)
  ├── /api/preview         — start/stop the workspace dev server
  ├── /api/settings        — encrypted env var CRUD
  ├── /api/projects        — project CRUD
  └── /api/database        — SQLite introspection (debug UI)

Agent core (src/lib)
  ├── agentManager.ts   — one background agent per project; event replay for
  │                       reconnecting clients; workspace locks
  ├── agentLoop.ts      — the agent loop: plan step → stream LLM → execute
  │                       tools → verify (lint/tests) → git checkpoint →
  │                       persist turn messages
  ├── tools.ts          — tool schemas + the single sandboxed tool executor
  ├── toolValidator.ts  — Zod validation of LLM-provided tool args
  ├── llmClient.ts      — OpenAI-compatible client + retry/circuit breaker,
  │                       streaming with real usage capture
  ├── models.ts         — central registry: context windows, costs, provider routing
  ├── contextManager.ts — token estimation + context compaction
  ├── safeExec.ts       — allowlisted, no-shell command execution (Windows-safe)
  ├── safeResolve.ts    — path jailing (traversal/symlink/forbidden-file checks)
  ├── previewManager.ts — dev-server process manager (kills full process tree)
  ├── db.ts             — better-sqlite3: projects, messages, checkpoints,
  │                       usage_log, tool_log
  ├── settingsStore.ts  — AES-256-GCM encrypted env vars (.settings/env.json)
  └── workspaceLock.ts / cancellation.ts / events.ts — concurrency plumbing

Sandbox
  └── workspaces/<projectId>/  — the folder the agent reads/writes/runs in
```

### The agent loop

`/api/chat` starts a **background** agent (it keeps running if the browser
disconnects; reconnecting clients get all events replayed):

1. Optional plan step (no tools) for non-trivial prompts.
2. Stream the LLM response (text deltas + tool-call deltas to the UI).
3. Validate tool args with Zod, git-checkpoint before the first edit, then
   execute tools against the jailed workspace.
4. Feed tool results back; repeat until the model stops calling tools
   (max 25 steps / 5 minutes).
5. If files changed but neither `run_lint` nor `run_tests` ran, the loop
   pushes back and forces a verification step before finishing.
6. Persist this turn's messages to SQLite and take a final checkpoint.

Tools: `list_files`, `read_file`, `create_file`, `edit_file` (unique-match
enforced, fresh-read required), `replace_lines`, `delete_file`,
`grep_files` / `glob_files` (pure Node — portable), `web_search` /
`fetch_url` (SSRF-guarded, so the agent can read real docs),
`generate_image` (free Flux via Pollinations/HF, saved into the
workspace), `run_command` (allowlisted), `run_lint`, `run_tests`.

## 2. Provider-agnostic LLM integration

Any OpenAI-compatible Chat Completions + tool-calling API works. The
provider registry lives in `src/lib/models.ts` (`PROVIDERS` +
`resolveProvider`); Settings → AI Providers shows live status, local-model
detection, and usage per model.

| Model syntax                        | Provider    | Key env var          |
| ----------------------------------- | ----------- | -------------------- |
| `llama-3.*`, `qwen/*`, `openai/*`   | Groq        | `GROQ_API_KEY`       |
| `openrouter:<model>`                | OpenRouter  | `OPENROUTER_API_KEY` |
| `together:<model>`                  | Together AI | `TOGETHER_API_KEY`   |
| `*:cloud`, `*:latest`, `*:8b`       | Ollama      | none                 |
| `lmstudio:<model>`                  | LM Studio   | none (localhost:1234)|
| `localai:<model>`                   | LocalAI     | none (localhost:8080)|
| anything else                       | default     | `LLM_API_KEY` / `OPENAI_API_KEY` + `LLM_BASE_URL` |

Keys come from env **or** the encrypted Settings store (global scope) — a
key pasted in the UI works without a restart, and never reaches the
browser. Set `LLM_FALLBACKS` (comma-separated model list) to auto-fail-over
when the selected model errors or rate-limits before producing output.
Adding another OpenAI-compatible provider is one `PROVIDERS` entry.

Nemotron Ultra is available through Ollama Cloud as `nemotron-3-ultra:cloud`.
Select it from the model picker, or set `LLM_MODEL=nemotron-3-ultra:cloud`.

Image generation: the agent's `generate_image` tool uses Pollinations
(keyless, Flux) with a Hugging Face `FLUX.1-schnell` fallback when
`HUGGINGFACE_API_KEY` is set, saving assets straight into the workspace.

Known upstream issue: `minimax-m3:cloud` via Ollama has documented problems
with multi-step tool calling (ollama/ollama#16389 — stalls or 400s after
tool-result messages). If you hit that, prefer `qwen3-coder-next:cloud` or a
hosted provider.

## 3. Running it

```bash
cd ai-code-platform
cp .env.local.example .env.local   # set your provider + keys
npm install
npm run dev
```

Open http://localhost:3000, create a project, and ask for an app. The
Preview tab boots `npm run dev` inside the workspace automatically after
the agent's turn changes files.

Verification: `npm run typecheck`, `npm run lint`, `npm test` (vitest;
includes security suites for `safeExec` and `safeResolve`), `e2e/` has
Playwright specs.

Chat supports Claude Code-style slash commands including `/help`, `/clear`,
`/status`, `/model`, `/compact`, `/review`, `/build`, `/fix`, `/test`,
`/refactor`, `/explain`, `/init`, `/memory`, `/permissions`, `/doctor`,
`/cost`, `/security-review`, `/pr-comments`, `/vim`, `/terminal-setup`,
`/hooks`, `/mcp`, `/config`, `/plan`, `/resume`, and `/add-dir`. Local commands
execute immediately; work commands expand into explicit prompts for the agent.

## 4. Security model

Defense in depth for a **local, single-user** tool — still not hardened
for hostile multi-tenant use (no container isolation):

- **Path jailing** — every LLM/user path goes through
  `safeResolve` (traversal, double-encoding, symlink, null-byte checks;
  `.env`/keys/`.git` are unreadable/unwritable).
- **Command allowlist** — all command execution (agent `run_command` and
  the `/api/command` terminal) goes through `safeExec`: allowlisted
  binaries only (npm, node, git subset, tsc, …), no shell interpretation,
  blocked arg patterns (redirection, chaining, `.env`, system paths),
  timeouts, output caps, sandboxed child env. Works on Windows via
  cross-spawn.
- **CSRF protection** — `src/proxy.ts` rejects state-changing API requests
  whose `Origin` doesn't match the host (blocks malicious web pages — or a
  prompt-injected preview app — from calling the API), adds rate limits,
  and supports optional token auth via `AUTH_TOKEN`.
- **No shell interpolation** — routes that call git use `execFile` with
  validated arguments (checkpoint shas must match `^[0-9a-f]{7,40}$`).
- **Secrets** — env vars are AES-256-GCM encrypted at rest
  (`SETTINGS_ENCRYPTION_KEY`), decrypted server-side only, and injected
  into workspace processes; the API returns masked values.

## 5. Beyond the basics

### Skills, harness, and context memory

Project-specific skills can be added under `.opencode/skills/<name>/SKILL.md`.
The agent also recognizes `.agents/skills/<name>/SKILL.md` and
`skills/<name>/SKILL.md`. Each skill may start with YAML-style `name` and
`description` fields, followed by instructions. Skills are loaded per project
and included in that project's system prompt.

Every run uses a harness with guardrails for secret handling, scoped edits,
untrusted tool output, and honest verification reporting. `AGENTS.md` remains
the project memory file and is composed with the harness and skills.

Long conversations are compacted before the model reaches its context limit.
The platform first asks the configured model for a factual summary, preserves
recent tool-call groups, and falls back to deterministic summaries if that
request fails or is cancelled. Compaction is ephemeral: original history
remains persisted while the working context stays within the model window.

- **Build Mode** — a second project type alongside the app-builder flow. On
  the welcome screen, switch to **Build Mode** and give it an absolute path
  to any existing folder on disk (any language, any framework, no template
  scaffolding) — the agent operates on that real directory directly, the way
  a general-purpose terminal coding agent would. `safeResolve` still jails
  every file tool to that folder exactly as it does for `workspaces/<id>`
  sandboxes; the difference is the folder itself is real and consequential,
  so creation is gated by a path denylist (filesystem roots, the platform's
  own directory, the bare home-directory root, system directories) and the
  UI shows a notice recommending `SANDBOX_MODE=docker` for command
  execution. Build Mode projects skip template scaffolding, only run
  `git init` if no repo exists (never force an initial commit over your own
  uncommitted work), only add `AGENTS.md` if one isn't already there, and
  hide the Preview/Deploy UI (an arbitrary folder isn't assumed to be a
  runnable web app — the agent can still deploy on request via the
  `deploy_app` tool if it genuinely is one).
- **Starter templates** — new projects can scaffold from a React + Vite app
  or a static site, both shipping a small dark design system the agent is
  instructed to build on (`src/lib/templates.ts`).
- **Web-aware agent** — `web_search` (DuckDuckGo, keyless) and `fetch_url`
  let the agent read real documentation. Both refuse private/loopback
  addresses (DNS-checked), cap sizes, and re-validate redirects.
- **One-click deploy** — the ▲ Deploy button in the Preview tab ships the
  workspace to Vercel. Set `VERCEL_TOKEN` in Settings (per project or
  global) or the server env.
- **Inspect mode** — the crosshair button in the Preview toolbar serves the
  app through a same-origin proxy (`/api/preview-proxy`) with an injected
  picker: click any element and the chat input is pre-filled with its CSS
  selector, ready for an edit instruction. (Dev-server HMR is bypassed
  while inspecting; toggle it off for normal browsing.)
- **Docker sandbox (opt-in)** — `SANDBOX_MODE=docker` runs every agent and
  terminal command in a throwaway container (workspace mounted at
  `/workspace`, no network except package installs, 1 GB / 1 CPU / pid
  caps). Inside the container **full shell syntax works** (pipes, `&&`,
  redirection via `sh -c`) — the container is the boundary; on the host the
  strict allowlist applies instead. **The preview dev server is
  containerized too**: deps install into a per-project named volume (no
  host/Linux binary mixing) and only the mapped port reaches the host.
  Requires Docker; override the image with `SANDBOX_IMAGE`.
- **Persistent plans + turn continuation** — for multi-step work the agent
  maintains a task list via `update_plan` (shown live in chat, stored per
  project). If a turn hits its step/time limit, a **Continue** button
  resumes from the saved plan instead of starting over. The agent can also
  deploy on request via the `deploy_app` tool (same Vercel path as the ▲
  button).
- **Real-browser verification** — the agent's `check_preview` tool loads
  the preview in headless system Chrome/Edge (playwright-core, no browser
  download), reporting console errors, uncaught exceptions, failed
  requests, and rendered text, plus a screenshot saved into the workspace.
  Reverting a checkpoint in Settings → Checkpoints now also **rewinds the
  chat history** to match the restored files.
- **MCP servers** — drop a config in `.platform/mcp.json`
  (`{"servers":{"name":{"command":"npx","args":["-y","@some/mcp-server"]}}}`)
  and each server's tools appear to the agent as `mcp_<name>_<tool>`
  (stdio transport, initialize handshake, health shown in Settings → AI
  Providers). This is the extension point for third-party tools without
  touching core code.
- **Per-project env vars** — Settings vars are scoped to the project;
  global vars (shared) are supported and shown with a "global" tag.
- **Token auth** — set `AUTH_TOKEN` and every API request must present it
  (`x-api-key`, `Authorization: Bearer`, or an `auth` cookie).

### Hardening before multi-user

1. Real user accounts (AUTH_TOKEN is a single shared secret).
2. Egress allowlisting for the sandbox's package-install network access.
3. Run with `SANDBOX_MODE=docker` — host mode remains allowlist-only.
