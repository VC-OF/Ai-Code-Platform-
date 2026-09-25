"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type Status = "stopped" | "starting" | "running" | "error" | "unavailable" | "exited";
type Device = "desktop" | "tablet" | "mobile";

export default function PreviewTab({
  autoStartToken,
  projectId,
}: {
  autoStartToken?: number;
  projectId: string;
}) {
  const [status, setStatus] = useState<Status>("stopped");
  // Why there is nothing to preview (status "unavailable") / why it failed
  const [unavailable, setUnavailable] = useState<{ reason?: string; hint?: string; kind?: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // CLI projects ("Run in Docker") and notes such as "API server — no web UI"
  const [cli, setCli] = useState<{ command: string; exitCode?: number | null } | null>(null);
  const [note, setNote] = useState<string | null>(null);
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
      setUnavailable(
        data.status === "unavailable" ? { reason: data.reason, hint: data.hint, kind: data.kind } : null
      );
      setFailure(data.status === "error" ? data.error || null : null);
      setCli(data.kind === "cli" && data.command ? { command: data.command, exitCode: data.exitCode } : null);
      setNote(data.note || null);
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

  async function runCli() {
    setStatus("running");
    statusRef.current = "running";
    await fetch("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run", projectId }),
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

  const icon = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const auditTone =
    auditResult?.status === "clean"
      ? "success"
      : auditResult?.status === "issues_detected"
        ? "error"
        : "warning";
  const auditHeadline = !auditResult
    ? ""
    : auditResult.status === "clean"
      ? "No errors found on this page"
      : auditResult.status === "issues_detected"
        ? `${auditResult.totalProblems} ${auditResult.totalProblems === 1 ? "problem" : "problems"} found`
        : auditResult.status === "offline"
          ? "Preview is offline"
          : "Check could not finish";
  const auditDetail = !auditResult
    ? ""
    : auditResult.status === "clean"
      ? auditResult.title || ""
      : auditResult.pageErrors?.slice(0, 1).join(" ") ||
        auditResult.consoleErrors?.slice(0, 1).join(" ") ||
        auditResult.error ||
        "";

  const devices: { id: Device; label: string; paths: ReactNode }[] = [
    {
      id: "desktop",
      label: "Desktop view (100%)",
      paths: (
        <>
          <rect x="2" y="4" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 18v3" />
        </>
      ),
    },
    {
      id: "tablet",
      label: "Tablet view (768px)",
      paths: (
        <>
          <rect x="4" y="2" width="16" height="20" rx="2" />
          <path d="M12 18h.01" />
        </>
      ),
    },
    {
      id: "mobile",
      label: "Mobile view (375px)",
      paths: (
        <>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M12 18h.01" />
        </>
      ),
    },
  ];

  return (
    <div className="preview-root">
      <div className="preview-toolbar">
        <div className="url-pill">
          <svg {...icon} width={12} height={12} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
          </svg>
          <span className="url-text">{url || "Server offline"}</span>
        </div>

        <button
          className="toolbar-icon"
          onClick={() => setIframeKey((k) => k + 1)}
          title="Reload preview"
          aria-label="Reload preview"
          disabled={status !== "running"}
        >
          <svg {...icon} width={14} height={14} aria-hidden="true">
            <path d="M21 12a9 9 0 11-2.64-6.36M21 4v5h-5" />
          </svg>
        </button>

        <button
          className={`toolbar-icon ${inspecting ? "toolbar-icon--active" : ""}`}
          onClick={() => setInspecting((v) => !v)}
          title="Inspect: click an element in the preview to edit it via chat"
          aria-label="Inspect element"
          aria-pressed={inspecting}
          disabled={status !== "running"}
        >
          <svg {...icon} width={14} height={14} aria-hidden="true">
            <path d="M4 4l6.5 16 2.2-6.8L19.5 11z" />
          </svg>
        </button>

        <button
          className={`toolbar-icon ${auditing ? "toolbar-icon--active" : ""}`}
          onClick={runBrowserAudit}
          title="Check page for console and runtime errors"
          aria-label="Check page for errors"
          disabled={status !== "running" || auditing}
        >
          {auditing ? (
            <span className="spinner" aria-hidden="true" />
          ) : (
            <svg {...icon} width={14} height={14} aria-hidden="true">
              <path d="M12 21s7-3.5 7-9V5.5L12 3 5 5.5V12c0 5.5 7 9 7 9z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          )}
        </button>

        <button
          className="toolbar-icon"
          onClick={() => url && window.open(url, "_blank")}
          title="Open in new tab"
          aria-label="Open in new tab"
          disabled={status !== "running"}
        >
          <svg {...icon} width={14} height={14} aria-hidden="true">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <path d="M15 3h6v6M10 14L21 3" />
          </svg>
        </button>

        <div className="device-toggle" role="group" aria-label="Viewport size">
          {devices.map((d) => (
            <button
              key={d.id}
              className={`di ${device === d.id ? "active" : ""}`}
              onClick={() => setDevice(d.id)}
              title={d.label}
              aria-label={d.label}
              aria-pressed={device === d.id}
            >
              <svg {...icon} width={13} height={13} aria-hidden="true">
                {d.paths}
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="preview-subtabs" role="tablist">
        {(["browser", "database", "analytics"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={previewSubTab === t}
            className={`pst ${previewSubTab === t ? "pst--active" : ""}`}
            onClick={() => setPreviewSubTab(t)}
          >
            {t === "browser" ? "Browser" : t === "database" ? "Database" : "Server"}
          </button>
        ))}
      </div>

      {previewSubTab === "browser" && (
        <div className="preview-layout">
          <div className="preview-canvas">
            {status === "running" && url && !cli ? (
              <div className={`preview-frame-wrapper ${device}`}>
                {note && <div className="preview-note">{note}</div>}
                {inspecting && (
                  <div className="inspect-banner">
                    Click any element to reference it in chat. Press Esc to cancel.
                  </div>
                )}
                {auditResult && (
                  <div className="audit-toast" role="status">
                    <span className={`audit-dot audit-dot--${auditTone}`} aria-hidden="true" />
                    <div className="audit-body">
                      <div className="audit-title">{auditHeadline}</div>
                      {auditDetail && <div className="audit-detail">{auditDetail}</div>}
                    </div>
                    <button
                      type="button"
                      className="audit-close"
                      onClick={() => setAuditResult(null)}
                      aria-label="Dismiss"
                    >
                      <svg {...icon} width={12} height={12} aria-hidden="true">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
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
                  title="Preview"
                />
              </div>
            ) : (
              <div className="preview-offline">
                <div className="preview-offline-icon">
                  <svg {...icon} width={20} height={20} aria-hidden="true">
                    <rect x="3" y="4" width="18" height="14" rx="2" />
                    <path d="M8 21h8M12 18v3" />
                  </svg>
                </div>
                <h3 className="preview-offline-title">
                  {cli && status === "running"
                    ? "Running in Docker"
                    : cli && status === "exited"
                      ? `Finished with exit code ${cli.exitCode ?? "?"}`
                      : cli && status === "unavailable"
                        ? "This is a command-line program"
                        : status === "starting"
                    ? "Starting preview server"
                    : status === "unavailable"
                      ? unavailable?.kind === "unsupported"
                        ? "This project can't be previewed here"
                        : "Nothing to run yet"
                      : status === "error"
                        ? "Preview failed to start"
                        : "Preview server offline"}
                </h3>
                <p className="preview-offline-desc">
                  {cli && (status === "running" || status === "exited")
                    ? <>Output of <code className="mono">{cli.command}</code> is shown in the terminal below.</>
                    : status === "starting"
                    ? "The development server is starting up. Installing dependencies can take a minute the first time."
                    : status === "unavailable"
                      ? unavailable?.reason || "There's no app in this project yet."
                      : status === "error"
                        ? "The dev server exited with an error. The last lines of its output are below."
                        : "Start the preview server to see your app update live as changes are made."}
                </p>
                {status === "unavailable" && unavailable?.hint && (
                  <p className="preview-offline-hint">{unavailable.hint}</p>
                )}
                {status === "error" && failure && (
                  <pre className="preview-offline-error mono">{failure}</pre>
                )}
                {cli && status !== "running" && (
                  <button className="start-server-btn" onClick={runCli}>
                    {status === "exited" ? "Run again" : "Run in Docker"}
                  </button>
                )}
                {cli && status === "running" && (
                  <button className="check-again-btn" onClick={stop}>
                    Stop
                  </button>
                )}
                {status !== "starting" && !(cli && status !== "unavailable") && (
                  <button
                    className={status === "unavailable" ? "check-again-btn" : "start-server-btn"}
                    onClick={start}
                  >
                    {status === "unavailable"
                      ? "Check again"
                      : status === "error"
                        ? "Try again"
                        : "Start preview server"}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="terminal-panel">
            <div className="term-head">
              <span className="term-label">Terminal</span>
              <button className="term-clear" onClick={() => setLogs([])}>
                Clear
              </button>
            </div>

            <div className="term-body">
              {logs.length > 0 ? (
                <pre className="term-pre">{logs.join("")}</pre>
              ) : (
                <div className="term-empty">No output yet.</div>
              )}
              {executingCommand && (
                <div className="term-running">
                  <span className="spinner" aria-hidden="true" />
                  Running command…
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
                  aria-label="Shell command"
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
                  aria-label="Run command"
                >
                  <svg {...icon} width={13} height={13} aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewSubTab === "database" && (
        <div className="subtab-panel">
          <div className="sta-grid">
            {[
              { lbl: "Tables", val: dbStats ? String(dbStats.tables) : "…", sub: "In platform database" },
              { lbl: "Rows", val: dbStats ? String(dbStats.rows) : "…", sub: "Total records" },
              { lbl: "Size", val: dbStats ? `${dbStats.sizeKb} KB` : "…", sub: "Database size" },
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

      {previewSubTab === "analytics" && (
        <div className="subtab-panel">
          <div className="sta-grid">
            {[
              { lbl: "Status", val: status, sub: "Dev server", mono: false },
              { lbl: "URL", val: url ? url.replace(/^https?:\/\//, "") : "—", sub: "Preview address", mono: true },
              { lbl: "Log lines", val: String(logs.length), sub: "Buffered output", mono: false },
            ].map((c) => (
              <div key={c.lbl} className="sta-card">
                <div className="sta-lbl">{c.lbl}</div>
                <div className={`sta-val ${c.mono ? "sta-val--mono" : ""}`}>{c.val}</div>
                <div className="sta-sub">{c.sub}</div>
              </div>
            ))}
          </div>
          <div className="subtab-hint">Live state of the workspace dev server managed by the platform.</div>
        </div>
      )}

      <div className="preview-dock">
        <div className="dock-left">
          <button className="dock-btn" onClick={start} disabled={status === "starting" || status === "running"}>
            Start server
          </button>
          <button className="dock-btn" onClick={stop} disabled={status === "stopped"}>
            Stop server
          </button>
          <button
            className="dock-btn"
            onClick={deploy}
            disabled={deploying}
            title="Deploy this workspace to Vercel (needs VERCEL_TOKEN in Settings)"
          >
            <svg {...icon} width={12} height={12} aria-hidden="true">
              <path d="M12 4l9 16H3z" />
            </svg>
            {deploying ? "Deploying…" : "Deploy"}
          </button>
        </div>
        <div className="dock-right">
          <span
            className={`dock-dot ${status === "running" ? "dock-dot--on" : status === "error" ? "dock-dot--err" : ""}`}
            aria-hidden="true"
          />
          {deployUrl ? (
            <a href={deployUrl} target="_blank" rel="noreferrer" className="dock-status-text mono">
              {deployUrl.replace(/^https:\/\//, "")}
            </a>
          ) : (
            <span className="dock-status-text">
              {status === "running" && url ? (
                <>
                  Running at <span className="mono">{url}</span>
                </>
              ) : (
                status === "unavailable" ? "Nothing to run" : `Server ${status}`
              )}
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
          font-family: var(--font-sans);
          font-size: 13px;
          color: var(--text-primary);
        }
        button:focus-visible,
        a:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }
        .mono {
          font-family: var(--font-mono);
        }

        /* Toolbar */
        .preview-toolbar {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .url-pill {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          margin-right: 4px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 5px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-secondary);
        }
        .url-pill svg {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .url-text {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .toolbar-icon {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-md);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary);
          background: transparent;
          border: 1px solid transparent;
          cursor: pointer;
          flex-shrink: 0;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .toolbar-icon:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .toolbar-icon:disabled {
          color: var(--text-disabled);
          cursor: not-allowed;
        }
        .toolbar-icon.toolbar-icon--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .device-toggle {
          display: flex;
          margin-left: 4px;
          padding: 2px;
          gap: 2px;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-elevated);
          flex-shrink: 0;
        }
        .di {
          width: 24px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .di:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .di.active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        /* Sub-tabs */
        .preview-subtabs {
          display: flex;
          gap: 4px;
          padding: 0 12px;
          border-bottom: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .pst {
          padding: 8px;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--text-muted);
          cursor: pointer;
          margin-bottom: -1px;
          transition: color var(--transition-fast), border-color var(--transition-fast);
        }
        .pst:hover {
          color: var(--text-primary);
        }
        .pst.pst--active {
          color: var(--text-primary);
          border-bottom-color: var(--accent);
        }

        /* Layout */
        .preview-layout {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-height: 0;
          padding: 12px;
          gap: 12px;
          overflow: hidden;
        }
        .preview-canvas {
          flex: 1;
          min-height: 0;
          border-radius: var(--radius-md);
          border: 1px solid var(--border-subtle);
          background: var(--bg-surface);
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
          transition: max-width 0.2s ease;
        }
        .preview-frame-wrapper.tablet,
        .preview-frame-wrapper.mobile {
          height: 96%;
          border: 1px solid var(--border-strong);
          border-radius: var(--radius-md);
          overflow: hidden;
        }
        .preview-frame-wrapper.tablet {
          max-width: 768px;
        }
        .preview-frame-wrapper.mobile {
          max-width: 375px;
        }
        .preview-iframe {
          width: 100%;
          height: 100%;
          border: 0;
          background: var(--bg-base);
          display: block;
        }
        .inspect-banner {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 5;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
          font-size: 12px;
          padding: 5px 12px;
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          pointer-events: none;
          white-space: nowrap;
        }

        /* Audit toast */
        .audit-toast {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 100;
          display: flex;
          align-items: flex-start;
          gap: 10px;
          min-width: 280px;
          max-width: 520px;
          padding: 10px 10px 10px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          animation: auditIn 0.15s ease-out;
        }
        @keyframes auditIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .audit-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          margin-top: 5px;
          flex-shrink: 0;
        }
        .audit-dot--success {
          background: var(--success);
        }
        .audit-dot--error {
          background: var(--error);
        }
        .audit-dot--warning {
          background: var(--warning);
        }
        .audit-body {
          flex: 1;
          min-width: 0;
        }
        .audit-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
        }
        .audit-detail {
          margin-top: 2px;
          font-size: 12px;
          color: var(--text-secondary);
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          word-break: break-word;
        }
        .audit-close {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          cursor: pointer;
          flex-shrink: 0;
        }
        .audit-close:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        /* Offline */
        .preview-offline {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          text-align: center;
          padding: 16px;
          max-width: 320px;
          max-height: 100%;
          overflow-y: auto;
        }
        .preview-offline-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          margin-bottom: 12px;
        }
        .preview-offline-title {
          font-family: var(--font-sans);
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          margin: 0 0 4px;
        }
        .preview-offline-desc {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
          margin: 0 0 14px;
        }
        .start-server-btn {
          background: var(--accent);
          border: 1px solid var(--accent);
          color: var(--text-on-accent);
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 12px;
          padding: 6px 12px;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .preview-offline:has(.preview-offline-error) {
          max-width: 560px;
        }
        .preview-note {
          padding: 6px 10px;
          font-size: 12px;
          color: var(--text-secondary);
          background: var(--bg-elevated);
          border-bottom: 1px solid var(--border-subtle);
        }
        .preview-offline-hint {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.5;
          margin: -6px 0 14px;
          padding: 8px 10px;
          border-radius: var(--radius-md);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          text-align: left;
        }
        .preview-offline-error {
          width: 100%;
          max-height: 180px;
          overflow: auto;
          margin: -6px 0 14px;
          padding: 8px 10px;
          font-size: 11px;
          line-height: 1.45;
          text-align: left;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--text-primary);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-left: 2px solid var(--error);
          border-radius: var(--radius-md);
        }
        .check-again-btn {
          background: transparent;
          border: 1px solid var(--border-subtle);
          color: var(--text-primary);
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 12px;
          padding: 6px 12px;
          border-radius: var(--radius-md);
          cursor: pointer;
        }
        .check-again-btn:hover {
          background: var(--bg-elevated);
        }
        .start-server-btn:hover {
          background: var(--accent-dim);
          border-color: var(--accent-dim);
        }

        /* Terminal */
        .terminal-panel {
          width: 100%;
          height: 160px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          overflow: hidden;
        }
        .term-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .term-label {
          font-size: 12px;
          color: var(--text-secondary);
          font-weight: 500;
        }
        .term-clear {
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--text-muted);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          padding: 2px 6px;
          cursor: pointer;
        }
        .term-clear:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }
        .term-body {
          flex: 1;
          padding: 8px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
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
          margin: 0;
          font-family: var(--font-mono);
        }
        .term-empty {
          color: var(--text-muted);
        }
        .term-running {
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .term-input-row {
          padding: 6px 8px;
          border-top: 1px solid var(--border-subtle);
        }
        .term-input-inner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 3px 4px 3px 8px;
        }
        .term-input-inner:focus-within {
          outline: 2px solid var(--accent);
          outline-offset: -1px;
        }
        .term-prompt {
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .term-field {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 12px;
          padding: 0;
        }
        .term-field::placeholder {
          color: var(--text-muted);
        }
        .term-submit {
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .term-submit:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .term-submit:disabled {
          color: var(--text-disabled);
          cursor: not-allowed;
        }
        .spinner {
          display: inline-block;
          width: 10px;
          height: 10px;
          border: 1.5px solid var(--border-strong);
          border-top-color: var(--text-secondary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        /* Dock */
        .preview-dock {
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 0 12px;
          border-top: 1px solid var(--border-subtle);
          background: var(--bg-surface);
          flex-shrink: 0;
        }
        .dock-left {
          display: flex;
          gap: 6px;
        }
        .dock-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: var(--radius-md);
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .dock-btn:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .dock-btn:disabled {
          color: var(--text-disabled);
          cursor: not-allowed;
        }
        .dock-right {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }
        .dock-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-disabled);
          flex-shrink: 0;
        }
        .dock-dot--on {
          background: var(--success);
        }
        .dock-dot--err {
          background: var(--error);
        }
        .dock-status-text {
          font-size: 12px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        a.dock-status-text {
          color: var(--text-secondary);
          text-decoration: none;
        }
        a.dock-status-text:hover {
          color: var(--text-primary);
          text-decoration: underline;
        }

        /* Sub-tab panels */
        .subtab-panel {
          flex: 1;
          min-height: 0;
          padding: 12px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }
        .sta-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 10px 12px;
          min-width: 0;
        }
        .sta-lbl {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 4px;
        }
        .sta-val {
          font-size: 18px;
          font-weight: 500;
          color: var(--text-primary);
          line-height: 1.2;
          margin-bottom: 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sta-val--mono {
          font-family: var(--font-mono);
          font-size: 13px;
          line-height: 1.7;
        }
        .sta-sub {
          font-size: 12px;
          color: var(--text-muted);
        }
        .subtab-hint {
          font-size: 12px;
          color: var(--text-muted);
          padding: 8px 12px;
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        @media (prefers-reduced-motion: reduce) {
          .audit-toast,
          .spinner {
            animation: none;
          }
          .preview-frame-wrapper,
          .toolbar-icon,
          .di,
          .pst,
          .dock-btn,
          .term-submit,
          .start-server-btn {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
