"use client";

import { useEffect, useState } from "react";

export default function SettingsTab({ projectId }: { projectId: string }) {
  const [vars, setVars] = useState<
    { key: string; value: string; scope?: "project" | "global" }[]
  >([]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  // Database states
  const [tables, setTables] = useState<{ name: string; data: Record<string, unknown>[] }[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [loadingDb, setLoadingDb] = useState(false);

  async function refresh() {
    const res = await fetch(
      `/api/settings?projectId=${encodeURIComponent(projectId)}`
    );
    const data = await res.json();
    setVars(data.vars || []);
  }

  async function refreshDb() {
    setLoadingDb(true);
    try {
      const res = await fetch(
        `/api/database?projectId=${encodeURIComponent(projectId)}`
      );
      const data = await res.json();
      const loadedTables = data.tables || [];
      setTables(loadedTables);
      if (loadedTables.length > 0) {
        setActiveTable((current) =>
          loadedTables.some((t: { name: string }) => t.name === current)
            ? current
            : loadedTables[0].name
        );
      } else {
        setActiveTable(null);
      }
    } finally {
      setLoadingDb(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line
    refresh();
    refreshDb();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function add() {
    if (!newKey.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: newKey.trim(), value: newValue, projectId }),
      });
      setNewKey("");
      setNewValue("");
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(key: string) {
    await fetch("/api/settings", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, projectId }),
    });
    refresh();
  }

  const [activeView, setActiveView] = useState<"secrets" | "database" | "memory" | "history" | "providers">("secrets");

  // AI provider status
  interface ProviderStatus {
    id: string; label: string; kind: "cloud" | "local"; baseURL: string;
    keyEnv: string | null; prefix: string | null; available: boolean; models?: string[];
  }
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [providerUsage, setProviderUsage] = useState<
    { model: string; calls: number; total_tokens: number; cost_usd: number }[]
  >([]);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [mcpServers, setMcpServers] = useState<
    { server: string; connected: boolean; tools: string[]; error?: string }[]
  >([]);
  const [mcpConfigPath, setMcpConfigPath] = useState(".platform/mcp.json");

  async function loadProviders() {
    setLoadingProviders(true);
    try {
      const res = await fetch("/api/providers");
      const data = await res.json();
      setProviders(data.providers || []);
      setProviderUsage(data.usageByModel || []);
      setFallbacks(data.fallbacks || []);
      const mcp = await fetch("/api/mcp").then((r) => r.json()).catch(() => null);
      setMcpServers(mcp?.servers || []);
      if (mcp?.configPath) setMcpConfigPath(mcp.configPath);
    } finally {
      setLoadingProviders(false);
    }
  }

  useEffect(() => {
    // Fetch-on-view-change: the loading flag is intentionally set synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeView === "providers") loadProviders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView]);

  // Git checkpoints
  const [checkpoints, setCheckpoints] = useState<{ sha: string; timestamp: number; message: string }[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(false);
  const [revertingCheckpoints, setRevertingCheckpoints] = useState<string | null>(null);

  async function loadCheckpoints() {
    setLoadingCheckpoints(true);
    try {
      const res = await fetch(`/api/git/checkpoints?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setCheckpoints(data.checkpoints || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingCheckpoints(false);
    }
  }

  async function revertProject(sha: string) {
    if (!window.confirm("Are you sure you want to revert the ENTIRE project workspace to this checkpoint? All modifications made after this turn will be permanently overwritten."))
      return;
    setRevertingCheckpoints(sha);
    try {
      const res = await fetch("/api/git/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha, projectId }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // Chat panel reloads its (now-truncated) history
        window.dispatchEvent(new CustomEvent("oc-history-rewound"));
        window.alert(
          `Project reverted.${
            data.messagesRewound ? ` ${data.messagesRewound} newer chat messages were rewound too.` : ""
          }`
        );
        loadCheckpoints();
      }
    } catch (err) {
      window.alert("Error reverting project: " + String(err));
    } finally {
      setRevertingCheckpoints(null);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line
    if (activeView === "history") loadCheckpoints();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, projectId]);

  // AGENTS.md project memory
  const [agentsMd, setAgentsMd] = useState("");
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);

  async function loadAgentsMd() {
    try {
      const res = await fetch(`/api/files?path=AGENTS.md&projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setAgentsMd(data.content ?? "");
    } catch {
      setAgentsMd("");
    }
  }

  async function saveAgentsMd() {
    setSavingMemory(true);
    try {
      await fetch("/api/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "AGENTS.md", content: agentsMd, projectId }),
      });
      setMemorySaved(true);
      setTimeout(() => setMemorySaved(false), 2000);
    } finally {
      setSavingMemory(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line
    if (activeView === "memory") loadAgentsMd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, projectId]);

  const navItems = [
    {
      id: "secrets" as const,
      label: "Secrets",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
        </svg>
      ),
    },
    {
      id: "database" as const,
      label: "Database",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
        </svg>
      ),
    },
    {
      id: "memory" as const,
      label: "Project Memory",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
        </svg>
      ),
    },
    {
      id: "history" as const,
      label: "Checkpoints",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
      ),
    },
    {
      id: "providers" as const,
      label: "AI Providers",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={15} height={15}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12a7 7 0 1114 0 7 7 0 01-14 0zm7-9v2m0 14v2m9-9h-2M5 12H3m13.66-6.66l-1.42 1.42M8.76 15.24l-1.42 1.42m0-9.32l1.42 1.42m6.48 6.48l1.42 1.42"/>
        </svg>
      ),
    },
  ];



  return (
    <div className="settings-root">
      {/* ── Left sub-nav ─────────────────────────────────────────────── */}
      <div className="settings-subnav">
        <div className="sn-label">Settings</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`sn-item ${activeView === item.id ? "sn-item--active" : ""}`}
            onClick={() => setActiveView(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {/* ── Right panel ──────────────────────────────────────────────── */}
      <div className="settings-panel">

        {/* ── Secrets ────────────────────────────────────────────── */}
        {activeView === "secrets" && (
          <>
            <div className="panel-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              <div className="panel-head-title">Sandbox Environment Variables</div>
            </div>
            <p className="panel-desc">
              Values are encrypted at rest and masked in the browser. They are injected into the workspace sandbox automatically during builds, commands, and previews.
            </p>

            <div className="eyebrow">Configured Variables</div>

            {vars.length === 0 ? (
              <div className="empty-well">No custom environment variables defined yet.</div>
            ) : (
              <div className="var-list">
                {vars.map((v) => (
                  <div key={`${v.scope}-${v.key}`} className="var-row">
                    <div className="var-row-left">
                      <span className="var-key">{v.key}</span>
                      {v.scope === "global" && (
                        <span
                          className="var-key"
                          style={{ opacity: 0.5, fontSize: "9px" }}
                          title="Defined globally — shared by all projects"
                        >
                          global
                        </span>
                      )}
                      <span className="var-val">{"•".repeat(Math.min(v.value.length, 18))}</span>
                    </div>
                    <button className="mini-btn mini-btn--danger" onClick={() => remove(v.key)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="add-var-card">
              <div className="add-var-title">Add variable</div>
              <div className="add-var-sub">Key and value are stored encrypted server-side.</div>
              <div className="add-var-fields">
                <input
                  className="field-input"
                  placeholder="KEY_NAME"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                />
                <input
                  className="field-input"
                  placeholder="value"
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && add()}
                />
              </div>
              <button className="add-btn" onClick={add} disabled={saving || !newKey.trim()}>
                {saving ? "Saving…" : "Add variable"}
              </button>
            </div>
          </>
        )}

        {/* ── Database ───────────────────────────────────────────── */}
        {activeView === "database" && (
          <>
            <div className="panel-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
              </svg>
              <div className="panel-head-title">Database Inspector</div>
            </div>
            <p className="panel-desc">Browse the SQLite database created by the agent inside your project sandbox.</p>

            <div className="db-status-card">
              <div className="db-status-left">
                <div className="db-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/>
                  </svg>
                </div>
                <div>
                  <div className="db-status-name">SQLite — project.db</div>
                  <div className="db-status-sub">{tables.length} table{tables.length !== 1 ? "s" : ""} found</div>
                </div>
              </div>
              <button className="mini-btn mini-btn--default" onClick={refreshDb}>
                {loadingDb ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {tables.length > 0 && (
              <div className="db-layout">
                {/* Table list sidebar */}
                <div className="table-subnav">
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Tables</div>
                  {tables.map((t) => (
                    <button
                      key={t.name}
                      className={`table-nav-item ${activeTable === t.name ? "table-nav-item--active" : ""}`}
                      onClick={() => setActiveTable(t.name)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M3 9h18M9 21V9"/>
                      </svg>
                      {t.name}
                      <span className="table-row-count">
                        {tables.find(tb => tb.name === t.name)?.data.length ?? 0}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Data table */}
                <div className="table-data">
                  {activeTable && (() => {
                    const tableData = tables.find((t) => t.name === activeTable)?.data || [];
                    if (tableData.length === 0) {
                      return <div className="empty-well">Table is empty</div>;
                    }
                    const keys = Object.keys(tableData[0]);
                    return (
                      <div className="data-table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              {keys.map((k) => <th key={k}>{k}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {tableData.map((row, _i) => (
                              <tr key={_i}>
                                {keys.map((k) => (
                                  <td key={k} title={row[k] !== undefined && row[k] !== null ? String(row[k]) : ""}>
                                    {row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : String(row[k] ?? "")}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {tables.length === 0 && !loadingDb && (
              <div className="empty-well">No database found. The agent will create one when it runs database operations.</div>
            )}
          </>
        )}

        {/* ── Memory ─────────────────────────────────────────────── */}
        {activeView === "memory" && (
          <>
            <div className="panel-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              <div className="panel-head-title">Project Memory</div>
            </div>
            <p className="panel-desc">
              This file (<code>AGENTS.md</code>) is automatically injected into every AI prompt for this project. Use it to teach the agent your project&apos;s conventions, preferred commands, and constraints.
            </p>

            <div className="memory-hint-row">
              <div className="memory-card">
                <div className="memory-tag">Convention</div>
                <div className="memory-text">Package manager, test command, lint rules</div>
              </div>
              <div className="memory-card">
                <div className="memory-tag">Constraints</div>
                <div className="memory-text">Files to never edit, runtime restrictions</div>
              </div>
              <div className="memory-card">
                <div className="memory-tag">Context</div>
                <div className="memory-text">Architecture notes, preferred patterns</div>
              </div>
            </div>

            <div className="eyebrow">AGENTS.md content</div>
            <textarea
              className="memory-textarea"
              value={agentsMd}
              onChange={(e) => setAgentsMd(e.target.value)}
              rows={18}
              placeholder={`# Project conventions\n# (Injected into every AI turn for this project)\n\n- Package manager: npm\n- Test command: npm test\n- Lint: npm run lint\n- Never edit files under /generated\n- API routes must use nodejs runtime (not edge)`}
            />

            <div className="save-row">
              <button className="add-btn" onClick={saveAgentsMd} disabled={savingMemory}>
                {savingMemory ? "Saving…" : "Save memory"}
              </button>
              {memorySaved && (
                <span className="saved-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={13} height={13}>
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Saved
                </span>
              )}
            </div>
          </>
        )}

        {/* ── History ────────────────────────────────────────────── */}
        {activeView === "history" && (
          <>
            <div className="panel-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <div className="panel-head-title">Project Checkpoints</div>
            </div>
            <p className="panel-desc">
              Every agent turn is checkpointed automatically. You can hard-revert the entire workspace back to any snapshot.
            </p>

            {loadingCheckpoints ? (
              <div className="empty-well">Loading checkpoints…</div>
            ) : checkpoints.length === 0 ? (
              <div className="empty-well">No checkpoints found. Start chatting with the agent to create checkpoints.</div>
            ) : (
              <div className="timeline">
                {checkpoints.map((c) => (
                  <div key={c.sha} className="cp-item">
                    <div className="cp-dot" />
                    <div className="cp-card">
                      <div className="cp-left">
                        <div className="cp-msg">{c.message}</div>
                        <div className="cp-meta">
                          <span className="cp-hash">{c.sha.slice(0, 7)}</span>
                          <span>·</span>
                          <span>{new Date(c.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                      <button
                        className="mini-btn mini-btn--danger"
                        disabled={revertingCheckpoints !== null}
                        onClick={() => revertProject(c.sha)}
                      >
                        {revertingCheckpoints === c.sha ? "Reverting…" : "Revert workspace"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── AI Providers ─────────────────────────────────────────── */}
        {activeView === "providers" && (
          <>
            <div className="panel-head">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={18} height={18}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 12a7 7 0 1114 0 7 7 0 01-14 0z"/>
              </svg>
              <div className="panel-head-title">AI Providers</div>
              <button className="mini-btn" style={{ marginLeft: "auto" }} onClick={loadProviders}>
                Refresh
              </button>
            </div>
            <p className="panel-desc">
              Every provider speaks the OpenAI-compatible protocol. Cloud keys go in
              Secrets (global scope) using the env name shown; prefixed models
              (e.g. <code>openrouter:meta-llama/llama-3.3-70b-instruct</code>) route
              explicitly. Local providers are detected automatically.
            </p>

            {loadingProviders ? (
              <div className="empty-well">Checking providers…</div>
            ) : (
              <div className="provider-list">
                {providers.map((p) => (
                  <div key={p.id} className="provider-row">
                    <span className={`provider-dot ${p.available ? "provider-dot--up" : ""}`} />
                    <div className="provider-info">
                      <div className="provider-name">
                        {p.label}
                        <span className="provider-kind">{p.kind}</span>
                        {p.prefix && <code className="provider-prefix">{p.prefix}:</code>}
                      </div>
                      <div className="provider-detail">
                        {p.kind === "cloud"
                          ? p.available
                            ? `Configured (${p.keyEnv})`
                            : `Not configured — add ${p.keyEnv} in Secrets`
                          : p.available
                            ? `Running at ${p.baseURL}${p.models?.length ? ` — ${p.models.length} models` : ""}`
                            : `Not detected at ${p.baseURL}`}
                      </div>
                      {p.models && p.models.length > 0 && (
                        <div className="provider-models">
                          {p.models.slice(0, 8).map((m) => <code key={m}>{m}</code>)}
                          {p.models.length > 8 && <span>+{p.models.length - 8} more</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="eyebrow" style={{ marginTop: 20 }}>Fallback chain</div>
            <p className="panel-desc">
              {fallbacks.length > 0
                ? <>When the selected model fails, these are tried in order: {fallbacks.map((f) => <code key={f} style={{ marginRight: 6 }}>{f}</code>)}</>
                : <>None configured. Set <code>LLM_FALLBACKS</code> in .env.local, e.g. <code>LLM_FALLBACKS=openrouter:meta-llama/llama-3.3-70b-instruct,llama3.1:latest</code></>}
            </p>

            <div className="eyebrow" style={{ marginTop: 20 }}>MCP servers</div>
            {mcpServers.length === 0 ? (
              <p className="panel-desc">
                None configured. Add servers in <code>{mcpConfigPath}</code>:
                {' '}<code>{'{"servers":{"name":{"command":"npx","args":["-y","@some/mcp-server"]}}}'}</code>
                {' '}— their tools become available to the agent as <code>mcp_name_*</code>.
              </p>
            ) : (
              <div className="provider-list">
                {mcpServers.map((s) => (
                  <div key={s.server} className="provider-row">
                    <span className={`provider-dot ${s.connected ? "provider-dot--up" : ""}`} />
                    <div className="provider-info">
                      <div className="provider-name">
                        {s.server}
                        <span className="provider-kind">mcp</span>
                      </div>
                      <div className="provider-detail">
                        {s.connected
                          ? `Connected — ${s.tools.length} tool(s)`
                          : `Unavailable: ${s.error ?? "unknown error"}`}
                      </div>
                      {s.tools.length > 0 && (
                        <div className="provider-models">
                          {s.tools.slice(0, 8).map((t) => <code key={t}>{t}</code>)}
                          {s.tools.length > 8 && <span>+{s.tools.length - 8} more</span>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {providerUsage.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 12 }}>Usage by model (all projects)</div>
                <div className="provider-list">
                  {providerUsage.map((u) => (
                    <div key={u.model} className="provider-row">
                      <div className="provider-info">
                        <div className="provider-name"><code>{u.model}</code></div>
                        <div className="provider-detail">
                          {u.calls} calls · {(u.total_tokens ?? 0).toLocaleString()} tokens · ${Number(u.cost_usd ?? 0).toFixed(4)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .provider-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .provider-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
        }

        .provider-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-disabled);
          margin-top: 5px;
          flex-shrink: 0;
        }

        .provider-dot--up {
          background: var(--success);
          box-shadow: 0 0 6px var(--success);
        }

        .provider-info { flex: 1; min-width: 0; }

        .provider-name {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .provider-kind {
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          padding: 1px 6px;
          border-radius: var(--radius-full);
        }

        .provider-prefix {
          font-size: 10px;
          color: var(--brand);
        }

        .provider-detail {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .provider-models {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 6px;
          font-size: 10px;
          color: var(--text-secondary);
        }

        .provider-models code {
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-subtle);
          padding: 1px 6px;
          border-radius: 4px;
        }
`}} />
      <style dangerouslySetInnerHTML={{ __html: `
        .settings-root {
          display: flex;
          height: 100%;
          background: var(--bg-base);
          color: var(--text-primary);
        }

        /* ── Sub-nav ──────────────────────────────────────────────── */
        .settings-subnav {
          /* The middle column can be narrow (chat + explorer flank it) —
             the sub-nav must shrink instead of crushing the content panel */
          width: 180px;
          min-width: 52px;
          flex-shrink: 1;
          border-right: 1px solid var(--border-subtle);
          padding: 20px 10px;
          display: flex;
          flex-direction: column;
          background: rgba(255,255,255,0.012);
          overflow-y: auto;
          overflow-x: hidden;
        }

        .sn-label {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: var(--text-muted);
          font-weight: 600;
          padding: 0 8px 12px;
        }

        .sn-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-secondary);
          padding: 9px 10px;
          border-radius: 8px;
          cursor: pointer;
          border: none;
          background: none;
          text-align: left;
          width: 100%;
          margin-bottom: 2px;
          transition: background var(--transition-fast), color var(--transition-fast);
        }

        .sn-item:hover {
          background: rgba(255,255,255,0.03);
          color: var(--text-primary);
        }

        .sn-item--active {
          background: var(--violet-soft);
          color: #cfc9ff;
        }

        /* ── Panel ────────────────────────────────────────────────── */
        .settings-panel {
          flex: 1 1 0;
          min-width: 220px;
          padding: 26px 24px;
          overflow-y: auto;
          max-width: 760px;
        }

        .panel-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 6px;
          color: var(--text-secondary);
        }

        .panel-head-title {
          font-family: var(--font-brand);
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .panel-desc {
          font-size: 12.5px;
          color: var(--text-secondary);
          line-height: 1.65;
          max-width: 560px;
          margin-bottom: 22px;
        }

        .panel-desc code {
          font-family: var(--font-mono);
          font-size: 11.5px;
          background: rgba(255,255,255,0.06);
          border-radius: 4px;
          padding: 1px 5px;
        }

        .eyebrow {
          font-size: 10.5px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          font-weight: 600;
          margin-bottom: 10px;
        }

        .empty-well {
          border: 1px dashed var(--border-base);
          border-radius: 10px;
          padding: 20px;
          text-align: center;
          font-size: 12.5px;
          color: var(--text-muted);
          font-style: italic;
          margin-bottom: 22px;
        }

        /* ── Secrets ──────────────────────────────────────────────── */
        .var-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 20px;
        }

        .var-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--panel);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 11px 14px;
          transition: border-color var(--transition-fast);
        }

        .var-row:hover {
          border-color: var(--border-base);
        }

        .var-row-left {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .var-key {
          font-family: var(--font-mono);
          font-size: 12.5px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .var-val {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.06em;
        }

        .add-var-card {
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 18px 20px;
          margin-top: 4px;
        }

        .add-var-title {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 3px;
        }

        .add-var-sub {
          font-size: 11.5px;
          color: var(--text-muted);
          margin-bottom: 14px;
        }

        .add-var-fields {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }

        .field-input {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border-subtle);
          border-radius: 9px;
          padding: 10px 12px;
          font-size: 13px;
          font-family: var(--font-mono);
          color: var(--text-primary);
          outline: none;
          transition: border-color var(--transition-fast);
          width: 100%;
        }

        .field-input:focus {
          border-color: rgba(124,108,246,0.4);
        }

        .field-input::placeholder {
          color: var(--text-muted);
        }

        .add-btn {
          background: rgba(255,255,255,0.05);
          border: 1px solid var(--border-base);
          color: var(--text-primary);
          font-weight: 600;
          font-size: 13px;
          padding: 10px 18px;
          border-radius: 9px;
          cursor: pointer;
          transition: all var(--transition-fast);
          width: 100%;
        }

        .add-btn:hover:not(:disabled) {
          background: rgba(255,255,255,0.07);
          border-color: rgba(124,108,246,0.4);
        }

        .add-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        /* ── Buttons ──────────────────────────────────────────────── */
        .mini-btn {
          font-size: 11px;
          font-weight: 600;
          padding: 6px 12px;
          border-radius: 7px;
          cursor: pointer;
          border: 1px solid var(--border-subtle);
          background: transparent;
          color: var(--text-secondary);
          flex-shrink: 0;
          transition: all var(--transition-fast);
        }

        .mini-btn:hover { background: rgba(255,255,255,0.04); }

        .mini-btn--danger {
          color: var(--coral);
          border-color: rgba(242,104,92,0.3);
        }

        .mini-btn--danger:hover {
          background: rgba(242,104,92,0.08);
        }

        .mini-btn--default {
          color: var(--text-secondary);
        }

        /* ── Database ─────────────────────────────────────────────── */
        .db-status-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 14px 18px;
          margin-bottom: 20px;
        }

        .db-status-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .db-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          background: var(--cyan-soft);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--cyan);
          flex-shrink: 0;
        }

        .db-status-name {
          font-size: 13.5px;
          font-weight: 600;
          color: var(--text-primary);
          font-family: var(--font-mono);
          margin-bottom: 2px;
        }

        .db-status-sub {
          font-size: 11.5px;
          color: var(--text-muted);
        }

        .db-layout {
          display: flex;
          gap: 16px;
          height: 360px;
        }

        .table-subnav {
          width: 160px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
        }

        .table-nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12.5px;
          font-family: var(--font-mono);
          color: var(--text-secondary);
          padding: 8px 10px;
          border-radius: 7px;
          cursor: pointer;
          background: transparent;
          border: none;
          text-align: left;
          width: 100%;
          transition: background var(--transition-fast);
        }

        .table-nav-item:hover { background: rgba(255,255,255,0.04); }

        .table-nav-item--active {
          background: var(--violet-soft);
          color: #cfc9ff;
        }

        .table-row-count {
          margin-left: auto;
          font-size: 10px;
          color: var(--text-muted);
          background: rgba(255,255,255,0.05);
          border-radius: 4px;
          padding: 1px 6px;
        }

        .table-data {
          flex: 1;
          min-width: 0;
          overflow: auto;
          border-radius: 10px;
          border: 1px solid var(--border-subtle);
        }

        .data-table-wrap {
          overflow: auto;
          height: 100%;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--font-mono);
          font-size: 12px;
        }

        .data-table thead tr {
          background: rgba(255,255,255,0.03);
          border-bottom: 1px solid var(--border-subtle);
        }

        .data-table th {
          padding: 10px 14px;
          color: var(--text-primary);
          font-weight: 600;
          text-align: left;
          white-space: nowrap;
        }

        .data-table td {
          padding: 10px 14px;
          color: var(--text-secondary);
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          border-bottom: 1px solid var(--border-subtle);
        }

        .data-table tbody tr:hover { background: rgba(255,255,255,0.02); }
        .data-table tbody tr:last-child td { border-bottom: none; }

        /* ── Memory ───────────────────────────────────────────────── */
        .memory-hint-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-bottom: 20px;
        }

        .memory-card {
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 14px 16px;
        }

        .memory-tag {
          font-size: 10.5px;
          font-weight: 600;
          color: var(--violet);
          background: var(--violet-soft);
          border-radius: 6px;
          padding: 2px 8px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          display: inline-block;
          margin-bottom: 8px;
        }

        .memory-text {
          font-size: 11.5px;
          color: var(--text-secondary);
          line-height: 1.5;
        }

        .memory-textarea {
          width: 100%;
          background: rgba(255,255,255,0.025);
          border: 1px solid var(--border-subtle);
          border-radius: 10px;
          padding: 14px 16px;
          font-size: 12.5px;
          font-family: var(--font-mono);
          color: var(--text-primary);
          outline: none;
          resize: vertical;
          line-height: 1.7;
          margin-bottom: 14px;
          transition: border-color var(--transition-fast);
        }

        .memory-textarea:focus {
          border-color: rgba(124,108,246,0.4);
        }

        .memory-textarea::placeholder {
          color: var(--text-muted);
        }

        .save-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .save-row .add-btn {
          width: auto;
          padding: 10px 22px;
        }

        .saved-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--green);
          font-weight: 500;
        }

        /* ── History / Timeline ───────────────────────────────────── */
        .timeline {
          position: relative;
          padding-left: 26px;
        }

        .timeline::before {
          content: '';
          position: absolute;
          left: 7px;
          top: 6px;
          bottom: 6px;
          width: 1px;
          background: var(--border-base);
        }

        .cp-item {
          position: relative;
          padding-bottom: 18px;
        }

        .cp-dot {
          position: absolute;
          left: -26px;
          top: 4px;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: var(--bg-base);
          border: 2px solid var(--violet);
          box-shadow: 0 0 10px var(--violet-glow);
        }

        .cp-card {
          border-radius: 12px;
          border: 1px solid var(--border-subtle);
          background: var(--panel);
          padding: 14px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          transition: border-color var(--transition-fast);
        }

        .cp-card:hover {
          border-color: var(--border-base);
        }

        .cp-left {
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
          flex: 1;
        }

        .cp-msg {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cp-meta {
          display: flex;
          align-items: center;
          gap: 7px;
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
        }

        .cp-hash {
          color: var(--cyan);
          background: var(--cyan-soft);
          border-radius: 4px;
          padding: 1px 6px;
        }
      ` }} />
    </div>
  );
}
