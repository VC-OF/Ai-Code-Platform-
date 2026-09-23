'use client';

import { useState, useCallback, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { buildTree, languageFor, type TreeNode } from '@/lib/file-utils';

// ─── Syntax highlighter ────────────────────────────────────────────────────────
function highlight(code: string, lang: string): string {
  const esc = code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  if (lang === 'markdown') return `<span style="color:#cdd6f4">${esc}</span>`;
  if (lang === 'css') return esc
    .replace(/(\/\*[\s\S]*?\*\/)/g,'<span class="tok-comment">$1</span>')
    .replace(/([.#]?[\w-]+)\s*\{/g,'<span class="tok-type">$1</span>{')
    .replace(/([\w-]+)\s*:/g,'<span class="tok-kw">$1</span>:')
    .replace(/:\s*([^;{}]+)/g,': <span class="tok-string">$1</span>');
  if (lang === 'json') return esc
    .replace(/("(?:[^"\\]|\\.)*")\s*:/g,'<span class="tok-kw">$1</span>:')
    .replace(/:\s*("(?:[^"\\]|\\.)*")/g,': <span class="tok-string">$1</span>')
    .replace(/\b(true|false|null)\b/g,'<span class="tok-type">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="tok-num">$1</span>');
  return esc
    .replace(/(\/\/[^\n]*)/g,'<span class="tok-comment">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g,'<span class="tok-comment">$1</span>')
    .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g,'<span class="tok-string">$1</span>')
    .replace(/\b(const|let|var|function|return|import|export|default|from|if|else|for|while|do|switch|case|break|continue|class|extends|new|typeof|instanceof|async|await|type|interface|enum|void|null|undefined|true|false|try|catch|finally|throw|of|in)\b/g,'<span class="tok-kw">$1</span>')
    .replace(/\b([A-Z][A-Za-z0-9_]*)\b/g,'<span class="tok-type">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g,'<span class="tok-num">$1</span>');
}

function fileIcon(n: string) {
  if (n.endsWith('.tsx')||n.endsWith('.jsx')) return '⚛';
  if (n.endsWith('.ts')||n.endsWith('.js'))   return '◈';
  if (n.endsWith('.css')||n.endsWith('.scss')) return '🎨';
  if (n.endsWith('.json')) return '{}';
  if (n.endsWith('.md'))   return '📝';
  if (n.endsWith('.yml')||n.endsWith('.yaml')) return '⚙';
  if (n.endsWith('.sh'))   return '$';
  if (n.includes('.env'))  return '🔑';
  if (n.endsWith('.html')) return '🌐';
  return '◌';
}

function SideNode({ node, depth, activeFile, openFiles, onSelect, expanded, onToggle, onDelete, onNewFile }: {
  node: TreeNode; depth: number; activeFile: string|null; openFiles: Set<string>;
  onSelect: (p:string)=>void; expanded: Set<string>; onToggle: (p:string)=>void;
  onDelete: (p:string)=>void; onNewFile: (d:string)=>void;
}) {
  const isExp = expanded.has(node.fullPath);
  const isAct = activeFile === node.fullPath;
  const pl = 10 + depth * 14;
  const [hov, setHov] = useState(false);

  if (node.isDirectory) return (
    <div>
      <div className="s-row s-dir" style={{paddingLeft:pl}} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
        <button className="s-row-btn" onClick={()=>onToggle(node.fullPath)}>
          <svg className={`s-chev ${isExp?'open':''}`} viewBox="0 0 24 24" fill="currentColor" width={10} height={10}><path d="M10 6l6 6-6 6V6z"/></svg>
          <span className="s-folder-ic">{isExp?'📂':'📁'}</span>
          <span className="s-nm">{node.name}</span>
        </button>
        {hov && <button className="s-action-btn" onClick={()=>onNewFile(node.fullPath)}>+</button>}
      </div>
      {isExp && node.children.map(c=>(
        <SideNode key={c.fullPath} node={c} depth={depth+1} activeFile={activeFile}
          openFiles={openFiles} onSelect={onSelect} expanded={expanded}
          onToggle={onToggle} onDelete={onDelete} onNewFile={onNewFile}/>
      ))}
    </div>
  );

  return (
    <div className={`s-row ${isAct?'act':''}`} style={{paddingLeft:pl+14}}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>
      <button className="s-row-btn" onClick={()=>onSelect(node.fullPath)}>
        <span className="s-file-ic">{fileIcon(node.name)}</span>
        <span className="s-nm">{node.name}</span>
        {openFiles.has(node.fullPath) && <span className="s-open-dot"/>}
      </button>
      {hov && <button className="s-action-btn s-del-btn" onClick={()=>onDelete(node.fullPath)}>×</button>}
    </div>
  );
}

// ─── DB Panel ─────────────────────────────────────────────────────────────────
type DbTab = 'overview'|'tables'|'llm'|'tools'|'messages'|'query';

// Loose row shape for the debug tables — fields vary per section
type DbRow = {
  id?: string; model?: string; total_tokens?: number; cost_usd?: number;
  created_at?: number; success?: number; tool_name?: string;
  duration_ms?: number; role?: string; content?: string; tokens_used?: number;
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
    messages?: number; tool_calls?: number; total_tokens?: number;
    total_cost_usd?: number; turn_count?: number; checkpoints?: number;
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
  const [tab,        setTab]        = useState<DbTab>('overview');
  const [overview,   setOverview]   = useState<DbOverview | null>(null);
  const [section,    setSection]    = useState<DbSection | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [sql,        setSql]        = useState('SELECT * FROM projects;');
  const [sqlRes,     setSqlRes]     = useState<SqlResult | null>(null);
  const [sqlRunning, setSqlRunning] = useState(false);

  const fetchOverview = useCallback(()=>{
    setLoading(true);
    fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=overview`)
      .then(r=>r.json()).then(d=>setOverview(d)).finally(()=>setLoading(false));
  },[projectId]);

  const fetchSection = useCallback((sec: string)=>{
    setLoading(true); setSection(null);
    fetch(`/api/database?projectId=${encodeURIComponent(projectId)}&section=${sec}`)
      .then(r=>r.json()).then(d=>setSection(d)).finally(()=>setLoading(false));
  },[projectId]);

  // Fetch-on-mount: the loading flag is intentionally set synchronously
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ fetchOverview(); },[fetchOverview]);

  const runSql = ()=>{
    if (!sql.trim()) return;
    setSqlRunning(true); setSqlRes(null);
    fetch('/api/database',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sql,projectId}),
    }).then(r=>r.json()).then(d=>setSqlRes(d))
      .catch(e=>setSqlRes({error:String(e)}))
      .finally(()=>setSqlRunning(false));
  };

  const switchTab = (t: DbTab)=>{
    setTab(t);
    if (t==='overview') { if (!overview) fetchOverview(); }
    else if (t!=='query') {
      const map: Record<string,string> = {tables:'tables',llm:'usage',tools:'tools',messages:'messages'};
      fetchSection(map[t]||t);
    }
  };

  const COLORS = ['#6366f1','#f59e0b','#10b981','#3b82f6','#8b5cf6','#ec4899'];

  return (
    <div className="ed-db">
      {/* header */}
      <div className="ed-db-hdr">
        <span className="ed-db-title">🗄 Database Explorer</span>
        <span className="ed-db-pill">{overview?'● Connected':'○ …'}</span>
        <button className="ed-db-ref" onClick={()=>{ setOverview(null); fetchOverview(); }}>↻</button>
      </div>

      {/* sub-tabs */}
      <div className="ed-db-stabs">
        {(['overview','tables','llm','tools','messages','query'] as DbTab[]).map(t=>(
          <button key={t} className={`ed-db-stab ${tab===t?'on':''}`} onClick={()=>switchTab(t)}>
            {t==='llm'?'LLM':t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      <div className="ed-db-body">
        {loading && <div className="ed-db-load">Loading…</div>}

        {/* Overview */}
        {tab==='overview' && !loading && overview && <>
          {overview.project && (
            <div className="db-sec">
              <div className="db-sec-ttl">📁 Project</div>
              {[['Name',overview.project.name],['ID',overview.project.id],['Folder',overview.project.workspace?.split(/[/\\]/).pop()??'–']].map(([k,v])=>(
                <div key={k} className="db-kv">
                  <span className="db-k">{k}</span>
                  <span className="db-v" style={{maxWidth:130,overflow:'hidden',textOverflow:'ellipsis'}}>{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="db-stat-grid">
            {[
              {l:'MESSAGES',  v:overview.stats?.messages??0,          s:'Chat history',   c:0},
              {l:'TOOL CALLS',v:overview.stats?.tool_calls??0,        s:'Agent tool uses', c:1},
              {l:'TOKENS',    v:(overview.stats?.total_tokens??0)>999?`${((overview.stats?.total_tokens??0)/1000).toFixed(1)}K`:String(overview.stats?.total_tokens??0), s:'LLM total', c:2},
              {l:'COST',      v:`$${(overview.stats?.total_cost_usd??0).toFixed(4)}`,      s:'USD spent',     c:3},
              {l:'TURNS',     v:overview.stats?.turn_count??0,         s:'LLM turns',     c:0},
              {l:'COMMITS',   v:overview.stats?.checkpoints??0,        s:'Git checkpoints',c:1},
            ].map(s=>(
              <div key={s.l} className="db-stat-card">
                <span className="db-stat-l">{s.l}</span>
                <span className={`db-stat-v c${s.c}`}>{String(s.v)}</span>
                <span className="db-stat-s">{s.s}</span>
              </div>
            ))}
          </div>
          <div className="db-sec">
            <div className="db-sec-ttl">🗄 SQLite File</div>
            {[['Tables',overview.health?.tables?.length??0],['Size',`${((overview.health?.size_bytes??0)/1024).toFixed(1)} KB`],['Status',overview.health?.ok?'✓ OK':'✗ Error']].map(([k,v])=>(
              <div key={k} className="db-kv">
                <span className="db-k">{k}</span>
                <span className={`db-v ${k==='Status'?'g':''}`}>{String(v)}</span>
              </div>
            ))}
          </div>
          <div className="db-sec">
            <div className="db-sec-ttl">■ Tables</div>
            {(overview.tables??[]).map((t,i)=>(
              <div key={t.name} className="db-tbl-row" onClick={()=>switchTab('tables')}>
                <span style={{color:COLORS[i%6],fontSize:10}}>■</span>
                <span className="db-tbl-nm">{t.name}</span>
                <span className="db-tbl-cnt">{t.rows.toLocaleString()} rows</span>
              </div>
            ))}
          </div>
        </>}

        {/* Tables */}
        {tab==='tables' && !loading && section && (
          <div className="db-sec">
            {(section.tables??[]).map((t,i)=>(
              <div key={t.name} className="db-tbl-card">
                <div className="db-tbl-card-hdr">
                  <span style={{color:COLORS[i%6]}}>■</span>
                  <span className="db-tbl-nm">{t.name}</span>
                  <span className="db-tbl-cnt">{t.rows?.toLocaleString()} rows</span>
                </div>
                <div className="db-cols">
                  {(t.columns??[]).map((c)=>(
                    <span key={c.name} className="db-col-pill">
                      <span className="db-col-nm">{c.name}</span>
                      <span className="db-col-type">{c.type}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div className="db-hint">{((section.size_bytes??0)/1024).toFixed(1)} KB total</div>
          </div>
        )}

        {/* LLM */}
        {tab==='llm' && !loading && section && <>
          <div className="db-sec">
            <div className="db-sec-ttl">💰 Usage Summary</div>
            {[['Total Tokens',(section.summary?.total_tokens??0).toLocaleString()],['Total Cost',`$${(section.summary?.total_cost_usd??0).toFixed(5)}`],['LLM Turns',section.summary?.turn_count??0]].map(([k,v])=>(
              <div key={k} className="db-kv">
                <span className="db-k">{k}</span><span className="db-v g">{String(v)}</span>
              </div>
            ))}
          </div>
          <div className="db-sec">
            <div className="db-sec-ttl">🤖 By Model</div>
            {(section.byModel??[]).length===0 && <div className="db-hint">No LLM calls recorded yet.</div>}
            {(section.byModel??[]).map((m)=>(
              <div key={m.model} className="db-model-row">
                <div className="db-model-nm">{m.model}</div>
                <div className="db-model-st">
                  <span>{m.calls} calls</span>
                  <span>{(m.total_tokens??0).toLocaleString()} tok</span>
                  <span className="g">${(m.cost_usd??0).toFixed(5)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="db-sec">
            <div className="db-sec-ttl">📋 Recent</div>
            {(section.rows??[]).slice(0,15).map((r)=>(
              <div key={r.id} className="db-llm-row">
                <span className="db-llm-m">{r.model}</span>
                <span className="db-llm-t">{r.total_tokens?.toLocaleString()} tok</span>
                <span className="db-llm-c g">${(r.cost_usd??0).toFixed(5)}</span>
                <span className="db-llm-ts">{new Date(r.created_at??0).toLocaleTimeString()}</span>
              </div>
            ))}
            {(section.rows??[]).length===0 && <div className="db-hint">No usage logged yet.</div>}
          </div>
        </>}

        {/* Tools */}
        {tab==='tools' && !loading && section && <>
          <div className="db-sec">
            <div className="db-sec-ttl">🔧 Tool Stats</div>
            {(section.stats??[]).length===0 && <div className="db-hint">No tool calls yet.</div>}
            {(section.stats??[]).map((t)=>(
              <div key={t.tool_name} className="db-tool-row">
                <div className="db-tool-nm">{t.tool_name}</div>
                <div className="db-tool-st">
                  <span>{t.call_count} calls</span>
                  <span className="g">{t.success_count} ✓</span>
                  <span>{Math.round(t.avg_duration_ms)}ms avg</span>
                </div>
              </div>
            ))}
          </div>
          <div className="db-sec">
            <div className="db-sec-ttl">📋 Recent</div>
            {(section.rows??[]).slice(0,12).map((r)=>(
              <div key={r.id} className="db-tool-log">
                <span className={`db-tl-s ${r.success?'ok':'fail'}`}>{r.success?'✓':'✗'}</span>
                <span className="db-tl-nm">{r.tool_name}</span>
                <span className="db-tl-d">{r.duration_ms}ms</span>
              </div>
            ))}
          </div>
        </>}

        {/* Messages */}
        {tab==='messages' && !loading && section && (
          <div className="db-sec">
            <div className="db-sec-ttl">💬 Chat History ({(section.rows??[]).length})</div>
            {(section.rows??[]).length===0 && <div className="db-hint">No messages yet.</div>}
            {(section.rows??[]).map((m)=>(
              <div key={m.id} className={`db-msg db-msg-${m.role}`}>
                <span className="db-msg-role">{m.role}</span>
                <span className="db-msg-body">{String(m.content).slice(0,120)}{(m.content?.length??0)>120?'…':''}</span>
                {m.tokens_used ? <span className="db-msg-tok">{m.tokens_used} tok</span> : null}
              </div>
            ))}
          </div>
        )}

        {/* Query */}
        {tab==='query' && <>
          <div className="db-ql">SQL Query</div>
          <textarea className="db-qi" value={sql} onChange={e=>setSql(e.target.value)} rows={5} spellCheck={false}
            placeholder="SELECT * FROM projects;"
            onKeyDown={e=>{ if ((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runSql();} }}/>
          <button className="db-qrun" disabled={sqlRunning} onClick={runSql}>
            {sqlRunning?'⏳ Running…':'▶ Run Query (Ctrl+Enter)'}
          </button>
          {sqlRes && (
            <div className="db-qresult">
              {sqlRes.error
                ? <div className="db-qerr">{sqlRes.error}</div>
                : <>
                    <div className="db-qmeta">{sqlRes.rows?.length??0} rows · {sqlRes.elapsed_ms}ms</div>
                    {sqlRes.rows && sqlRes.rows.length > 0 && (
                      <div className="db-qtw">
                        <table className="db-qt">
                          <thead><tr>{Object.keys(sqlRes.rows[0]).map((k)=><th key={k}>{k}</th>)}</tr></thead>
                          <tbody>{sqlRes.rows.map((row,i)=>(
                            <tr key={i}>{Object.values(row).map((v,j)=><td key={j}>{String(v??'').slice(0,60)}</td>)}</tr>
                          ))}</tbody>
                        </table>
                      </div>
                    )}
                  </>
              }
            </div>
          )}
        </>}
      </div>
    </div>
  );
}

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
    const res = await fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`);
    setData(await res.json());
  }, [projectId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/git/status?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (active) setData(json);
      })
      .catch(() => {
        if (active) setNotice('Unable to read git status.');
      });
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
          <div className="ed-sc-branch">{data.branch || 'Reading repository…'}</div>
        </div>
        <button className="ed-db-ref" onClick={() => refresh()} title="Refresh source control">↻</button>
      </div>
      <div className="ed-sc-actions">
        <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Commit message" maxLength={200} />
        <button onClick={() => runAction('commit')} disabled={busy || !message.trim()}>Commit</button>
        <button onClick={() => runAction('push')} disabled={busy}>Push</button>
      </div>
      {notice && <div className="ed-sc-notice">{notice}</div>}
      <div className="ed-sc-section">
        <div className="ed-sc-label">Changes · {data.changes?.length ?? 0}</div>
        {data.changes?.length ? data.changes.map((change) => (
          <div className="ed-sc-change" key={`${change.code}-${change.path}`}>
            <code>{change.code.trim() || '·'}</code><span>{change.path}</span>
          </div>
        )) : <div className="ed-sc-empty">Working tree clean.</div>}
      </div>
      <div className="ed-sc-section ed-sc-graph-section">
        <div className="ed-sc-label">Commit Graph</div>
        <pre className="ed-sc-graph">{data.graph?.length ? data.graph.join('\n') : 'No commits yet.'}</pre>
      </div>
      {data.remote?.length ? <div className="ed-sc-remote">Remote · {data.remote[0]}</div> : null}
    </div>
  );
}

// ─── Editor inner ──────────────────────────────────────────────────────────────
function EditorInner() {
  const params    = useSearchParams();
  const projectId = params.get('projectId') || 'default';

  const [tree,         setTree]         = useState<TreeNode[]>([]);
  const [treeLoading,  setTreeLoading]  = useState(true);
  const [expanded,     setExpanded]     = useState<Set<string>>(new Set(['src','src/app','src/components','src/lib']));
  const [openTabs,     setOpenTabs]     = useState<string[]>([]);
  const [activeFile,   setActiveFile]   = useState<string|null>(null);
  const [fileContents, setFileContents] = useState<Map<string,string>>(new Map());
  const [dirtyFiles,   setDirtyFiles]   = useState<Set<string>>(new Set());
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [rightPanel,   setRightPanel]   = useState<'agent'|'database'|'source'>('source');
  const [search,       setSearch]       = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadTree = useCallback(async ()=>{
    setTreeLoading(true);
    try {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      const d = await res.json();
      setTree(buildTree(d.tree||[]));
    } catch{} finally { setTreeLoading(false); }
  },[projectId]);

  // Fetch-on-mount: the loading flag is intentionally set synchronously
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{ loadTree(); },[loadTree]);

  const openFile = useCallback(async(fp:string)=>{
    setActiveFile(fp);
    if (!openTabs.includes(fp)) setOpenTabs(p=>[...p,fp]);
    if (!fileContents.has(fp)) {
      setLoading(true);
      try {
        const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(fp)}`);
        const d = await res.json();
        setFileContents(p=>new Map(p).set(fp,d.content??''));
      } catch {
        setFileContents(p=>new Map(p).set(fp,'// Failed to load file'));
      } finally { setLoading(false); }
    }
  },[projectId,openTabs,fileContents]);

  const handleEdit = useCallback((v:string)=>{
    if (!activeFile) return;
    setFileContents(p=>new Map(p).set(activeFile,v));
    setDirtyFiles(p=>new Set(p).add(activeFile));
  },[activeFile]);

  const saveFile = useCallback(async(fp?:string)=>{
    const path=fp??activeFile; if(!path) return;
    const content=fileContents.get(path)??'';
    setSaving(true);
    try {
      await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,content,projectId})});
      setDirtyFiles(p=>{const n=new Set(p);n.delete(path);return n;});
      setSaveMsg('Saved ✓'); setTimeout(()=>setSaveMsg(''),2000);
    } catch { setSaveMsg('Save failed ✗'); setTimeout(()=>setSaveMsg(''),2000); }
    finally { setSaving(false); }
  },[activeFile,fileContents,projectId]);

  const closeTab = useCallback((fp:string)=>{
    if (dirtyFiles.has(fp) && !confirm(`"${fp.split('/').pop()}" has unsaved changes. Close anyway?`)) return;
    setOpenTabs(p=>{
      const next=p.filter(t=>t!==fp);
      if (activeFile===fp) setActiveFile(next[next.length-1]??null);
      return next;
    });
    setDirtyFiles(p=>{const n=new Set(p);n.delete(fp);return n;});
  },[activeFile,dirtyFiles]);

  const deleteFile = useCallback(async(fp:string)=>{
    if (!confirm(`Delete "${fp}"?`)) return;
    await fetch(`/api/files?path=${encodeURIComponent(fp)}&projectId=${encodeURIComponent(projectId)}`,{method:'DELETE'});
    closeTab(fp); loadTree();
  },[projectId,closeTab,loadTree]);

  const newFile = useCallback(async(dir?:string)=>{
    const name=prompt(`New file path${dir?` in ${dir}`:''}:`); if (!name?.trim()) return;
    const fp=dir?`${dir}/${name.trim()}`:name.trim();
    await fetch('/api/files',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:fp,content:'',projectId})});
    await loadTree(); openFile(fp);
  },[projectId,loadTree,openFile]);

  const toggleFolder = useCallback((p:string)=>{
    setExpanded(prev=>{
      const n=new Set(prev);
      if (n.has(p)) {
        n.delete(p);
      } else {
        n.add(p);
      }
      return n;
    });
  },[]);

  useEffect(()=>{
    const h=(e:KeyboardEvent)=>{
      if ((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();saveFile();}
      if ((e.ctrlKey||e.metaKey)&&e.key==='w'){e.preventDefault();if(activeFile)closeTab(activeFile);}
      if ((e.ctrlKey||e.metaKey)&&e.key==='n'){e.preventDefault();newFile();}
    };
    window.addEventListener('keydown',h);
    return ()=>window.removeEventListener('keydown',h);
  },[saveFile,closeTab,activeFile,newFile]);

  const searchTerm = search.trim().toLowerCase();
  const activeContent = activeFile?(fileContents.get(activeFile)??''):'';
  const activeLang    = activeFile?languageFor(activeFile):'plaintext';
  const activeLines   = activeContent.split('\n');
  const openFileSet   = new Set(openTabs);

  const flatFiles: TreeNode[] = [];
  const flatten = (ns:TreeNode[])=>{ for(const n of ns){if(!n.isDirectory)flatFiles.push(n);if(n.isDirectory)flatten(n.children);} };
  flatten(tree);
  const filteredFiles = searchTerm ? flatFiles.filter(f=>f.fullPath.toLowerCase().includes(searchTerm)) : [];

  return (
    <div className="ed-shell">
      {/* Title bar */}
      <div className="ed-bar">
        <div className="ed-bar-l">
          <span className="ed-logo">⚡</span>
          {['File','Edit','Selection','View','Go','Run','Terminal','Help'].map(m=>(
            <button key={m} className="ed-menu" onClick={m==='File'?()=>newFile():undefined}>{m}</button>
          ))}
          <span className="ed-proj">{projectId}</span>
        </div>
        <div className="ed-bar-r">
          {saveMsg && <span className="ed-save-msg">{saveMsg}</span>}
          <a href={`/?projectId=${projectId}`} className="ed-back" id="btn-back-to-agent">← Back to Agent</a>
          <div className="ed-wc">
            <span className="wc wc-y"/><span className="wc wc-g"/>
            <a href={`/?projectId=${projectId}`} className="wc wc-r" title="Close"/>
          </div>
        </div>
      </div>

      <div className="ed-body">
        {/* Sidebar */}
        <div className="ed-side">
          <div className="ed-side-hdr">
            <span>▾ {projectId.toUpperCase()}</span>
            <div className="ed-side-acts">
              <button onClick={()=>newFile()} className="ed-side-btn">+</button>
              <button onClick={loadTree} className="ed-side-btn">↻</button>
            </div>
          </div>
          <div className="ed-search-w">
            <input className="ed-search" placeholder="Search files…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <div className="ed-side-tree">
            {treeLoading ? <div className="ed-hint">Loading files…</div>
             : searchTerm ? (
               filteredFiles.length===0 ? <div className="ed-hint">No results</div>
               : filteredFiles.map(f=>(
                 <button key={f.fullPath} className={`s-row s-row-btn ${activeFile===f.fullPath?'act':''}`}
                   style={{paddingLeft:12}} onClick={()=>openFile(f.fullPath)}>
                   <span className="s-file-ic">{fileIcon(f.name)}</span>
                   <span className="s-nm" style={{fontSize:11}}>{f.fullPath}</span>
                 </button>
               ))
             )
             : tree.map(n=>(
               <SideNode key={n.fullPath} node={n} depth={0} activeFile={activeFile}
                 openFiles={openFileSet} onSelect={openFile} expanded={expanded}
                 onToggle={toggleFolder} onDelete={deleteFile} onNewFile={newFile}/>
             ))
            }
          </div>
        </div>

        {/* Code area */}
        <div className="ed-main">
          {/* Tabs */}
          <div className="ed-tabs">
            {openTabs.map(t=>(
              <div key={t} className={`ed-tab ${activeFile===t?'cur':''} ${dirtyFiles.has(t)?'dirty':''}`} onClick={()=>openFile(t)}>
                <span className="ed-tab-ic">{fileIcon(t.split('/').pop()??t)}</span>
                <span className="ed-tab-nm">{t.split('/').pop()}</span>
                {dirtyFiles.has(t) && <span className="ed-dirty">●</span>}
                <button className="ed-tab-x" onClick={e=>{e.stopPropagation();closeTab(t);}}>×</button>
              </div>
            ))}
            <button className="ed-new-tab" onClick={()=>newFile()}>+</button>
          </div>

          {activeFile ? (
            <>
              <div className="ed-bc">
                {activeFile.split('/').map((s,i,a)=>(
                  <span key={i}>
                    <span className={i===a.length-1?'bc-a':'bc-s'}>{s}</span>
                    {i<a.length-1&&<span className="bc-sep"> › </span>}
                  </span>
                ))}
                <span className="bc-lang">{activeLang}</span>
                {saving && <span className="bc-saving">Saving…</span>}
              </div>

              <div className="ed-code-wrap">
                <div className="ed-gutter">
                  {activeLines.map((_,i)=><div key={i} className="ed-ln">{i+1}</div>)}
                </div>
                <div className="ed-editor-area">
                  {loading ? <div className="ed-hint" style={{padding:24}}>Loading…</div> : <>
                    <pre className="ed-hi" aria-hidden dangerouslySetInnerHTML={{__html:highlight(activeContent,activeLang)+'\n'}}/>
                    <textarea ref={textareaRef} className="ed-ta" value={activeContent}
                      onChange={e=>handleEdit(e.target.value)}
                      onKeyDown={e=>{
                        if(e.key==='Tab'){e.preventDefault();const el=e.currentTarget;const s=el.selectionStart;handleEdit(el.value.substring(0,s)+'  '+el.value.substring(el.selectionEnd));setTimeout(()=>{el.selectionStart=el.selectionEnd=s+2;},0);}
                      }}
                      spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"/>
                  </>}
                </div>
              </div>

              <div className="ed-status">
                <div className="ed-st-l">
                  <span>⎇ main</span>
                  <span>{dirtyFiles.has(activeFile)?'● Unsaved':'✓ Saved'}</span>
                  <span>{activeLang}</span>
                </div>
                <div className="ed-st-r">
                  <span>Ln {activeLines.length}</span>
                  <span>UTF-8</span>
                  <button className="ed-st-save" onClick={()=>saveFile()} disabled={!dirtyFiles.has(activeFile)}>
                    {saving?'Saving…':'Save (Ctrl+S)'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="ed-welcome">
              <div style={{fontSize:40}}>⚡</div>
              <div className="ed-wc-title">Open a file to start editing</div>
              <div className="ed-wc-sub">Click any file in the explorer, or press Ctrl+N to create one.</div>
              <div className="ed-shortcuts">
                {[['Ctrl+N','New file'],['Ctrl+S','Save'],['Ctrl+W','Close tab'],['Tab','Indent']].map(([k,v])=>(
                  <div key={k} className="ed-shortcut"><kbd>{k}</kbd> {v}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="ed-rp">
          <div className="ed-rp-tabs">
            <button className={`ed-rp-tab ${rightPanel==='agent'?'on':''}`} onClick={()=>setRightPanel('agent')}>● Agent</button>
            <button className={`ed-rp-tab ${rightPanel==='source'?'on':''}`} onClick={()=>setRightPanel('source')}>⌘ Source</button>
            <button className={`ed-rp-tab ${rightPanel==='database'?'on':''}`} onClick={()=>setRightPanel('database')}>🗄 Database</button>
          </div>

          {rightPanel==='source' && <SourceControlPanel projectId={projectId}/>}
          {rightPanel==='database' && <DbPanel projectId={projectId}/>}

          {rightPanel==='agent' && (
            <div className="ed-agent">
              <div className="ed-ag-title">Agent Status</div>
              {[{n:'Planner',s:'Planning',c:'green'},{n:'Executor',s:'Running',c:'orange'},{n:'Reviewer',s:'Idle',c:'gray'}].map(a=>(
                <div key={a.n} className="ed-ag-row">
                  <span className={`ed-ag-dot d-${a.c}`}/>
                  <span className="ed-ag-name">{a.n}</span>
                  <span className="ed-ag-status">{a.s}</span>
                </div>
              ))}
              <div style={{fontSize:11,color:'#374151',fontStyle:'italic',paddingTop:4}}>Agent is working on your project.</div>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        .ed-shell{display:flex;flex-direction:column;height:100vh;width:100vw;background:#0d0d0d;color:#cdd6f4;font-family:'Inter',system-ui,sans-serif;overflow:hidden;}

        /* bar */
        .ed-bar{height:36px;background:#1a1a1a;border-bottom:1px solid #252525;display:flex;align-items:center;justify-content:space-between;padding:0 12px;flex-shrink:0;user-select:none;}
        .ed-bar-l{display:flex;align-items:center;gap:4px;}
        .ed-logo{font-size:16px;color:#f59e0b;margin-right:6px;}
        .ed-menu{font-size:12px;color:#9ca3af;background:none;border:none;padding:2px 8px;border-radius:4px;cursor:pointer;}
        .ed-menu:hover{background:rgba(255,255,255,.07);color:#e5e7eb;}
        .ed-proj{font-size:11px;color:#4b5563;margin-left:8px;}
        .ed-bar-r{display:flex;align-items:center;gap:10px;}
        .ed-save-msg{font-size:11px;color:#34d399;font-weight:500;}
        .ed-back{font-size:11.5px;color:#34d399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.28);border-radius:6px;padding:4px 12px;text-decoration:none;}
        .ed-back:hover{background:rgba(52,211,153,.18);}
        .ed-wc{display:flex;gap:6px;align-items:center;}
        .wc{width:12px;height:12px;border-radius:50%;display:block;text-decoration:none;cursor:pointer;}
        .wc-y{background:#f59e0b;}.wc-g{background:#10b981;}.wc-r{background:#ef4444;}

        /* body */
        .ed-body{flex:1;display:flex;overflow:hidden;min-height:0;}

        /* sidebar */
        .ed-side{width:220px;flex-shrink:0;min-height:0;background:#111;border-right:1px solid #1e1e1e;display:flex;flex-direction:column;overflow:hidden;}
        .ed-side-hdr{padding:8px 10px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#4b5563;border-bottom:1px solid #1e1e1e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .ed-side-acts{display:flex;gap:4px;}
        .ed-side-btn{background:none;border:none;color:#6b7280;font-size:14px;cursor:pointer;padding:0 3px;border-radius:3px;}
        .ed-side-btn:hover{color:#d1d5db;background:rgba(255,255,255,.06);}
        .ed-search-w{padding:6px 8px;border-bottom:1px solid #1e1e1e;flex-shrink:0;}
        .ed-search{width:100%;background:rgba(0,0,0,.3);border:1px solid #2a2a2a;border-radius:5px;padding:5px 8px;font-size:11.5px;color:#d1d5db;outline:none;}
        .ed-search:focus{border-color:rgba(96,165,250,.5);}
        .ed-search::placeholder{color:#374151;}
        .ed-side-tree{flex:1;overflow-y:auto;padding:4px 0;}
        .ed-hint{padding:12px;font-size:11.5px;color:#374151;font-style:italic;}

        /* tree */
        .s-row{display:flex;align-items:center;width:100%;min-height:22px;transition:background .1s;position:relative;}
        .s-row:hover{background:rgba(255,255,255,.04);}
        .s-row.act{background:rgba(0,122,255,.12);}
        .s-dir{cursor:default;}
        .s-row-btn{display:flex;align-items:center;gap:5px;flex:1;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;text-align:left;}
        .s-row.act .s-row-btn{color:#60a5fa;}
        .s-chev{transition:transform .15s;color:#4b5563;flex-shrink:0;}
        .s-chev.open{transform:rotate(90deg);}
        .s-folder-ic{font-size:12px;flex-shrink:0;}
        .s-file-ic{font-size:11px;flex-shrink:0;color:#6b7280;}
        .s-nm{overflow:hidden;text-overflow:ellipsis;}
        .s-open-dot{width:5px;height:5px;border-radius:50%;background:#60a5fa;flex-shrink:0;margin-left:2px;}
        .s-action-btn{background:none;border:none;color:#6b7280;font-size:13px;cursor:pointer;padding:0 4px;flex-shrink:0;border-radius:3px;}
        .s-action-btn:hover{color:#d1d5db;}
        .s-del-btn:hover{color:#f87171!important;}

        /* main */
        .ed-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0;min-height:0;background:#0d0d0d;}
        .ed-tabs{display:flex;background:#111;border-bottom:1px solid #1e1e1e;height:34px;overflow-x:auto;flex-shrink:0;align-items:stretch;}
        .ed-tab{display:flex;align-items:center;gap:5px;padding:0 10px;height:100%;font-size:11.5px;color:#6b7280;cursor:pointer;border-right:1px solid #1e1e1e;flex-shrink:0;background:#111;max-width:180px;}
        .ed-tab:hover{color:#d1d5db;background:rgba(255,255,255,.03);}
        .ed-tab.cur{color:#f3f4f6;background:#0d0d0d;border-bottom:2px solid #007acc;}
        .ed-tab-ic{font-size:11px;flex-shrink:0;}
        .ed-tab-nm{font-family:'JetBrains Mono',monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .ed-dirty{color:#f59e0b;font-size:10px;flex-shrink:0;}
        .ed-tab-x{font-size:14px;color:#374151;background:none;border:none;cursor:pointer;padding:0 2px;border-radius:3px;line-height:1;flex-shrink:0;}
        .ed-tab-x:hover{color:#f87171;}
        .ed-new-tab{padding:0 12px;background:none;border:none;border-left:1px solid #1e1e1e;color:#4b5563;font-size:18px;cursor:pointer;flex-shrink:0;line-height:34px;}
        .ed-new-tab:hover{color:#d1d5db;}

        .ed-bc{padding:4px 16px;font-size:11px;border-bottom:1px solid #181818;background:#0f0f0f;flex-shrink:0;display:flex;align-items:center;gap:4px;}
        .bc-sep{color:#2d2d2d;}.bc-s{color:#4b5563;}.bc-a{color:#9ca3af;}
        .bc-lang{margin-left:auto;background:rgba(255,255,255,.04);border:1px solid #252525;border-radius:3px;padding:1px 6px;font-size:9.5px;color:#4b5563;text-transform:uppercase;}
        .bc-saving{font-size:10px;color:#f59e0b;margin-left:8px;}

        .ed-code-wrap{flex:1;overflow:hidden;display:flex;font-family:'JetBrains Mono',monospace;font-size:13px;line-height:1.7;}
        .ed-gutter{min-width:54px;padding:12px 0;text-align:right;color:#2d3748;font-size:12px;line-height:1.7;background:#0d0d0d;border-right:1px solid #181818;flex-shrink:0;user-select:none;overflow:hidden;}
        .ed-ln{padding-right:16px;}
        .ed-editor-area{flex:1;position:relative;overflow:auto;}
        .ed-hi{position:absolute;top:0;left:0;right:0;padding:12px 20px;margin:0;white-space:pre;color:#cdd6f4;font-family:inherit;font-size:inherit;line-height:inherit;pointer-events:none;z-index:1;overflow:visible;min-height:100%;}
        .ed-ta{position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;padding:12px 20px;background:transparent;border:none;outline:none;resize:none;color:transparent;caret-color:#f3f4f6;font-family:inherit;font-size:inherit;line-height:inherit;z-index:2;white-space:pre;overflow-wrap:normal;}

        :global(.tok-kw){color:#c792ea;}:global(.tok-string){color:#c3e88d;}:global(.tok-comment){color:#546e7a;font-style:italic;}:global(.tok-type){color:#82aaff;}:global(.tok-num){color:#f78c6c;}

        .ed-status{height:24px;background:#007acc;display:flex;align-items:center;justify-content:space-between;padding:0 10px;flex-shrink:0;}
        .ed-st-l,.ed-st-r{display:flex;align-items:center;gap:14px;}
        .ed-st-l span,.ed-st-r span{font-size:11px;color:rgba(255,255,255,.85);}
        .ed-st-save{font-size:10.5px;color:rgba(255,255,255,.8);background:rgba(255,255,255,.12);border:none;border-radius:4px;padding:2px 8px;cursor:pointer;}
        .ed-st-save:hover:not(:disabled){background:rgba(255,255,255,.2);}
        .ed-st-save:disabled{opacity:.4;cursor:default;}

        .ed-welcome{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:40px;}
        .ed-wc-title{font-size:16px;font-weight:600;color:#6b7280;}
        .ed-wc-sub{font-size:12px;color:#374151;}
        .ed-shortcuts{display:flex;flex-direction:column;gap:6px;margin-top:16px;}
        .ed-shortcut{display:flex;align-items:center;gap:10px;font-size:12px;color:#4b5563;}
        .ed-shortcut kbd{background:#1e1e1e;border:1px solid #2a2a2a;border-radius:4px;padding:2px 7px;font-size:10.5px;font-family:'JetBrains Mono',monospace;color:#9ca3af;}

        /* right panel */
        .ed-rp{width:280px;flex-shrink:0;min-height:0;border-left:1px solid #1e1e1e;display:flex;flex-direction:column;background:#111;overflow:hidden;}
        .ed-rp-tabs{display:flex;border-bottom:1px solid #1e1e1e;flex-shrink:0;}
        .ed-rp-tab{flex:1;padding:9px 8px;font-size:11.5px;color:#6b7280;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-weight:500;}
        .ed-rp-tab:hover{color:#d1d5db;}
        .ed-rp-tab.on{color:#f3f4f6;border-bottom-color:#10b981;}

        /* DB panel */
        .ed-db{display:flex;flex-direction:column;flex:1;overflow:hidden;}
        .ed-db-hdr{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid #1e1e1e;flex-shrink:0;}
        .ed-db-title{font-size:12px;font-weight:600;color:#e5e7eb;flex:1;}
        .ed-db-pill{font-size:10px;color:#34d399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.25);border-radius:10px;padding:2px 7px;}
        .ed-db-ref{background:none;border:none;color:#4b5563;font-size:14px;cursor:pointer;padding:2px 4px;border-radius:3px;}
        .ed-db-ref:hover{color:#d1d5db;}
        .ed-db-stabs{display:flex;border-bottom:1px solid #1e1e1e;flex-shrink:0;overflow-x:auto;}
        .ed-db-stab{flex:0 0 auto;padding:6px 9px;font-size:10px;color:#6b7280;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;}
        .ed-db-stab:hover{color:#d1d5db;}
        .ed-db-stab.on{color:#60a5fa;border-bottom-color:#60a5fa;}
        .ed-db-body{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:10px;}
        .ed-db-load{padding:12px;font-size:11px;color:#374151;font-style:italic;}

        /* DB sections */
        .db-sec{display:flex;flex-direction:column;gap:5px;}
        .db-sec-ttl{font-size:10.5px;font-weight:600;color:#9ca3af;padding-bottom:4px;border-bottom:1px solid #1e1e1e;}
        .db-kv{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;}
        .db-k{color:#4b5563;}
        .db-v{color:#9ca3af;font-family:'JetBrains Mono',monospace;font-size:10px;}
        .db-v.g,.g{color:#34d399;}
        .db-hint{font-size:10.5px;color:#374151;font-style:italic;padding:4px 0;}

        /* Stat grid */
        .db-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px;}
        .db-stat-card{background:rgba(255,255,255,.03);border:1px solid #1e2a2a;border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;}
        .db-stat-l{font-size:8px;text-transform:uppercase;letter-spacing:.06em;color:#4b5563;font-weight:700;}
        .db-stat-v{font-size:16px;font-weight:700;}
        .c0{color:#60a5fa;}.c1{color:#a78bfa;}.c2{color:#f59e0b;}.c3{color:#34d399;}
        .db-stat-s{font-size:9px;color:#374151;}

        /* Table rows/cards */
        .db-tbl-row{display:flex;align-items:center;gap:8px;padding:5px 8px;background:rgba(255,255,255,.02);border:1px solid #1e1e1e;border-radius:5px;cursor:pointer;font-size:12px;}
        .db-tbl-row:hover{background:rgba(255,255,255,.04);}
        .db-tbl-nm{flex:1;color:#d1d5db;}
        .db-tbl-cnt{font-size:10px;color:#4b5563;}
        .db-tbl-card{background:rgba(255,255,255,.02);border:1px solid #1e1e1e;border-radius:7px;overflow:hidden;}
        .db-tbl-card-hdr{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #1a1a1a;font-size:12px;}
        .db-cols{display:flex;flex-wrap:wrap;gap:4px;padding:7px 10px;}
        .db-col-pill{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.03);border:1px solid #252525;border-radius:4px;padding:2px 6px;font-size:10px;}
        .db-col-nm{color:#cdd6f4;}
        .db-col-type{color:#4b5563;font-family:'JetBrains Mono',monospace;}

        /* LLM rows */
        .db-model-row{background:rgba(255,255,255,.02);border:1px solid #1e1e1e;border-radius:6px;padding:7px 10px;}
        .db-model-nm{font-size:11.5px;color:#82aaff;font-weight:600;margin-bottom:3px;}
        .db-model-st{display:flex;gap:10px;font-size:10px;color:#6b7280;}
        .db-llm-row{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1a1a1a;font-size:10.5px;}
        .db-llm-m{flex:1;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .db-llm-t{color:#4b5563;}
        .db-llm-ts{color:#374151;font-size:9.5px;}

        /* Tool rows */
        .db-tool-row{background:rgba(255,255,255,.02);border:1px solid #1e1e1e;border-radius:6px;padding:7px 10px;}
        .db-tool-nm{font-size:11.5px;color:#c3e88d;font-weight:600;margin-bottom:3px;}
        .db-tool-st{display:flex;gap:10px;font-size:10px;color:#6b7280;}
        .db-tool-log{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:10.5px;border-bottom:1px solid #1a1a1a;}
        .db-tl-s{font-size:10px;}
        .db-tl-s.ok{color:#34d399;}.db-tl-s.fail{color:#f87171;}
        .db-tl-nm{flex:1;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;}
        .db-tl-d{color:#4b5563;font-size:9.5px;}

        /* Message rows */
        .db-msg{display:flex;flex-direction:column;gap:3px;padding:6px 8px;border-radius:5px;border:1px solid #1e1e1e;font-size:10.5px;}
        .db-msg-user{background:rgba(0,122,255,.06);border-color:rgba(0,122,255,.15);}
        .db-msg-assistant{background:rgba(52,211,153,.04);border-color:rgba(52,211,153,.12);}
        .db-msg-tool{background:rgba(245,158,11,.04);border-color:rgba(245,158,11,.12);}
        .db-msg-role{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;font-weight:700;}
        .db-msg-body{color:#9ca3af;line-height:1.5;}
        .db-msg-tok{font-size:9px;color:#374151;}

        /* SQL */
        .db-ql{font-size:10px;color:#4b5563;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
        .db-qi{width:100%;background:#0a0a0a;border:1px solid #1e2a3a;border-radius:6px;padding:10px 12px;color:#c3e88d;font-family:'JetBrains Mono',monospace;font-size:11.5px;outline:none;resize:none;line-height:1.6;}
        .db-qi:focus{border-color:rgba(96,165,250,.4);}
        .db-qrun{padding:7px;background:#1d4ed8;border:none;border-radius:6px;color:white;font-size:11.5px;font-weight:500;cursor:pointer;width:100%;}
        .db-qrun:hover:not(:disabled){background:#2563eb;}
        .db-qrun:disabled{opacity:.5;cursor:default;}
        .db-qresult{display:flex;flex-direction:column;gap:6px;}
        .db-qmeta{font-size:10px;color:#4b5563;}
        .db-qerr{font-size:11px;color:#f87171;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.2);border-radius:5px;padding:8px 10px;}
        .db-qtw{overflow-x:auto;border:1px solid #1e1e1e;border-radius:5px;max-height:200px;overflow-y:auto;}
        .db-qt{width:100%;border-collapse:collapse;font-size:10.5px;font-family:'JetBrains Mono',monospace;}
        .db-qt th{padding:5px 8px;background:#151515;color:#6b7280;font-weight:600;text-align:left;border-bottom:1px solid #252525;font-size:9.5px;text-transform:uppercase;white-space:nowrap;}
        .db-qt td{padding:4px 8px;color:#cdd6f4;border-bottom:1px solid #1a1a1a;white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;}
        .db-qt tr:last-child td{border-bottom:none;}
        .db-qt tr:hover td{background:rgba(255,255,255,.02);}

        /* Agent */
        .ed-agent{padding:14px;display:flex;flex-direction:column;gap:10px;}
        .ed-ag-title{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#4b5563;font-weight:700;}
        .ed-ag-row{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,.02);border:1px solid #1e1e1e;border-radius:8px;}
        .ed-ag-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
        .d-green{background:#34d399;box-shadow:0 0 5px #34d399;animation:pulse-soft 1.5s infinite;}
        .d-orange{background:#f59e0b;}
        .d-gray{background:#374151;}
        .ed-ag-name{flex:1;font-size:12px;color:#d1d5db;}
        .ed-ag-status{font-size:10.5px;color:#4b5563;}

        .ed-sc{display:flex;flex-direction:column;min-height:0;flex:1;overflow-y:auto;padding:12px;gap:12px;background:var(--bg-surface);}
        .ed-sc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border-subtle);padding-bottom:10px;}
        .ed-sc-title{font-size:12px;font-weight:700;color:var(--text-primary);}
        .ed-sc-branch{font-size:10px;color:var(--text-muted);font-family:var(--font-mono);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px;}
        .ed-sc-actions{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:5px;}
        .ed-sc-actions input{min-width:0;background:var(--bg-base);border:1px solid var(--border-base);border-radius:var(--radius-sm);padding:6px 7px;color:var(--text-primary);font-size:10px;outline:none;}
        .ed-sc-actions input:focus{border-color:var(--brand);}
        .ed-sc-actions button{background:var(--brand);border:0;border-radius:var(--radius-sm);padding:0 8px;color:#fffaf7;font-size:10px;font-weight:600;cursor:pointer;}
        .ed-sc-actions button:last-child{background:var(--bg-elevated);border:1px solid var(--border-base);color:var(--text-primary);}
        .ed-sc-actions button:disabled{opacity:.45;cursor:not-allowed;}
        .ed-sc-notice{font-size:10px;color:var(--brand);background:var(--brand-glow);border:1px solid var(--accent-border);border-radius:var(--radius-sm);padding:6px 8px;}
        .ed-sc-section{display:flex;flex-direction:column;gap:5px;min-width:0;}
        .ed-sc-label{font-size:9px;color:var(--text-muted);font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding-bottom:4px;border-bottom:1px solid var(--border-subtle);}
        .ed-sc-change{display:flex;align-items:center;gap:7px;font-size:10.5px;color:var(--text-secondary);min-width:0;}
        .ed-sc-change code{color:var(--brand);font-family:var(--font-mono);width:18px;}
        .ed-sc-change span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .ed-sc-empty{font-size:10.5px;color:var(--text-muted);font-style:italic;}
        .ed-sc-graph-section{min-height:0;}
        .ed-sc-graph{margin:0;max-height:270px;overflow:auto;background:var(--bg-base);border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:8px;font:9.5px/1.55 var(--font-mono);color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;}
        .ed-sc-remote{font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-top:1px solid var(--border-subtle);padding-top:8px;}

        /* The standalone editor shares the main app's light workbench theme. */
        html[data-theme="light"] .ed-shell{background:var(--bg-base);color:var(--text-primary);}
        html[data-theme="light"] .ed-bar,
        html[data-theme="light"] .ed-side,
        html[data-theme="light"] .ed-main,
        html[data-theme="light"] .ed-rp,
        html[data-theme="light"] .ed-tabs,
        html[data-theme="light"] .ed-tab{background:var(--bg-surface);border-color:var(--border-subtle);}
        html[data-theme="light"] .ed-menu,
        html[data-theme="light"] .ed-side-hdr,
        html[data-theme="light"] .ed-proj,
        html[data-theme="light"] .ed-rp-tab,
        html[data-theme="light"] .ed-db-stab,
        html[data-theme="light"] .ed-search::placeholder{color:var(--text-muted);}
        html[data-theme="light"] .ed-menu:hover,
        html[data-theme="light"] .ed-side-btn:hover,
        html[data-theme="light"] .ed-tab:hover,
        html[data-theme="light"] .ed-rp-tab:hover,
        html[data-theme="light"] .ed-db-stab:hover{color:var(--text-primary);background:var(--bg-hover);}
        html[data-theme="light"] .ed-back{color:var(--brand);background:var(--brand-glow);border-color:var(--accent-border);}
        html[data-theme="light"] .ed-search{background:var(--bg-base);border-color:var(--border-base);color:var(--text-primary);}
        html[data-theme="light"] .s-row:hover,
        html[data-theme="light"] .db-tbl-row:hover,
        html[data-theme="light"] .db-qt tr:hover td{background:var(--bg-hover);}
        html[data-theme="light"] .s-row-btn,
        html[data-theme="light"] .ed-rp-tab.on,
        html[data-theme="light"] .ed-db-title,
        html[data-theme="light"] .db-tbl-nm,
        html[data-theme="light"] .db-col-nm,
        html[data-theme="light"] .ed-ag-name{color:var(--text-primary);}
        html[data-theme="light"] .s-row.act,
        html[data-theme="light"] .ed-tab.cur{background:var(--brand-glow);}
        html[data-theme="light"] .s-row.act .s-row-btn,
        html[data-theme="light"] .ed-db-stab.on{color:var(--brand);}
        html[data-theme="light"] .ed-bc{background:var(--bg-deep);border-color:var(--border-subtle);}
        html[data-theme="light"] .bc-s,
        html[data-theme="light"] .bc-a,
        html[data-theme="light"] .ed-wc-title,
        html[data-theme="light"] .db-v,
        html[data-theme="light"] .db-msg-body{color:var(--text-secondary);}
        html[data-theme="light"] .ed-code-wrap,
        html[data-theme="light"] .ed-gutter{background:var(--bg-surface);border-color:var(--border-subtle);}
        html[data-theme="light"] .ed-hi{color:var(--text-primary);}
        html[data-theme="light"] .ed-ta{caret-color:var(--brand);}
        html[data-theme="light"] .ed-status{background:var(--brand);}
        html[data-theme="light"] .ed-wc-sub,
        html[data-theme="light"] .ed-shortcut,
        html[data-theme="light"] .ed-hint,
        html[data-theme="light"] .db-hint{color:var(--text-muted);}
        html[data-theme="light"] .ed-shortcut kbd,
        html[data-theme="light"] .db-stat-card,
        html[data-theme="light"] .db-tbl-row,
        html[data-theme="light"] .db-tbl-card,
        html[data-theme="light"] .db-col-pill,
        html[data-theme="light"] .db-model-row,
        html[data-theme="light"] .db-tool-row,
        html[data-theme="light"] .db-msg,
        html[data-theme="light"] .ed-ag-row{background:var(--bg-elevated);border-color:var(--border-subtle);}
        html[data-theme="light"] .db-sec-ttl,
        html[data-theme="light"] .db-kv,
        html[data-theme="light"] .db-llm-row,
        html[data-theme="light"] .db-tool-log{border-color:var(--border-subtle);}
        html[data-theme="light"] .db-qi{background:var(--bg-base);border-color:var(--border-base);color:var(--text-primary);}
        html[data-theme="light"] .db-qrun{background:var(--brand);}
        html[data-theme="light"] .db-qrun:hover:not(:disabled){background:var(--brand-dim);}
        html[data-theme="light"] .db-qt th{background:var(--bg-elevated);color:var(--text-muted);border-color:var(--border-subtle);}
        html[data-theme="light"] .db-qt td{color:var(--text-secondary);border-color:var(--border-subtle);}
        @keyframes pulse-soft{0%,100%{opacity:1}50%{opacity:.5}}
      `}</style>
    </div>
  );
}

export default function EditorPage() {
  return (
    <Suspense fallback={
      <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0d0d0d',color:'#6b7280',fontFamily:'Inter,system-ui,sans-serif'}}>
        Loading editor…
      </div>
    }>
      <EditorInner/>
    </Suspense>
  );
}
