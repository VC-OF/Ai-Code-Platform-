'use client';

import { useState, useEffect } from 'react';
import type { Project } from '@/types';

interface SidebarProps {
  open:            boolean;
  activeProject:   Project | null;
  onProjectSelect: (p: Project | null) => void;
  onToggle?:        () => void;
}

export default function Sidebar({
  open,
  activeProject,
  onProjectSelect,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search,   setSearch]   = useState('');
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [newTemplate, setNewTemplate] = useState('react-vite');
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const [showAllProjects, setShowAllProjects] = useState(false);

  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const displayedProjects = search.trim() || showAllProjects ? filtered : filtered.slice(0, 8);

  const createProject = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: newName.trim(), template: newTemplate }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const project = data.project;
      if (!project) return;
      setProjects((p) => [project, ...p]);
      onProjectSelect(project);
      setNewName('');
      setCreating(false);
    } catch {}
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this project?')) return;
    const res = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    if (!res?.ok) return;
    setProjects((p) => p.filter((x) => x.id !== id));
    if (activeProject?.id === id) onProjectSelect(null);
  };

  if (!open) return null;

  return (
    <aside className="sidebar">
      {/* Top Search Input */}
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
          <circle cx="11" cy="11" r="7"/>
          <path d="M21 21l-4.3-4.3"/>
        </svg>
        <input
          type="text"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sidebar-search-input"
        />
      </div>

      {/* New Project Action Button */}
      <div className="sidebar-action-container">
        {creating ? (
          <div className="sidebar-new-form">
            <input
              type="text"
              placeholder="Project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  createProject();
                if (e.key === 'Escape') setCreating(false);
              }}
              className="sidebar-new-input"
              autoFocus
            />
            <select
              value={newTemplate}
              onChange={(e) => setNewTemplate(e.target.value)}
              className="sidebar-new-input sidebar-template-select"
              style={{ fontSize: '11px', padding: '4px 6px', marginTop: '2px' }}
            >
              <option value="react-vite">React app</option>
              <option value="nextjs-tailwind">Next.js 16</option>
              <option value="dashboard-shell">Dashboard</option>
              <option value="fastapi-react">FastAPI + React</option>
              <option value="express-api">Express API</option>
              <option value="static-site">Static site</option>
              <option value="blank">Blank</option>
            </select>
            <div className="sidebar-new-actions">
              <button onClick={createProject} className="btn-primary-sm">
                Create
              </button>
              <button
                onClick={() => setCreating(false)}
                className="btn-ghost-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="sidebar-new-btn"
          >
            <span className="sidebar-new-plus">+</span>
            <span>New</span>
          </button>
        )}
      </div>

      {/* Upgrade OpenCode shortcut */}
      <div className="sidebar-nav-shortcuts">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('oc-open', { detail: { target: 'upgrade' } }))}
          className="sidebar-nav-item"
          title="Upgrade OpenCode in an isolated worktree"
        >
          <svg className="sidebar-nav-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span>Upgrade OpenCode</span>
        </button>
      </div>

      {/* Projects list header */}
      <div className="sidebar-nav-label">Projects</div>

      {/* Project list */}
      <div className="sidebar-list">
        {loading ? (
          <div className="sidebar-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="sidebar-skeleton" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-empty">
            {search ? 'No results' : 'No projects yet'}
          </div>
        ) : (
          <>
            {displayedProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                active={activeProject?.id === project.id}
                onClick={() => onProjectSelect(project)}
                onDelete={(e) => deleteProject(project.id, e)}
              />
            ))}
            {!search && filtered.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllProjects(!showAllProjects)}
                className="sidebar-more-btn"
              >
                {showAllProjects ? 'Show fewer' : `Show all (${filtered.length})`}
              </button>
            )}
          </>
        )}
      </div>





      <style jsx>{`
        .sidebar {
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-subtle);
          width: var(--sidebar-width);
          overflow: hidden;
          padding: 10px 8px;
          height: 100%;
          font-size: 13px;
          user-select: none;
        }
        .sidebar-search {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 0 8px;
          margin-bottom: 8px;
          flex-shrink: 0;
          font-size: 12px;
          transition: border-color var(--transition-fast);
        }
        .sidebar-search:focus-within {
          border-color: var(--border-strong);
          box-shadow: 0 0 0 1px var(--border-strong);
        }
        .sidebar-more-btn {
          width: 100%;
          padding: 6px 8px;
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          background: transparent;
          border: 1px dashed var(--border-subtle);
          border-radius: var(--radius-sm);
          cursor: pointer;
          margin-top: 4px;
          transition: all var(--transition-fast);
          text-align: center;
        }
        .sidebar-more-btn:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
          border-color: var(--border-base);
        }
        .sidebar-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .sidebar-search-input {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: #1f1e1d;
          font-size: 12px;
        }
        :global(html:not([data-theme="light"])) .sidebar-search-input {
          color: #eceae3;
        }
        .sidebar-search-input::placeholder {
          color: #9c978b;
        }
        .sidebar-action-container {
          margin-bottom: 6px;
          flex-shrink: 0;
        }
        .sidebar-new-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 5px 8px;
          border-radius: var(--radius-md);
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
          text-align: left;
        }
        .sidebar-new-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .sidebar-new-plus {
          font-size: 16px;
          font-weight: 600;
          line-height: 1;
        }
        .sidebar-nav-shortcuts {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding-bottom: 8px;
          margin-bottom: 6px;
          border-bottom: 1px solid #ece9e0;
          flex-shrink: 0;
        }
        :global(html:not([data-theme="light"])) .sidebar-nav-shortcuts {
          border-bottom-color: rgba(255, 255, 255, 0.08);
        }
        .sidebar-nav-item {
          display: flex;
          align-items: center;
          gap: 6px;
          width: 100%;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: 12px;
          font-weight: 400;
          color: var(--text-muted);
          background: transparent;
          border: none;
          cursor: pointer;
          transition: background var(--transition-fast), color var(--transition-fast);
          text-align: left;
        }
        .sidebar-nav-item:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .sidebar-nav-icon {
          color: #736f66;
          flex-shrink: 0;
        }
        .sidebar-more-dots {
          font-family: var(--font-mono);
          font-weight: 700;
          color: #736f66;
          width: 14px;
          text-align: center;
        }
        .sidebar-nav-label {
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-disabled);
          padding: 0 10px;
          margin-bottom: 2px;
          flex-shrink: 0;
        }
        .sidebar-new-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sidebar-new-input {
          width: 100%;
          height: 30px;
          padding: 0 8px;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          color: var(--text-primary);
          font-size: 12px;
          outline: none;
        }
        .sidebar-new-input:focus {
          border-color: var(--brand);
        }
        .sidebar-new-actions {
          display: flex;
          gap: 6px;
        }
        .btn-primary-sm,
        .btn-ghost-sm {
          flex: 1;
          height: 26px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
        }
        .btn-primary-sm {
          background: var(--brand);
          border: none;
          color: #ffffff;
        }
        .btn-ghost-sm {
          background: transparent;
          border: 1px solid var(--border-base);
          color: var(--text-muted);
        }

        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }
        .sidebar-loading {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 4px 0;
        }
        .sidebar-skeleton {
          height: 28px;
          background: rgba(0, 0, 0, 0.04);
          border-radius: 6px;
        }
        .sidebar-empty {
          padding: 8px;
          color: #9c978b;
          font-size: 12px;
        }
      `}</style>
    </aside>
  );
}

// ─── Project item ─────────────────────────────────────────────────────────────
function ProjectItem({
  project,
  active,
  onClick,
  onDelete,
}: {
  project:  Project;
  active:   boolean;
  onClick:  () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`project-item ${active ? 'project-item--active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Name */}
      <div className="project-info">
        <span className="project-name">
          {project.title}
          {project.kind === 'build' && <span className="project-build-badge">folder</span>}
        </span>
        <span className="project-date">
          {formatRelativeDate(project.updatedAt)}
        </span>
      </div>

      {/* Delete button */}
      <button
        type="button"
        className="project-delete"
        onClick={onDelete}
        title="Delete project"
        aria-label={`Delete ${project.title}`}
      >
        <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>

      <style jsx>{`
        .project-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          height: 32px;
          padding: 0 8px;
          border-radius: var(--radius-md);
          cursor: pointer;
          text-align: left;
          transition: background var(--transition-fast);
          position: relative;
          outline: none;
          flex-shrink: 0;
        }
        .project-item:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .project-item:hover {
          background: var(--bg-hover);
        }
        .project-item--active,
        .project-item--active:hover {
          background: var(--bg-hover);
          border-left: 2px solid var(--brand);
          padding-left: 6px;
        }
        .project-info {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .project-name {
          flex: 1;
          min-width: 0;
          font-size: 13px;
          color: var(--text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .project-item--active .project-name {
          color: var(--text-primary);
        }
        .project-build-badge {
          font-size: 11px;
          color: var(--text-muted);
          margin-left: 6px;
        }
        .project-date {
          font-size: 11px;
          color: var(--text-muted);
          flex-shrink: 0;
        }
        .project-item:hover .project-date,
        .project-item:focus-within .project-date {
          visibility: hidden;
        }
        .project-delete {
          position: absolute;
          right: 4px;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
        }
        .project-item:hover .project-delete,
        .project-item:focus-within .project-delete {
          opacity: 1;
          pointer-events: auto;
        }
        .project-delete:hover {
          background: var(--bg-hover);
          color: var(--error);
        }
        .project-delete:focus-visible {
          outline: 2px solid var(--accent);
        }
      `}</style>
    </div>
  );
}

function formatRelativeDate(ts: number): string {
  const diff = Date.now() - ts;
  const min  = 60_000;
  const hour = 60 * min;
  const day  = 24 * hour;
  if (diff < min)       return 'just now';
  if (diff < hour)      return `${Math.floor(diff / min)}m ago`;
  if (diff < day)       return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day)   return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString();
}
