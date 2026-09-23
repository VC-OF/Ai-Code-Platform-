import path from "path";
import fs from "fs/promises";

/**
 * Real-browser preview verification for the agent.
 *
 * Uses playwright-core with the system Chrome/Edge (no bundled-browser
 * download). Loads the preview URL, captures console messages and page
 * errors — the runtime failures a server-log read can't see — plus the
 * page title and rendered text, and saves a screenshot into the workspace
 * so the user can eyeball it (and vision-capable models can attach it).
 */

const LOAD_TIMEOUT_MS = 20_000;
const SETTLE_MS = 1_500;

export interface BrowserCheckResult {
  title: string;
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  visibleText: string;
  screenshotPath?: string;
}

export async function checkPreviewInBrowser(
  url: string,
  workspace: string,
  screenshotRelPath?: string
): Promise<BrowserCheckResult> {
  const { chromium } = await import("playwright-core");

  let browser;
  for (const channel of ["chrome", "msedge"] as const) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      break;
    } catch {
      // try next channel
    }
  }
  if (!browser) {
    throw new Error(
      "No system Chrome/Edge found for browser checks. Install Google Chrome or Microsoft Edge."
    );
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on("console", (msg) => {
      const text = msg.text().slice(0, 300);
      if (msg.type() === "error") consoleErrors.push(text);
      else if (msg.type() === "warning") consoleWarnings.push(text);
    });
    page.on("pageerror", (err) => {
      pageErrors.push(String(err.message ?? err).slice(0, 300));
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? "failed"}`);
    });

    await page.goto(url, { timeout: LOAD_TIMEOUT_MS, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(SETTLE_MS); // let SPA hydration/errors surface

    const title = await page.title();
    const visibleText = (
      await page.evaluate(() => document.body?.innerText ?? "")
    ).slice(0, 4_000);

    let screenshotPath: string | undefined;
    if (screenshotRelPath) {
      const full = path.join(workspace, screenshotRelPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await page.screenshot({ path: full, fullPage: false });
      screenshotPath = screenshotRelPath;
    }

    return {
      title,
      consoleErrors: consoleErrors.slice(0, 20),
      consoleWarnings: consoleWarnings.slice(0, 10),
      pageErrors: pageErrors.slice(0, 20),
      failedRequests: failedRequests.slice(0, 10),
      visibleText,
      screenshotPath,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
