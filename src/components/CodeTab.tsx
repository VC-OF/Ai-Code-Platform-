"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

import { languageFor } from "@/lib/file-utils";

interface CodeTabProps {
  refreshKey: number;
  projectId: string;
  onFileSelect?: (path: string) => void;
  activeFile?: string | null;
}

export default function CodeTab({
  refreshKey,
  projectId,
  onFileSelect,
  activeFile,
}: CodeTabProps) {
  const [activePath, setActivePath] = useState<string | null>(activeFile ?? null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [gitContent, setGitContent] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [revertingFile, setRevertingFile] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">("vs-dark");
  const editorRef = useRef<unknown>(null);

  useEffect(() => {
    const updateTheme = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      setEditorTheme(theme === "light" ? "vs" : "vs-dark");
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Sync the active-file prop using the adjust-state-during-render pattern
  const [prevActiveFile, setPrevActiveFile] = useState(activeFile);
  if (activeFile !== prevActiveFile) {
    setPrevActiveFile(activeFile);
    if (activeFile !== undefined) setActivePath(activeFile);
  }

  useEffect(() => {
    if (!activePath) return;
    // Fetch-on-change: the loading flag is intentionally set synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingFile(true);
    setShowDiff(false);

    const fetchFs = fetch(
      `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}`
    ).then((r) => r.json());

    const fetchGit = fetch(
      `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}&version=git`
    ).then((r) => r.json());

    Promise.all([fetchFs, fetchGit])
      .then(([fsData, gitData]) => {
        setContent(fsData.content ?? "");
        setSavedContent(fsData.content ?? "");
        setGitContent(gitData.content ?? "");
      })
      .catch((err) => console.error("Error loading file content", err))
      .finally(() => setLoadingFile(false));
  }, [activePath, refreshKey, projectId]);

  const isModified = content !== savedContent;

  async function saveFile() {
    if (!activePath || !isModified || savingFile) return;
    setSavingFile(true);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, content, projectId }),
      });
      if (res.ok) {
        setSavedContent(content);
        setGitContent(content);
      }
    } finally {
      setSavingFile(false);
    }
  }

  async function revertFile() {
    if (!activePath || revertingFile) return;
    if (
      !confirm(
        `Are you sure you want to revert "${activePath}" to its last checkpoint? All unsaved modifications will be lost.`
      )
    )
      return;

    setRevertingFile(true);
    try {
      const res = await fetch("/api/files/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, projectId }),
      });
      if (res.ok) {
        setContent("");
        setSavedContent("");
        setGitContent("");

        const fsData = await fetch(
          `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}`
        ).then((r) => r.json());
        const gitData = await fetch(
          `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}&version=git`
        ).then((r) => r.json());

        setContent(fsData.content ?? "");
        setSavedContent(fsData.content ?? "");
        setGitContent(gitData.content ?? "");
        setShowDiff(false);
      }
    } catch (err) {
      alert("Error reverting file: " + String(err));
    } finally {
      setRevertingFile(false);
    }
  }

  async function createNewFile() {
    const filename = prompt(
      "Enter relative file path (e.g. src/components/Badge.tsx):"
    );
    if (!filename?.trim()) return;
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filename.trim(), content: "", projectId }),
      });
      if (res.ok) {
        onFileSelect?.(filename.trim().replace(/\\/g, "/"));
      }
    } catch (e) {
      alert(`Error creating file: ${String(e)}`);
    }
  }

  // Ctrl+S keybind listener
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [content, activePath, isModified]);

  return (
    <div className="code-editor-panel">
      {/* Editor Breadcrumb & Save Bar */}
      {activePath && (
        <div className="editor-bar">
          <div className="breadcrumb-path">
            {activePath.split("/").map((seg, i, arr) => (
              <span key={i} className="path-seg">
                {i > 0 && <span className="path-sep">/</span>}
                <span className={i === arr.length - 1 ? "path-file font-semibold" : "path-folder"}>
                  {seg}
                </span>
              </span>
            ))}
            {isModified && (
              <span className="modified-badge">Modified</span>
            )}
          </div>

          <div className="editor-actions">
            <button
              onClick={() => setShowDiff(!showDiff)}
              className={`action-btn ${showDiff ? "action-btn--active" : ""}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>{showDiff ? "Show Editor" : "Show Diff"}</span>
            </button>

            {isModified && (
              <button
                disabled={revertingFile}
                onClick={revertFile}
                className="revert-btn"
                title="Revert all unsaved changes"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                  <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                <span>{revertingFile ? "Reverting…" : "Revert"}</span>
              </button>
            )}

            <button
              disabled={!isModified || savingFile}
              onClick={saveFile}
              className="save-btn"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <path d="M17 21v-8H7v8M7 3v5h8" />
              </svg>
              <span>{savingFile ? "Saving..." : "Save"}</span>
            </button>
          </div>
        </div>
      )}

      <div className="editor-container">
        {!activePath && (
          <div className="welcome-screen">
            <div className="welcome-card">
              <div className="welcome-icon">
                {/* 3D Code Window Icon Mockup */}
                <div className="window-frame">
                  <div className="window-dots">
                    <span className="dot dot-r" />
                    <span className="dot dot-y" />
                    <span className="dot dot-g" />
                  </div>
                  <span className="code-symbol">&lt;/&gt;</span>
                </div>
              </div>
              <h2 className="welcome-title">No file open</h2>
              <p className="welcome-desc">
                Select a file from the explorer or create a new file to start coding.
              </p>
              <div className="welcome-actions">
                <button
                  onClick={() => {
                    const searchEl = document.querySelector('.search-input') as HTMLInputElement;
                    searchEl?.focus();
                  }}
                  className="btn-primary"
                >
                  Select a file
                </button>
                <button
                  onClick={createNewFile}
                  className="btn-ghost"
                >
                  + New File
                </button>
              </div>
            </div>
          </div>
        )}

        {activePath && showDiff && (
          <MonacoDiffEditor
            key={activePath + "-diff"}
            height="100%"
            theme={editorTheme}
            language={languageFor(activePath)}
            original={loadingFile ? "// loading..." : gitContent}
            modified={loadingFile ? "// loading..." : content}
            options={{
              minimap: { enabled: false },
              fontSize: 12.5,
              fontFamily: "var(--font-mono), monospace",
              readOnly: true,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              padding: { top: 12, bottom: 12 },
            }}
          />
        )}

        {activePath && !showDiff && (
          <MonacoEditor
            key={activePath}
            height="100%"
            theme={editorTheme}
            language={languageFor(activePath)}
            value={loadingFile ? "// loading..." : content}
            onChange={(val) => setContent(val ?? "")}
            onMount={(editor) => {
              editorRef.current = editor;
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 12.5,
              fontFamily: "var(--font-mono), monospace",
              readOnly: false,
              wordWrap: "on",
              lineNumbersMinChars: 3,
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              cursorBlinking: "smooth",
              padding: { top: 12, bottom: 12 },
            }}
          />
        )}
      </div>

      <style jsx>{`
        .code-editor-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-deep);
          position: relative;
        }

        .editor-bar {
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          background: rgba(18, 18, 23, 0.25);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
        }

        .breadcrumb-path {
          display: flex;
          align-items: center;
          gap: 6px;
          font-family: var(--font-mono);
          font-size: 11px;
        }

        .path-seg {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .path-sep { color: var(--text-disabled); }
        .path-folder { color: var(--text-muted); }
        .path-file { color: var(--text-primary); }

        .modified-badge {
          font-size: 9.5px;
          color: var(--amber);
          background: var(--amber-dim);
          border: 1px solid rgba(255, 159, 10, 0.2);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
          margin-left: 6px;
        }

        .editor-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .action-btn,
        .revert-btn,
        .save-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .action-btn {
          border: 1px solid var(--border-base);
          background: transparent;
          color: var(--text-secondary);
        }

        .action-btn:hover {
          color: var(--text-primary);
          background: rgba(255, 255, 255, 0.04);
        }

        .action-btn--active {
          background: var(--brand-glow) !important;
          border-color: rgba(0, 122, 255, 0.25) !important;
          color: var(--brand) !important;
        }

        .revert-btn {
          border: 1px solid rgba(255, 69, 58, 0.2);
          background: var(--error-dim);
          color: var(--error);
        }

        .revert-btn:hover:not(:disabled) {
          background: var(--error);
          color: white;
        }

        .save-btn {
          background: var(--brand);
          color: white;
          border: none;
          box-shadow: 0 1px 3px rgba(0, 122, 255, 0.2);
        }

        .save-btn:hover:not(:disabled) {
          filter: brightness(1.1);
        }

        .save-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .editor-container {
          flex: 1;
          min-height: 0;
          position: relative;
        }

        /* Welcome screen fallback */
        .welcome-screen {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .welcome-card {
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 320px;
        }

        .welcome-icon {
          width: 90px;
          height: 90px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }

        .window-frame {
          width: 80px;
          height: 70px;
          border: 1.5px solid var(--border-strong);
          background: rgba(255, 255, 255, 0.02);
          border-radius: var(--radius-md);
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: var(--shadow-md);
        }

        .window-dots {
          position: absolute;
          top: 6px;
          left: 8px;
          display: flex;
          gap: 4px;
        }

        .dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
        }

        .dot-r { background: var(--error); }
        .dot-y { background: var(--warning); }
        .dot-g { background: var(--success); }

        .code-symbol {
          font-family: var(--font-mono);
          font-size: 16px;
          color: var(--text-muted);
          font-weight: 500;
        }

        .welcome-title {
          font-family: var(--font-brand);
          font-size: 16.5px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .welcome-desc {
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.55;
          margin-bottom: 20px;
        }

        .welcome-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .btn-primary {
          background: #ffffff;
          color: #000000;
          border: none;
          font-size: 11.5px;
          font-weight: 500;
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-primary:hover {
          background: rgba(255, 255, 255, 0.85);
        }

        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border-base);
          color: var(--text-primary);
          font-size: 11.5px;
          font-weight: 500;
          padding: 8px 16px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-ghost:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: var(--border-strong);
        }
      `}</style>
    </div>
  );
}
