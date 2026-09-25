"use client";

import { useEffect, useState } from "react";
import s from "./SettingsTab.module.css";

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
    if (!window.confirm("Revert the whole workspace to this checkpoint? Changes made after it will be overwritten."))
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
      const res = await fetch("/api/files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "AGENTS.md", content: agentsMd, projectId }),
      });
      if (!res.ok) {
        window.alert("Failed to save AGENTS.md");
        return;
      }
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

  const navItems: { id: typeof activeView; label: string }[] = [
    { id: "secrets", label: "Environment" },
    { id: "database", label: "Database" },
    { id: "memory", label: "Project memory" },
    { id: "history", label: "Checkpoints" },
    { id: "providers", label: "Models & MCP" },
  ];

  return (
    <div className={s.root}>
      <nav className={s.subnav} aria-label="Settings sections">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={activeView === item.id ? "page" : undefined}
            className={`${s.navItem} ${activeView === item.id ? s.navItemActive : ""}`}
            onClick={() => setActiveView(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className={s.panel}>
        {/* ── Environment variables ───────────────────────────── */}
        {activeView === "secrets" && (
          <section className={s.section}>
            <h2 className={s.heading}>Environment variables</h2>
            <p className={s.desc}>
              Encrypted at rest, masked here, and injected into the sandbox for builds, commands, and previews.
            </p>

            {vars.length === 0 ? (
              <p className={s.empty}>No variables yet. Add one below, e.g. <code>DATABASE_URL</code>.</p>
            ) : (
              <div className={s.rows}>
                {vars.map((v) => (
                  <div key={`${v.scope}-${v.key}`} className={s.row}>
                    <div className={s.rowLabel}>
                      <code className={s.mono}>{v.key}</code>
                      <span className={s.rowSub}>
                        {"•".repeat(Math.min(v.value.length, 18))}
                        {v.scope === "global" && (
                          <span title="Defined globally, shared by all projects"> · global</span>
                        )}
                      </span>
                    </div>
                    <button type="button" className={`${s.btn} ${s.btnDanger}`} onClick={() => remove(v.key)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 className={s.subheading}>Add variable</h3>
            <div className={s.addRow}>
              <input
                className={`${s.input} ${s.mono}`}
                aria-label="Variable name"
                placeholder="KEY_NAME"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
              <input
                className={`${s.input} ${s.mono}`}
                aria-label="Variable value"
                placeholder="value"
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                onClick={add}
                disabled={saving || !newKey.trim()}
              >
                {saving ? "Saving…" : "Add"}
              </button>
            </div>
          </section>
        )}

        {/* ── Database ───────────────────────────────────────── */}
        {activeView === "database" && (
          <section className={s.section}>
            <div className={s.headRow}>
              <h2 className={s.heading}>Database</h2>
              <button type="button" className={s.btn} onClick={refreshDb}>
                {loadingDb ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <p className={s.desc}>
              Browse the SQLite database (<code>project.db</code>) the agent created in your sandbox.{" "}
              {tables.length} table{tables.length !== 1 ? "s" : ""}.
            </p>

            {tables.length > 0 && (
              <div className={s.dbLayout}>
                <div className={s.tableList}>
                  {tables.map((t) => (
                    <button
                      key={t.name}
                      type="button"
                      aria-current={activeTable === t.name ? "true" : undefined}
                      className={`${s.navItem} ${s.mono} ${activeTable === t.name ? s.navItemActive : ""}`}
                      onClick={() => setActiveTable(t.name)}
                    >
                      <span className={s.ellipsis}>{t.name}</span>
                      <span className={s.count}>{t.data.length}</span>
                    </button>
                  ))}
                </div>

                <div className={s.tableData}>
                  {activeTable && (() => {
                    const tableData = tables.find((t) => t.name === activeTable)?.data || [];
                    if (tableData.length === 0) {
                      return <p className={s.empty}>This table is empty.</p>;
                    }
                    const keys = Object.keys(tableData[0]);
                    return (
                      <table className={s.dataTable}>
                        <thead>
                          <tr>
                            {keys.map((k) => <th key={k}>{k}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.map((row, i) => (
                            <tr key={i}>
                              {keys.map((k) => (
                                <td key={k} title={row[k] !== undefined && row[k] !== null ? String(row[k]) : ""}>
                                  {row[k] !== null && typeof row[k] === "object" ? JSON.stringify(row[k]) : String(row[k] ?? "")}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            )}

            {tables.length === 0 && !loadingDb && (
              <p className={s.empty}>
                No database yet. Ask the agent to persist something, e.g. &ldquo;Store todos in SQLite&rdquo;.
              </p>
            )}
          </section>
        )}

        {/* ── Project memory ─────────────────────────────────── */}
        {activeView === "memory" && (
          <section className={s.section}>
            <h2 className={s.heading}>Project memory</h2>
            <p className={s.desc}>
              <code>AGENTS.md</code> is added to every prompt for this project. Use it for conventions (package
              manager, test and lint commands), constraints (files never to edit), and architecture notes.
            </p>

            <textarea
              className={s.textarea}
              aria-label="AGENTS.md content"
              value={agentsMd}
              onChange={(e) => setAgentsMd(e.target.value)}
              rows={18}
              placeholder={`# Project conventions\n\n- Package manager: npm\n- Test command: npm test\n- Lint: npm run lint\n- Never edit files under /generated\n- API routes must use nodejs runtime (not edge)`}
            />

            <div className={s.saveRow}>
              <button
                type="button"
                className={`${s.btn} ${s.btnPrimary}`}
                onClick={saveAgentsMd}
                disabled={savingMemory}
              >
                {savingMemory ? "Saving…" : "Save"}
              </button>
              {memorySaved && <span className={s.saved} role="status">Saved</span>}
            </div>
          </section>
        )}

        {/* ── Checkpoints ────────────────────────────────────── */}
        {activeView === "history" && (
          <section className={s.section}>
            <h2 className={s.heading}>Checkpoints</h2>
            <p className={s.desc}>
              Every agent turn is checkpointed. Reverting restores the whole workspace to that snapshot.
            </p>

            {loadingCheckpoints ? (
              <p className={s.empty}>Loading checkpoints…</p>
            ) : checkpoints.length === 0 ? (
              <p className={s.empty}>No checkpoints yet. They appear after your first message to the agent.</p>
            ) : (
              <div className={s.rows}>
                {checkpoints.map((c) => (
                  <div key={c.sha} className={s.row}>
                    <div className={s.rowLabel}>
                      <span className={s.ellipsis}>{c.message}</span>
                      <span className={s.rowSub}>
                        <code className={s.mono}>{c.sha.slice(0, 7)}</code> · {new Date(c.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`${s.btn} ${s.btnDanger}`}
                      disabled={revertingCheckpoints !== null}
                      onClick={() => revertProject(c.sha)}
                    >
                      {revertingCheckpoints === c.sha ? "Reverting…" : "Revert"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Models & MCP ───────────────────────────────────── */}
        {activeView === "providers" && (
          <section className={s.section}>
            <div className={s.headRow}>
              <h2 className={s.heading}>Model providers</h2>
              <button type="button" className={s.btn} onClick={loadProviders}>
                Refresh
              </button>
            </div>
            <p className={s.desc}>
              All providers speak the OpenAI-compatible protocol. Add cloud keys under Environment using the
              variable shown; prefixed models (e.g. <code>openrouter:meta-llama/llama-3.3-70b-instruct</code>) route
              explicitly. Local providers are detected automatically.
            </p>

            {loadingProviders ? (
              <p className={s.empty}>Checking providers…</p>
            ) : (
              <div className={s.rows}>
                {providers.map((p) => (
                  <div key={p.id} className={s.row}>
                    <div className={s.rowLabel}>
                      <span className={s.rowTitle}>
                        <span className={`${s.dot} ${p.available ? s.dotUp : ""}`} aria-hidden="true" />
                        {p.label}
                        <span className={s.rowSub}>{p.kind}</span>
                        {p.prefix && <code className={s.mono}>{p.prefix}:</code>}
                      </span>
                      <span className={s.rowSub}>
                        {p.kind === "cloud"
                          ? p.available
                            ? <>Configured (<code>{p.keyEnv}</code>)</>
                            : <>Not configured. Add <code>{p.keyEnv}</code> under Environment.</>
                          : p.available
                            ? `Running at ${p.baseURL}${p.models?.length ? ` · ${p.models.length} models` : ""}`
                            : `Not detected at ${p.baseURL}`}
                      </span>
                      {p.models && p.models.length > 0 && (
                        <span className={s.chips}>
                          {p.models.slice(0, 8).map((m) => <code key={m}>{m}</code>)}
                          {p.models.length > 8 && <span>+{p.models.length - 8} more</span>}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className={s.subheading}>Fallback chain</h3>
            <p className={s.desc}>
              {fallbacks.length > 0
                ? <>When the selected model fails, these are tried in order: {fallbacks.map((f) => <code key={f} className={s.gap}>{f}</code>)}</>
                : <>None configured. Set <code>LLM_FALLBACKS</code> in <code>.env.local</code>, e.g. <code>LLM_FALLBACKS=openrouter:meta-llama/llama-3.3-70b-instruct,llama3.1:latest</code></>}
            </p>

            <h3 className={s.subheading}>MCP servers</h3>
            {mcpServers.length === 0 ? (
              <p className={s.desc}>
                None configured. Add servers in <code>{mcpConfigPath}</code>:{" "}
                <code>{'{"servers":{"name":{"command":"npx","args":["-y","@some/mcp-server"]}}}'}</code>. Their tools
                become available to the agent as <code>mcp_name_*</code>.
              </p>
            ) : (
              <div className={s.rows}>
                {mcpServers.map((m) => (
                  <div key={m.server} className={s.row}>
                    <div className={s.rowLabel}>
                      <span className={s.rowTitle}>
                        <span className={`${s.dot} ${m.connected ? s.dotUp : ""}`} aria-hidden="true" />
                        {m.server}
                      </span>
                      <span className={s.rowSub}>
                        {m.connected
                          ? `Connected · ${m.tools.length} tool${m.tools.length === 1 ? "" : "s"}`
                          : `Unavailable: ${m.error ?? "unknown error"}`}
                      </span>
                      {m.tools.length > 0 && (
                        <span className={s.chips}>
                          {m.tools.slice(0, 8).map((t) => <code key={t}>{t}</code>)}
                          {m.tools.length > 8 && <span>+{m.tools.length - 8} more</span>}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {providerUsage.length > 0 && (
              <>
                <h3 className={s.subheading}>Usage by model</h3>
                <p className={s.desc}>Across all projects.</p>
                <div className={s.rows}>
                  {providerUsage.map((u) => (
                    <div key={u.model} className={s.row}>
                      <code className={s.mono}>{u.model}</code>
                      <span className={s.rowSub}>
                        {u.calls} calls · {(u.total_tokens ?? 0).toLocaleString()} tokens · ${Number(u.cost_usd ?? 0).toFixed(4)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
