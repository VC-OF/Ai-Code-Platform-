import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
import { safeResolve } from "./safeResolve";
import { safeExec, CommandError } from "./safeExec";
import { webSearch, fetchUrl, htmlToText } from "./webTools";
import { generateImage } from "./imageGen";
import { getPreviewLogs, getPreviewStatus } from "./previewManager";
import { callMcpTool, demangleName } from "./mcpClient";
import { planDb, projectDb, type PlanTask } from "./db";
import { getDockerStatus, execInDocker } from "./dockerService";

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
      description: "Read the full text content of a file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
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
        "Replace an exact snippet of text inside an existing file with new text. oldText must match exactly once in the file. You MUST have called read_file on this file earlier in this turn.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          oldText: { type: "string" },
          newText: { type: "string" },
        },
        required: ["path", "oldText", "newText"],
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
        "Run an allowlisted command inside the project workspace (e.g. 'npm install', 'npm run build'). Has a 30-second timeout and output limit. Long-running dev servers should NOT be started with this tool.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
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
        "Run the project's lint and type-check commands. Call this after editing code to verify there are no type errors or lint violations before declaring the task done.",
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
        "Run the project's test suite. Call this after editing code that has tests to verify correctness before declaring the task done.",
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
] as const;

// ─── Constants ─────────────────────────────────────────────────────────────────

const MAX_READ_CHARS = 32_000;
const MAX_OUTPUT_CHARS = 8_000;

function truncate(s: string, max = MAX_OUTPUT_CHARS): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

// ─── Turn context ──────────────────────────────────────────────────────────────

/**
 * Tracks per-turn state: which files the model has read (fresh-read
 * enforcement for edits), what it changed, and which verifications ran.
 */
export interface TurnContext {
  filesRead: Set<string>;
  filesEdited: Set<string>;
  filesCreated: Set<string>;
  commandsRun: string[];
  hasEdits: boolean;
  hasRunLint: boolean;
  hasRunTests: boolean;
}

export function createTurnContext(): TurnContext {
  return {
    filesRead: new Set(),
    filesEdited: new Set(),
    filesCreated: new Set(),
    commandsRun: [],
    hasEdits: false,
    hasRunLint: false,
    hasRunTests: false,
  };
}

// ─── Result shape ──────────────────────────────────────────────────────────────

export interface VerificationOutcome {
  passed: boolean;
  errorCount?: number;
  warningCount?: number;
  total?: number;
  failed?: number;
  skipped?: boolean;
}

/** Machine-readable payload attached by tools that produce one:
 *  lint/test outcomes, plan snapshots, deploy URLs. */
export type StructuredOutcome = Partial<VerificationOutcome> & {
  tasks?: PlanTask[];
  url?: string | null;
  artifactId?: string;
  title?: string;
};

export interface ToolResult {
  success: boolean;
  /** Full text fed back to the LLM as the tool message */
  output: string;
  /** One-line human-readable summary for the UI timeline */
  summary: string;
  error?: string;
  suggestion?: string;
  changedFile?: string;
  extra?: Record<string, unknown>;
  structured?: StructuredOutcome;
}

// ─── Tool executor ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  ctx: TurnContext,
  signal?: AbortSignal
): Promise<ToolResult> {
  try {
    // MCP tools (mcp_<server>_<tool>) route to their external server
    if (demangleName(name)) {
      const output = await callMcpTool(name, args);
      return {
        success: true,
        output: truncate(output, 16_000),
        summary: `MCP ${name} completed`,
      };
    }

    switch (name) {
      // ── read_file ──────────────────────────────────────────────────────
      case "read_file": {
        const filePath = safeResolve(workspace, args.path as string);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n").length;
        ctx.filesRead.add(args.path as string);
        return {
          success: true,
          output: truncate(content, MAX_READ_CHARS),
          summary: `Read ${args.path} (${lines} lines)`,
        };
      }

      // ── load_skill ─────────────────────────────────────────────────────
      case "load_skill": {
        const { loadSkills, findSkill } = await import("./skills");
        const requested = String(args.name ?? "");
        const skills = await loadSkills(workspace, { includeGlobal: true });
        const skill = findSkill(skills, requested);
        if (!skill) {
          const names = skills.map((s) => s.name).join(", ") || "(none)";
          return {
            success: false,
            output: `Unknown skill '${requested}'. Available skills: ${names}`,
            summary: `Skill not found: ${requested}`,
            error: `Unknown skill '${requested}'`,
            suggestion: `Use one of: ${names}`,
          };
        }
        return {
          success: true,
          output: `# Skill: ${skill.name}\nSource: ${skill.source}\n\n${skill.instructions}`,
          summary: `Loaded skill ${skill.name}`,
        };
      }

      // ── create_file ────────────────────────────────────────────────────
      case "create_file": {
        const filePath = safeResolve(workspace, args.path as string);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, args.content as string, "utf-8");
        ctx.filesCreated.add(args.path as string);
        return {
          success: true,
          output: `Created ${args.path}`,
          summary: `Created ${args.path}`,
          changedFile: args.path as string,
        };
      }

      // ── append_file ────────────────────────────────────────────────────
      case "append_file": {
        const filePath = safeResolve(workspace, args.path as string);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, args.content as string, "utf-8");
        ctx.filesEdited.add(args.path as string);
        const lines = (await fs.readFile(filePath, "utf-8")).split("\n").length;
        return {
          success: true,
          output: `Appended to ${args.path} (now ${lines} lines)`,
          summary: `Appended to ${args.path}`,
          changedFile: args.path as string,
        };
      }

      // ── edit_file ──────────────────────────────────────────────────────
      case "edit_file": {
        const relPath = args.path as string;
        const filePath = safeResolve(workspace, relPath);

        // Fresh-read guard
        if (
          !ctx.filesRead.has(relPath) &&
          !ctx.filesEdited.has(relPath) &&
          !ctx.filesCreated.has(relPath)
        ) {
          return {
            success: false,
            output: `Error: Must read '${relPath}' before editing.`,
            summary: `Edit rejected — file not read`,
            error: `File '${relPath}' must be read first`,
            suggestion: `Call read_file with path '${relPath}' first`,
          };
        }

        const content = await fs.readFile(filePath, "utf-8");
        const oldText = args.oldText as string;
        const newText = args.newText as string;

        // Exact match — must be unique
        const occurrences = content.split(oldText).length - 1;
        if (occurrences === 1) {
          // Function replacer: newText must be inserted literally ($&, $1 … are not patterns)
          const updated = content.replace(oldText, () => newText);
          await fs.writeFile(filePath, updated, "utf-8");
          ctx.filesEdited.add(relPath);

          const added = newText.split("\n").length;
          const removed = oldText.split("\n").length;

          return {
            success: true,
            output: `Edited ${relPath}`,
            summary: `Edited ${relPath} (+${added}/-${removed} lines)`,
            changedFile: relPath,
            extra: {
              diff: { linesAdded: added, linesRemoved: removed },
            },
          };
        }

        if (occurrences > 1) {
          return {
            success: false,
            output:
              `Error: oldText matched ${occurrences} times in ${relPath} — it must match exactly once. ` +
              `Include more surrounding context to make it unique.`,
            summary: `Edit failed — ambiguous match in ${relPath}`,
            error: `oldText matched ${occurrences} times — must be unique`,
            suggestion: `Include more surrounding lines in oldText so it matches exactly once`,
          };
        }

        // Fuzzy fallback: whitespace-normalised regex, also required unique
        const escapedPattern = oldText
          .split(/\s+/)
          .filter(Boolean)
          .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\s+");

        if (escapedPattern) {
          let fuzzyMatches = 0;
          try {
            fuzzyMatches = content.match(new RegExp(escapedPattern, "g"))?.length ?? 0;
          } catch {
            fuzzyMatches = 0;
          }

          if (fuzzyMatches === 1) {
            const updated = content.replace(new RegExp(escapedPattern), () => newText);
            await fs.writeFile(filePath, updated, "utf-8");
            ctx.filesEdited.add(relPath);
            return {
              success: true,
              output: `Edited ${relPath} (whitespace-normalised fuzzy match)`,
              summary: `Edited ${relPath} (fuzzy match)`,
              changedFile: relPath,
            };
          }

          if (fuzzyMatches > 1) {
            return {
              success: false,
              output: `Error: text matched ${fuzzyMatches} times (fuzzy) in ${relPath} — must be unique. Add surrounding context.`,
              summary: `Edit failed — ambiguous fuzzy match`,
              error: `Fuzzy match ambiguous (${fuzzyMatches} occurrences)`,
              suggestion: `Include more surrounding lines in oldText so it matches exactly once`,
            };
          }
        }

        // Failure: return excerpt so the model can self-correct
        const lines = content.split("\n");
        const excerpt = lines
          .slice(0, 30)
          .map((l, i) => `${String(i + 1).padStart(3)}| ${l}`)
          .join("\n");

        return {
          success: false,
          output: `Error: Could not find text in ${relPath}.\n\nFirst 30 lines:\n${excerpt}`,
          summary: `Edit failed — text not found in ${relPath}`,
          error: `Text not found in '${relPath}'`,
          suggestion: `Check the file contents with read_file and adjust oldText`,
        };
      }

      // ── replace_lines ──────────────────────────────────────────────────
      case "replace_lines": {
        const relPath = args.path as string;
        const filePath = safeResolve(workspace, relPath);

        if (
          !ctx.filesRead.has(relPath) &&
          !ctx.filesEdited.has(relPath) &&
          !ctx.filesCreated.has(relPath)
        ) {
          return {
            success: false,
            output: `Error: Must read '${relPath}' before editing.`,
            summary: "Replace lines rejected",
            error: "File not read first",
            suggestion: `Call read_file with path '${relPath}' first`,
          };
        }

        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.split("\n");
        const startLine = args.start_line as number;
        const endLine = args.end_line as number;

        if (
          !Number.isInteger(startLine) ||
          !Number.isInteger(endLine) ||
          startLine < 1 ||
          endLine < startLine
        ) {
          return {
            success: false,
            output: `Error: invalid line range ${startLine}-${endLine} (must be integers, 1 <= start_line <= end_line).`,
            summary: `Replace lines failed — invalid range`,
            error: `invalid line range`,
          };
        }

        if (startLine > lines.length) {
          return {
            success: false,
            output: `Error: start_line ${startLine} is beyond end of file (${lines.length} lines).`,
            summary: `Replace lines failed — out of range`,
            error: `start_line out of range`,
            suggestion: `The file has ${lines.length} lines — read it again and adjust the range`,
          };
        }

        const start = startLine - 1;
        const end = Math.min(lines.length, endLine);

        lines.splice(start, end - start, ...(args.new_content as string).split("\n"));
        await fs.writeFile(filePath, lines.join("\n"), "utf-8");
        ctx.filesEdited.add(relPath);

        return {
          success: true,
          output: `Replaced lines ${startLine}-${endLine} in ${relPath}`,
          summary: `Replaced lines in ${relPath}`,
          changedFile: relPath,
        };
      }

      // ── delete_file ────────────────────────────────────────────────────
      case "delete_file": {
        const filePath = safeResolve(workspace, args.path as string);
        await fs.rm(filePath, { recursive: true, force: true });
        return {
          success: true,
          output: `Deleted ${args.path}`,
          summary: `Deleted ${args.path}`,
          changedFile: args.path as string,
        };
      }

      // ── list_files ─────────────────────────────────────────────────────
      case "list_files": {
        const dirPath = safeResolve(workspace, (args.path as string) ?? ".");
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const visible = entries.filter(
          (e) =>
            e.name !== "node_modules" && e.name !== ".next" && e.name !== ".git"
        );
        const output = visible
          .sort((a, b) =>
            a.isDirectory() === b.isDirectory()
              ? a.name.localeCompare(b.name)
              : a.isDirectory() ? -1 : 1
          )
          .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`)
          .join("\n");
        return {
          success: true,
          output: output || "(empty directory)",
          summary: `Listed ${visible.length} entries in ${args.path ?? "."}`,
        };
      }

      // ── glob_files ─────────────────────────────────────────────────────
      case "glob_files": {
        assertSafeGlob(String(args.pattern));
        const files = await fg(args.pattern as string, {
          cwd: workspace,
          ignore: ["**/node_modules/**", "**/.next/**", "**/.git/**"],
          onlyFiles: true,
        });
        const shown = files.slice(0, 200);
        let output = shown.join("\n") || "(no matches)";
        if (files.length > 200) {
          output += `\n...[showing 200 of ${files.length} matches]`;
        }
        return {
          success: true,
          output,
          summary: `Glob '${args.pattern}': ${files.length} matches`,
        };
      }

      // ── grep_files ─────────────────────────────────────────────────────
      case "grep_files": {
        const flags = args.case_sensitive ? "" : "i";
        let regex: RegExp;
        try {
          regex = new RegExp(args.pattern as string, flags);
        } catch {
          return {
            success: false,
            output: `Error: Invalid regex pattern: ${args.pattern}`,
            summary: `Grep failed — invalid regex`,
            error: `Invalid regex pattern`,
            suggestion: `Escape special characters or simplify the pattern`,
          };
        }

        const searchRoot = args.path
          ? safeResolve(workspace, args.path as string)
          : workspace;
        const matches = await nodeGrep(
          searchRoot,
          regex,
          args.glob ? String(args.glob) : undefined
        );

        let output = matches
          .slice(0, 100)
          .map((m) => `${m.file}:${m.line}: ${m.text}`)
          .join("\n");
        if (matches.length > 100) {
          output += `\n\n...[showing 100 of ${matches.length} matches — narrow your search]`;
        }

        return {
          success: true,
          output: truncate(output) || "(no matches)",
          summary: `Grep found ${matches.length} matches for '${args.pattern}'`,
        };
      }

      // ── web_search ─────────────────────────────────────────────────────
      case "web_search": {
        const results = await webSearch(String(args.query));
        const output = results.length
          ? results
              .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
              .join("\n\n")
          : "(no results)";
        return {
          success: true,
          output,
          summary: `Web search '${args.query}': ${results.length} results`,
        };
      }

      // ── fetch_url ──────────────────────────────────────────────────────
      case "fetch_url": {
        const page = await fetchUrl(String(args.url));
        return {
          success: true,
          output: `URL: ${page.url}\nContent-Type: ${page.contentType}\n\n${page.text}`,
          summary: `Fetched ${page.url}${page.truncated ? " (truncated)" : ""}`,
        };
      }

      // ── generate_image ─────────────────────────────────────────────────
      case "generate_image": {
        const relPath = args.path as string;
        const filePath = safeResolve(workspace, relPath);

        const image = await generateImage({
          prompt: String(args.prompt),
          width: args.width ? Number(args.width) : undefined,
          height: args.height ? Number(args.height) : undefined,
          seed: args.seed !== undefined ? Number(args.seed) : undefined,
        });

        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, image.bytes);
        ctx.filesCreated.add(relPath);

        const kb = Math.round(image.bytes.byteLength / 1024);
        return {
          success: true,
          output:
            `Generated ${image.width}x${image.height} image via ${image.provider} ` +
            `and saved to ${relPath} (${kb} KB). Reference it in the app as needed.`,
          summary: `Generated image → ${relPath} (${image.provider}, ${kb} KB)`,
          changedFile: relPath,
        };
      }

      // ── create_artifact ─────────────────────────────────────────────────
      case "create_artifact": {
        const { saveArtifact } = await import("./artifacts");
        const title = String(args.title || "Untitled Artifact");
        const content = String(args.content || "");
        const type = (args.type as "markdown" | "plan" | "diagram" | "diff" | "report" | "code") || "markdown";
        const description = args.description ? String(args.description) : undefined;

        const artifact = await saveArtifact(workspace, {
          title,
          content,
          type,
          description,
        });

        return {
          success: true,
          output: `Artifact created successfully:\nTitle: ${artifact.title}\nID: ${artifact.id}\nType: ${artifact.type}\nCharacters: ${artifact.content.length}\n\nVisible in the Antigravity Artifacts drawer.`,
          summary: `Created artifact → ${artifact.title} (${artifact.type})`,
          structured: { artifactId: artifact.id, title: artifact.title },
        };
      }

      // ── deploy_app ─────────────────────────────────────────────────────
      case "deploy_app": {
        const projectId = projectIdForWorkspace(workspace);
        const { deployToVercel } = await import("./deploy");
        const result = await deployToVercel(projectId, workspace);
        return {
          success: true,
          output: result.url
            ? `Deployed successfully: ${result.url}\n\n${result.output}`
            : `Deploy completed but no URL was reported.\n\n${result.output}`,
          summary: result.url
            ? `Deployed → ${result.url}`
            : "Deployed (no URL reported)",
          structured: { url: result.url },
        };
      }

      // ── run_command ────────────────────────────────────────────────────
      case "run_command": {
        const command = args.command as string;
        // Package installs and builds legitimately take longer than the
        // default 30s command timeout
        const isSlow = /^(npm|pnpm|yarn|bun)\s+(install|ci|add|run\s+build)\b/.test(
          command.trim()
        );
        const result = await safeExec(command, workspace, {
          signal,
          timeoutMs: isSlow ? 180_000 : undefined,
        });
        ctx.commandsRun.push(command);
        const success = result.code === 0 && !result.timedOut;
        return {
          success,
          output: truncate(
            result.stdout + (result.stderr ? `\nSTDERR:\n${result.stderr}` : "")
          ),
          summary: result.timedOut
            ? `Command '${command}' timed out`
            : `Command '${command}' ${success ? "succeeded" : `failed (exit ${result.code})`}`,
        };
      }

      // ── docker_run ────────────────────────────────────────────────────
      case "docker_run": {
        const command = args.command as string;
        const image = (args.image as string) || undefined;
        const network = (args.network as 'bridge' | 'none') || 'bridge';
        const res = await execInDocker(command, workspace, {
          image,
          network,
          timeoutMs: 180_000,
        });
        ctx.commandsRun.push(`docker: ${command}`);
        const success = res.exitCode === 0;
        return {
          success,
          output: truncate(
            res.stdout + (res.stderr ? `\nSTDERR:\n${res.stderr}` : "")
          ),
          summary: `Docker [${image || 'default'}] '${command}' ${success ? "succeeded" : `failed (exit ${res.exitCode})`}`,
        };
      }

      // ── docker_status ─────────────────────────────────────────────────
      case "docker_status": {
        const status = await getDockerStatus(true);
        return {
          success: status.available,
          output: JSON.stringify(status, null, 2),
          summary: status.available
            ? `Docker Engine online (${status.containersRunning} running, ${status.imagesCount} images, ${status.version || 'v' + status.serverVersion})`
            : `Docker Engine unavailable: ${status.error}`,
        };
      }


      // ── update_plan ────────────────────────────────────────────────────
      case "update_plan": {
        const projectId = projectIdForWorkspace(workspace);
        const tasks = (args.tasks as PlanTask[]).map((t) => ({
          id: String(t.id),
          title: String(t.title),
          status: t.status,
        }));
        planDb.set(projectId, tasks);

        const done = tasks.filter((t) => t.status === "completed").length;
        const active = tasks.find((t) => t.status === "in_progress");
        return {
          success: true,
          output:
            `Plan updated (${done}/${tasks.length} done).` +
            (active ? ` In progress: ${active.title}` : ""),
          summary: `Plan: ${done}/${tasks.length} done${active ? ` — ${active.title}` : ""}`,
          structured: { tasks },
        };
      }

      // ── read_preview_logs ──────────────────────────────────────────────
      case "read_preview_logs": {
        // Workspace roots are workspaces/<projectId>, so the basename is
        // the preview-manager key
        const projectId = projectIdForWorkspace(workspace);
        const info = getPreviewLogs(
          projectId,
          args.lines ? Number(args.lines) : 100
        );
        if (info.status === "stopped") {
          return {
            success: true,
            output:
              "Preview server is not running — no logs available. Ask the user to start it from the Preview tab, or diagnose via run_lint/run_command instead.",
            summary: "Preview logs: server stopped",
          };
        }
        const logText = info.logs.join("");
        return {
          success: true,
          output:
            `Preview server: ${info.status} at ${info.url}\n\n--- logs ---\n` +
            (truncate(logText) || "(no output yet)"),
          summary: `Read preview logs (${info.status}, ${info.logs.length} lines)`,
        };
      }

      // ── fetch_preview ──────────────────────────────────────────────────
      case "fetch_preview": {
        const projectId = projectIdForWorkspace(workspace);
        const preview = getPreviewStatus(projectId);
        if (preview.status !== "running" || !preview.url) {
          return {
            success: false,
            output: `Preview server is ${preview.status} — cannot fetch. It starts automatically after your turn changes files, or the user can start it in the Preview tab.`,
            summary: `Fetch preview failed — server ${preview.status}`,
            error: `Preview server ${preview.status}`,
          };
        }

        const relPath = String(args.path ?? "/");
        if (!relPath.startsWith("/")) {
          return {
            success: false,
            output: "Error: path must start with '/'",
            summary: "Fetch preview failed — bad path",
            error: "path must start with '/'",
          };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const res = await fetch(`${preview.url}${relPath}`, {
            signal: controller.signal,
          });
          const body = await res.text();
          const isHtml = /text\/html/i.test(res.headers.get("content-type") ?? "");
          const content =
            isHtml && !args.raw ? htmlToText(body) : body;
          return {
            success: true,
            output:
              `HTTP ${res.status} for ${relPath}\n\n` +
              (truncate(content, 16_000) || "(empty response)"),
            summary: `Fetched preview ${relPath} (HTTP ${res.status})`,
          };
        } finally {
          clearTimeout(timer);
        }
      }

      // ── check_preview ──────────────────────────────────────────────────
      case "check_preview": {
        const projectId = projectIdForWorkspace(workspace);
        const preview = getPreviewStatus(projectId);
        if (preview.status !== "running" || !preview.url) {
          return {
            success: false,
            output: `Preview server is ${preview.status} — cannot run a browser check.`,
            summary: `Browser check failed — server ${preview.status}`,
            error: `Preview server ${preview.status}`,
          };
        }

        const relPath = String(args.path ?? "/");
        const shotPath = String(args.screenshot_path ?? ".preview/check.png");
        // Screenshot path must stay inside the workspace
        safeResolve(workspace, shotPath);

        const { checkPreviewInBrowser } = await import("./browserCheck");
        const check = await checkPreviewInBrowser(
          `${preview.url}${relPath.startsWith("/") ? relPath : `/${relPath}`}`,
          workspace,
          shotPath
        );

        const problems =
          check.pageErrors.length + check.consoleErrors.length + check.failedRequests.length;

        const sections = [
          `Title: ${check.title || "(none)"}`,
          check.pageErrors.length
            ? `Uncaught page errors:\n${check.pageErrors.map((e) => `  - ${e}`).join("\n")}`
            : "Uncaught page errors: none",
          check.consoleErrors.length
            ? `Console errors:\n${check.consoleErrors.map((e) => `  - ${e}`).join("\n")}`
            : "Console errors: none",
          check.failedRequests.length
            ? `Failed requests:\n${check.failedRequests.map((e) => `  - ${e}`).join("\n")}`
            : "Failed requests: none",
          check.screenshotPath ? `Screenshot saved: ${check.screenshotPath}` : "",
          `Visible text (first 4000 chars):\n${check.visibleText || "(page rendered no text — possible blank page!)"}`,
        ].filter(Boolean);

        return {
          success: true,
          output: truncate(sections.join("\n\n"), 12_000),
          summary: problems
            ? `Browser check ✗ ${problems} problem(s) on ${relPath}`
            : `Browser check ✓ clean on ${relPath}`,
          changedFile: check.screenshotPath,
          structured: { passed: problems === 0, errorCount: problems },
        };
      }

      // ── run_lint ───────────────────────────────────────────────────────
      case "run_lint": {
        const hasTsconfig = await fileExists(path.join(workspace, "tsconfig.json"));
        const pkg = await readPackageJson(workspace);
        const hasEslint = !!(
          pkg?.devDependencies?.eslint || pkg?.dependencies?.eslint
        );

        let passed = true;
        let errorCount = 0;
        let warningCount = 0;
        let output = "";
        let ranAnything = false;

        if (hasTsconfig) {
          const tscResult = await safeExec(
            "tsc --noEmit --pretty false",
            workspace,
            { signal, timeoutMs: 60_000 }
          ).catch(() => null);
          if (tscResult) {
            ranAnything = true;
            if (tscResult.code !== 0) {
              passed = false;
              const combined = tscResult.stdout + "\n" + tscResult.stderr;
              errorCount += (combined.match(/error TS/g) ?? []).length || 1;
              output += `TypeScript:\n${truncate(combined)}\n`;
            } else {
              output += "TypeScript: ✓ No errors\n";
            }
          }
        }

        if (hasEslint) {
          const eslintResult = await safeExec(
            "eslint . --format json",
            workspace,
            { signal, timeoutMs: 60_000 }
          ).catch(() => null);
          if (eslintResult) {
            ranAnything = true;
            try {
              const eslintData = JSON.parse(eslintResult.stdout) as {
                errorCount: number;
                warningCount: number;
              }[];
              const totalErrors = eslintData.reduce(
                (s, f) => s + f.errorCount, 0);
              const totalWarnings = eslintData.reduce(
                (s, f) => s + f.warningCount, 0);
              errorCount += totalErrors;
              warningCount += totalWarnings;
              if (totalErrors > 0) passed = false;
              output += `ESLint: ${totalErrors} errors, ${totalWarnings} warnings\n`;
            } catch {
              output += truncate(eslintResult.stdout);
            }
          }
        }

        if (!ranAnything) {
          output = "No TypeScript config or ESLint found — nothing to lint.";
        }

        const structured = { passed, errorCount, warningCount };
        return {
          success: true,
          output: output || "Lint passed",
          summary: passed
            ? `Lint ✓ passed (${warningCount} warnings)`
            : `Lint ✗ failed (${errorCount} errors, ${warningCount} warnings)`,
          structured,
        };
      }

      // ── run_tests ──────────────────────────────────────────────────────
      case "run_tests": {
        const pkg = await readPackageJson(workspace);
        if (!pkg?.scripts?.test) {
          return {
            success: true,
            output: "No test script found in package.json — skipping tests.",
            summary: "Tests skipped (no test script)",
            structured: { passed: true, total: 0, failed: 0, skipped: true },
          };
        }

        const cmd = args.pattern
          ? `npm test -- ${String(args.pattern)}`
          : "npm test";
        const result = await safeExec(cmd, workspace, {
          signal,
          timeoutMs: 120_000,
        });

        let passed = result.code === 0 && !result.timedOut;
        let total = 0;
        let failed = 0;

        const combined = result.stdout + "\n" + result.stderr;
        try {
          const data = JSON.parse(result.stdout);
          total = data.numTotalTests ?? 0;
          failed = data.numFailedTests ?? 0;
          passed = data.success ?? passed;
        } catch {
          const totalMatch = combined.match(/(\d+)\s+(?:tests?\s+)?passed/i);
          const failedMatch = combined.match(/(\d+)\s+(?:tests?\s+)?failed/i);
          total = parseInt(totalMatch?.[1] ?? "0");
          failed = parseInt(failedMatch?.[1] ?? "0");
        }

        const structured = { passed, total, failed };
        return {
          success: true,
          output: truncate(combined),
          summary: passed
            ? `Tests ✓ passed (${total} total)`
            : `Tests ✗ failed (${failed}/${total} failing)`,
          structured,
        };
      }

      default:
        return {
          success: false,
          output: `Unknown tool: ${name}`,
          summary: `Unknown tool: ${name}`,
          error: `Tool '${name}' does not exist`,
        };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Error: ${msg}`,
      summary: `Tool error: ${msg}`,
      error: msg,
      suggestion:
        err instanceof CommandError
          ? "Use an allowlisted command (npm, node, git, …) without shell operators"
          : "Check arguments and try again",
    };
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

// Build Mode workspaces are arbitrary host folders, so the folder name is not
// the project id — look it up; app-mode workspaces/<id> fall back to basename
function projectIdForWorkspace(workspace: string): string {
  try {
    const row = projectDb.getAll().find((p) => p.workspace === workspace);
    if (row) return row.id;
  } catch {}
  return path.basename(workspace);
}

async function fileExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(workspace: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(workspace, "package.json"), "utf-8")
    ) as PackageJson;
  } catch {
    return null;
  }
}

// Glob patterns are resolved by fast-glob relative to cwd, but "../" segments
// and absolute patterns would escape the workspace
function assertSafeGlob(pattern: string): void {
  const p = pattern.replace(/\\/g, "/");
  if (path.isAbsolute(p) || /^[a-zA-Z]:/.test(p) || p.split("/").includes("..")) {
    throw new Error(`Glob pattern '${pattern}' must be relative and stay inside the workspace`);
  }
}

// Pure-Node grep — portable (no external grep/find binaries needed)
async function nodeGrep(
  searchRoot: string,
  pattern: RegExp,
  globFilter: string | undefined
): Promise<{ file: string; line: number; text: string }[]> {
  if (globFilter) assertSafeGlob(globFilter);
  const files = await fg(globFilter || "**/*", {
    cwd: searchRoot,
    ignore: ["**/node_modules/**", "**/.next/**", "**/.git/**"],
    absolute: true,
    onlyFiles: true,
  });

  const results: { file: string; line: number; text: string }[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      lines.forEach((lineText, idx) => {
        if (pattern.test(lineText)) {
          results.push({
            file: path.relative(searchRoot, filePath).replace(/\\/g, "/"),
            line: idx + 1,
            text: lineText.trim(),
          });
        }
      });
    } catch {
      // Skip binary or unreadable files
    }
    if (results.length >= 200) break; // cap raw results
  }
  return results;
}
