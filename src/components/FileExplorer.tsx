'use client';

import { useEffect, useState, useRef } from 'react';
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
  onRename,
  onDelete,
  expandedFolders,
  toggleFolder,
  projectId,
}: {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
  onRename: (path: string, e: React.MouseEvent) => void;
  onDelete: (path: string, e: React.MouseEvent) => void;
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  projectId: string;
}) {
  const isExpanded = expandedFolders.has(node.fullPath);
  const isActive = activePath === node.fullPath;
  const indent = depth * 12;

  if (node.isDirectory) {
    return (
      <div>
        <button
          onClick={() => toggleFolder(node.fullPath)}
          className="fe-row pr-2"
          style={{ paddingLeft: `${8 + indent}px` }}
        >
          <svg
            className={`w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M10 6l6 6-6 6V6z" />
          </svg>
          <FolderIcon open={isExpanded} />
          <span className="truncate">
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
                onRename={onRename}
                onDelete={onDelete}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
                projectId={projectId}
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
        className={`fe-row fe-row--file pr-14 ${
          isActive
            ? 'fe-row--active'
            : ''
        }`}
        style={{ paddingLeft: `${8 + indent + 16}px` }}
        title={node.fullPath}
      >
        <FileIcon name={node.name} />
        <span className="truncate">{node.name}</span>
      </button>
      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 flex items-center gap-0.5">
        <a
          href={`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(node.fullPath)}&download=1`}
          download
          className="fe-icon-btn"
          title="Download file"
          onClick={(e) => e.stopPropagation()}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard?.writeText(node.fullPath);
          }}
          className="fe-icon-btn"
          title="Copy path"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => onRename(node.fullPath, e)}
          className="fe-icon-btn"
          title="Rename"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => onDelete(node.fullPath, e)}
          className="fe-icon-btn fe-icon-btn--danger"
          title="Delete file"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
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
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const [modal, setModal] = useState<{
    isOpen: boolean;
    type: 'file' | 'folder' | 'rename';
    targetPath?: string;
  }>({ isOpen: false, type: 'file' });
  const [modalInput, setModalInput] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [modalError, setModalError] = useState('');

  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openModal = (type: 'file' | 'folder' | 'rename', targetPath?: string) => {
    setModal({ isOpen: true, type, targetPath });
    setModalInput(type === 'rename' ? (targetPath || '') : '');
    setModalError('');
  };

  const closeModal = () => {
    setModal({ isOpen: false, type: 'file' });
    setModalInput('');
    setModalError('');
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const val = modalInput.trim();
    if (!val) return;
    setModalSubmitting(true);
    setModalError('');
    try {
      if (modal.type === 'file') {
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: val, content: '', projectId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create file');
        }
        await loadFiles();
        onFileSelect(val.replace(/\\/g, '/'));
        closeModal();
      } else if (modal.type === 'folder') {
        const placeholderPath = `${val.replace(/\\/g, '/')}/.gitkeep`;
        const res = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: placeholderPath, content: '', projectId }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to create folder');
        }
        await loadFiles();
        setExpandedFolders((prev) => new Set([...Array.from(prev), val]));
        closeModal();
      } else if (modal.type === 'rename' && modal.targetPath) {
        const res = await fetch('/api/files', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            oldPath: modal.targetPath,
            newPath: val.replace(/\\/g, '/'),
            projectId,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to rename');
        }
        await loadFiles();
        if (activeFile === modal.targetPath) {
          onFileSelect(val.replace(/\\/g, '/'));
        }
        closeModal();
      }
    } catch (err) {
      setModalError(err instanceof Error ? err.message : String(err));
    } finally {
      setModalSubmitting(false);
    }
  };

  const uploadFiles = async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('projectId', projectId);
    Array.from(filesList).forEach((f) => formData.append('files', f));
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await loadFiles();
      } else {
        const data = await res.json();
        alert(`Upload error: ${data.error || 'Failed to upload'}`);
      }
    } catch (err) {
      alert(`Upload error: ${String(err)}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files) {
      await uploadFiles(e.dataTransfer.files);
    }
  };

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
    <div
      className="file-explorer"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        type="file"
        multiple
        ref={fileInputRef}
        onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        style={{ display: 'none' }}
      />

      {/* Dropzone overlay */}
      {isDragging && (
        <div className="fe-dropzone-overlay">
          <div className="fe-dropzone-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={28} height={28} className="text-blue-500">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Drop files to upload</span>
          </div>
        </div>
      )}

      {/* Pane Title Bar */}
      <div className="explorer-header">
        <span className="explorer-title">Files</span>
        <div className="explorer-actions">
          <button onClick={() => openModal('file')} className="action-btn" title="New file">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <path d="M9 12h6M12 9v6M12 3v18" />
            </svg>
          </button>
          <button onClick={() => openModal('folder')} className="action-btn" title="New folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2zM12 11v6M9 14h6" />
            </svg>
          </button>
          <button onClick={() => fileInputRef.current?.click()} className="action-btn" title="Upload files">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </button>
          <button onClick={loadFiles} className="action-btn" title="Refresh files">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} className={loading || uploading ? 'animate-spin' : ''}>
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
            </svg>
          </button>
          <span className="header-divider" />
          <button type="button" className="action-btn" title="More options">⋮</button>
          <button type="button" className="action-btn" title="Expand">⤢</button>
          <button type="button" className="action-btn" onClick={() => window.dispatchEvent(new CustomEvent('oc-close-explorer'))} title="Close">✕</button>
        </div>
      </div>

      {/* Search files bar (Filter, or ? to search in files) */}
      <div className="explorer-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13} className="explorer-search-icon">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          type="text"
          placeholder="Filter, or ? to search in files"
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
                  className={`fe-row fe-row--file px-3 ${
                    activeFile === f.path
                      ? 'fe-row--active'
                      : ''
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
          <div className="empty-message">No files found. Drag files here to upload.</div>
        ) : (
          treeNodes.map((node) => (
            <TreeEntry
              key={node.fullPath}
              node={node}
              depth={0}
              activePath={activeFile}
              onSelect={onFileSelect}
              onRename={(path) => openModal('rename', path)}
              onDelete={handleDelete}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              projectId={projectId}
            />
          ))
        )}
      </div>

      {/* Modal Dialog for File/Folder/Rename */}
      {modal.isOpen && (
        <div className="fe-modal-overlay" onClick={closeModal}>
          <div className="fe-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="fe-modal-header">
              <span className="fe-modal-title">
                {modal.type === 'file' ? 'New File' : modal.type === 'folder' ? 'New Folder' : 'Rename'}
              </span>
              <button type="button" onClick={closeModal} className="action-btn">&times;</button>
            </div>
            <form onSubmit={handleModalSubmit} className="fe-modal-form">
              <input
                type="text"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                placeholder={
                  modal.type === 'file'
                    ? 'e.g. src/components/Badge.tsx'
                    : modal.type === 'folder'
                    ? 'e.g. src/utils'
                    : 'New path'
                }
                className="search-input"
                autoFocus
              />
              {modalError && <div className="fe-modal-error">{modalError}</div>}
              <div className="fe-modal-actions">
                <button type="button" onClick={closeModal} className="qa-footer-btn">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSubmitting || !modalInput.trim()}
                  className="qa-footer-btn qa-footer-btn--primary"
                >
                  {modalSubmitting ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Open Code Editor CTA ────────────────────────────────────────── */}
      <div className="quick-actions-footer">
        <div className="qa-footer-row">
          <a
            href={`/editor?projectId=${encodeURIComponent(projectId)}`}
            className="qa-footer-btn"
            id="btn-open-code-editor"
            title="Open full code editor"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            Open code
          </a>
        </div>
      </div>

      <style jsx>{`
        .file-explorer {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          background: #ffffff;
          border: 1px solid #e5e2da;
          border-radius: 14px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
          overflow: hidden;
        }

        :global(.dark) .file-explorer {
          background: #1f1e1d;
          border-color: #383632;
        }

        .explorer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px;
          border-bottom: 1px solid #e8e6de;
          background: #faf9f6;
          height: 36px;
        }

        :global(.dark) .explorer-header {
          background: #23221f;
          border-color: #383632;
        }

        .explorer-title {
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
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
          transition: color var(--transition-fast), background var(--transition-fast);
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
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          padding: 6px 10px;
          font-family: var(--font-sans);
          font-size: 12px;
          color: var(--text-primary);
          outline: none;
          transition: border-color var(--transition-fast);
        }

        .search-input:focus {
          border-color: var(--border-strong);
        }

        .search-input:focus-visible,
        .action-btn:focus-visible,
        .qa-footer-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
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
          font-size: 12px;
          color: var(--text-muted);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .spinner-dot,
          .file-explorer :global(.animate-spin) {
            animation: none;
          }
          .file-explorer :global(*) {
            transition: none;
          }
        }

        /* Tree rows (rendered by TreeEntry, so styled via :global) */
        .file-explorer :global(.fe-row) {
          width: 100%;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 6px;
          padding-top: 4px;
          padding-bottom: 4px;
          font-family: var(--font-sans);
          font-size: 12.5px;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          cursor: pointer;
          position: relative;
          transition: background var(--transition-fast), color var(--transition-fast);
        }
        .file-explorer :global(.fe-row--file) {
          font-family: var(--font-mono);
          font-size: 12px;
        }
        .file-explorer :global(.fe-row:hover) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .file-explorer :global(.fe-row--active),
        .file-explorer :global(.fe-row--active:hover) {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .file-explorer :global(.fe-row--active::before) {
          content: '';
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 2px;
          border-radius: var(--radius-full);
          background: var(--accent);
        }
        .file-explorer :global(.fe-row:focus-visible),
        .file-explorer :global(.fe-icon-btn:focus-visible) {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .file-explorer :global(.fe-icon-btn) {
          padding: 4px;
          display: flex;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          cursor: pointer;
        }
        .file-explorer :global(.fe-icon-btn:hover) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .file-explorer :global(.fe-icon-btn--danger:hover) {
          color: var(--error);
        }

        /* ── Quick Actions Footer ── */
        .quick-actions-footer {
          padding: 10px 12px;
          border-top: 1px solid var(--border-subtle);
          flex-shrink: 0;
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
          gap: 6px;
          padding: 6px 8px;
          font-family: var(--font-sans);
          font-size: 12px;
          font-weight: 500;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background var(--transition-fast), border-color var(--transition-fast);
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-primary);
          text-decoration: none;
          white-space: nowrap;
        }
        .qa-footer-btn:hover {
          background: var(--bg-hover);
          border-color: var(--border-strong);
        }

        .qa-footer-btn--primary {
          background: var(--accent);
          color: white;
          border-color: var(--accent);
        }
        .qa-footer-btn--primary:hover {
          background: var(--accent-strong, #3b82f6);
        }

        /* ── Drag & Drop Overlay ── */
        .fe-dropzone-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          pointer-events: none;
        }
        .fe-dropzone-box {
          border: 2px dashed var(--accent);
          border-radius: var(--radius-lg, 12px);
          background: var(--bg-surface);
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 500;
        }

        /* ── File Explorer Inline Modal ── */
        .fe-modal-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(2px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          z-index: 40;
        }
        .fe-modal-card {
          width: 100%;
          max-width: 280px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg, 10px);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
          padding: 14px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .fe-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .fe-modal-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-primary);
        }
        .fe-modal-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .fe-modal-error {
          font-size: 11px;
          color: var(--error, #ef4444);
        }
        .fe-modal-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
