'use client';

import { useEffect, useState } from 'react';
import { buildTree, type TreeNode, type FlatNode } from '@/lib/file-utils';
import { FileIcon, FolderIcon } from '@/components/icons/FileIcon';

interface FileExplorerProps {
  projectId: string;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  refreshKey?: number;
}

// Tree Entry Component
function TreeEntry({
  node,
  depth,
  activePath,
  onSelect,
  onDelete,
  expandedFolders,
  toggleFolder,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string, e: React.MouseEvent) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
}) {
  const isExpanded = expandedFolders.has(node.fullPath);
  const isActive = activePath === node.fullPath;
  const indent = depth * 12;

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => toggleFolder(node.fullPath)}
          className="w-full text-left flex items-center gap-1.5 py-1.5 pr-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30 transition-all rounded-md cursor-pointer"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <svg
            className={`w-3.5 h-3.5 shrink-0 text-zinc-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M10 6l6 6-6 6V6z" />
          </svg>
          <FolderIcon open={isExpanded} />
          <span className="text-xs truncate font-medium text-zinc-300">
            {node.name}
          </span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map((child) => (
              <TreeEntry
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onSelect={onSelect}
                onDelete={onDelete}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group relative">
      <button
        onClick={() => onSelect(node.fullPath)}
        className={`w-full text-left flex items-center gap-1.5 py-1.5 pr-8 text-xs font-mono transition-all cursor-pointer rounded-md ${
          isActive
            ? 'bg-[var(--brand)]/12 text-blue-400 border-r-2 border-[var(--brand)]'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
        }`}
        style={{ paddingLeft: `${8 + indent + 16}px` }}
        title={node.fullPath}
      >
        <FileIcon name={node.name} />
        <span className="truncate">{node.name}</span>
      </button>
      <button
        onClick={(e) => onDelete(node.fullPath, e)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 hover:bg-zinc-800 rounded text-rose-500 transition-opacity cursor-pointer"
        title="Delete File"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}

export default function FileExplorer({
  projectId,
  activeFile,
  onFileSelect,
  refreshKey = 0,
}: FileExplorerProps) {
  const [flatNodes, setFlatNodes] = useState<FlatNode[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['src', 'app', 'components', 'lib'])
  );
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  async function loadFiles() {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      const nodes: FlatNode[] = data.tree || [];
      setFlatNodes(nodes);
      setTreeNodes(buildTree(nodes));
    } catch (e) {
      console.error('Failed to load tree', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Fetch-on-change: the loading flag is intentionally set synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshKey]);

  function toggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  async function createNewFile() {
    const filename = prompt('Enter relative file path (e.g. src/components/Badge.tsx):');
    if (!filename?.trim()) return;
    try {
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filename.trim(), content: '', projectId }),
      });
      if (res.ok) {
        await loadFiles();
        onFileSelect(filename.trim().replace(/\\/g, '/'));
      }
    } catch (e) {
      alert(`Error creating file: ${String(e)}`);
    }
  }

  async function createNewFolder() {
    const foldername = prompt('Enter relative folder path (e.g. src/utils):');
    if (!foldername?.trim()) return;
    try {
      // Create empty placeholder file so git/system registers folder
      const placeholderPath = `${foldername.trim().replace(/\\/g, '/')}/.gitkeep`;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: placeholderPath, content: '', projectId }),
      });
      if (res.ok) {
        await loadFiles();
        setExpandedFolders((prev) => new Set([...Array.from(prev), foldername.trim()]));
      }
    } catch (e) {
      alert(`Error creating folder: ${String(e)}`);
    }
  }

  async function handleDelete(filePath: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${filePath}"?`)) return;
    try {
      const res = await fetch(
        `/api/files?path=${encodeURIComponent(filePath)}&projectId=${encodeURIComponent(projectId)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        await loadFiles();
      }
    } catch (err) {
      alert(`Error deleting: ${String(err)}`);
    }
  }

  const searchActive = searchTerm.trim().length > 0;
  const filteredFiles = flatNodes
    .filter((n) => !n.isDirectory)
    .map((n) => ({ ...n, path: n.path.replace(/\\/g, '/') }))
    .filter((f) => f.path.toLowerCase().includes(searchTerm.toLowerCase()))
    .sort((a, b) => a.path.localeCompare(b.path));

  return (
    <div className="file-explorer">
      {/* Pane Title Bar */}
      <div className="explorer-header">
        <span className="explorer-title">File Explorer</span>
        <div className="explorer-actions">
          <button onClick={createNewFile} className="action-btn" title="New File">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
              <path d="M9 12h6M12 9v6M12 3v18" />
            </svg>
          </button>
          <button onClick={createNewFolder} className="action-btn" title="New Folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v6M9 14h6" />
            </svg>
          </button>
          <button onClick={loadFiles} className="action-btn" title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14} className={loading ? 'animate-spin' : ''}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search files bar */}
      <div className="explorer-search">
        <input
          type="text"
          placeholder="Search files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="search-input"
        />
      </div>

      {/* Directory Tree */}
      <div className="tree-container">
        {loading && treeNodes.length === 0 ? (
          <div className="loading-spinner">
            <span className="spinner-dot" />
            Loading files...
          </div>
        ) : searchActive ? (
          filteredFiles.length === 0 ? (
            <div className="empty-message">No files matched</div>
          ) : (
            filteredFiles.map((f) => (
              <div key={f.path} className="group relative">
                <button
                  onClick={() => onFileSelect(f.path)}
                  className={`w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono transition-all cursor-pointer rounded-md ${
                    activeFile === f.path
                      ? 'bg-[var(--brand)]/12 text-blue-400 border-r-2 border-[var(--brand)]'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30'
                  }`}
                  title={f.path}
                >
                  <FileIcon name={f.path} />
                  <span className="truncate">{f.path}</span>
                </button>
              </div>
            ))
          )
        ) : treeNodes.length === 0 ? (
          <div className="empty-message">No files found.</div>
        ) : (
          treeNodes.map((node) => (
            <TreeEntry
              key={node.fullPath}
              node={node}
              depth={0}
              activePath={activeFile}
              onSelect={onFileSelect}
              onDelete={handleDelete}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          ))
        )}
      </div>

      {/* ── Open Code Editor CTA ────────────────────────────────────────── */}
      <div className="quick-actions-footer">
        <div className="qa-footer-label">QUICK ACTIONS</div>
        <div className="qa-footer-row">
          <a
            href={`/editor?projectId=${projectId}`}
            className="qa-footer-btn qa-footer-btn--primary"
            id="btn-open-code-editor"
            title="Open full code editor"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Open Code
          </a>
        </div>
      </div>

      <style jsx>{`
        .file-explorer {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-surface);
          border-left: 1px solid var(--border-subtle);
        }

        .explorer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-subtle);
          height: 48px;
        }

        .explorer-title {
          font-size: 11.5px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .explorer-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .action-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          background: transparent;
          color: var(--text-muted);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .action-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .explorer-search {
          padding: 8px 12px;
          border-bottom: 1px solid var(--border-subtle);
        }

        .search-input {
          width: 100%;
          background: var(--bg-base);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 6px 10px;
          font-size: 11.5px;
          color: var(--text-primary);
          outline: none;
          transition: all var(--transition-fast);
        }

        .search-input:focus {
          border-color: var(--brand);
          box-shadow: 0 0 0 2px var(--brand-glow);
        }

        .search-input::placeholder {
          color: var(--text-muted);
        }

        .tree-container {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .loading-spinner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          font-size: 11.5px;
          color: var(--text-muted);
        }

        .spinner-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          border: 1.5px solid var(--text-muted);
          border-top-color: transparent;
          animation: spin 0.8s linear infinite;
        }

        .empty-message {
          padding: 16px 12px;
          font-size: 11.5px;
          color: var(--text-disabled);
          font-style: italic;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* ── Quick Actions Footer ── */
        .quick-actions-footer {
          padding: 10px 12px 14px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }
        .qa-footer-label {
          font-size: 8.5px;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--text-muted);
          font-weight: 700;
          margin-bottom: 8px;
        }
        .qa-footer-row {
          display: flex;
          gap: 6px;
        }
        .qa-footer-btn {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
          padding: 7px 6px;
          font-size: 11px;
          font-weight: 500;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: all var(--transition-fast);
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          text-decoration: none;
          white-space: nowrap;
        }
        .qa-footer-btn:hover {
          background: var(--bg-hover);
          border-color: var(--border-base);
          color: var(--text-primary);
        }
        .qa-footer-btn--primary {
          background: var(--brand);
          border-color: var(--brand);
          color: #fffaf7;
          font-weight: 600;
          flex: 1.4;
        }
        .qa-footer-btn--primary:hover {
          background: var(--brand-dim);
          border-color: var(--brand-dim);
          box-shadow: var(--shadow-sm);
          color: #fffaf7;
        }
      `}</style>
    </div>
  );
}
