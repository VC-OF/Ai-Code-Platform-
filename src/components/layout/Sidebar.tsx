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
  onToggle,
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
              placeholder="Project name..."
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
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            <span>New Project</span>
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
        <span className="sidebar-search-kbd">⌘K</span>
      </div>

      {/* Recents Label */}
      <div className="sidebar-nav-label">Recent Projects</div>

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
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-right: 1px solid var(--border-subtle);
          width: var(--sidebar-width);
          overflow: hidden;
          padding: 12px;
          height: 100%;
        }

        .sidebar-action-container {
          margin-bottom: 14px;
          flex-shrink: 0;
        }

        .sidebar-new-btn {
          width: 100%;
          background: var(--brand);
          border: none;
          border-radius: var(--radius-md);
          color: #fffaf7;
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 12.5px;
          padding: 9px 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .sidebar-new-btn:hover {
          background: var(--brand-dim);
        }

        .sidebar-new-btn:active {
          transform: scale(0.97);
        }

        .sidebar-new-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .sidebar-new-input {
          width: 100%;
          padding: 8px 10px;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--brand);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: var(--text-xs);
          outline: none;
        }

        .sidebar-new-actions {
          display: flex;
          gap: 6px;
        }

        .btn-primary-sm {
          flex: 1;
          padding: 6px;
          background: var(--brand);
          border: none;
          border-radius: var(--radius-md);
          color: white;
          font-size: var(--text-xs);
          font-weight: 500;
          cursor: pointer;
        }

        .btn-ghost-sm {
          flex: 1;
          padding: 6px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          font-size: var(--text-xs);
          cursor: pointer;
        }

        .sidebar-search {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          padding: 7px 10px;
          margin-bottom: 14px;
          flex-shrink: 0;
          transition: all var(--transition-fast);
        }

        .sidebar-search:focus-within {
          border-color: rgba(255, 255, 255, 0.15);
        }

        .sidebar-search-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .sidebar-search-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-size: 11.5px;
        }

        .sidebar-search-input::placeholder {
          color: var(--text-muted);
        }

        .sidebar-search-kbd {
          font-size: 9px;
          color: var(--text-muted);
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-subtle);
          border-radius: 4px;
          padding: 1px 4px;
          flex-shrink: 0;
        }

        .sidebar-nav-label {
          font-size: 9.5px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--text-muted);
          padding: 0 4px;
          margin-bottom: 8px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .sidebar-list {
          flex: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-bottom: 14px;
        }

        .sidebar-loading {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 4px 0;
        }

        .sidebar-skeleton {
          height: 38px;
          background: rgba(255,255,255,0.03);
          border-radius: var(--radius-md);
        }

        .sidebar-empty {
          text-align: center;
          padding: 24px 12px;
          color: var(--text-disabled);
          font-size: var(--text-xs);
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
  const initials = project.title
    .split(' ')
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('');

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
      {/* Avatar */}
      <div className={`project-avatar ${active ? 'project-avatar--active' : ''}`}>
        {initials}
      </div>

      {/* Name */}
      <div className="project-info">
        <span className="project-name">
          {project.title}
          {project.kind === 'build' && <span className="project-build-badge">Build</span>}
        </span>
        <span className="project-date">
          {formatRelativeDate(project.updatedAt)}
        </span>
      </div>

      {/* Delete button */}
      <button
        className="project-delete"
        onClick={onDelete}
        title="Delete project"
      >
        ✕
      </button>

      <style jsx>{`
        .project-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          background: none;
          border: 1px solid transparent;
          border-radius: var(--radius-md);
          cursor: pointer;
          text-align: left;
          transition: all var(--transition-fast);
          position: relative;
          outline: none;
        }

        .project-item:focus-visible {
          outline: 2px solid var(--brand);
        }

        .project-item:hover {
          background: var(--bg-hover);
        }

        .project-item--active {
          background: var(--brand-glow) !important;
          border-color: var(--accent-border) !important;
        }

        .project-item--active .project-name {
          color: var(--brand);
          font-weight: 600;
        }

        .project-avatar {
          width: 26px;
          height: 26px;
          border-radius: 6px;
          background: var(--bg-elevated);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-brand);
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          flex-shrink: 0;
        }

        .project-avatar--active {
          background: var(--brand);
          color: #fffaf7;
        }

        .project-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .project-name {
          font-size: 12.5px;
          font-weight: 500;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .project-build-badge {
          font-size: 8px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--warning, #ff9f0a);
          background: rgba(255, 159, 10, 0.1);
          border: 1px solid rgba(255, 159, 10, 0.25);
          border-radius: var(--radius-full);
          padding: 1px 5px;
          margin-left: 6px;
        }

        .project-date {
          font-size: 10px;
          color: var(--text-muted);
        }

        .project-delete {
          position: absolute;
          right: 6px;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-surface);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          font-size: 10px;
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          transition: all var(--transition-fast);
        }

        .project-item:hover .project-delete,
        .project-item:focus-within .project-delete {
          opacity: 1;
          pointer-events: auto;
        }

        .project-delete:hover {
          background: var(--error-dim);
          border-color: var(--error);
          color: var(--error);
        }

        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
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
