import path from "path";
import fs from "fs/promises";
import type { Browser, BrowserContext, Page, ConsoleMessage, Request, Response } from "playwright-core";
import { assertPublicHost } from "./webTools";
import { safeResolve } from "./safeResolve";
import { ensureOpenCodeIgnored } from "./openCodeDir";

/**
 * Built-in browser for the agent.
 *
 * One persistent headless Chromium context per project (lazy launch, reused
 * across tool calls and turns, closed after IDLE_MS of inactivity and on
 * process exit). Each page records console messages, uncaught page errors
 * and failed / 4xx-5xx requests into ring buffers that browser_console
 * drains. Elements are addressed by stable refs ("e12") stamped onto the DOM
 * as data-oc-ref attributes by snapshot().
 *
 * The browser runs on the host in both sandbox modes — in docker mode the
 * preview port is published to host localhost, so the same URL works.
 */

export const NAV_TIMEOUT_MS = 30_000;
export const ACTION_TIMEOUT_MS = 10_000;
export const MAX_WAIT_MS = 15_000;
const IDLE_MS = 10 * 60_000;
const RING_SIZE = 200;
const VIEWPORT = { width: 1280, height: 800 };

// ─── URL policy ──────────────────────────────────────────────────────────────

export interface UrlPolicyContext {
  /** Running preview URL for this project (e.g. http://localhost:4001) */
  previewUrl: string | null;
  /** Port of the platform itself (never browsable) */
  platformPort?: number;
}

function platformPort(ctx: UrlPolicyContext): number {
  return ctx.platformPort ?? (Number(process.env.PORT) || 3000);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function effectivePort(u: URL): number {
  if (u.port) return Number(u.port);
  return u.protocol === "https:" ? 443 : 80;
}

/**
 * Throws with a model-readable reason if the URL may not be opened.
 * Allowed: the project's own preview (any loopback alias, same port) and
 * public http(s) hosts that pass the webTools SSRF check. Everything else —
 * file:, chrome:, data:, javascript:, the platform's own port, other
 * localhost ports, private IPs — is blocked.
 */
export async function checkUrlAllowed(raw: string, ctx: UrlPolicyContext): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked URL scheme ${u.protocol} — only http(s) is allowed`);
  }
  const host = u.hostname.toLowerCase();
  const port = effectivePort(u);

  if (LOOPBACK.has(host)) {
    if (port === platformPort(ctx)) {
      throw new Error(`Blocked: port ${port} is the platform itself, not the project's app`);
    }
    if (ctx.previewUrl) {
      const p = new URL(ctx.previewUrl);
      if (port === effectivePort(p)) return u;
    }
    throw new Error(
      `Blocked: ${u.origin} is not this project's preview` +
        (ctx.previewUrl ? ` (preview is ${ctx.previewUrl})` : " (preview is not running)")
    );
  }

  if (ctx.previewUrl) {
    const p = new URL(ctx.previewUrl);
    if (u.origin === p.origin) return u;
  }

  await assertPublicHost(u); // SSRF guard: rejects private/loopback/link-local
  return u;
}

// ─── Session state ───────────────────────────────────────────────────────────

export interface ConsoleEntry {
  kind: "console" | "pageerror" | "network";
  level: string;
  text: string;
  location?: string;
  ts: number;
}

interface Session {
  projectId: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  log: ConsoleEntry[];
  readCursor: number; // index into total-seen count
  totalSeen: number;
  idleTimer?: NodeJS.Timeout;
  policy: () => UrlPolicyContext;
}

// Survive Next.js dev HMR module reloads
const g = globalThis as unknown as { __ocBrowserSessions?: Map<string, Promise<Session>>; __ocBrowserExitHook?: boolean };
const sessions: Map<string, Promise<Session>> = (g.__ocBrowserSessions ??= new Map());

if (!g.__ocBrowserExitHook) {
  g.__ocBrowserExitHook = true;
  const closeAll = () => {
    for (const s of sessions.values()) s.then((x) => x.browser.close()).catch(() => {});
    sessions.clear();
  };
  process.once("beforeExit", closeAll);
  process.once("SIGINT", () => { closeAll(); process.exit(130); });
  process.once("SIGTERM", () => { closeAll(); process.exit(143); });
}

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const errors: string[] = [];
  // Same approach as browserCheck: system Chrome/Edge, no bundled download
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      errors.push(`${channel}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  try {
    return await chromium.launch({ headless: true }); // bundled, if installed
  } catch (e) {
    errors.push(`bundled: ${(e as Error).message.split("\n")[0]}`);
  }
  throw new Error(`No browser available (install Google Chrome or Microsoft Edge). ${errors.join("; ")}`);
}

function push(s: Session, e: Omit<ConsoleEntry, "ts">) {
  s.log.push({ ...e, text: e.text.slice(0, 500), ts: Date.now() });
  s.totalSeen++;
  if (s.log.length > RING_SIZE) s.log.shift();
}

function attachPage(s: Session, page: Page) {
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  page.on("console", (m: ConsoleMessage) => {
    const loc = m.location();
    push(s, {
      kind: "console",
      level: m.type(),
      text: m.text(),
      location: loc?.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
    });
  });
  page.on("pageerror", (err) => push(s, { kind: "pageerror", level: "error", text: String(err.stack || err.message || err) }));
  page.on("requestfailed", (r: Request) =>
    push(s, { kind: "network", level: "error", text: `${r.method()} ${r.url()} — ${r.failure()?.errorText ?? "failed"}` })
  );
  page.on("response", (r: Response) => {
    if (r.status() >= 400) {
      push(s, { kind: "network", level: r.status() >= 500 ? "error" : "warning", text: `${r.request().method()} ${r.url()} — HTTP ${r.status()}` });
    }
  });
  page.on("dialog", (d) => {
    push(s, { kind: "console", level: "info", text: `[dialog ${d.type()}] ${d.message()} (auto-dismissed)` });
    d.dismiss().catch(() => {});
  });
}

function touch(s: Session) {
  if (s.idleTimer) clearTimeout(s.idleTimer);
  s.idleTimer = setTimeout(() => void closeSession(s.projectId), IDLE_MS);
  s.idleTimer.unref?.();
}

export async function getSession(projectId: string, policy: () => UrlPolicyContext): Promise<Session> {
  let p = sessions.get(projectId);
  if (p) {
    const s = await p.catch(() => null);
    if (s && s.browser.isConnected() && !s.page.isClosed()) {
      s.policy = policy;
      touch(s);
      return s;
    }
    sessions.delete(projectId);
    if (s) await s.browser.close().catch(() => {});
  }
  p = (async () => {
    const browser = await launchBrowser();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const s = { projectId, browser, context, log: [], readCursor: 0, totalSeen: 0, policy } as unknown as Session;
    // Guard every main-frame navigation (links, redirects, location=) with the URL policy
    await context.route("**/*", async (route) => {
      const req = route.request();
      if (req.isNavigationRequest() && req.frame() === req.frame().page().mainFrame()) {
        try {
          await checkUrlAllowed(req.url(), s.policy());
        } catch (e) {
          push(s, { kind: "network", level: "error", text: `Navigation blocked: ${req.url()} — ${(e as Error).message}` });
          return route.abort("blockedbyclient");
        }
      } else if (/^(file|chrome|chrome-extension):/i.test(req.url())) {
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    s.page = await context.newPage();
    attachPage(s, s.page);
    context.on("page", (pg) => {
      // Popups/new tabs: follow the newest one
      attachPage(s, pg);
      s.page = pg;
    });
    browser.on("disconnected", () => sessions.delete(projectId));
    touch(s);
    return s;
  })();
  sessions.set(projectId, p);
  try {
    return await p;
  } catch (e) {
    sessions.delete(projectId);
    throw e;
  }
}

export function hasSession(projectId: string): boolean {
  return sessions.has(projectId);
}

export async function closeSession(projectId: string): Promise<boolean> {
  const p = sessions.get(projectId);
  if (!p) return false;
  sessions.delete(projectId);
  const s = await p.catch(() => null);
  if (s) {
    if (s.idleTimer) clearTimeout(s.idleTimer);
    await s.browser.close().catch(() => {});
  }
  return true;
}

async function requireSession(projectId: string): Promise<Session> {
  const p = sessions.get(projectId);
  const s = p ? await p.catch(() => null) : null;
  if (!s || !s.browser.isConnected() || s.page.isClosed()) {
    throw new Error("No browser page is open. Call browser_open first.");
  }
  touch(s);
  return s;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * page.evaluate with a serialized function, shimming esbuild/tsx's `__name`
 * helper (keepNames) which otherwise leaks into the page and throws.
 */
function evalIn<R, A>(page: Page, fn: (arg: A) => R, arg?: A): Promise<R> {
  const src = `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`;
  return page.evaluate(src) as Promise<R>;
}

export async function openUrl(projectId: string, url: string, policy: () => UrlPolicyContext) {
  const u = await checkUrlAllowed(url, policy());
  const s = await getSession(projectId, policy);
  const resp = await s.page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  // Let SPA hydration / early errors surface, but don't hang on long-polling
  await s.page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  return { url: s.page.url(), status: resp?.status() ?? null, title: await s.page.title() };
}

export interface SnapshotResult {
  url: string;
  title: string;
  text: string;
  outline: string;
  refCount: number;
}

/** Stamp refs on visible interactive/landmark elements and build an outline. */
export async function snapshot(projectId: string): Promise<SnapshotResult> {
  const s = await requireSession(projectId);
  const data = await evalIn(s.page, () => {
    const w = window as unknown as { __ocRefSeq?: number };
    w.__ocRefSeq ??= 0;
    const INTERACTIVE =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option],[role=combobox],[role=textbox],[contenteditable=""],[contenteditable=true],[onclick],[tabindex]:not([tabindex="-1"])';
    const STRUCT = "h1,h2,h3,h4,h5,h6,img[alt],[role=alert],[role=dialog],label,nav,main,header,footer,form,table";
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    const clean = (t: string | null | undefined, n = 80) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
    const nameOf = (el: Element) => {
      const he = el as HTMLElement;
      const lbl =
        el.getAttribute("aria-label") ||
        (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        (el as HTMLInputElement).placeholder ||
        he.innerText ||
        el.getAttribute("name") ||
        "";
      return clean(lbl);
    };
    const roleOf = (el: Element) => {
      const r = el.getAttribute("role");
      if (r) return r;
      const tag = el.tagName.toLowerCase();
      if (tag === "a") return "link";
      if (tag === "input") {
        const t = (el as HTMLInputElement).type;
        return t === "checkbox" || t === "radio" ? t : t === "submit" || t === "button" ? "button" : `textbox[${t}]`;
      }
      if (tag === "textarea") return "textbox";
      if (tag === "select") return "combobox";
      if (/^h[1-6]$/.test(tag)) return `heading(${tag[1]})`;
      if (tag === "img") return "img";
      return tag;
    };
    const lines: string[] = [];
    const nodes = Array.from(document.querySelectorAll(`${INTERACTIVE},${STRUCT}`)).filter(visible);
    let refCount = 0;
    for (const el of nodes.slice(0, 400)) {
      const interactive = el.matches(INTERACTIVE);
      let ref = el.getAttribute("data-oc-ref");
      if (interactive && !ref) {
        ref = `e${++w.__ocRefSeq!}`;
        el.setAttribute("data-oc-ref", ref);
      }
      const role = roleOf(el);
      let line = interactive ? `[${ref}] ${role}` : `- ${role}`;
      const name = ["nav", "main", "header", "footer", "form", "table"].includes(role) ? "" : nameOf(el);
      if (name) line += ` "${name}"`;
      const he = el as HTMLInputElement;
      if (interactive) {
        refCount++;
        if ("value" in he && he.value && el.tagName !== "BUTTON") line += ` value="${clean(he.value, 60)}"`;
        if (he.type === "checkbox" || he.type === "radio") line += he.checked ? " (checked)" : " (unchecked)";
        if ((el as HTMLButtonElement).disabled) line += " (disabled)";
        if (el.tagName === "A") line += ` -> ${clean(el.getAttribute("href"), 60)}`;
        if (el.tagName === "SELECT") {
          line += ` options=[${Array.from((el as HTMLSelectElement).options).slice(0, 15).map((o) => clean(o.text, 30)).join(", ")}]`;
        }
      }
      lines.push(line);
    }
    return {
      text: clean(document.body?.innerText, 3000),
      outline: lines.join("\n"),
      refCount,
    };
  });
  return { url: s.page.url(), title: await s.page.title(), ...data };
}

export function formatSnapshot(r: SnapshotResult, maxOutline = 6000): string {
  const outline = r.outline.length > maxOutline ? r.outline.slice(0, maxOutline) + "\n...[outline truncated]" : r.outline;
  return `URL: ${r.url}\nTitle: ${r.title}\n\nVisible text:\n${r.text || "(empty — the page may be blank or still loading)"}\n\nElements (${r.refCount} refs; use browser_click/browser_type with ref):\n${outline || "(no elements)"}`;
}

async function locate(projectId: string, ref: string) {
  const s = await requireSession(projectId);
  if (!/^e\d+$/.test(ref)) throw new Error(`Invalid ref '${ref}' — refs look like 'e12'. Call browser_snapshot to get refs.`);
  const loc = s.page.locator(`[data-oc-ref="${ref}"]`);
  if ((await loc.count()) === 0) {
    throw new Error(`Ref ${ref} not found (stale — the page changed or navigated). Call browser_snapshot again for fresh refs.`);
  }
  return { s, loc: loc.first() };
}

async function settle(s: Session) {
  await s.page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  await s.page.waitForTimeout(300);
}

export async function click(projectId: string, ref: string) {
  const { s, loc } = await locate(projectId, ref);
  await loc.click({ timeout: ACTION_TIMEOUT_MS });
  await settle(s);
}

export async function typeInto(projectId: string, ref: string, text: string, submit?: boolean) {
  const { s, loc } = await locate(projectId, ref);
  await loc.fill(text, { timeout: ACTION_TIMEOUT_MS });
  if (submit) await loc.press("Enter", { timeout: ACTION_TIMEOUT_MS });
  await settle(s);
}

export async function pressKey(projectId: string, key: string) {
  const s = await requireSession(projectId);
  await s.page.keyboard.press(key);
  await settle(s);
}

export async function selectOption(projectId: string, ref: string, values: string[]) {
  const { s, loc } = await locate(projectId, ref);
  // Accept option values or visible labels
  const selected = await loc
    .selectOption(values, { timeout: ACTION_TIMEOUT_MS })
    .catch(() => loc.selectOption(values.map((label) => ({ label })), { timeout: ACTION_TIMEOUT_MS }));
  await settle(s);
  return selected;
}

export async function scroll(projectId: string, direction: "up" | "down" | "top" | "bottom" = "down") {
  const s = await requireSession(projectId);
  const pos = await evalIn(s.page, (dir: string) => {
    const h = window.innerHeight * 0.8;
    if (dir === "top") window.scrollTo(0, 0);
    else if (dir === "bottom") window.scrollTo(0, document.documentElement.scrollHeight);
    else window.scrollBy(0, dir === "up" ? -h : h);
    return { y: Math.round(window.scrollY), max: Math.round(document.documentElement.scrollHeight - window.innerHeight) };
  }, direction);
  await s.page.waitForTimeout(200);
  return pos;
}

export async function waitFor(projectId: string, opts: { text?: string; ms?: number }) {
  const s = await requireSession(projectId);
  const ms = Math.min(opts.ms ?? (opts.text ? MAX_WAIT_MS : 1000), MAX_WAIT_MS);
  if (opts.text) {
    await s.page.getByText(opts.text, { exact: false }).first().waitFor({ state: "visible", timeout: ms });
    return `Text "${opts.text}" is visible`;
  }
  await s.page.waitForTimeout(ms);
  return `Waited ${ms}ms`;
}

export function drainConsole(projectId: string, level?: "error" | "warning" | "all", markRead = true) {
  const p = sessions.get(projectId);
  if (!p) throw new Error("No browser page is open. Call browser_open first.");
  return p.then((s) => {
    const unread = s.totalSeen - s.readCursor;
    const fresh = unread > 0 ? s.log.slice(-Math.min(unread, s.log.length)) : [];
    if (markRead) s.readCursor = s.totalSeen;
    const dropped = Math.max(0, unread - fresh.length);
    const filtered = fresh.filter((e) =>
      !level || level === "all" ? true : level === "error" ? e.level === "error" : e.level === "error" || e.level === "warning"
    );
    return { entries: filtered, dropped };
  });
}

export async function screenshot(projectId: string, workspace: string, fullPage = false) {
  const s = await requireSession(projectId);
  const rel = `.open-code/screenshots/${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  const full = safeResolve(workspace, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  const buf = await s.page.screenshot({ path: full, fullPage, timeout: ACTION_TIMEOUT_MS });
  // PNG IHDR: width/height at bytes 16..24
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  await ensureOpenCodeIgnored(workspace);
  return { path: rel, width, height, bytes: buf.length };
}
