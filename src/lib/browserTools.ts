import { z } from "zod";
import { getPreviewStatus } from "./previewManager";
import * as B from "./browserSession";

/**
 * Agent-facing browser_* tools: schemas (OpenAI function format), zod
 * validators and the executor. tools.ts / toolValidator.ts only spread these
 * in, so the whole feature lives here and in browserSession.ts.
 */

export interface BrowserToolResult {
  success: boolean;
  output: string;
  summary: string;
  error?: string;
  suggestion?: string;
  extra?: Record<string, unknown>;
}

const MAX_OUT = 10_000;
function truncate(s: string, max = MAX_OUT): string {
  return s.length <= max ? s : s.slice(0, max) + `\n...[truncated ${s.length - max} chars]`;
}

const fn = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "function" as const,
  function: { name, description, parameters: { type: "object", properties, required } },
});

const REF = { type: "string", description: "Element ref from browser_snapshot, e.g. 'e12'" };

export const BROWSER_TOOL_SCHEMAS = [
  fn(
    "browser_open",
    "Open a URL in the built-in headless browser (persistent per project, 1280x800). Defaults to the project's running preview. Only the project's own preview and public http(s) sites are allowed. Returns the page snapshot (text + element refs).",
    { url: { type: "string", description: "URL or path (e.g. '/about'). Default: the running preview URL" } }
  ),
  fn("browser_snapshot", "Get the current page's URL, title, visible text and an outline of interactive elements with refs (e1, e2…) usable by browser_click/browser_type/browser_select."),
  fn("browser_click", "Click an element by ref (from browser_snapshot). Returns the updated snapshot.", { ref: REF }, ["ref"]),
  fn(
    "browser_type",
    "Fill a text field by ref (replaces its value). Set submit=true to press Enter afterwards.",
    { ref: REF, text: { type: "string" }, submit: { type: "boolean" } },
    ["ref", "text"]
  ),
  fn("browser_press", "Press a keyboard key or chord on the focused element, e.g. 'Enter', 'Escape', 'Tab', 'Control+A'.", { key: { type: "string" } }, ["key"]),
  fn(
    "browser_select",
    "Choose option(s) in a <select> by ref (option values or visible labels).",
    { ref: REF, values: { type: "array", items: { type: "string" } } },
    ["ref", "values"]
  ),
  fn("browser_scroll", "Scroll the page.", { direction: { type: "string", enum: ["down", "up", "top", "bottom"] } }),
  fn(
    "browser_wait",
    "Wait until some text is visible, or for a fixed number of ms (max 15000).",
    { text: { type: "string" }, ms: { type: "number" } }
  ),
  fn(
    "browser_console",
    "Console messages, uncaught page errors and failed/4xx/5xx network requests since the last call (marks them read).",
    { level: { type: "string", enum: ["error", "warning", "all"], description: "Minimum level (default all)" } }
  ),
  fn(
    "browser_screenshot",
    "Save a PNG screenshot of the current page under .open-code/screenshots/ in the workspace and return its path and size. Use when layout/visuals matter.",
    { fullPage: { type: "boolean" } }
  ),
  fn("browser_close", "Close the built-in browser for this project."),
];

const ref = z.string().min(1).max(20);
export const BROWSER_ZOD_SCHEMAS = {
  browser_open: z.object({ url: z.string().max(2000).optional() }),
  browser_snapshot: z.object({}).passthrough().optional(),
  browser_click: z.object({ ref }),
  browser_type: z.object({ ref, text: z.string().max(10_000), submit: z.boolean().optional() }),
  browser_press: z.object({ key: z.string().min(1).max(50) }),
  browser_select: z.object({ ref, values: z.array(z.string().max(500)).min(1).max(50) }),
  browser_scroll: z.object({ direction: z.enum(["down", "up", "top", "bottom"]).optional() }),
  browser_wait: z
    .object({ text: z.string().min(1).max(500).optional(), ms: z.number().int().min(0).max(B.MAX_WAIT_MS).optional() }),
  browser_console: z.object({ level: z.enum(["error", "warning", "all"]).optional() }),
  browser_screenshot: z.object({ fullPage: z.boolean().optional() }),
  browser_close: z.object({}).passthrough().optional(),
};

export function isBrowserTool(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BROWSER_ZOD_SCHEMAS, name);
}

function policyFor(projectId: string): () => B.UrlPolicyContext {
  return () => {
    const p = getPreviewStatus(projectId);
    return { previewUrl: p.status === "running" && p.url ? p.url : null };
  };
}

async function snapText(projectId: string, max = 6000) {
  return B.formatSnapshot(await B.snapshot(projectId), max);
}

async function consoleSummary(projectId: string): Promise<string> {
  const { entries } = await B.drainConsole(projectId, "warning", false); // peek; browser_console marks read
  if (!entries.length) return "";
  return `\n\nUnread console/network problems (${entries.length}):\n` + entries.slice(-10).map(fmtEntry).join("\n");
}

function fmtEntry(e: B.ConsoleEntry): string {
  const tag = e.kind === "pageerror" ? "PAGE ERROR" : e.kind === "network" ? `network ${e.level}` : e.level;
  return `[${tag}] ${e.text}${e.location ? `  (${e.location})` : ""}`;
}

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  projectId: string
): Promise<BrowserToolResult> {
  try {
    switch (name) {
      case "browser_open": {
        const policy = policyFor(projectId);
        const preview = policy().previewUrl;
        let url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : "";
        if (!url || url.startsWith("/")) {
          if (!preview) {
            const st = getPreviewStatus(projectId);
            return fail(
              `The project's preview is not running (status: ${st.status}). Start it first — the user can press Run in the Preview tab (there is no agent tool to start it); read_preview_logs/check_preview show its state. Or pass a public https URL.`,
              "Preview not running"
            );
          }
          url = preview.replace(/\/$/, "") + (url || "/");
        }
        const r = await B.openUrl(projectId, url, policy);
        const text = await snapText(projectId);
        const problems = await consoleSummary(projectId);
        return {
          success: true,
          output: truncate(`HTTP ${r.status ?? "?"}\n${text}${problems}`),
          summary: `Opened ${r.url}${r.status && r.status >= 400 ? ` (HTTP ${r.status})` : ""}`,
          extra: { url: r.url },
        };
      }
      case "browser_snapshot": {
        const r = await B.snapshot(projectId);
        return { success: true, output: truncate(B.formatSnapshot(r, 8000)), summary: `Snapshot of ${r.title || r.url} (${r.refCount} refs)` };
      }
      case "browser_click": {
        await B.click(projectId, String(args.ref));
        return ok(`${await snapText(projectId)}${await consoleSummary(projectId)}`, `Clicked ${args.ref}`);
      }
      case "browser_type": {
        await B.typeInto(projectId, String(args.ref), String(args.text), Boolean(args.submit));
        const shown = String(args.text).slice(0, 40);
        return ok(`${await snapText(projectId)}${await consoleSummary(projectId)}`, `Typed "${shown}" into ${args.ref}${args.submit ? " and submitted" : ""}`);
      }
      case "browser_press": {
        await B.pressKey(projectId, String(args.key));
        return ok(`${await snapText(projectId)}${await consoleSummary(projectId)}`, `Pressed ${args.key}`);
      }
      case "browser_select": {
        const vals = (args.values as string[]).map(String);
        const sel = await B.selectOption(projectId, String(args.ref), vals);
        return ok(`Selected: ${sel.join(", ")}\n\n${await snapText(projectId)}`, `Selected ${vals.join(", ")} in ${args.ref}`);
      }
      case "browser_scroll": {
        const dir = (args.direction as "up" | "down" | "top" | "bottom") ?? "down";
        const pos = await B.scroll(projectId, dir);
        return ok(`Scrolled ${dir}: y=${pos.y} of ${pos.max}`, `Scrolled ${dir}`);
      }
      case "browser_wait": {
        const msg = await B.waitFor(projectId, { text: args.text as string | undefined, ms: args.ms as number | undefined });
        return ok(msg, msg);
      }
      case "browser_console": {
        const level = (args.level as "error" | "warning" | "all") ?? "all";
        const { entries, dropped } = await B.drainConsole(projectId, level);
        const errs = entries.filter((e) => e.level === "error").length;
        const body = entries.length ? entries.map(fmtEntry).join("\n") : "(no new console messages, page errors or failed requests)";
        return ok(
          truncate(`${body}${dropped ? `\n(${dropped} older entries dropped)` : ""}`),
          entries.length ? `Console: ${entries.length} new (${errs} errors)` : "Console clean"
        );
      }
      case "browser_screenshot": {
        const shot = await B.screenshot(projectId, workspace, Boolean(args.fullPage));
        const snap = await snapText(projectId, 3000);
        return {
          success: true,
          output: truncate(`Screenshot saved: ${shot.path} (${shot.width}x${shot.height}, ${shot.bytes} bytes)\n\n${snap}`),
          summary: `Screenshot saved ${shot.path}`,
          extra: {
            screenshot: shot.path,
            screenshotUrl: `/api/browser/screenshot?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(shot.path)}`,
            width: shot.width,
            height: shot.height,
          },
        };
      }
      case "browser_close": {
        const closed = await B.closeSession(projectId);
        return ok(closed ? "Browser closed." : "No browser was open.", closed ? "Closed browser" : "No browser open");
      }
      default:
        return fail(`Unknown browser tool ${name}`, "Unknown tool");
    }
  } catch (e) {
    const msg = (e as Error).message?.split("\n")[0] ?? String(e);
    const timeout = /Timeout \d+ms exceeded/i.test(msg);
    return fail(
      msg,
      `${name} failed`,
      timeout
        ? "The element may be hidden, covered or disabled, or the page is slow. Call browser_snapshot to re-check refs."
        : /stale|not found/i.test(msg)
          ? "Call browser_snapshot for fresh refs."
          : undefined
    );
  }
}

function ok(output: string, summary: string): BrowserToolResult {
  return { success: true, output: truncate(output), summary };
}

function fail(error: string, summary: string, suggestion?: string): BrowserToolResult {
  return { success: false, output: `Error: ${error}${suggestion ? `\n${suggestion}` : ""}`, summary, error, suggestion };
}
