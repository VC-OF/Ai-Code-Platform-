"use client";

import { useEffect, useRef, useState } from "react";

type Status = "stopped" | "starting" | "running" | "error";
type Device = "desktop" | "tablet" | "mobile";

export default function PreviewTab({
  autoStartToken,
  projectId,
}: {
  autoStartToken?: number;
  projectId: string;
}) {
  const [status, setStatus] = useState<Status>("stopped");
  const [url, setUrl] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [iframeKey, setIframeKey] = useState(0);
  const [device, setDevice] = useState<Device>("desktop");
  const [previewSubTab, setPreviewSubTab] = useState<'browser' | 'database' | 'analytics'>('browser');

  // Custom Terminal execution states
  const [commandInput, setCommandInput] = useState("");
  const [executingCommand, setExecutingCommand] = useState(false);

  // Real database stats for the Database sub-tab
  const [dbStats, setDbStats] = useState<{
    tables: number;
    rows: number;
    sizeKb: number;
  } | null>(null);

  // Vercel deploy state
  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  // Inspect mode: serve the preview through a same-origin proxy that lets
  // the user click an element to reference it in the chat
  const [inspecting, setInspecting] = useState(false);

  // Autonomous Browser Verification state
  const [auditing, setAuditing] = useState(false);
  const [auditResult, setAuditResult] = useState<{
    status: 'clean' | 'issues_detected' | 'error' | 'offline';
    totalProblems: number;
    title?: string;
    consoleErrors?: string[];
    pageErrors?: string[];
    visibleTextPreview?: string;
    error?: string;
  } | null>(null);

  const runBrowserAudit = async () => {
    if (status !== 'running' || auditing) return;
    setAuditing(true);
    setAuditResult(null);
    try {
      const res = await fetch(`/api/preview/inspect?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setAuditResult(data);
    } catch (err: unknown) {
      setAuditResult({
        status: 'error',
        totalProblems: 1,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAuditing(false);
    }
  };

  useEffect(() => {
    if (!inspecting) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== "oc-element-picked") return;
      window.dispatchEvent(
        new CustomEvent("oc-element-picked", { detail: e.data })
      );
      setInspecting(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInspecting(false);
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onKey);
    };
  }, [inspecting]);

  const statusRef = useRef<Status>("stopped");
  const lastAutoStartToken = useRef<number | undefined>(undefined);
  const logsEndRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const res = await fetch(
        `/api/preview?projectId=${encodeURIComponent(projectId)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      // Reload the iframe once the server transitions into "running"
      if (statusRef.current !== "running" && data.status === "running") {
        setIframeKey((k) => k + 1);
      }
      setStatus(data.status);
      statusRef.current = data.status;
      setUrl(data.url);
      setLogs(data.logs || []);
    } catch {
      // Ignore transient polling failures
    }
  }

  // Scroll to bottom of logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, executingCommand]);

  // Poll status while mounted — the server may be starting/stopping in the
  // background regardless of which tab was visible when that began
  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 2000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function start() {
    setStatus("starting");
    statusRef.current = "starting";
    await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", projectId }),
    });
    refresh();
  }

  // Auto-start (or reload) when the agent changes files. Runs on mount too,
  // so switching to the Preview tab after a turn boots the server.
  useEffect(() => {
    if (!autoStartToken) return;
    if (autoStartToken === lastAutoStartToken.current) return;
    lastAutoStartToken.current = autoStartToken;

    if (statusRef.current === "running") {
      setIframeKey((k) => k + 1);
    } else if (statusRef.current !== "starting") {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartToken]);

  async function stop() {
    await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop", projectId }),
    });
    refresh();
  }

  // Load real platform-DB stats when the Database sub-tab is opened
  useEffect(() => {
    if (previewSubTab !== "database") return;
    fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=tables`)
      .then((r) => r.json())
      .then((data) => {
        const tables: { rows: number }[] = data.tables || [];
        setDbStats({
          tables: tables.length,
          rows: tables.reduce((s, t) => s + (t.rows || 0), 0),
          sizeKb: Math.round((data.size_bytes || 0) / 1024),
        });
      })
      .catch(() => setDbStats(null));
  }, [previewSubTab, projectId]);

  async function deploy() {
    if (deploying) return;
    setDeploying(true);
    setDeployUrl(null);
    setLogs((prev) => [...prev, "\n$ deploy → vercel\n"]);
    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (data.error) {
        setLogs((prev) => [...prev, `deploy error: ${data.error}\n${data.output ?? ""}\n`]);
      } else {
        setDeployUrl(data.url);
        setLogs((prev) => [
          ...prev,
          `${data.output ?? ""}\n✓ Deployed: ${data.url ?? "(no URL reported)"}\n`,
        ]);
        if (data.url) window.open(data.url, "_blank");
      }
    } catch (err) {
      setLogs((prev) => [...prev, `deploy error: ${String(err)}\n`]);
    } finally {
      setDeploying(false);
    }
  }

  async function runCustomCommand() {
    const cmd = commandInput.trim();
    if (!cmd || executingCommand) return;

    setCommandInput("");
    setExecutingCommand(true);
    setLogs((prev) => [...prev, `\n$ ${cmd}\n`]);

    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, projectId }),
      });
      const data = await res.json();

      let out = "";
      if (data.stdout) out += data.stdout;
      if (data.stderr) out += `\nstderr:\n${data.stderr}`;
      if (data.error) out += `\nerror: ${data.error}`;
      if (!out) out = "\nCommand finished with no output.\n";

      setLogs((prev) => [...prev, out]);
    } catch (err) {
      setLogs((prev) => [...prev, `\nExecution error: ${String(err)}\n`]);
    } finally {
      setExecutingCommand(false);
      refresh();
    }
  }

  return (
    <div className="preview-root">
      {/* ── Preview toolbar ── */}
      <div className="preview-toolbar">
        <div className="traffic-dots">
          <span />
          <span />
          <span />
        </div>
        
        <div className="url-pill">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
            <rect x="3" y="11" width="18" height="10" rx="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
          {url || "server offline"}
        </div>

        <button
          className="toolbar-icon"
          onClick={() => setIframeKey((k) => k + 1)}
          title="Reload preview"
          disabled={status !== "running"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.5 9a9 9 0 0114.5-3.4L23 10M1 14l5-4.6A9 9 0 0020.5 15"/>
          </svg>
        </button>

        <button
          className={`toolbar-icon ${inspecting ? "toolbar-icon--active" : ""}`}
          onClick={() => setInspecting((v) => !v)}
          title="Inspect: click an element in the preview to edit it via chat"
          disabled={status !== "running"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M3 3l7.5 18 2.5-7.5L20.5 11z" />
          </svg>
        </button>

        <button
          className={`toolbar-icon ${auditing ? "toolbar-icon--active" : ""}`}
          onClick={runBrowserAudit}
          title="Autonomous Verify: Run Playwright DOM & console health audit"
          disabled={status !== "running" || auditing}
        >
          {auditing ? (
            <span className="audit-spin">⟳</span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          )}
        </button>

        <button
          className="toolbar-icon"
          onClick={() => url && window.open(url, "_blank")}
          title="Open in new tab"
          disabled={status !== "running"}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <path d="M15 3h6v6M10 14L21 3"/>
          </svg>
        </button>

        <div className="device-toggle">
          <button
            className={`di ${device === "desktop" ? "active" : ""}`}
            onClick={() => setDevice("desktop")}
            title="Desktop view (100%)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <rect x="2" y="4" width="20" height="14" rx="2"/>
              <path d="M8 21h8M12 18v3"/>
            </svg>
          </button>
          <button
            className={`di ${device === "tablet" ? "active" : ""}`}
            onClick={() => setDevice("tablet")}
            title="Tablet view (768px)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <rect x="4" y="2" width="16" height="20" rx="2"/>
              <path d="M12 18h.01"/>
            </svg>
          </button>
          <button
            className={`di ${device === "mobile" ? "active" : ""}`}
            onClick={() => setDevice("mobile")}
            title="Mobile view (375px)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <rect x="6" y="2" width="12" height="20" rx="2"/>
              <path d="M12 18h.01"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Sub-tab switcher ─────────────────────────────────────── */}
      <div className="preview-subtabs">
        {(['browser', 'database', 'analytics'] as const).map((t) => (
          <button
            key={t}
            className={`pst ${previewSubTab === t ? 'pst--active' : ''}`}
            onClick={() => setPreviewSubTab(t)}
          >
            {t === 'browser'   ? 'Browser'   :
             t === 'database'  ? 'Database'  :
             'Server'}
          </button>
        ))}
      </div>

      {previewSubTab === 'browser' && (
      <div className="preview-layout">
        {/* ── Preview Canvas ── */}
        <div className="preview-canvas">
          {status === "running" ? (
            <div className={`preview-frame-wrapper ${device}`}>
              {inspecting && (
                <div className="inspect-banner">
                  Click any element to reference it in chat — Esc to cancel
                </div>
              )}
              {auditResult && (
                <div className={`preview-audit-toast preview-audit-toast--${auditResult.status}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-xs flex items-center gap-1.5">
                      {auditResult.status === 'clean' ? '✓ Playwright Verified Clean' : '⚠️ Verification Issues Detected'}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] opacity-70 hover:opacity-100 cursor-pointer"
                      onClick={() => setAuditResult(null)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="text-[11px] mt-1 text-slate-300">
                    {auditResult.status === 'clean' ? (
                      <span>Page: <strong>{auditResult.title || 'OK'}</strong> · 0 uncaught errors · DOM verified.</span>
                    ) : (
                      <span>
                        Found {auditResult.totalProblems} problem(s):{' '}
                        {auditResult.pageErrors?.slice(0, 1).join(' ') ||
                          auditResult.consoleErrors?.slice(0, 1).join(' ') ||
                          auditResult.error}
                      </span>
                    )}
                  </div>
                </div>
              )}
              <iframe
                key={`${iframeKey}-${inspecting}`}
                src={
                  inspecting
                    ? `/api/preview-proxy?projectId=${encodeURIComponent(projectId)}&path=/`
                    : url
                }
                className="preview-iframe"
              />
            </div>
          ) : (
            <div className="preview-offline">
              <div className="preview-offline-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={24} height={24}>
                  <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.58 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>
                </svg>
              </div>
              <h3 className="preview-offline-title">Preview server offline</h3>
              <p className="preview-offline-desc">
                {status === "starting"
                  ? "Development server is starting up. Please wait..."
                  : "Start the preview server to visualize your application live as changes are made."}
              </p>
              {status !== "starting" && (
                <button className="start-server-btn" onClick={start}>
                  Start preview server
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Terminal build logs panel ── */}
        <div className="terminal-panel">
          <div className="term-head">
            <span className="term-label">Interactive Terminal</span>
            <button className="term-clear" onClick={() => setLogs([])}>
              Clear
            </button>
          </div>

          <div className="term-body">
            {logs.length > 0 ? (
              <pre className="term-pre">{logs.join("")}</pre>
            ) : (
              <div className="term-empty">No output logs received yet.</div>
            )}
            {executingCommand && (
              <div className="term-running">
                <span className="term-spin" />
                Running command...
              </div>
            )}
            <div ref={logsEndRef} />
          </div>

          <div className="term-input-row">
            <div className="term-input-inner">
              <span className="term-prompt">$</span>
              <input
                type="text"
                placeholder="Run shell command…"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    runCustomCommand();
                  }
                }}
                disabled={executingCommand}
                className="term-field"
              />
              <button
                onClick={runCustomCommand}
                disabled={executingCommand || !commandInput.trim()}
                className="term-submit"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={13} height={13}>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ── Database sub-tab (live platform-DB stats) ─────────────── */}
      {previewSubTab === 'database' && (
        <div className="subtab-panel">
          <div className="sta-grid">
            {[
              { lbl: 'TABLES', val: dbStats ? String(dbStats.tables) : '…', sub: 'in platform db' },
              { lbl: 'ROWS',   val: dbStats ? String(dbStats.rows)   : '…', sub: 'total records'  },
              { lbl: 'SIZE',   val: dbStats ? `${dbStats.sizeKb}KB`  : '…', sub: 'database size'  },
            ].map((c) => (
              <div key={c.lbl} className="sta-card">
                <div className="sta-lbl">{c.lbl}</div>
                <div className="sta-val">{c.val}</div>
                <div className="sta-sub">{c.sub}</div>
              </div>
            ))}
          </div>
          <div className="subtab-hint">Open Settings → Database to browse tables and run queries.</div>
        </div>
      )}

      {/* ── Server sub-tab (live dev-server info) ─────────────────── */}
      {previewSubTab === 'analytics' && (
        <div className="subtab-panel">
          <div className="sta-grid">
            {[
              { lbl: 'STATUS',    val: status,                        sub: 'dev server'       },
              { lbl: 'URL',       val: url ? url.replace(/^https?:\/\//, '') : '—', sub: 'preview address' },
              { lbl: 'LOG LINES', val: String(logs.length),           sub: 'buffered output'  },
            ].map((c) => (
              <div key={c.lbl} className="sta-card">
                <div className="sta-lbl">{c.lbl}</div>
                <div className="sta-val">{c.val}</div>
                <div className="sta-sub">{c.sub}</div>
              </div>
            ))}
          </div>
          <div className="subtab-hint">Live state of the workspace dev server managed by the platform.</div>
        </div>
      )}

      {/* ── Build status dock footer control ── */}
      <div className="preview-dock">
        <div className="dock-left">
          <button className="dock-btn ghost" onClick={start} disabled={status === "starting" || status === "running"}>
            Start server
          </button>
          <button className="dock-btn ghost" onClick={stop} disabled={status === "stopped"}>
            Stop server
          </button>
          <button
            className="dock-btn deploy"
            onClick={deploy}
            disabled={deploying}
            title="Deploy this workspace to Vercel (needs VERCEL_TOKEN in Settings)"
          >
            {deploying ? "Deploying…" : "▲ Deploy"}
          </button>
        </div>
        <div className="dock-right">
          {deployUrl ? (
            <a href={deployUrl} target="_blank" rel="noreferrer" className="dock-status-text online">
              {deployUrl.replace(/^https:\/\//, "")}
            </a>
          ) : (
            <span className={`dock-status-text ${status === "running" ? "online" : ""}`}>
              {status === "running" && url ? `Running at ${url}` : `Server ${status}`}
            </span>
          )}
        </div>
      </div>

      <style jsx>{`
        .preview-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: var(--bg-base);
        }

        /* ── Toolbar ── */
        .preview-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 10px 14px;
          margin: 16px 20px 0;
        }

        .traffic-dots {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .traffic-dots span {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.12);
        }

        .url-pill {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 7px 12px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-secondary);
        }

        .url-pill svg {
          color: var(--green);
          flex-shrink: 0;
        }

        .toolbar-icon {
          width: 30px;
          height: 30px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .toolbar-icon:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .toolbar-icon:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .toolbar-icon--active {
          background: var(--brand-glow) !important;
          color: var(--brand) !important;
        }

        .inspect-banner {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 5;
          background: rgba(0, 0, 0, 0.75);
          border: 1px solid var(--brand);
          color: var(--text-primary);
          font-size: 11px;
          padding: 5px 12px;
          border-radius: var(--radius-full);
          pointer-events: none;
        }

        .device-toggle {
          display: flex;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
          overflow: hidden;
          flex-shrink: 0;
        }

        .device-toggle .di {
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .device-toggle .di:first-child {
          border-right: 1px solid var(--border-subtle);
        }

        .device-toggle .di:hover {
          color: var(--text-secondary);
        }

        .preview-root {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-base);
        }

        /* ── Toolbar ── */
        .preview-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 8px 12px;
          margin: 12px 16px 0;
          flex-shrink: 0;
        }

        .traffic-dots {
          display: flex;
          gap: 6px;
          flex-shrink: 0;
        }

        .traffic-dots span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--border-strong);
        }

        .url-pill {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 6px 12px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-secondary);
        }

        .url-pill svg {
          color: var(--green);
          flex-shrink: 0;
        }

        .toolbar-icon {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .toolbar-icon:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .toolbar-icon:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }

        .device-toggle {
          display: flex;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
          overflow: hidden;
          flex-shrink: 0;
        }

        .device-toggle .di {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .device-toggle .di:first-child {
          border-right: 1px solid var(--border-subtle);
        }

        .device-toggle .di:hover {
          color: var(--text-secondary);
        }

        .device-toggle .di.active {
          background: var(--brand-glow);
          color: var(--brand);
        }

        /* ── Layout columns (Stacked vertically) ── */
        .preview-layout {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          padding: 12px 16px 12px;
          gap: 12px;
          overflow: hidden;
        }

        .preview-canvas {
          flex: 1;
          min-height: 0;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-subtle);
          background: var(--bg-deep);
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .preview-frame-wrapper {
          width: 100%;
          height: 100%;
          position: relative;
          transition: max-width 0.3s ease;
        }

        .preview-frame-wrapper.tablet {
          max-width: 768px;
          height: 96%;
          border: 8px solid var(--border-strong);
          border-radius: 10px;
          box-shadow: var(--shadow-md);
        }

        .preview-frame-wrapper.mobile {
          max-width: 375px;
          height: 95%;
          border: 8px solid var(--border-strong);
          border-radius: 10px;
          box-shadow: var(--shadow-md);
        }

        .preview-iframe {
          width: 100%;
          height: 100%;
          border: 0;
          background: white;
        }

        /* ── Offline state ── */
        .preview-offline {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          text-align: center;
          padding: 16px;
          max-width: 300px;
          max-height: 100%;
          overflow-y: auto;
        }

        .preview-offline-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          margin-bottom: 14px;
        }

        .preview-offline-title {
          font-family: var(--font-brand);
          font-size: 15px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .preview-offline-desc {
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 16px;
        }

        .start-server-btn {
          background: var(--brand);
          border: none;
          color: #fff;
          font-weight: 500;
          font-size: 12.5px;
          padding: 8px 16px;
          border-radius: var(--radius-md);
          cursor: pointer;
          box-shadow: var(--shadow-sm);
          transition: all var(--transition-fast);
        }

        .start-server-btn:hover {
          filter: brightness(1.15);
        }

        .start-server-btn:active {
          transform: scale(0.97);
        }

        /* ── Terminal Panel (Full width, shorter height) ── */
        .terminal-panel {
          width: 100%;
          height: 160px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          background: var(--bg-deep);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        .term-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .term-label {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
          font-weight: 600;
        }

        .term-clear {
          font-size: 10.5px;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          font-weight: 500;
        }

        .term-clear:hover {
          color: var(--text-secondary);
        }

        .term-body {
          flex: 1;
          padding: 10px 12px;
          font-family: var(--font-mono);
          font-size: 11px;
          line-height: 1.5;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--bg-base);
        }

        .term-pre {
          white-space: pre-wrap;
          color: var(--text-secondary);
        }

        .term-empty {
          color: var(--text-muted);
          font-style: italic;
          font-size: 11px;
        }

        .term-running {
          color: var(--brand);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .term-spin {
          width: 8px;
          height: 8px;
          border: 1.5px solid var(--brand);
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin-term 0.8s linear infinite;
        }

        @keyframes spin-term {
          to { transform: rotate(360deg); }
        }

        .term-input-row {
          padding: 8px 10px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-deep);
        }

        .term-input-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-base);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 4px 8px;
        }

        .term-prompt {
          color: var(--brand);
          font-family: var(--font-mono);
          font-weight: bold;
          font-size: 12px;
        }

        .term-field {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 11px;
          padding: 0;
        }

        .term-field::placeholder {
          color: var(--text-muted);
        }

        .term-submit {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          padding: 2px;
          transition: color var(--transition-fast);
        }

        .term-submit:hover:not(:disabled) {
          color: var(--brand);
        }

        .term-submit:disabled {
          opacity: 0.3;
        }

        /* ── Dock Footer ── */
        .preview-dock {
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          border-top: 1px solid var(--border-subtle);
          margin-top: 8px;
          flex-shrink: 0;
        }

        .dock-left {
          display: flex;
          gap: 6px;
        }

        .dock-btn {
          font-size: 11px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .dock-btn.ghost {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
        }

        .dock-btn.ghost:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .dock-btn.ghost:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .dock-btn.deploy {
          background: var(--brand);
          border: none;
          color: #fffaf7;
          font-weight: 600;
        }

        .dock-btn.deploy:hover:not(:disabled) {
          background: var(--brand-dim);
        }

        .dock-btn.deploy:disabled {
          opacity: 0.5;
          cursor: wait;
        }

        .dock-right {
          display: flex;
          align-items: center;
        }

        .dock-status-text {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .dock-status-text.online {
          color: var(--green);
        }

        /* Preview sub-tab switcher */
        .preview-subtabs {
          display: flex;
          gap: 2px;
          padding: 8px 20px 0;
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .pst {
          padding: 7px 14px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          font-size: 11.5px;
          color: var(--text-muted);
          cursor: pointer;
          transition: all var(--transition-fast);
          font-family: var(--font-sans);
          margin-bottom: -1px;
        }
        .pst:hover { color: var(--text-primary); }
        .pst--active {
          color: var(--brand);
          border-bottom-color: var(--brand);
        }

        /* Sub-tab panels */
        .subtab-panel {
          flex: 1;
          min-height: 0;
          padding: 16px 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .sta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }

        .sta-card {
          background: var(--bg-deep);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 12px 14px;
        }

        .sta-lbl {
          font-size: 8px;
          letter-spacing: 0.07em;
          font-weight: 700;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 4px;
        }

        .sta-val {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-primary);
          font-family: var(--font-brand);
          line-height: 1.1;
          margin-bottom: 3px;
        }

        .sta-sub {
          font-size: 10px;
          color: var(--text-muted);
        }

        .subtab-hint {
          font-size: 11.5px;
          color: var(--text-muted);
          padding: 10px 14px;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          font-style: italic;
        }

        /* ── Autonomous Browser Verification Toast ── */
        .preview-audit-toast {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
          min-width: 320px;
          max-width: 520px;
          padding: 10px 14px;
          border-radius: 10px;
          backdrop-filter: blur(12px);
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(99, 102, 241, 0.2);
          animation: auditSlideDown 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes auditSlideDown {
          from { opacity: 0; transform: translate(-50%, -10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .preview-audit-toast--clean {
          background: rgba(16, 40, 28, 0.95);
          border: 1px solid rgba(52, 211, 153, 0.5);
          color: #a7f3d0;
        }
        .preview-audit-toast--issues_detected {
          background: rgba(45, 20, 20, 0.95);
          border: 1px solid rgba(248, 113, 113, 0.5);
          color: #fecaca;
        }
        .preview-audit-toast--error,
        .preview-audit-toast--offline {
          background: rgba(35, 25, 15, 0.95);
          border: 1px solid rgba(251, 191, 36, 0.5);
          color: #fde68a;
        }
        .audit-spin {
          display: inline-block;
          animation: spinAudit 1s linear infinite;
        }
        @keyframes spinAudit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

    </div>
  );
}
