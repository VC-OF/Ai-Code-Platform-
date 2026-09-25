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
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = projects.filter((p) =>
    p.title.toLowerCase().includes(search.toLowerCase())
  );

  const createProject = async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch('/api/projects', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: newName.trim(), template: 'react-vite' }),
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span>New project</span>
          </button>
        )}
      </div>

      {/* Search Projects */}
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
          <circle cx="11" cy="11" r="7"/>
          <path d="M21 21l-4.3-4.3"/>
        </svg>
        <input
          type="text"
          placeholder="Search projects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sidebar-search-input"
        />
      </div>

      {/* Recents Label */}
      <div className="sidebar-nav-label">Recent projects</div>

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
          filtered.map((project) => (
            <ProjectItem
              key={project.id}
              project={project}
              active={activeProject?.id === project.id}
              onClick={() => onProjectSelect(project)}
              onDelete={(e) => deleteProject(project.id, e)}
            />
          ))
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
          padding: 8px;
          height: 100%;
          font-size: 13px;
        }
        .sidebar-action-container {
          margin-bottom: 8px;
          flex-shrink: 0;
        }
        .sidebar-new-btn {
          width: 100%;
          height: 32px;
          background: var(--accent);
          border: none;
          border-radius: var(--radius-md);
          color: var(--bg-surface);
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 13px;
          padding: 0 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: background var(--transition-fast);
        }
        .sidebar-new-btn:hover {
          background: var(--accent-dim);
        }
        .sidebar-new-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sidebar-new-input {
          width: 100%;
          height: 32px;
          padding: 0 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 13px;
          outline: none;
        }
        .sidebar-new-input:focus {
          border-color: var(--accent);
        }
        .sidebar-new-actions {
          display: flex;
          gap: 6px;
        }
        .btn-primary-sm,
        .btn-ghost-sm {
          flex: 1;
          height: 28px;
          border-radius: var(--radius-md);
          font-size: 12px;
          cursor: pointer;
        }
        .btn-primary-sm {
          background: var(--accent);
          border: none;
          color: var(--bg-surface);
          font-weight: 500;
        }
        .btn-ghost-sm {
          background: transparent;
          border: 1px solid var(--border-base);
          color: var(--text-secondary);
        }
        .btn-ghost-sm:hover {
          background: var(--bg-hover);
        }
        .sidebar-new-btn:focus-visible,
        .btn-primary-sm:focus-visible,
        .btn-ghost-sm:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }
        .sidebar-search {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          padding: 0 8px;
          margin-bottom: 12px;
          flex-shrink: 0;
          transition: background var(--transition-fast), border-color var(--transition-fast);
        }
        .sidebar-search:hover {
          background: var(--bg-hover);
        }
        .sidebar-search:focus-within {
          background: var(--bg-elevated);
          border-color: var(--accent);
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
          color: var(--text-primary);
          font-size: 13px;
        }
        .sidebar-search-input::placeholder {
          color: var(--text-muted);
        }
        .sidebar-nav-label {
          font-size: 12px;
          color: var(--text-muted);
          padding: 0 8px;
          margin-bottom: 4px;
          font-weight: 500;
          flex-shrink: 0;
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
          height: 32px;
          background: var(--bg-hover);
          border-radius: var(--radius-md);
        }
        .sidebar-empty {
          padding: 8px;
          color: var(--text-muted);
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
          background: var(--bg-overlay);
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
