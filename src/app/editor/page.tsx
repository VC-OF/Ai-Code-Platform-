'use client';

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { OnMount } from '@monaco-editor/react';
import { buildTree, languageFor, type TreeNode } from '@/lib/file-utils';

// Dynamically import Monaco Editor and DiffEditor to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="monaco-loading-placeholder">
      <div className="monaco-spinner" />
      <span>Loading VS Code Editor…</span>
    </div>
  ),
});

const MonacoDiffEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.DiffEditor),
  {
    ssr: false,
    loading: () => (
      <div className="monaco-loading-placeholder">
        <div className="monaco-spinner" />
        <span>Loading Diff View…</span>
      </div>
    ),
  }
);

// ─── File Icon Helper ──────────────────────────────────────────────────────────
function fileIcon(n: string) {
  if (n.endsWith('.tsx') || n.endsWith('.jsx')) return '⚛';
  if (n.endsWith('.ts') || n.endsWith('.js')) return '◈';
  if (n.endsWith('.css') || n.endsWith('.scss')) return '🎨';
  if (n.endsWith('.json')) return '{}';
  if (n.endsWith('.md')) return '📝';
  if (n.endsWith('.yml') || n.endsWith('.yaml')) return '⚙';
  if (n.endsWith('.sh') || n.endsWith('.bash')) return '$';
  if (n.includes('.env')) return '🔑';
  if (n.endsWith('.html')) return '🌐';
  if (n.endsWith('.py')) return '🐍';
  if (n.endsWith('.sql')) return '🗄';
  return '◌';
}

function getReadableLang(lang: string): string {
  switch (lang) {
    case 'typescript': return 'TypeScript';
    case 'javascript': return 'JavaScript';
    case 'json': return 'JSON';
    case 'css': return 'CSS';
    case 'html': return 'HTML';
    case 'markdown': return 'Markdown';
    case 'python': return 'Python';
    case 'sql': return 'SQL';
    case 'shell': return 'Shell Script';
    case 'yaml': return 'YAML';
    default: return 'Plain Text';
  }
}

// ─── Tree Node for Sidebar Explorer ───────────────────────────────────────────
function SideNode({
  node,
  depth,
  activeFile,
  openFiles,
  dirtyFiles,
  onSelect,
  expanded,
  onToggle,
  onDelete,
  onNewFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  openFiles: Set<string>;
  dirtyFiles: Set<string>;
  onSelect: (p: string) => void;
  expanded: Set<string>;
  onToggle: (p: string) => void;
  onDelete: (p: string) => void;
  onNewFile: (d: string) => void;
}) {
  const isExp = expanded.has(node.fullPath);
  const isAct = activeFile === node.fullPath;
  const isDirty = dirtyFiles.has(node.fullPath);
  const pl = 10 + depth * 14;
  const [hov, setHov] = useState(false);

  if (node.isDirectory) {
    return (
      <div>
        <div
          className="s-row s-dir"
          style={{ paddingLeft: pl }}
          onMouseEnter={() => setHov(true)}
          onMouseLeave={() => setHov(false)}
        >
          <button className="s-row-btn" onClick={() => onToggle(node.fullPath)}>
            <svg
              className={`s-chev ${isExp ? 'open' : ''}`}
              viewBox="0 0 24 24"
              fill="currentColor"
              width={10}
              height={10}
            >
              <path d="M10 6l6 6-6 6V6z" />
            </svg>
            <span className="s-folder-ic">{isExp ? '📂' : '📁'}</span>
            <span className="s-nm">{node.name}</span>
          </button>
          {hov && (
            <button
              className="s-action-btn"
              onClick={() => onNewFile(node.fullPath)}
              title="New file in this folder"
            >
              +
            </button>
          )}
        </div>
        {isExp &&
          node.children.map((c) => (
            <SideNode
              key={c.fullPath}
              node={c}
              depth={depth + 1}
              activeFile={activeFile}
              openFiles={openFiles}
              dirtyFiles={dirtyFiles}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
              onDelete={onDelete}
              onNewFile={onNewFile}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`s-row ${isAct ? 'act' : ''}`}
      style={{ paddingLeft: pl + 14 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <button className="s-row-btn" onClick={() => onSelect(node.fullPath)}>
        <span className="s-file-ic">{fileIcon(node.name)}</span>
        <span className="s-nm">{node.name}</span>
        {isDirty ? (
          <span className="s-dirty-dot" title="Unsaved changes" />
        ) : openFiles.has(node.fullPath) ? (
          <span className="s-open-dot" title="Open tab" />
        ) : null}
      </button>
      {hov && (
        <button
          className="s-action-btn s-del-btn"
          onClick={() => onDelete(node.fullPath)}
          title="Delete file"
        >
          ✕
        </button>
      )}
    </div>
  );
}

// ─── Database Panel ───────────────────────────────────────────────────────────
type DbTab = 'overview' | 'tables' | 'llm' | 'tools' | 'messages' | 'query';

type DbRow = {
  id?: string;
  model?: string;
  total_tokens?: number;
  cost_usd?: number;
  created_at?: number;
  success?: number;
  tool_name?: string;
  duration_ms?: number;
  role?: string;
  content?: string;
  tokens_used?: number;
  [key: string]: unknown;
};

interface DbTableInfo {
  name: string;
  rows: number;
  data?: DbRow[];
  columns?: { name: string; type: string }[];
}

interface DbOverview {
  project?: { name: string; id: string; workspace?: string };
  stats?: {
    messages?: number;
    tool_calls?: number;
    total_tokens?: number;
    total_cost_usd?: number;
    turn_count?: number;
    checkpoints?: number;
  };
  health?: { tables?: string[]; size_bytes?: number; ok?: boolean };
  tables?: DbTableInfo[];
}

interface DbSection {
  tables?: DbTableInfo[];
  size_bytes?: number;
  summary?: { total_tokens?: number; total_cost_usd?: number; turn_count?: number };
  byModel?: { model: string; calls: number; total_tokens?: number; cost_usd?: number }[];
  stats?: { tool_name: string; call_count: number; success_count: number; avg_duration_ms: number }[];
  rows?: DbRow[];
}

interface SqlResult {
  error?: string;
  rows?: DbRow[];
  elapsed_ms?: number;
}

function DbPanel({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<DbTab>('overview');
  const [overview, setOverview] = useState<DbOverview | null>(null);
  const [section, setSection] = useState<DbSection | null>(null);
  const [loading, setLoading] = useState(false);
  const [sql, setSql] = useState('SELECT * FROM projects;');
  const [sqlRes, setSqlRes] = useState<SqlResult | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const fetchOverview = useCallback(() => {
    fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=overview`)
      .then((r) => r.json())
      .then((d) => setOverview(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const fetchSection = useCallback(
    (sec: string) => {
      setLoading(true);
      setSection(null);
      fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=${sec}`)
        .then((r) => r.json())
        .then((d) => setSection(d))
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [projectId]
  );

  useEffect(() => {
    let active = true;
    fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=overview`)
      .then((r) => r.json())
      .then((d) => {
        if (active) setOverview(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  const runSql = () => {
    if (!sql.trim()) return;
    setSqlRunning(true);
    setSqlRes(null);
    fetch('/api/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, projectId }),
    })
      .then((r) => r.json())
      .then((d) => setSqlRes(d))
      .catch((e) => setSqlRes({ error: String(e) }))
      .finally(() => setSqlRunning(false));
  };

  const switchTab = (t: DbTab) => {
    setTab(t);
    if (t === 'overview') {
      if (!overview) fetchOverview();
    } else if (t !== 'query') {
      const map: Record<string, string> = {
        tables: 'tables',
        llm: 'usage',
        tools: 'tools',
        messages: 'messages',
      };
      fetchSection(map[t] || t);
    }
  };

  const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

  return (
    <div className="ed-db">
      <div className="ed-db-hdr">
        <span className="ed-db-title">🗄 Database Explorer</span>
        <span className="ed-db-pill">{overview ? '● Connected' : '○ …'}</span>
        <button
          className="ed-db-ref"
          onClick={() => {
            setOverview(null);
            fetchOverview();
          }}
          title="Refresh database"
        >
          ↻
        </button>
      </div>

      <div className="ed-db-stabs">
        {(['overview', 'tables', 'llm', 'tools', 'messages', 'query'] as DbTab[]).map((t) => (
          <button
            key={t}
            className={`ed-db-stab ${tab === t ? 'on' : ''}`}
            onClick={() => switchTab(t)}
          >
            {t === 'llm' ? 'LLM' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="ed-db-body">
        {loading && <div className="ed-db-load">Loading…</div>}

        {tab === 'overview' && !loading && overview && (
          <>
            {overview.project && (
              <div className="db-sec">
                <div className="db-sec-ttl">📁 Project</div>
                {[
                  ['Name', overview.project.name],
                  ['ID', overview.project.id],
                  ['Folder', overview.project.workspace?.split(/[/\\]/).pop() ?? '–'],
                ].map(([k, v]) => (
                  <div key={k} className="db-kv">
                    <span className="db-k">{k}</span>
                    <span
                      className="db-v"
                      style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {String(v)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="db-stat-grid">
              {[
                { l: 'MESSAGES', v: overview.stats?.messages ?? 0, s: 'Chat history', c: 0 },
                { l: 'TOOL CALLS', v: overview.stats?.tool_calls ?? 0, s: 'Agent tool uses', c: 1 },
                {
                  l: 'TOKENS',
                  v:
                    (overview.stats?.total_tokens ?? 0) > 999
                      ? `${((overview.stats?.total_tokens ?? 0) / 1000).toFixed(1)}K`
                      : String(overview.stats?.total_tokens ?? 0),
                  s: 'LLM total',
                  c: 2,
                },
                {
                  l: 'COST',
                  v: `$${(overview.stats?.total_cost_usd ?? 0).toFixed(4)}`,
                  s: 'USD spent',
                  c: 3,
                },
                { l: 'TURNS', v: overview.stats?.turn_count ?? 0, s: 'LLM turns', c: 0 },
                { l: 'COMMITS', v: overview.stats?.checkpoints ?? 0, s: 'Git checkpoints', c: 1 },
              ].map((s) => (
                <div key={s.l} className="db-stat-card">
                  <span className="db-stat-l">{s.l}</span>
                  <span className={`db-stat-v c${s.c}`}>{String(s.v)}</span>
                  <span className="db-stat-s">{s.s}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'tables' && !loading && section && (
          <div className="db-sec">
            {(section.tables ?? []).map((t, i) => (
              <div key={t.name} className="db-tbl-card">
                <div className="db-tbl-card-hdr">
                  <span style={{ color: COLORS[i % 6] }}>■</span>
                  <span className="db-tbl-nm">{t.name}</span>
                  <span className="db-tbl-cnt">{t.rows?.toLocaleString()} rows</span>
                </div>
                <div className="db-cols">
                  {(t.columns ?? []).map((c) => (
                    <span key={c.name} className="db-col-pill">
                      <span className="db-col-nm">{c.name}</span>
                      <span className="db-col-type">{c.type}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'query' && (
          <>
            <div className="db-ql">SQL Query</div>
            <textarea
              className="db-qi"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="SELECT * FROM projects;"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  runSql();
                }
              }}
            />
            <button className="db-qrun" disabled={sqlRunning} onClick={runSql}>
              {sqlRunning ? '⏳ Running…' : '▶ Run Query (Ctrl+Enter)'}
            </button>
            {sqlRes && (
              <div className="db-qresult">
                {sqlRes.error ? (
                  <div className="db-qerr">{sqlRes.error}</div>
                ) : (
                  <>
                    <div className="db-qmeta">
                      {sqlRes.rows?.length ?? 0} rows · {sqlRes.elapsed_ms}ms
                    </div>
                    {sqlRes.rows && sqlRes.rows.length > 0 && (
                      <div className="db-qtw">
                        <table className="db-qt">
                          <thead>
                            <tr>
                              {Object.keys(sqlRes.rows[0]).map((k) => (
                                <th key={k}>{k}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sqlRes.rows.map((row, i) => (
                              <tr key={i}>
                                {Object.values(row).map((v, j) => (
                                  <td key={j}>{String(v ?? '').slice(0, 60)}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Source Control Panel ─────────────────────────────────────────────────────
function SourceControlPanel({ projectId }: { projectId: string }) {
  const [data, setData] = useState<{
    branch?: string;
    changes?: { code: string; path: string }[];
    graph?: string[];
    remote?: string[];
  }>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
      setData(await res.json());
    } catch {}
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (active) setData(json);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [projectId]);

  const runAction = async (action: 'commit' | 'push') => {
    setBusy(true);
    setNotice('');
    try {
      const res = await fetch('/api/git/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, action, message }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Source control action failed');
      setMessage('');
      setNotice(action === 'commit' ? 'Committed changes.' : 'Pushed changes.');
      await refresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ed-sc">
      <div className="ed-sc-head">
        <div>
          <div className="ed-sc-title">Source Control</div>
          <div className="ed-sc-branch">⎇ {data.branch || 'Reading repository…'}</div>
        </div>
        <button className="ed-db-ref" onClick={() => refresh()} title="Refresh source control">
          ↻
        </button>
      </div>
      <div className="ed-sc-actions">
        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message (Ctrl+Enter)"
          maxLength={200}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && message.trim()) {
              e.preventDefault();
              runAction('commit');
            }
          }}
        />
        <button onClick={() => runAction('commit')} disabled={busy || !message.trim()}>
          Commit
        </button>
      </div>
      {notice && <div className="ed-sc-notice">{notice}</div>}
      <div className="ed-sc-section">
        <div className="ed-sc-label">Changes · {data.changes?.length ?? 0}</div>
        {data.changes?.length ? (
          data.changes.map((change) => (
            <div className="ed-sc-change" key={`${change.code}-${change.path}`}>
              <code>{change.code.trim() || 'M'}</code>
              <span>{change.path}</span>
            </div>
          ))
        ) : (
          <div className="ed-sc-empty">Working tree clean.</div>
        )}
      </div>
      <div className="ed-sc-section ed-sc-graph-section">
        <div className="ed-sc-label">Recent Commits</div>
        <pre className="ed-sc-graph">
          {data.graph?.length ? data.graph.join('\n') : 'No commits yet.'}
        </pre>
      </div>
    </div>
  );
}

// ─── Live Agent Status Panel ──────────────────────────────────────────────────
function AgentPanel({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>('idle');

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      fetch(`/api/chat/status?projectId=${encodeURIComponent(projectId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) {
            setRunning(data.running ?? false);
            setStatus(data.status ?? 'idle');
          }
        })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  return (
    <div className="ed-agent">
      <div className="ed-agent-head">
        <span className="ed-ag-title">AI Coding Agent</span>
        <span className={`ed-ag-badge ${running ? 'badge-running' : 'badge-idle'}`}>
          {running ? '● Running' : '○ Idle'}
        </span>
      </div>

      <div className="ed-ag-card">
        <div className="ed-ag-row">
          <span className="ed-ag-prop">Current State:</span>
          <span className="ed-ag-val font-semibold">{status}</span>
        </div>
        <div className="ed-ag-row">
          <span className="ed-ag-prop">Mode:</span>
          <span className="ed-ag-val">Autonomous Dev Loop</span>
        </div>
        <div className="ed-ag-row">
          <span className="ed-ag-prop">Verification:</span>
          <span className="ed-ag-val">Lint + Tests + Git</span>
        </div>
      </div>

      <div className="ed-ag-desc">
        {running
          ? 'The agent is actively making edits, reading files, or verifying changes in your workspace. Code updates sync live.'
          : 'Agent is ready. Send instructions from the main workspace chat to start building or editing code.'}
      </div>

      <a href={`/?projectId=${projectId}`} className="ed-ag-btn">
        💬 Switch to Agent Workspace
      </a>
    </div>
  );
}

// ─── Main Editor Component ────────────────────────────────────────────────────
function EditorInner() {
  const params = useSearchParams();
  const projectId = params.get('projectId') || 'default';

  // Workspace Tree & File Management
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(['src', 'src/app', 'src/components', 'src/lib'])
  );
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Contents Cache & Sync
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [savedContents, setSavedContents] = useState<Map<string, string>>(new Map());
  const [gitContents, setGitContents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [syncNotice, setSyncNotice] = useState('');

  // UI Panels & Layout State
  const [activityTab, setActivityTab] = useState<'explorer' | 'search' | 'git' | 'database' | 'agent'>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const [search, setSearch] = useState('');
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState('');

  // Monaco Editor State
  const [editorTheme, setEditorTheme] = useState<'vs' | 'vs-dark'>('vs-dark');
  const [cursorPos, setCursorPos] = useState({ ln: 1, col: 1, selected: 0 });
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  // Live Agent Status indicator in bottom bar
  const [agentRunning, setAgentRunning] = useState(false);
  const [gitBranch, setGitBranch] = useState('main');

  // Sync editor theme with data-theme attribute
  useEffect(() => {
    const updateTheme = () => {
      const theme = document.documentElement.getAttribute('data-theme');
      setEditorTheme(theme === 'light' ? 'vs' : 'vs-dark');
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  // Compute dirty files (files with unsaved modifications)
  const dirtyFiles = useMemo(() => {
    const s = new Set<string>();
    fileContents.forEach((val, path) => {
      const saved = savedContents.get(path);
      if (saved !== undefined && val !== saved) {
        s.add(path);
      }
    });
    return s;
  }, [fileContents, savedContents]);

  // Load project file tree
  const loadTree = useCallback(async () => {
    try {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      const d = await res.json();
      if (d.tree) {
        setTree(buildTree(d.tree));
      }
    } catch {
    } finally {
      setTreeLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((d) => {
        if (active && d.tree) {
          setTree(buildTree(d.tree));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setTreeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Load Git Branch for status bar
  useEffect(() => {
    fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.branch) setGitBranch(d.branch);
      })
      .catch(() => {});
  }, [projectId]);

  // Open a file into Monaco tab
  const openFile = useCallback(
    async (fp: string) => {
      setActiveFile(fp);
      setShowDiff(false);
      if (!openTabs.includes(fp)) {
        setOpenTabs((p) => [...p, fp]);
      }

      // If we don't have the content cached yet, fetch it
      if (!fileContents.has(fp)) {
        setLoading(true);
        try {
          const [fsRes, gitRes] = await Promise.all([
            fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(fp)}`),
            fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(fp)}&version=git`),
          ]);
          const fsData = await fsRes.json();
          const gitData = await gitRes.json();
          const content = fsData.content ?? '';

          setFileContents((p) => new Map(p).set(fp, content));
          setSavedContents((p) => new Map(p).set(fp, content));
          setGitContents((p) => new Map(p).set(fp, gitData.content ?? ''));
        } catch {
          setFileContents((p) => new Map(p).set(fp, '// Failed to load file'));
        } finally {
          setLoading(false);
        }
      }
    },
    [projectId, openTabs, fileContents]
  );

  // Real-Time Background Synchronization:
  // Polls the workspace to pick up file edits made by the background agent or external tools
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      // 1. Check agent status
      try {
        const statusRes = await fetch(`/api/chat/status?projectId=${encodeURIComponent(projectId)}`);
        const statusData = await statusRes.json();
        setAgentRunning(statusData.running ?? false);
      } catch {}

      // 2. Refresh file tree in background
      loadTree();

      // 3. For the active file, check if disk content changed
      if (activeFile && !dirtyFiles.has(activeFile)) {
        try {
          const res = await fetch(
            `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(activeFile)}`
          );
          const data = await res.json();
          const diskContent = data.content;
          if (diskContent !== undefined) {
            const currentSaved = savedContents.get(activeFile);
            if (currentSaved !== undefined && diskContent !== currentSaved) {
              // Real-time update into Monaco!
              setFileContents((prev) => new Map(prev).set(activeFile, diskContent));
              setSavedContents((prev) => new Map(prev).set(activeFile, diskContent));
              setSyncNotice('↻ Synced from workspace');
              setTimeout(() => setSyncNotice(''), 2500);
            }
          }
        } catch {}
      }
    }, 2500);

    return () => clearInterval(syncInterval);
  }, [projectId, activeFile, dirtyFiles, savedContents, loadTree]);

  // Handle edit from Monaco editor
  const handleEdit = useCallback(
    (v: string | undefined) => {
      if (!activeFile) return;
      const val = v ?? '';
      setFileContents((p) => new Map(p).set(activeFile, val));
    },
    [activeFile]
  );

  // Save current active file
  const saveFile = useCallback(
    async (fp?: string) => {
      const path = fp ?? activeFile;
      if (!path) return;
      const content = fileContents.get(path) ?? '';
      setSaving(true);
      try {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content, projectId }),
        });
        if (res.ok) {
          setSavedContents((p) => new Map(p).set(path, content));
          setSaveMsg('Saved ✓');
          setTimeout(() => setSaveMsg(''), 2000);
        } else {
          setSaveMsg('Save failed ✗');
          setTimeout(() => setSaveMsg(''), 2500);
        }
      } catch {
        setSaveMsg('Save error ✗');
        setTimeout(() => setSaveMsg(''), 2500);
      } finally {
        setSaving(false);
      }
    },
    [activeFile, fileContents, projectId]
  );

  // Monaco commands are bound once at mount; route them through a ref so
  // Ctrl+S always saves the latest content instead of the mount-time snapshot
  const saveFileRef = useRef(saveFile);
  useEffect(() => {
    saveFileRef.current = saveFile;
  }, [saveFile]);

  // Close tab
  const closeTab = useCallback(
    (fp: string) => {
      if (
        dirtyFiles.has(fp) &&
        !confirm(`"${fp.split('/').pop()}" has unsaved changes. Close anyway?`)
      ) {
        return;
      }
      setOpenTabs((p) => {
        const next = p.filter((t) => t !== fp);
        if (activeFile === fp) {
          setActiveFile(next[next.length - 1] ?? null);
        }
        return next;
      });
    },
    [activeFile, dirtyFiles]
  );

  // Delete file
  const deleteFile = useCallback(
    async (fp: string) => {
      if (!confirm(`Delete "${fp}" from workspace?`)) return;
      try {
        await fetch(
          `/api/files?path=${encodeURIComponent(fp)}&projectId=${encodeURIComponent(projectId)}`,
          { method: 'DELETE' }
        );
        closeTab(fp);
        loadTree();
      } catch {}
    },
    [projectId, closeTab, loadTree]
  );

  // Create new file
  const newFile = useCallback(
    async (dir?: string) => {
      const name = prompt(`New file path${dir ? ` in ${dir}` : ''}:`);
      if (!name?.trim()) return;
      const fp = dir ? `${dir}/${name.trim()}` : name.trim();
      await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fp, content: '', projectId }),
      });
      await loadTree();
      openFile(fp);
    },
    [projectId, loadTree, openFile]
  );

  // Toggle folder expansion
  const toggleFolder = useCallback((p: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  // Global Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
        e.preventDefault();
        if (activeFile) closeTab(activeFile);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        setQuickOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && quickOpen) {
        setQuickOpen(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [saveFile, closeTab, activeFile, quickOpen]);

  // Setup Monaco onMount with typed parameters
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Track cursor position
      editor.onDidChangeCursorPosition((e) => {
        const selection = editor.getSelection();
        const selected = selection
          ? editor.getModel()?.getValueInRange(selection)?.length ?? 0
          : 0;
        setCursorPos({
          ln: e.position.lineNumber,
          col: e.position.column,
          selected,
        });
      });

      // Bind Ctrl+S inside Monaco
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFileRef.current();
      });

      // Bind Ctrl+P inside Monaco
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        setQuickOpen(true);
      });

      // Bind Ctrl+B inside Monaco
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
        setSidebarOpen((p) => !p);
      });
    },
    []
  );

  // Flatten tree for searching
  const flatFiles = useMemo(() => {
    const list: TreeNode[] = [];
    const flatten = (ns: TreeNode[]) => {
      for (const n of ns) {
        if (!n.isDirectory) list.push(n);
        if (n.isDirectory) flatten(n.children);
      }
    };
    flatten(tree);
    return list;
  }, [tree]);

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return flatFiles.filter((f) => f.fullPath.toLowerCase().includes(q));
  }, [flatFiles, search]);

  const quickOpenResults = useMemo(() => {
    const q = quickOpenQuery.trim().toLowerCase();
    if (!q) return flatFiles.slice(0, 20);
    return flatFiles
      .filter((f) => f.fullPath.toLowerCase().includes(q))
      .slice(0, 20);
  }, [flatFiles, quickOpenQuery]);

  const activeContent = activeFile ? fileContents.get(activeFile) ?? '' : '';
  const activeGitContent = activeFile ? gitContents.get(activeFile) ?? '' : '';
  const activeLang = activeFile ? languageFor(activeFile) : 'plaintext';
  const openFileSet = useMemo(() => new Set(openTabs), [openTabs]);

  return (
    <div className="vs-shell">
      {/* ── Top VS Code Menu Bar ── */}
      <div className="vs-topbar">
        <div className="vs-topbar-left">
          <span className="vs-logo">⚡</span>
          <span className="vs-app-title">Open Code</span>
          <span className="vs-proj-tag">{projectId}</span>
          <div className="vs-menu-items">
            <button className="vs-menu-btn" onClick={() => newFile()}>File</button>
            <button className="vs-menu-btn" onClick={() => editorRef.current?.trigger('action', 'actions.find', null)}>Edit</button>
            <button className="vs-menu-btn" onClick={() => setSidebarOpen((p) => !p)}>View</button>
            <button className="vs-menu-btn" onClick={() => setQuickOpen(true)}>Go</button>
            <button className="vs-menu-btn" onClick={() => setShowDiff((p) => !p)}>Diff</button>
          </div>
        </div>

        <div className="vs-topbar-center">
          <button className="vs-search-palette-btn" onClick={() => setQuickOpen(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <span>{projectId} — Search files (Ctrl+P)</span>
          </button>
        </div>

        <div className="vs-topbar-right">
          {syncNotice && <span className="vs-sync-notice">{syncNotice}</span>}
          {saveMsg && <span className="vs-save-notice">{saveMsg}</span>}
          <a href={`/?projectId=${projectId}`} className="vs-back-btn" id="btn-back-to-agent">
            ← Back to Agent
          </a>
        </div>
      </div>

      {/* ── Main Workspace Body (Activity Bar + Sidebar + Monaco + Right Panel) ── */}
      <div className="vs-body">
        {/* Left Activity Bar */}
        <div className="vs-activitybar">
          <div className="vs-act-group">
            <button
              className={`vs-act-btn ${sidebarOpen && activityTab === 'explorer' ? 'act' : ''}`}
              onClick={() => {
                if (activityTab === 'explorer' && sidebarOpen) setSidebarOpen(false);
                else { setActivityTab('explorer'); setSidebarOpen(true); }
              }}
              title="Explorer (Ctrl+Shift+E)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 8 9" />
              </svg>
            </button>

            <button
              className={`vs-act-btn ${sidebarOpen && activityTab === 'search' ? 'act' : ''}`}
              onClick={() => {
                if (activityTab === 'search' && sidebarOpen) setSidebarOpen(false);
                else { setActivityTab('search'); setSidebarOpen(true); }
              }}
              title="Search (Ctrl+Shift+F)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            <button
              className={`vs-act-btn ${sidebarOpen && activityTab === 'git' ? 'act' : ''}`}
              onClick={() => {
                if (activityTab === 'git' && sidebarOpen) setSidebarOpen(false);
                else { setActivityTab('git'); setSidebarOpen(true); }
              }}
              title="Source Control (Ctrl+Shift+G)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="18" cy="18" r="3" />
                <circle cx="6" cy="6" r="3" />
                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                <line x1="6" y1="9" x2="6" y2="21" />
              </svg>
            </button>

            <button
              className={`vs-act-btn ${sidebarOpen && activityTab === 'database' ? 'act' : ''}`}
              onClick={() => {
                if (activityTab === 'database' && sidebarOpen) setSidebarOpen(false);
                else { setActivityTab('database'); setSidebarOpen(true); }
              }}
              title="Database Explorer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </button>

            <button
              className={`vs-act-btn ${sidebarOpen && activityTab === 'agent' ? 'act' : ''}`}
              onClick={() => {
                if (activityTab === 'agent' && sidebarOpen) setSidebarOpen(false);
                else { setActivityTab('agent'); setSidebarOpen(true); }
              }}
              title="AI Agent Status"
            >
              <span className={`vs-act-agent-dot ${agentRunning ? 'act' : ''}`}>⚡</span>
            </button>
          </div>
        </div>

        {/* Collapsible Primary Sidebar */}
        {sidebarOpen && (
          <div className="vs-sidebar">
            {activityTab === 'explorer' && (
              <>
                <div className="vs-side-head">
                  <span className="vs-side-title">EXPLORER: {projectId.toUpperCase()}</span>
                  <div className="vs-side-actions">
                    <button onClick={() => newFile()} title="New File" className="vs-icon-btn">+</button>
                    <button onClick={loadTree} title="Refresh Workspace" className="vs-icon-btn">↻</button>
                    <button onClick={() => setSidebarOpen(false)} title="Hide Sidebar (Ctrl+B)" className="vs-icon-btn">✕</button>
                  </div>
                </div>

                <div className="vs-side-searchbox">
                  <input
                    placeholder="Filter files…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="vs-search-input"
                  />
                </div>

                <div className="vs-tree-scroll">
                  {treeLoading ? (
                    <div className="vs-empty-hint">Loading files…</div>
                  ) : search ? (
                    filteredFiles.length === 0 ? (
                      <div className="vs-empty-hint">No matching files</div>
                    ) : (
                      filteredFiles.map((f) => (
                        <button
                          key={f.fullPath}
                          className={`s-row s-row-btn ${activeFile === f.fullPath ? 'act' : ''}`}
                          style={{ paddingLeft: 14 }}
                          onClick={() => openFile(f.fullPath)}
                        >
                          <span className="s-file-ic">{fileIcon(f.name)}</span>
                          <span className="s-nm">{f.fullPath}</span>
                          {dirtyFiles.has(f.fullPath) && <span className="s-dirty-dot" />}
                        </button>
                      ))
                    )
                  ) : (
                    tree.map((n) => (
                      <SideNode
                        key={n.fullPath}
                        node={n}
                        depth={0}
                        activeFile={activeFile}
                        openFiles={openFileSet}
                        dirtyFiles={dirtyFiles}
                        onSelect={openFile}
                        expanded={expanded}
                        onToggle={toggleFolder}
                        onDelete={deleteFile}
                        onNewFile={newFile}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {activityTab === 'search' && (
              <div className="vs-search-panel">
                <div className="vs-side-head">
                  <span className="vs-side-title">SEARCH IN FILES</span>
                  <button onClick={() => setSidebarOpen(false)} className="vs-icon-btn">✕</button>
                </div>
                <div className="vs-side-searchbox">
                  <input
                    placeholder="Search file names or paths…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="vs-search-input"
                    autoFocus
                  />
                </div>
                <div className="vs-tree-scroll">
                  <div className="vs-results-count">{filteredFiles.length} files matched</div>
                  {filteredFiles.map((f) => (
                    <button
                      key={f.fullPath}
                      className={`s-row s-row-btn ${activeFile === f.fullPath ? 'act' : ''}`}
                      onClick={() => openFile(f.fullPath)}
                    >
                      <span className="s-file-ic">{fileIcon(f.name)}</span>
                      <span className="s-nm">{f.fullPath}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activityTab === 'git' && <SourceControlPanel projectId={projectId} />}
            {activityTab === 'database' && <DbPanel projectId={projectId} />}
            {activityTab === 'agent' && <AgentPanel projectId={projectId} />}
          </div>
        )}

        {/* ── Main Code Editor Region ── */}
        <div className="vs-editor-region">
          {/* File Tabs Bar */}
          <div className="vs-tabbar">
            <div className="vs-tabs-scroll">
              {openTabs.map((t) => {
                const isCur = activeFile === t;
                const isDirty = dirtyFiles.has(t);
                const fileName = t.split('/').pop() ?? t;

                return (
                  <div
                    key={t}
                    className={`vs-tab ${isCur ? 'cur' : ''} ${isDirty ? 'dirty' : ''}`}
                    onClick={() => openFile(t)}
                    onAuxClick={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        closeTab(t);
                      }
                    }}
                    title={t}
                  >
                    <span className="vs-tab-icon">{fileIcon(fileName)}</span>
                    <span className="vs-tab-label">{fileName}</span>
                    {isDirty ? (
                      <span
                        className="vs-tab-dirty"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t);
                        }}
                        title="Unsaved changes (click to close)"
                      >
                        ●
                      </span>
                    ) : (
                      <button
                        className="vs-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t);
                        }}
                        title="Close Tab (Ctrl+W)"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="vs-tabbar-actions">
              <button
                className={`vs-action-pill ${showDiff ? 'active' : ''}`}
                onClick={() => setShowDiff((prev) => !prev)}
                title="Toggle Git Diff vs HEAD"
                disabled={!activeFile}
              >
                ⎇ {showDiff ? 'Hide Diff' : 'Diff'}
              </button>
              <button
                className={`vs-action-pill ${minimap ? 'active' : ''}`}
                onClick={() => setMinimap((p) => !p)}
                title="Toggle Minimap"
              >
                Map
              </button>
              <button
                className={`vs-action-pill ${wordWrap === 'on' ? 'active' : ''}`}
                onClick={() => setWordWrap((p) => (p === 'on' ? 'off' : 'on'))}
                title="Toggle Word Wrap (Alt+Z)"
              >
                Wrap
              </button>
              <button
                className="vs-action-pill vs-save-btn"
                onClick={() => saveFile()}
                disabled={!activeFile || !dirtyFiles.has(activeFile) || saving}
                title="Save File (Ctrl+S)"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* Breadcrumbs Navigation */}
          {activeFile && (
            <div className="vs-breadcrumbs">
              <span className="vs-bc-icon">{fileIcon(activeFile)}</span>
              {activeFile.split('/').map((part, idx, arr) => (
                <span key={idx} className="vs-bc-segment">
                  <span className={idx === arr.length - 1 ? 'vs-bc-file' : 'vs-bc-folder'}>
                    {part}
                  </span>
                  {idx < arr.length - 1 && <span className="vs-bc-sep">/</span>}
                </span>
              ))}
              <span className="vs-bc-lang">{getReadableLang(activeLang)}</span>
              {showDiff && <span className="vs-bc-diff-tag">Comparing with Git HEAD</span>}
            </div>
          )}

          {/* Monaco Editor Container */}
          <div className="vs-monaco-container">
            {activeFile ? (
              showDiff ? (
                <MonacoDiffEditor
                  key={`diff-${activeFile}`}
                  original={activeGitContent}
                  modified={activeContent}
                  language={activeLang}
                  theme={editorTheme}
                  options={{
                    readOnly: false,
                    originalEditable: false,
                    renderSideBySide: true,
                    fontSize: 13,
                    fontFamily:
                      "var(--font-mono), 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
                    scrollBeyondLastLine: false,
                    minimap: { enabled: minimap },
                    wordWrap,
                  }}
                />
              ) : (
                <MonacoEditor
                  key={activeFile}
                  height="100%"
                  language={activeLang}
                  value={loading ? '// Loading file content…' : activeContent}
                  theme={editorTheme}
                  onChange={handleEdit}
                  onMount={handleEditorMount}
                  options={{
                    fontSize: 13,
                    fontFamily:
                      "var(--font-mono), 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
                    fontLigatures: true,
                    tabSize: 2,
                    insertSpaces: true,
                    wordWrap,
                    lineNumbersMinChars: 3,
                    scrollBeyondLastLine: false,
                    renderLineHighlight: 'all',
                    cursorBlinking: 'smooth',
                    cursorSmoothCaretAnimation: 'on',
                    bracketPairColorization: { enabled: true },
                    autoClosingBrackets: 'always',
                    autoClosingQuotes: 'always',
                    formatOnPaste: true,
                    folding: true,
                    minimap: { enabled: minimap, maxColumn: 80 },
                    padding: { top: 12, bottom: 12 },
                    smoothScrolling: true,
                  }}
                />
              )
            ) : (
              <div className="vs-welcome-view">
                <div className="vs-welcome-logo">⚡</div>
                <h2 className="vs-welcome-title">Open Code Editor</h2>
                <p className="vs-welcome-desc">
                  Select a file from the explorer or start by creating a new file.
                </p>
                <div className="vs-welcome-actions">
                  <button className="vs-welcome-btn" onClick={() => newFile()}>
                    + New File (Ctrl+N)
                  </button>
                  <button className="vs-welcome-btn secondary" onClick={() => setQuickOpen(true)}>
                    Search Files (Ctrl+P)
                  </button>
                </div>
                <div className="vs-welcome-shortcuts">
                  <div className="vs-sc-item"><kbd>Ctrl+P</kbd> Quick Open File</div>
                  <div className="vs-sc-item"><kbd>Ctrl+S</kbd> Save File</div>
                  <div className="vs-sc-item"><kbd>Ctrl+W</kbd> Close Tab</div>
                  <div className="vs-sc-item"><kbd>Ctrl+B</kbd> Toggle Sidebar</div>
                </div>
              </div>
            )}
          </div>

          {/* ── Bottom VS Code Status Bar ── */}
          <div className="vs-statusbar">
            <div className="vs-status-left">
              <span className="vs-status-item branch" title="Git Branch">
                ⎇ {gitBranch}
              </span>
              <span
                className={`vs-status-item agent-pill ${agentRunning ? 'running' : 'idle'}`}
                title="Agent Activity"
              >
                {agentRunning ? '● Agent Working…' : '○ Agent Idle'}
              </span>
              <span className="vs-status-item">
                {dirtyFiles.has(activeFile ?? '') ? '● Unsaved Changes' : '✓ Saved'}
              </span>
            </div>

            <div className="vs-status-right">
              {activeFile && (
                <>
                  <span className="vs-status-item">
                    Ln {cursorPos.ln}, Col {cursorPos.col}
                    {cursorPos.selected > 0 ? ` (${cursorPos.selected} selected)` : ''}
                  </span>
                  <span className="vs-status-item">Spaces: 2</span>
                  <span className="vs-status-item">UTF-8</span>
                  <span className="vs-status-item">LF</span>
                  <span className="vs-status-item lang">{getReadableLang(activeLang)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Open File Dialog (Ctrl+P) ── */}
      {quickOpen && (
        <div className="vs-quickopen-backdrop" onClick={() => setQuickOpen(false)}>
          <div className="vs-quickopen-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vs-quickopen-input-row">
              <span className="vs-quickopen-icon">🔍</span>
              <input
                className="vs-quickopen-input"
                placeholder="Search file by name… (Esc to close)"
                value={quickOpenQuery}
                onChange={(e) => setQuickOpenQuery(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickOpenResults.length > 0) {
                    openFile(quickOpenResults[0].fullPath);
                    setQuickOpen(false);
                  }
                  if (e.key === 'Escape') {
                    setQuickOpen(false);
                  }
                }}
              />
            </div>
            <div className="vs-quickopen-results">
              {quickOpenResults.length === 0 ? (
                <div className="vs-quickopen-empty">No matching files found</div>
              ) : (
                quickOpenResults.map((f, i) => (
                  <div
                    key={f.fullPath}
                    className={`vs-quickopen-item ${i === 0 ? 'highlight' : ''}`}
                    onClick={() => {
                      openFile(f.fullPath);
                      setQuickOpen(false);
                    }}
                  >
                    <span className="vs-qo-icon">{fileIcon(f.name)}</span>
                    <span className="vs-qo-name">{f.name}</span>
                    <span className="vs-qo-path">{f.fullPath}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── VS Code Theme Styling ── */}
      <style jsx global>{`
        .vs-shell {
          display: flex;
          flex-direction: column;
          height: 100vh;
          width: 100vw;
          background: #1e1e1e;
          color: #cccccc;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          overflow: hidden;
          user-select: none;
        }

        /* Top Title Bar */
        .vs-topbar {
          height: 38px;
          background: #323233;
          border-bottom: 1px solid #252526;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          flex-shrink: 0;
        }
        .vs-topbar-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .vs-logo {
          color: #e5a00d;
          font-size: 15px;
        }
        .vs-app-title {
          font-weight: 600;
          font-size: 12px;
          color: #e7e7e7;
        }
        .vs-proj-tag {
          font-size: 11px;
          color: #858585;
          margin-right: 6px;
        }
        .vs-menu-items {
          display: flex;
          gap: 2px;
        }
        .vs-menu-btn {
          background: none;
          border: none;
          color: #cccccc;
          font-size: 11.5px;
          padding: 2px 7px;
          border-radius: 3px;
          cursor: pointer;
        }
        .vs-menu-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .vs-topbar-center {
          flex: 1;
          max-width: 480px;
          display: flex;
          justify-content: center;
        }
        .vs-search-palette-btn {
          width: 100%;
          background: #3c3c3c;
          border: 1px solid #454545;
          border-radius: 6px;
          padding: 4px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #9d9d9d;
          font-size: 11.5px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .vs-search-palette-btn:hover {
          background: #474747;
          color: #e7e7e7;
          border-color: #007acc;
        }

        .vs-topbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .vs-sync-notice {
          font-size: 11px;
          color: #4ec9b0;
          font-weight: 500;
        }
        .vs-save-notice {
          font-size: 11px;
          color: #388a34;
          font-weight: 500;
        }
        .vs-back-btn {
          font-size: 11.5px;
          color: #ffffff;
          background: #0e639c;
          padding: 3px 10px;
          border-radius: 4px;
          text-decoration: none;
          font-weight: 500;
          transition: background 0.15s;
        }
        .vs-back-btn:hover {
          background: #1177bb;
        }

        /* Workspace Body */
        .vs-body {
          flex: 1;
          display: flex;
          min-height: 0;
          overflow: hidden;
        }

        /* Activity Bar */
        .vs-activitybar {
          width: 48px;
          background: #333333;
          border-right: 1px solid #252526;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 8px 0;
          flex-shrink: 0;
        }
        .vs-act-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
          align-items: center;
        }
        .vs-act-btn {
          width: 40px;
          height: 40px;
          border-radius: 6px;
          background: transparent;
          border: none;
          color: #858585;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s;
          position: relative;
        }
        .vs-act-btn:hover {
          color: #ffffff;
        }
        .vs-act-btn.act {
          color: #ffffff;
          border-left: 2px solid #ffffff;
        }
        .vs-act-agent-dot {
          font-size: 16px;
          color: #858585;
        }
        .vs-act-agent-dot.act {
          color: #e5a00d;
          animation: pulse-soft 1.8s infinite;
        }

        /* Primary Sidebar */
        .vs-sidebar {
          width: 260px;
          background: #252526;
          border-right: 1px solid #1e1e1e;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
          min-height: 0;
          overflow: hidden;
        }
        .vs-side-head {
          padding: 10px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #1e1e1e;
          flex-shrink: 0;
        }
        .vs-side-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          color: #bbbbbb;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vs-side-actions {
          display: flex;
          gap: 4px;
        }
        .vs-icon-btn {
          background: transparent;
          border: none;
          color: #858585;
          cursor: pointer;
          font-size: 13px;
          padding: 2px 4px;
          border-radius: 3px;
        }
        .vs-icon-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }

        .vs-side-searchbox {
          padding: 8px 10px;
          border-bottom: 1px solid #1e1e1e;
          flex-shrink: 0;
        }
        .vs-search-input {
          width: 100%;
          background: #3c3c3c;
          border: 1px solid #3c3c3c;
          border-radius: 4px;
          padding: 5px 8px;
          color: #cccccc;
          font-size: 12px;
          outline: none;
        }
        .vs-search-input:focus {
          border-color: #007acc;
        }
        .vs-search-input::placeholder {
          color: #707070;
        }

        .vs-tree-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }
        .vs-empty-hint {
          padding: 16px;
          font-size: 12px;
          color: #707070;
          text-align: center;
        }

        /* Tree node rows */
        .s-row {
          display: flex;
          align-items: center;
          width: 100%;
          min-height: 22px;
          transition: background 0.1s;
          position: relative;
        }
        .s-row:hover {
          background: #2a2d2e;
        }
        .s-row.act {
          background: #37373d;
        }
        .s-dir {
          cursor: pointer;
        }
        .s-row-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1;
          background: none;
          border: none;
          cursor: pointer;
          color: #cccccc;
          font-size: 12.5px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          padding: 2px 6px;
          text-align: left;
        }
        .s-row.act .s-row-btn {
          color: #ffffff;
          font-weight: 500;
        }
        .s-chev {
          transition: transform 0.15s;
          color: #858585;
          flex-shrink: 0;
        }
        .s-chev.open {
          transform: rotate(90deg);
        }
        .s-folder-ic {
          font-size: 12px;
          flex-shrink: 0;
        }
        .s-file-ic {
          font-size: 12px;
          flex-shrink: 0;
        }
        .s-nm {
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .s-dirty-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #e5a00d;
          flex-shrink: 0;
          margin-left: 4px;
        }
        .s-open-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #007acc;
          flex-shrink: 0;
          margin-left: 4px;
        }
        .s-action-btn {
          background: none;
          border: none;
          color: #858585;
          font-size: 12px;
          cursor: pointer;
          padding: 0 5px;
          border-radius: 3px;
        }
        .s-action-btn:hover {
          color: #ffffff;
        }
        .s-del-btn:hover {
          color: #f14c4c !important;
        }

        /* Search panel */
        .vs-search-panel {
          display: flex;
          flex-direction: column;
          flex: 1;
          overflow: hidden;
        }
        .vs-results-count {
          padding: 6px 12px;
          font-size: 11px;
          color: #858585;
        }

        /* Editor Region */
        .vs-editor-region {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: #1e1e1e;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        /* Tabs Bar */
        .vs-tabbar {
          height: 35px;
          background: #252526;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid #1e1e1e;
          flex-shrink: 0;
        }
        .vs-tabs-scroll {
          display: flex;
          overflow-x: auto;
          height: 100%;
          flex: 1;
        }
        .vs-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 12px;
          height: 100%;
          font-size: 12px;
          color: #969696;
          background: #2d2d2d;
          border-right: 1px solid #252526;
          cursor: pointer;
          flex-shrink: 0;
          max-width: 200px;
          transition: background 0.1s;
        }
        .vs-tab:hover {
          background: #2a2a2a;
          color: #cccccc;
        }
        .vs-tab.cur {
          background: #1e1e1e;
          color: #ffffff;
          border-top: 2px solid #007acc;
        }
        .vs-tab-icon {
          font-size: 12px;
        }
        .vs-tab-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .vs-tab-dirty {
          font-size: 12px;
          color: #e5a00d;
          padding: 0 3px;
        }
        .vs-tab-close {
          background: none;
          border: none;
          color: #858585;
          font-size: 11px;
          padding: 2px 4px;
          border-radius: 3px;
          cursor: pointer;
          opacity: 0.6;
        }
        .vs-tab-close:hover {
          opacity: 1;
          color: #ffffff;
          background: rgba(255, 255, 255, 0.15);
        }

        .vs-tabbar-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          padding-right: 12px;
        }
        .vs-action-pill {
          background: #3c3c3c;
          border: 1px solid #4a4a4a;
          color: #cccccc;
          border-radius: 4px;
          padding: 3px 8px;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .vs-action-pill:hover:not(:disabled) {
          background: #505050;
          color: #ffffff;
        }
        .vs-action-pill.active {
          background: #007acc;
          border-color: #007acc;
          color: #ffffff;
        }
        .vs-action-pill:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .vs-save-btn {
          background: #0e639c;
          border-color: #0e639c;
          color: #ffffff;
          font-weight: 500;
        }
        .vs-save-btn:hover:not(:disabled) {
          background: #1177bb;
        }

        /* Breadcrumbs */
        .vs-breadcrumbs {
          height: 24px;
          background: #1e1e1e;
          border-bottom: 1px solid #252526;
          display: flex;
          align-items: center;
          padding: 0 16px;
          font-size: 11px;
          color: #858585;
          gap: 4px;
          flex-shrink: 0;
        }
        .vs-bc-icon {
          margin-right: 4px;
        }
        .vs-bc-segment {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .vs-bc-folder {
          color: #858585;
        }
        .vs-bc-file {
          color: #cccccc;
          font-weight: 500;
        }
        .vs-bc-sep {
          color: #555555;
        }
        .vs-bc-lang {
          margin-left: auto;
          font-size: 10px;
          color: #707070;
          text-transform: uppercase;
        }
        .vs-bc-diff-tag {
          font-size: 10.5px;
          color: #e5a00d;
          background: rgba(229, 160, 13, 0.15);
          padding: 1px 6px;
          border-radius: 3px;
        }

        /* Monaco Container */
        .vs-monaco-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        .monaco-loading-placeholder {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #858585;
          font-size: 12px;
        }
        .monaco-spinner {
          width: 24px;
          height: 24px;
          border: 2px solid #3c3c3c;
          border-top-color: #007acc;
          border-radius: 50%;
          animation: spin-slow 1s linear infinite;
        }

        /* Welcome Empty View */
        .vs-welcome-view {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          text-align: center;
          padding: 24px;
        }
        .vs-welcome-logo {
          font-size: 42px;
          color: #e5a00d;
        }
        .vs-welcome-title {
          font-size: 18px;
          font-weight: 600;
          color: #cccccc;
        }
        .vs-welcome-desc {
          font-size: 12.5px;
          color: #858585;
          max-width: 400px;
        }
        .vs-welcome-actions {
          display: flex;
          gap: 10px;
          margin-top: 8px;
        }
        .vs-welcome-btn {
          background: #007acc;
          border: none;
          color: #ffffff;
          padding: 7px 16px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          font-weight: 500;
        }
        .vs-welcome-btn:hover {
          background: #0062a3;
        }
        .vs-welcome-btn.secondary {
          background: #3c3c3c;
          border: 1px solid #4a4a4a;
        }
        .vs-welcome-btn.secondary:hover {
          background: #474747;
        }
        .vs-welcome-shortcuts {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 20px;
        }
        .vs-sc-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 11.5px;
          color: #707070;
        }
        .vs-sc-item kbd {
          background: #2d2d2d;
          border: 1px solid #3c3c3c;
          border-radius: 3px;
          padding: 2px 6px;
          font-family: monospace;
          color: #cccccc;
        }

        /* Status Bar */
        .vs-statusbar {
          height: 22px;
          background: #007acc;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          font-size: 11px;
          color: #ffffff;
          flex-shrink: 0;
        }
        .vs-status-left,
        .vs-status-right {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .vs-status-item {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: default;
        }
        .vs-status-item.branch {
          font-weight: 600;
        }
        .vs-status-item.agent-pill.running {
          color: #fffae0;
          font-weight: 600;
        }

        /* Quick Open Modal (Ctrl+P) */
        .vs-quickopen-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          padding-top: 50px;
          z-index: 9999;
        }
        .vs-quickopen-modal {
          width: 550px;
          max-height: 400px;
          background: #252526;
          border: 1px solid #454545;
          border-radius: 6px;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .vs-quickopen-input-row {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: #2d2d2d;
          border-bottom: 1px solid #3c3c3c;
          gap: 8px;
        }
        .vs-quickopen-icon {
          font-size: 13px;
          color: #858585;
        }
        .vs-quickopen-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #ffffff;
          font-size: 13px;
          outline: none;
        }
        .vs-quickopen-results {
          overflow-y: auto;
          flex: 1;
          max-height: 320px;
        }
        .vs-quickopen-empty {
          padding: 18px;
          text-align: center;
          color: #707070;
          font-size: 12px;
        }
        .vs-quickopen-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          cursor: pointer;
          font-size: 12px;
          color: #cccccc;
        }
        .vs-quickopen-item:hover,
        .vs-quickopen-item.highlight {
          background: #094771;
          color: #ffffff;
        }
        .vs-qo-icon {
          font-size: 13px;
        }
        .vs-qo-name {
          font-weight: 500;
        }
        .vs-qo-path {
          margin-left: auto;
          font-size: 11px;
          color: #858585;
        }
        .vs-quickopen-item:hover .vs-qo-path,
        .vs-quickopen-item.highlight .vs-qo-path {
          color: #b0d4f1;
        }

        /* Agent Panel */
        .ed-agent {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          height: 100%;
        }
        .ed-agent-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ed-ag-title {
          font-size: 12px;
          font-weight: 700;
          color: #cccccc;
        }
        .ed-ag-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 12px;
          font-weight: 500;
        }
        .badge-running {
          background: rgba(229, 160, 13, 0.2);
          color: #e5a00d;
          border: 1px solid rgba(229, 160, 13, 0.3);
        }
        .badge-idle {
          background: rgba(255, 255, 255, 0.05);
          color: #858585;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .ed-ag-card {
          background: #1e1e1e;
          border: 1px solid #333333;
          border-radius: 6px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ed-ag-row {
          display: flex;
          justify-content: space-between;
          font-size: 11.5px;
        }
        .ed-ag-prop {
          color: #858585;
        }
        .ed-ag-val {
          color: #e7e7e7;
        }
        .ed-ag-desc {
          font-size: 11.5px;
          color: #858585;
          line-height: 1.5;
        }
        .ed-ag-btn {
          margin-top: auto;
          background: #007acc;
          color: #ffffff;
          padding: 8px 12px;
          border-radius: 4px;
          text-align: center;
          font-size: 12px;
          font-weight: 500;
          text-decoration: none;
        }
        .ed-ag-btn:hover {
          background: #0062a3;
        }

        /* Database & Source Control Styles */
        .ed-db {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }
        .ed-db-hdr {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 12px;
          border-bottom: 1px solid #1e1e1e;
        }
        .ed-db-title {
          font-size: 12px;
          font-weight: 600;
          color: #e7e7e7;
          flex: 1;
        }
        .ed-db-pill {
          font-size: 10px;
          color: #4ec9b0;
          background: rgba(78, 201, 176, 0.1);
          border: 1px solid rgba(78, 201, 176, 0.25);
          border-radius: 10px;
          padding: 2px 7px;
        }
        .ed-db-ref {
          background: none;
          border: none;
          color: #858585;
          font-size: 13px;
          cursor: pointer;
        }
        .ed-db-ref:hover {
          color: #ffffff;
        }
        .ed-db-stabs {
          display: flex;
          border-bottom: 1px solid #1e1e1e;
          overflow-x: auto;
        }
        .ed-db-stab {
          padding: 7px 10px;
          font-size: 11px;
          color: #858585;
          background: none;
          border: none;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          white-space: nowrap;
        }
        .ed-db-stab:hover {
          color: #cccccc;
        }
        .ed-db-stab.on {
          color: #007acc;
          border-bottom-color: #007acc;
        }
        .ed-db-body {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .ed-db-load {
          padding: 12px;
          font-size: 11px;
          color: #858585;
          font-style: italic;
        }
        .db-sec {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .db-sec-ttl {
          font-size: 10.5px;
          font-weight: 600;
          color: #bbbbbb;
          padding-bottom: 4px;
          border-bottom: 1px solid #1e1e1e;
        }
        .db-kv {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }
        .db-k {
          color: #858585;
        }
        .db-v {
          color: #cccccc;
          font-family: monospace;
          font-size: 10px;
        }
        .db-stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        .db-stat-card {
          background: #1e1e1e;
          border: 1px solid #333333;
          border-radius: 6px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .db-stat-l {
          font-size: 8.5px;
          text-transform: uppercase;
          color: #858585;
          font-weight: 700;
        }
        .db-stat-v {
          font-size: 15px;
          font-weight: 700;
        }
        .c0 { color: #569cd6; }
        .c1 { color: #c586c0; }
        .c2 { color: #dcdcaa; }
        .c3 { color: #4ec9b0; }
        .db-stat-s {
          font-size: 9.5px;
          color: #707070;
        }
        .db-tbl-card {
          background: #1e1e1e;
          border: 1px solid #333333;
          border-radius: 6px;
          overflow: hidden;
        }
        .db-tbl-card-hdr {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-bottom: 1px solid #2a2a2a;
          font-size: 11.5px;
        }
        .db-tbl-nm {
          flex: 1;
          color: #e7e7e7;
          font-weight: 500;
        }
        .db-tbl-cnt {
          font-size: 10px;
          color: #858585;
        }
        .db-cols {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          padding: 6px 10px;
        }
        .db-col-pill {
          display: flex;
          align-items: center;
          gap: 4px;
          background: #252526;
          border: 1px solid #333333;
          border-radius: 3px;
          padding: 2px 6px;
          font-size: 10px;
        }
        .db-col-nm {
          color: #cccccc;
        }
        .db-col-type {
          color: #858585;
          font-family: monospace;
        }
        .db-ql {
          font-size: 10px;
          color: #858585;
          text-transform: uppercase;
          font-weight: 700;
        }
        .db-qi {
          width: 100%;
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          border-radius: 4px;
          padding: 8px 10px;
          color: #dcdcaa;
          font-family: monospace;
          font-size: 11.5px;
          outline: none;
          resize: none;
        }
        .db-qi:focus {
          border-color: #007acc;
        }
        .db-qrun {
          padding: 6px;
          background: #0e639c;
          border: none;
          border-radius: 4px;
          color: white;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
        }
        .db-qrun:hover:not(:disabled) {
          background: #1177bb;
        }
        .db-qrun:disabled {
          opacity: 0.5;
        }
        .db-qresult {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .db-qmeta {
          font-size: 10px;
          color: #858585;
        }
        .db-qerr {
          font-size: 11px;
          color: #f14c4c;
          background: rgba(241, 76, 76, 0.1);
          border: 1px solid rgba(241, 76, 76, 0.25);
          border-radius: 4px;
          padding: 6px 8px;
        }
        .db-qtw {
          overflow-x: auto;
          border: 1px solid #333333;
          border-radius: 4px;
          max-height: 200px;
          overflow-y: auto;
        }
        .db-qt {
          width: 100%;
          border-collapse: collapse;
          font-size: 10.5px;
          font-family: monospace;
        }
        .db-qt th {
          padding: 5px 8px;
          background: #252526;
          color: #858585;
          text-align: left;
          border-bottom: 1px solid #333333;
        }
        .db-qt td {
          padding: 4px 8px;
          color: #cccccc;
          border-bottom: 1px solid #2a2a2a;
          white-space: nowrap;
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .ed-sc {
          display: flex;
          flex-direction: column;
          padding: 12px;
          gap: 12px;
          height: 100%;
          overflow-y: auto;
        }
        .ed-sc-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          border-bottom: 1px solid #1e1e1e;
          padding-bottom: 8px;
        }
        .ed-sc-title {
          font-size: 11px;
          font-weight: 700;
          color: #cccccc;
        }
        .ed-sc-branch {
          font-size: 10px;
          color: #858585;
          margin-top: 2px;
        }
        .ed-sc-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ed-sc-actions input {
          background: #1e1e1e;
          border: 1px solid #3c3c3c;
          border-radius: 4px;
          padding: 6px 8px;
          color: #cccccc;
          font-size: 11.5px;
          outline: none;
        }
        .ed-sc-actions input:focus {
          border-color: #007acc;
        }
        .ed-sc-actions button {
          background: #0e639c;
          border: none;
          border-radius: 4px;
          padding: 6px;
          color: white;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
        }
        .ed-sc-actions button:hover:not(:disabled) {
          background: #1177bb;
        }
        .ed-sc-actions button:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ed-sc-notice {
          font-size: 10.5px;
          color: #4ec9b0;
          background: rgba(78, 201, 176, 0.1);
          border: 1px solid rgba(78, 201, 176, 0.2);
          border-radius: 4px;
          padding: 6px 8px;
        }
        .ed-sc-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ed-sc-label {
          font-size: 10px;
          color: #858585;
          font-weight: 700;
          text-transform: uppercase;
        }
        .ed-sc-change {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #cccccc;
        }
        .ed-sc-change code {
          color: #e5a00d;
          font-family: monospace;
          font-weight: bold;
        }
        .ed-sc-empty {
          font-size: 11px;
          color: #707070;
          font-style: italic;
        }
        .ed-sc-graph {
          margin: 0;
          max-height: 180px;
          overflow: auto;
          background: #1e1e1e;
          border: 1px solid #333333;
          border-radius: 4px;
          padding: 8px;
          font-size: 10px;
          color: #858585;
          white-space: pre-wrap;
          font-family: monospace;
        }

        /* Light Theme Overrides */
        html[data-theme='light'] .vs-shell {
          background: #ffffff;
          color: #333333;
        }
        html[data-theme='light'] .vs-topbar {
          background: #dddddd;
          border-bottom-color: #cccccc;
        }
        html[data-theme='light'] .vs-app-title {
          color: #222222;
        }
        html[data-theme='light'] .vs-search-palette-btn {
          background: #f3f3f3;
          border-color: #d0d0d0;
          color: #555555;
        }
        html[data-theme='light'] .vs-activitybar {
          background: #2c2c2c;
        }
        html[data-theme='light'] .vs-sidebar {
          background: #f3f3f3;
          border-right-color: #e5e5e5;
        }
        html[data-theme='light'] .vs-side-head {
          border-bottom-color: #e5e5e5;
        }
        html[data-theme='light'] .vs-side-title {
          color: #333333;
        }
        html[data-theme='light'] .vs-search-input {
          background: #ffffff;
          border-color: #d0d0d0;
          color: #333333;
        }
        html[data-theme='light'] .s-row:hover {
          background: #e8e8e8;
        }
        html[data-theme='light'] .s-row.act {
          background: #e4e6f1;
        }
        html[data-theme='light'] .s-row-btn {
          color: #333333;
        }
        html[data-theme='light'] .vs-editor-region {
          background: #ffffff;
        }
        html[data-theme='light'] .vs-tabbar {
          background: #ececec;
          border-bottom-color: #e0e0e0;
        }
        html[data-theme='light'] .vs-tab {
          background: #e4e4e4;
          color: #666666;
          border-right-color: #e0e0e0;
        }
        html[data-theme='light'] .vs-tab.cur {
          background: #ffffff;
          color: #333333;
        }
        html[data-theme='light'] .vs-breadcrumbs {
          background: #ffffff;
          border-bottom-color: #f0f0f0;
          color: #666666;
        }
        html[data-theme='light'] .vs-action-pill {
          background: #f0f0f0;
          border-color: #d5d5d5;
          color: #333333;
        }
        html[data-theme='light'] .vs-quickopen-modal {
          background: #ffffff;
          border-color: #cccccc;
        }
        html[data-theme='light'] .vs-quickopen-input-row {
          background: #f3f3f3;
          border-bottom-color: #e0e0e0;
        }
        html[data-theme='light'] .vs-quickopen-input {
          color: #333333;
        }
        html[data-theme='light'] .vs-quickopen-item {
          color: #333333;
        }
        html[data-theme='light'] .vs-quickopen-item:hover,
        html[data-theme='light'] .vs-quickopen-item.highlight {
          background: #e8e8e8;
          color: #000000;
        }
        html[data-theme='light'] .ed-agent-head .ed-ag-title,
        html[data-theme='light'] .ed-db-title,
        html[data-theme='light'] .ed-sc-title {
          color: #333333;
        }
        html[data-theme='light'] .ed-ag-card,
        html[data-theme='light'] .db-stat-card,
        html[data-theme='light'] .db-tbl-card,
        html[data-theme='light'] .ed-sc-actions input,
        html[data-theme='light'] .ed-sc-graph {
          background: #ffffff;
          border-color: #e0e0e0;
        }
        html[data-theme='light'] .ed-ag-val,
        html[data-theme='light'] .db-v,
        html[data-theme='light'] .ed-sc-change {
          color: #333333;
        }
      `}</style>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#1e1e1e',
            color: '#858585',
            fontFamily: 'Inter, system-ui, sans-serif',
          }}
        >
          Loading Open Code Editor…
        </div>
      }
    >
      <EditorInner />
    </Suspense>
  );
}
