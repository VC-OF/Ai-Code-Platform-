// Tool JSON schemas exposed to the model
import { BROWSER_TOOL_SCHEMAS } from "../browserTools";
import { SCIENCE_TOOL_SCHEMAS } from "../scienceTools";
import { APP_TOOL_SCHEMAS } from "../appTools";
import { JOB_TOOL_SCHEMAS } from "../jobTools";
import { GITHUB_TOOL_SCHEMAS } from "../githubTools";
import { LSP_TOOL_SCHEMAS } from "../lspTools";
import { AST_TOOL_SCHEMAS } from "../astTools";
import { GIT_ADVANCED_TOOL_SCHEMAS } from "../gitAdvancedTools";
import { SIDECAR_TOOL_SCHEMAS } from "../sidecarTools";
import { SCHEDULE_TOOL_SCHEMAS } from "../scheduleTools";
import { TUNNEL_TOOL_SCHEMAS } from "../tunnelTools";
import { SPAWN_AGENT_SCHEMA } from "../subagents";


// ─── Private Tool Schemas (Scaffolding) ───────────────────────────────────────

export const PRIVATE_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "private_code_vault",
      description: "[Private Tool] Access encrypted local codebase secrets and sensitive source tokens. Available only when Private Mode is enabled.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Secret or token key name" },
        },
        required: ["key"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "private_credential_store",
      description: "[Private Tool] Manage isolated tokens with zero network transmission. Available only when Private Mode is enabled.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["list", "get", "store"], description: "Credential action" },
          target: { type: "string", description: "Target service or identifier" },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "private_local_eval",
      description: "[Private Tool] Run on-device air-gapped test or AST evaluation for sensitive logic. Available only when Private Mode is enabled.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Code snippet to evaluate" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "private_airgap_fetch",
      description: "[Private Tool] Internal mock fetch handler preventing external socket leaks. Available only when Private Mode is enabled.",
      parameters: {
        type: "object",
        properties: {
          endpoint: { type: "string", description: "Internal endpoint to mock" },
        },
        required: ["endpoint"],
      },
    },
  },
];

// ─── Tool Schemas ──────────────────────────────────────────────────────────────

export const TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description:
        "List files and folders inside the project workspace at the given relative path. Use '.' for the root.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Relative directory path, e.g. '.' or 'src'",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file in the workspace. Pass start_line/end_line (1-indexed, inclusive) to read only a range — do that for big files you have already read once instead of re-reading all of it. Jupyter notebooks (.ipynb) are rendered as 0-indexed cells with their outputs.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          start_line: { type: "integer", description: "First line to return (1-indexed, optional)" },
          end_line: { type: "integer", description: "Last line to return (inclusive, optional)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "load_skill",
      description:
        "Load the full instructions of a skill listed in the Skills section of the system prompt. Call this before starting a task that matches a skill.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name exactly as listed" },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_file",
      description:
        "Create a new file or completely overwrite an existing file with the given content. Creates parent directories automatically. For files longer than ~300 lines, write the first part here and add the rest with append_file, so no single call is too large.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Full file content" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "append_file",
      description:
        "Append content to the end of a file (creates it if missing). Use this to write large files in parts after create_file: keep each part under ~300 lines.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "Content to append. Include a leading newline if needed." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Replace an exact snippet of text inside an existing file with new text. oldText must match exactly once in the file unless replace_all is true. You MUST have called read_file on this file earlier in this turn. For several changes to one file use multi_edit.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
          replace_all: { type: "boolean", description: "Replace every occurrence of oldText (default false)" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multi_edit",
      description:
        "Apply several exact-text replacements to ONE file in a single call. Edits apply in order, each to the result of the previous one, and atomically: if any edit fails nothing is written. Each oldText must match exactly once unless its replace_all is true. You MUST have called read_file on this file earlier in this turn.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          edits: {
            type: "array",
            description: "Edits applied sequentially",
            items: {
              type: "object",
              properties: {
                oldText: { type: "string" },
                newText: { type: "string" },
                replace_all: { type: "boolean" },
              },
              required: ["oldText", "newText"],
            },
          },
        },
        required: ["path", "edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_lines",
      description:
        "Replace a range of lines in a file with new content. Safer than edit_file for large blocks where exact-match is brittle. Lines are 1-indexed and inclusive.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          start_line: {
            type: "number",
            description: "First line to replace (1-indexed)",
          },
          end_line: {
            type: "number",
            description: "Last line to replace (1-indexed, inclusive)",
          },
          new_content: {
            type: "string",
            description: "Replacement text for the specified lines",
          },
        },
        required: ["path", "start_line", "end_line", "new_content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file in the workspace.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_files",
      description:
        "Search files in the workspace for a regex pattern. Returns matching lines with file paths and line numbers. Prefer this over reading entire files to locate symbols or text.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description:
              "Subdirectory to search in (default: '.' = entire workspace)",
          },
          glob: {
            type: "string",
            description:
              "File glob filter, e.g. '**/*.ts' or '**/*.{ts,tsx}' (default: all files)",
          },
          case_sensitive: {
            type: "boolean",
            description: "Whether search is case-sensitive (default: false)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob_files",
      description:
        "Find files matching a glob pattern in the workspace. Useful for discovering file structure without reading content.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Glob pattern, e.g. '**/*.test.ts' or 'src/**/*.tsx'",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web (DuckDuckGo) for documentation, examples, or error messages. Returns titles, URLs, and snippets. Use fetch_url to read a promising result.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a public http(s) URL and return its readable text content (HTML is converted to plain text). Use for reading documentation or API references found via web_search.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Absolute http(s) URL" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description:
        "Create or update your task plan for multi-step work. The plan persists across turns and is shown to the user — set statuses (pending/in_progress/completed) as you go, and consult it to resume after an interrupted turn. Always send the FULL task list, not a diff.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Stable short id, e.g. 't1'" },
                title: { type: "string", description: "Imperative task title" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
              },
              required: ["id", "title", "status"],
            },
            description: "The complete current task list (max 20)",
          },
        },
        required: ["tasks"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ask_user",
      description:
        "Pause and ask the user a clarifying question when a decision genuinely changes what you will build (framework choice, design direction, ambiguous requirement). The loop waits for their answer. Use sparingly — prefer sensible defaults for minor choices.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The question to ask, concise and specific",
          },
          options: {
            type: "array",
            items: { type: "string" },
            description: "Up to 4 suggested answers shown as quick buttons",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exit_plan_mode",
      description:
        "Plan mode only: present your finished implementation plan (markdown) for the user's approval. If approved, the rest of the turn runs in auto mode and you implement the plan; otherwise keep planning. Plan mode is read-only until then.",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "string",
            description: "The implementation plan in markdown: files to change, steps, and how you will verify",
          },
        },
        required: ["plan"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description:
        "Generate an image with a free AI image model (Flux) and save it into the workspace. Use for hero images, illustrations, logos, and placeholder assets. Prefer .png or .jpg paths under the app's public/asset directory.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Detailed visual description of the image (style, subject, colors, mood)",
          },
          path: {
            type: "string",
            description:
              "Relative file path to save to, e.g. 'public/images/hero.png'",
          },
          width: { type: "number", description: "Pixels, 64–2048 (default 1024)" },
          height: { type: "number", description: "Pixels, 64–2048 (default 1024)" },
          seed: { type: "number", description: "Optional seed for reproducibility" },
        },
        required: ["prompt", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_artifact",
      description:
        "Create or update a persistent project artifact (architecture spec, report, design guidelines, diagram, walkthrough, or verification summary). Artifacts are presented in the Antigravity Artifacts drawer and persisted across sessions. Supports GitHub alerts ([!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]).",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Concise title of the artifact, e.g. 'Authentication Architecture' or 'Database Schema'",
          },
          content: {
            type: "string",
            description: "Full markdown or structured text content of the artifact",
          },
          type: {
            type: "string",
            enum: ["markdown", "plan", "diagram", "diff", "report", "code"],
            description: "Artifact category",
          },
          description: {
            type: "string",
            description: "Short 1-sentence summary",
          },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "deploy_app",
      description:
        "Deploy the workspace to Vercel and return the live URL. Only call when the user explicitly asks to deploy/publish/ship the app. Requires VERCEL_TOKEN in Settings — if missing, tell the user how to add it instead of retrying.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description:
        "Run a command inside the project workspace (e.g. 'npm install', 'python3 -m venv .venv', 'cargo build', 'go test ./...', 'mvn -q package'). Default timeout 60s; pass timeout_seconds (up to 900) for builds, installs and test suites. Output is truncated. Long-running dev servers should NOT be started with this tool.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout_seconds: {
            type: "integer",
            description: "Optional timeout in seconds (1-900, default 60). Use 300-900 for cargo/mvn/gradle builds or large installs.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_preview_logs",
      description:
        "Read the running preview dev server's output logs (build errors, runtime errors, request logs). Use this to diagnose why the app fails at runtime after your edits.",
      parameters: {
        type: "object",
        properties: {
          lines: {
            type: "number",
            description: "How many recent log lines to return (default 100, max 500)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_preview",
      description:
        "Fetch a page from the running preview server and return its content, so you can verify what the app actually renders. Use after changes to confirm the page works (no blank page, expected text present).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to fetch, e.g. '/' or '/about' (default '/')",
          },
          raw: {
            type: "boolean",
            description:
              "true = raw HTML (inspect structure/scripts); false = readable text (default)",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_preview",
      description:
        "Load the running preview in a real headless browser and report JavaScript console errors, uncaught page errors, failed network requests, the page title, and visible text. Also saves a screenshot into the workspace. This catches runtime/rendering failures that lint and server logs miss — use it to verify UI changes actually work.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Page path to check, e.g. '/' (default '/')",
          },
          screenshot_path: {
            type: "string",
            description:
              "Workspace-relative path to save the screenshot (default '.preview/check.png')",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_lint",
      description:
        "Run the project's lint and type-check commands. Detects the stack from manifests: JS/TS (tsc + eslint), Rust (cargo clippy / cargo check), Python (ruff / compileall), Go (go vet), Java (mvn/gradle compile); also checks first-level subprojects (client/, server/, apps/*…). Call this after editing code to verify there are no type errors or lint violations before declaring the task done.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tests",
      description:
        "Run the project's test suite. Detects the stack: npm test, cargo test, pytest (installs requirements into a project-local .venv in the sandbox), go test, mvn/gradle test; also runs first-level subprojects (client/, server/, apps/*…). Call this after editing code that has tests to verify correctness before declaring the task done.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Optional test file/name pattern to run a subset of tests",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_run",
      description:
        "Execute a command inside an isolated Docker container with the workspace mounted at /workspace. Useful for multi-language execution (Python, Rust, Node, Go, C/C++) and isolated Linux testing.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to run inside the container (e.g. 'python main.py', 'npm test', 'cargo --version')",
          },
          image: {
            type: "string",
            description: "Optional Docker image (defaults to node:20-slim; options: python:3.11-slim, alpine:3, etc.)",
          },
          network: {
            type: "string",
            enum: ["bridge", "none"],
            description: "Network mode. 'bridge' enables network for package downloads, 'none' disables network.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "docker_status",
      description:
        "Inspect the host Docker engine status, active containers, images, and container sandbox availability.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  ...SCIENCE_TOOL_SCHEMAS,
  ...APP_TOOL_SCHEMAS,
  ...JOB_TOOL_SCHEMAS,
  ...GITHUB_TOOL_SCHEMAS,
  ...LSP_TOOL_SCHEMAS,
  ...AST_TOOL_SCHEMAS,
  ...GIT_ADVANCED_TOOL_SCHEMAS,
  ...SIDECAR_TOOL_SCHEMAS,
  ...SCHEDULE_TOOL_SCHEMAS,
  ...TUNNEL_TOOL_SCHEMAS,
  SPAWN_AGENT_SCHEMA,
  ...BROWSER_TOOL_SCHEMAS,
] as const;
