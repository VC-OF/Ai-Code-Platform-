"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

import { languageFor, getFileIcon } from "@/lib/file-utils";

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
  // Tab management: list of open file paths
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(activeFile ?? null);

  // Split Editor state
  const [isSplit, setIsSplit] = useState(false);
  const [splitPath, setSplitPath] = useState<string | null>(null);

  // In-memory file content cache: path -> string
  const fileContents = useRef<Record<string, string>>({});
  const savedContents = useRef<Record<string, string>>({});
  const gitContents = useRef<Record<string, string>>({});

  // Render trigger for active file modified state
  const [modifiedPaths, setModifiedPaths] = useState<Set<string>>(new Set());

  // Current active file state for editor rendering
  const [currentContent, setCurrentContent] = useState("");
  const [currentGitContent, setCurrentGitContent] = useState("");
  const [splitContent, setSplitContent] = useState("");

  const [showDiff, setShowDiff] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [revertingFile, setRevertingFile] = useState(false);
  const [editorTheme, setEditorTheme] = useState<"vs" | "vs-dark">("vs-dark");

  // Editor configuration
  const [wordWrap, setWordWrap] = useState<"on" | "off">("on");
  const [fontSize, setFontSize] = useState(13);

  // Quick File Switcher modal (Ctrl+P)
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [quickOpenFilter, setQuickOpenFilter] = useState("");
  const [allProjectFiles, setAllProjectFiles] = useState<string[]>([]);
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);

  // VS Code status bar info
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // Monaco editor instance refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const splitEditorRef = useRef<any>(null);

  // Theme observer
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

  // Sync external activeFile prop to openTabs and activePath
  useEffect(() => {
    if (activeFile) {
      setOpenTabs((prev) => {
        if (!prev.includes(activeFile)) {
          return [...prev, activeFile];
        }
        return prev;
      });
      setActivePath(activeFile);
    }
  }, [activeFile]);

  // Load project files list for Quick Open palette
  const loadProjectFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      if (data.tree) {
        const filesOnly = (data.tree as { path: string; isDirectory: boolean }[])
          .filter((item) => !item.isDirectory)
          .map((item) => item.path.replace(/\\/g, "/"));
        setAllProjectFiles(filesOnly);
      }
    } catch {}
  }, [projectId]);

  useEffect(() => {
    loadProjectFiles();
  }, [loadProjectFiles, refreshKey]);

  // Load file content when activePath changes
  useEffect(() => {
    if (!activePath) {
      setCurrentContent("");
      setCurrentGitContent("");
      return;
    }

    setShowDiff(false);

    // If we already have unsaved in-memory content, use it immediately
    if (fileContents.current[activePath] !== undefined) {
      setCurrentContent(fileContents.current[activePath]);
      setCurrentGitContent(gitContents.current[activePath] ?? "");
      return;
    }

    setLoadingFile(true);
    const fetchFs = fetch(
      `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}`
    ).then((r) => r.json());

    const fetchGit = fetch(
      `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}&version=git`
    ).then((r) => r.json());

    Promise.all([fetchFs, fetchGit])
      .then(([fsData, gitData]) => {
        const text = fsData.content ?? "";
        const gitText = gitData.content ?? "";
        fileContents.current[activePath] = text;
        savedContents.current[activePath] = text;
        gitContents.current[activePath] = gitText;
        setCurrentContent(text);
        setCurrentGitContent(gitText);
      })
      .catch((err) => console.error("Error loading file content", err))
      .finally(() => setLoadingFile(false));
  }, [activePath, refreshKey, projectId]);

  // Load split file content when splitPath changes
  useEffect(() => {
    if (!isSplit || !splitPath) return;

    if (fileContents.current[splitPath] !== undefined) {
      setSplitContent(fileContents.current[splitPath]);
      return;
    }

    fetch(`/api/files?path=${encodeURIComponent(splitPath)}&projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => {
        const text = data.content ?? "";
        fileContents.current[splitPath] = text;
        savedContents.current[splitPath] = text;
        setSplitContent(text);
      })
      .catch(() => {});
  }, [isSplit, splitPath, projectId]);

  // Handle typing inside Monaco without triggering re-render of Monaco
  const handleContentChange = useCallback(
    (newVal: string, targetPath: string | null) => {
      if (!targetPath) return;
      fileContents.current[targetPath] = newVal;

      const isDiff = newVal !== (savedContents.current[targetPath] ?? "");
      setModifiedPaths((prev) => {
        const next = new Set(prev);
        if (isDiff) {
          next.add(targetPath);
        } else {
          next.delete(targetPath);
        }
        return next;
      });
    },
    []
  );

  // Save current active file (or specific path)
  const saveFile = useCallback(
    async (targetPath?: string) => {
      const pathToSave = targetPath || activePath;
      if (!pathToSave || savingFile) return;
      const contentToSave = fileContents.current[pathToSave] ?? currentContent;
      setSavingFile(true);

      try {
        const res = await fetch("/api/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: pathToSave, content: contentToSave, projectId }),
        });
        if (res.ok) {
          savedContents.current[pathToSave] = contentToSave;
          gitContents.current[pathToSave] = contentToSave;
          if (pathToSave === activePath) {
            setCurrentGitContent(contentToSave);
          }
          setModifiedPaths((prev) => {
            const next = new Set(prev);
            next.delete(pathToSave);
            return next;
          });
        }
      } catch (err) {
        console.error("Failed to save file:", err);
      } finally {
        setSavingFile(false);
      }
    },
    [activePath, currentContent, projectId, savingFile]
  );

  // Revert active file
  const revertFile = useCallback(async () => {
    if (!activePath || revertingFile) return;
    if (
      !confirm(
        `Are you sure you want to revert "${activePath}" to its last saved/checkpoint state? Unsaved modifications will be lost.`
      )
    ) {
      return;
    }

    setRevertingFile(true);
    try {
      const res = await fetch("/api/files/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, projectId }),
      });
      if (res.ok) {
        delete fileContents.current[activePath];
        delete savedContents.current[activePath];
        delete gitContents.current[activePath];

        const fsData = await fetch(
          `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}`
        ).then((r) => r.json());
        const gitData = await fetch(
          `/api/files?path=${encodeURIComponent(activePath)}&projectId=${encodeURIComponent(projectId)}&version=git`
        ).then((r) => r.json());

        const text = fsData.content ?? "";
        fileContents.current[activePath] = text;
        savedContents.current[activePath] = text;
        gitContents.current[activePath] = gitData.content ?? "";

        setCurrentContent(text);
        setCurrentGitContent(gitData.content ?? "");
        setModifiedPaths((prev) => {
          const next = new Set(prev);
          next.delete(activePath);
          return next;
        });
        setShowDiff(false);

        if (editorRef.current) {
          editorRef.current.setValue(text);
        }
      }
    } catch (err) {
      alert("Error reverting file: " + String(err));
    } finally {
      setRevertingFile(false);
    }
  }, [activePath, projectId, revertingFile]);

  // Tab switching
  const selectTab = (path: string) => {
    setActivePath(path);
    onFileSelect?.(path);
  };

  // Close tab
  const closeTab = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Check if modified before closing
    if (modifiedPaths.has(path)) {
      if (!confirm(`Save changes to ${path} before closing?`)) {
        return;
      }
    }

    const nextTabs = openTabs.filter((t) => t !== path);
    setOpenTabs(nextTabs);

    if (activePath === path) {
      const closedIndex = openTabs.indexOf(path);
      const nextActive =
        nextTabs[closedIndex] || nextTabs[closedIndex - 1] || null;
      setActivePath(nextActive);
      if (nextActive) onFileSelect?.(nextActive);
    }
    if (splitPath === path) {
      setSplitPath(nextTabs[0] || null);
    }
  };

  // Create new file
  const createNewFile = async () => {
    const filename = prompt(
      "Enter relative file path (e.g. src/components/Badge.tsx):"
    );
    if (!filename?.trim()) return;
    const cleanPath = filename.trim().replace(/\\/g, "/");
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: cleanPath, content: "", projectId }),
      });
      if (res.ok) {
        fileContents.current[cleanPath] = "";
        savedContents.current[cleanPath] = "";
        setOpenTabs((prev) => (prev.includes(cleanPath) ? prev : [...prev, cleanPath]));
        setActivePath(cleanPath);
        onFileSelect?.(cleanPath);
        loadProjectFiles();
      }
    } catch (e) {
      alert(`Error creating file: ${String(e)}`);
    }
  };

  // Trigger Find in editor
  const triggerFind = () => {
    if (editorRef.current) {
      editorRef.current.focus();
      editorRef.current.getAction("actions.find")?.run();
    }
  };

  // Trigger Format document
  const triggerFormat = () => {
    if (editorRef.current) {
      editorRef.current.getAction("editor.action.formatDocument")?.run();
    }
  };

  // Toggle Split Editor view
  const toggleSplitView = () => {
    if (!isSplit) {
      const otherTab = openTabs.find((t) => t !== activePath) || activePath;
      setSplitPath(otherTab);
      setIsSplit(true);
    } else {
      setIsSplit(false);
    }
  };

  // Keyboard shortcuts listener: Ctrl+S, Ctrl+W, Ctrl+P, Shift+Alt+F
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveFile();
      } else if (isMeta && e.key.toLowerCase() === "w" && activePath) {
        e.preventDefault();
        closeTab(activePath);
      } else if (isMeta && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setShowQuickOpen((prev) => !prev);
        setQuickOpenFilter("");
        setQuickOpenIndex(0);
      } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        triggerFormat();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveFile, activePath, openTabs]);

  const isCurrentModified = activePath ? modifiedPaths.has(activePath) : false;

  // Filtered files for Quick Open modal
  const filteredQuickFiles = allProjectFiles.filter((p) =>
    p.toLowerCase().includes(quickOpenFilter.toLowerCase())
  );

  const openFileFromPalette = (path: string) => {
    if (!openTabs.includes(path)) {
      setOpenTabs((prev) => [...prev, path]);
    }
    setActivePath(path);
    onFileSelect?.(path);
    setShowQuickOpen(false);
  };

  return (
    <div className="code-editor-panel">
      {/* ── VS Code Tab Bar ────────────────────────────────────────── */}
      {openTabs.length > 0 && (
        <div className="vscode-tabs-bar">
          <div className="vscode-tabs-list">
            {openTabs.map((path) => {
              const isActive = path === activePath;
              const isMod = modifiedPaths.has(path);
              const fileName = path.split("/").pop() || path;
              const { icon, color } = getFileIcon(fileName);

              return (
                <div
                  key={path}
                  className={`vscode-tab ${isActive ? "vscode-tab--active" : ""}`}
                  onClick={() => selectTab(path)}
                  onAuxClick={(e) => {
                    if (e.button === 1) closeTab(path, e);
                  }}
                  title={path}
                >
                  <span className="tab-icon" style={{ color }}>
                    {icon}
                  </span>
                  <span className="tab-title">{fileName}</span>
                  <button
                    className={`tab-close-btn ${isMod ? "tab-close-btn--modified" : ""}`}
                    onClick={(e) => closeTab(path, e)}
                    title={isMod ? "Unsaved changes" : "Close tab (Ctrl+W)"}
                  >
                    {isMod ? <span className="dirty-dot">●</span> : "✕"}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="vscode-tabs-actions">
            <button
              onClick={() => {
                setShowQuickOpen(true);
                setQuickOpenFilter("");
                setQuickOpenIndex(0);
              }}
              className="tab-action-icon-btn"
              title="Quick Open File (Ctrl+P)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
            <button
              onClick={createNewFile}
              className="tab-action-icon-btn"
              title="New File"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              onClick={toggleSplitView}
              className={`tab-action-icon-btn ${isSplit ? "tab-action-icon-btn--active" : ""}`}
              title={isSplit ? "Close Split Editor" : "Split Editor Right"}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M12 3v18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Breadcrumb & Action Toolbar ──────────────────────────── */}
      {activePath && (
        <div className="editor-bar">
          <div className="breadcrumb-path">
            <span
              className="breadcrumb-file-icon"
              style={{ color: getFileIcon(activePath).color }}
            >
              {getFileIcon(activePath).icon}
            </span>
            {activePath.split("/").map((seg, i, arr) => (
              <span key={i} className="path-seg">
                {i > 0 && <span className="path-sep">›</span>}
                <span className={i === arr.length - 1 ? "path-file font-semibold" : "path-folder"}>
                  {seg}
                </span>
              </span>
            ))}
            {isCurrentModified && (
              <span className="modified-badge">Modified</span>
            )}
          </div>

          <div className="editor-actions">
            {/* Quick action buttons */}
            <button
              onClick={triggerFind}
              className="tool-action-btn"
              title="Find (Ctrl+F)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <span>Find</span>
            </button>

            <button
              onClick={triggerFormat}
              className="tool-action-btn"
              title="Format Document (Shift+Alt+F)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12}>
                <path d="M4 6h16M4 12h10M4 18h14" />
              </svg>
              <span>Format</span>
            </button>

            <button
              onClick={() => setWordWrap((prev) => (prev === "on" ? "off" : "on"))}
              className={`tool-action-btn ${wordWrap === "on" ? "tool-action-btn--active" : ""}`}
              title="Toggle Word Wrap"
            >
              <span>Wrap</span>
            </button>

            <button
              onClick={() => setShowDiff(!showDiff)}
              className={`action-btn ${showDiff ? "action-btn--active" : ""}`}
              title="Compare with last checkpoint"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span>{showDiff ? "Editor" : "Diff"}</span>
            </button>

            {isCurrentModified && (
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
              disabled={!isCurrentModified || savingFile}
              onClick={() => saveFile()}
              className="save-btn"
              title="Save (Ctrl+S)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} width={12} height={12}>
                <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
                <path d="M17 21v-8H7v8M7 3v5h8" />
              </svg>
              <span>{savingFile ? "Saving…" : "Save"}</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Main Editor Canvas ───────────────────────────────────── */}
      <div className={`editor-container ${isSplit ? "editor-container--split" : ""}`}>
        {!activePath && (
          <div className="welcome-screen">
            <div className="welcome-card">
              <div className="welcome-icon">
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
                Select a file from the explorer on the left or press <strong>Ctrl+P</strong> to quickly open any file.
              </p>
              <div className="welcome-actions">
                <button
                  onClick={() => {
                    setShowQuickOpen(true);
                    setQuickOpenFilter("");
                  }}
                  className="btn-primary"
                >
                  Quick Open (Ctrl+P)
                </button>
                <button onClick={createNewFile} className="btn-ghost">
                  + New File
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Primary Editor Pane */}
        {activePath && showDiff && (
          <MonacoDiffEditor
            key={activePath + "-diff"}
            height="100%"
            theme={editorTheme}
            language={languageFor(activePath)}
            original={loadingFile ? "// loading..." : currentGitContent}
            modified={loadingFile ? "// loading..." : (fileContents.current[activePath] ?? currentContent)}
            options={{
              minimap: { enabled: true },
              fontSize,
              fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
              readOnly: true,
              wordWrap,
              scrollBeyondLastLine: false,
              renderLineHighlight: "all",
              padding: { top: 10, bottom: 10 },
            }}
          />
        )}

        {activePath && !showDiff && (
          <div className="editor-pane">
            <MonacoEditor
              key={activePath}
              height="100%"
              theme={editorTheme}
              language={languageFor(activePath)}
              defaultValue={currentContent}
              onChange={(val) => handleContentChange(val ?? "", activePath)}
              onMount={(editor, monaco) => {
                editorRef.current = editor;

                // Register Ctrl+S save command directly inside Monaco
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  saveFile();
                });

                // Track cursor position for the status bar
                editor.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
                  setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                });
              }}
              options={{
                minimap: {
                  enabled: true,
                  renderCharacters: false,
                  maxColumn: 90,
                },
                fontSize,
                fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
                fontLigatures: true,
                lineNumbers: "on",
                lineNumbersMinChars: 3,
                folding: true,
                bracketPairColorization: { enabled: true },
                autoClosingBrackets: "always",
                autoClosingQuotes: "always",
                formatOnPaste: true,
                formatOnType: true,
                wordWrap,
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: "on",
                tabCompletion: "on",
                wordBasedSuggestions: "allDocuments",
                parameterHints: { enabled: true },
                scrollBeyondLastLine: false,
                renderLineHighlight: "all",
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                smoothScrolling: true,
                padding: { top: 10, bottom: 12 },
              }}
            />
          </div>
        )}

        {/* Secondary Split Pane */}
        {isSplit && splitPath && (
          <div className="editor-pane editor-pane--secondary">
            <div className="split-pane-header">
              <span className="split-pane-title">
                <span style={{ color: getFileIcon(splitPath).color, fontWeight: "bold" }}>
                  {getFileIcon(splitPath).icon}
                </span>{" "}
                {splitPath}
              </span>
              <div className="split-pane-actions">
                <select
                  value={splitPath}
                  onChange={(e) => setSplitPath(e.target.value)}
                  className="split-file-select"
                >
                  {openTabs.map((tab) => (
                    <option key={tab} value={tab}>
                      {tab}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setIsSplit(false)}
                  className="split-close-btn"
                  title="Close split pane"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="split-editor-wrapper">
              <MonacoEditor
                key={"split-" + splitPath}
                height="100%"
                theme={editorTheme}
                language={languageFor(splitPath)}
                defaultValue={fileContents.current[splitPath] ?? splitContent}
                onChange={(val) => handleContentChange(val ?? "", splitPath)}
                onMount={(editor, monaco) => {
                  splitEditorRef.current = editor;
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    saveFile(splitPath);
                  });
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize,
                  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, monospace",
                  fontLigatures: true,
                  lineNumbers: "on",
                  lineNumbersMinChars: 3,
                  folding: true,
                  bracketPairColorization: { enabled: true },
                  autoClosingBrackets: "always",
                  autoClosingQuotes: "always",
                  wordWrap,
                  scrollBeyondLastLine: false,
                  renderLineHighlight: "all",
                  cursorBlinking: "smooth",
                  padding: { top: 10, bottom: 12 },
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── VS Code Style Status Bar ─────────────────────────────── */}
      {activePath && (
        <div className="vscode-statusbar">
          <div className="sb-left">
            <span className="sb-item" title="Git Branch">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={11} height={11}>
                <path d="M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9" />
              </svg>
              <span>main</span>
            </span>
            {isCurrentModified && (
              <span className="sb-item sb-item--warn" title="Unsaved modifications">
                ● 1 unsaved
              </span>
            )}
            {isSplit && (
              <span className="sb-item sb-item--split">
                Split Editor Active
              </span>
            )}
          </div>

          <div className="sb-right">
            <span
              className="sb-item sb-clickable"
              onClick={() => setFontSize((s) => (s >= 18 ? 12 : s + 1))}
              title="Click to change font size"
            >
              Zoom: {fontSize}px
            </span>
            <span className="sb-item">
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span className="sb-item">Spaces: 2</span>
            <span className="sb-item">UTF-8</span>
            <span className="sb-item">LF</span>
            <span className="sb-item sb-item--lang">
              {languageFor(activePath).toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* ── Quick Open File Switcher Modal (Ctrl+P) ──────────────── */}
      {showQuickOpen && (
        <div className="quick-open-overlay" onClick={() => setShowQuickOpen(false)}>
          <div className="quick-open-modal" onClick={(e) => e.stopPropagation()}>
            <div className="quick-open-input-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                autoFocus
                placeholder="Search files by name… (Esc to close)"
                value={quickOpenFilter}
                onChange={(e) => {
                  setQuickOpenFilter(e.target.value);
                  setQuickOpenIndex(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setShowQuickOpen(false);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setQuickOpenIndex((i) => Math.min(i + 1, filteredQuickFiles.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setQuickOpenIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && filteredQuickFiles[quickOpenIndex]) {
                    e.preventDefault();
                    openFileFromPalette(filteredQuickFiles[quickOpenIndex]);
                  }
                }}
                className="quick-open-input"
              />
            </div>
            <div className="quick-open-results">
              {filteredQuickFiles.length === 0 ? (
                <div className="quick-open-empty">No matching files</div>
              ) : (
                filteredQuickFiles.map((file, idx) => {
                  const fileName = file.split("/").pop() || file;
                  const dirName = file.split("/").slice(0, -1).join("/");
                  const { icon, color } = getFileIcon(fileName);

                  return (
                    <div
                      key={file}
                      className={`quick-open-item ${idx === quickOpenIndex ? "quick-open-item--active" : ""}`}
                      onClick={() => openFileFromPalette(file)}
                      onMouseEnter={() => setQuickOpenIndex(idx)}
                    >
                      <span className="q-icon" style={{ color }}>
                        {icon}
                      </span>
                      <span className="q-name">{fileName}</span>
                      {dirName && <span className="q-dir">{dirName}</span>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .code-editor-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-deep, #0e1117);
          position: relative;
          overflow: hidden;
        }

        /* ── Tab Bar ─────────────────────────────────────────────── */
        .vscode-tabs-bar {
          height: 35px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--bg-surface, #131720);
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          user-select: none;
          flex-shrink: 0;
          overflow: hidden;
        }

        .vscode-tabs-list {
          display: flex;
          align-items: center;
          height: 100%;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .vscode-tabs-list::-webkit-scrollbar {
          display: none;
        }

        .vscode-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          height: 100%;
          padding: 0 12px;
          font-size: 12px;
          color: var(--text-muted, #8b949e);
          background: rgba(0, 0, 0, 0.15);
          border-right: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
          border-top: 2px solid transparent;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }

        .vscode-tab:hover {
          background: rgba(255, 255, 255, 0.03);
          color: var(--text-primary, #e6edf3);
        }

        .vscode-tab--active {
          background: var(--bg-deep, #0e1117);
          color: var(--text-primary, #ffffff);
          border-top-color: var(--brand, #0070f3);
          font-weight: 500;
        }

        .tab-icon {
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .tab-title {
          max-width: 140px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tab-close-btn {
          width: 16px;
          height: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 3px;
          color: var(--text-muted, #8b949e);
          font-size: 10px;
          cursor: pointer;
          margin-left: 4px;
          transition: all 0.15s ease;
        }

        .tab-close-btn:hover {
          background: rgba(255, 255, 255, 0.15);
          color: var(--text-primary, #ffffff);
        }

        .dirty-dot {
          font-size: 11px;
          color: var(--amber, #f59e0b);
        }

        .tab-close-btn--modified:hover .dirty-dot {
          display: none;
        }
        .tab-close-btn--modified:hover::after {
          content: "✕";
          font-size: 10px;
        }

        .vscode-tabs-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 8px;
        }

        .tab-action-icon-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: var(--text-muted, #8b949e);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tab-action-icon-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-primary, #ffffff);
        }

        .tab-action-icon-btn--active {
          background: rgba(0, 112, 243, 0.2);
          color: var(--brand, #0070f3);
        }

        /* ── Breadcrumb Bar ──────────────────────────────────────── */
        .editor-bar {
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          background: rgba(14, 17, 23, 0.7);
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
          flex-shrink: 0;
          min-width: 0;
          overflow: hidden;
          gap: 8px;
        }

        .breadcrumb-path {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono, monospace);
          font-size: 11px;
          min-width: 0;
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
        }

        .breadcrumb-file-icon {
          font-weight: 700;
          font-size: 10.5px;
          margin-right: 2px;
          flex-shrink: 0;
        }

        .path-seg {
          display: flex;
          align-items: center;
          gap: 4px;
          min-width: 0;
          flex-shrink: 1;
        }

        .path-sep {
          color: var(--text-disabled, #484f58);
          font-size: 11px;
          flex-shrink: 0;
        }
        .path-folder {
          color: var(--text-muted, #8b949e);
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 90px;
          white-space: nowrap;
        }
        .path-file {
          color: var(--text-primary, #e6edf3);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .modified-badge {
          font-size: 9px;
          color: var(--amber, #f59e0b);
          background: rgba(245, 158, 11, 0.12);
          border: 1px solid rgba(245, 158, 11, 0.3);
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 600;
          margin-left: 6px;
          flex-shrink: 0;
        }

        .editor-actions {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
        }

        .tool-action-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--text-muted, #8b949e);
          background: transparent;
          border: 1px solid transparent;
          padding: 3px 6px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .tool-action-btn:hover {
          background: rgba(255, 255, 255, 0.06);
          color: var(--text-primary, #ffffff);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .tool-action-btn--active {
          color: var(--brand, #0070f3);
          background: rgba(0, 112, 243, 0.1);
          border-color: rgba(0, 112, 243, 0.3);
        }

        .action-btn,
        .revert-btn,
        .save-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          font-weight: 500;
          padding: 3px 8px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-btn {
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.12));
          background: transparent;
          color: var(--text-secondary, #8b949e);
        }

        .action-btn:hover {
          color: var(--text-primary, #ffffff);
          background: rgba(255, 255, 255, 0.05);
        }

        .action-btn--active {
          background: rgba(0, 112, 243, 0.15) !important;
          border-color: rgba(0, 112, 243, 0.4) !important;
          color: var(--brand, #0070f3) !important;
        }

        .revert-btn {
          border: 1px solid rgba(239, 68, 68, 0.25);
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
        }

        .revert-btn:hover:not(:disabled) {
          background: #ef4444;
          color: white;
        }

        .save-btn {
          background: var(--brand, #0070f3);
          color: white;
          border: none;
        }

        .save-btn:hover:not(:disabled) {
          filter: brightness(1.15);
        }

        .save-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        /* ── Editor Container & Split Pane ───────────────────────── */
        .editor-container {
          flex: 1;
          min-height: 0;
          position: relative;
          display: flex;
        }

        .editor-pane {
          flex: 1;
          height: 100%;
          min-width: 0;
          position: relative;
        }

        .editor-pane--secondary {
          border-left: 2px solid var(--border-base, rgba(255, 255, 255, 0.1));
          display: flex;
          flex-direction: column;
        }

        .split-pane-header {
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px;
          background: rgba(0, 0, 0, 0.25);
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
          font-size: 11px;
        }

        .split-pane-title {
          font-family: var(--font-mono, monospace);
          color: var(--text-primary, #ffffff);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .split-pane-actions {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .split-file-select {
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
          color: var(--text-primary, #ffffff);
          border-radius: 3px;
          font-size: 10px;
          padding: 1px 4px;
          outline: none;
        }

        .split-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted, #8b949e);
          cursor: pointer;
          font-size: 11px;
        }
        .split-close-btn:hover {
          color: #ef4444;
        }

        .split-editor-wrapper {
          flex: 1;
          min-height: 0;
        }

        /* ── VS Code Status Bar ──────────────────────────────────── */
        .vscode-statusbar {
          height: 24px;
          background: #007acc;
          color: #ffffff;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          font-size: 11px;
          font-family: var(--font-mono, monospace);
          flex-shrink: 0;
          user-select: none;
        }

        .sb-left,
        .sb-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .sb-item {
          display: flex;
          align-items: center;
          gap: 4px;
          opacity: 0.9;
        }

        .sb-item:hover {
          opacity: 1;
          cursor: default;
        }

        .sb-clickable {
          cursor: pointer !important;
        }
        .sb-clickable:hover {
          text-decoration: underline;
        }

        .sb-item--warn {
          background: rgba(0, 0, 0, 0.25);
          padding: 1px 5px;
          border-radius: 3px;
        }

        .sb-item--split {
          background: rgba(0, 0, 0, 0.3);
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 10px;
        }

        .sb-item--lang {
          font-weight: 600;
        }

        /* ── Quick Open Modal ────────────────────────────────────── */
        .quick-open-overlay {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          z-index: 100;
          display: flex;
          justify-content: center;
          padding-top: 40px;
        }

        .quick-open-modal {
          width: 500px;
          max-width: 90%;
          background: var(--bg-surface, #1e2430);
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.15));
          border-radius: 8px;
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 380px;
        }

        .quick-open-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
          color: var(--text-muted, #8b949e);
        }

        .quick-open-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary, #ffffff);
          font-size: 13px;
          font-family: var(--font-mono, monospace);
        }

        .quick-open-results {
          overflow-y: auto;
          padding: 6px;
        }

        .quick-open-empty {
          padding: 12px;
          text-align: center;
          color: var(--text-muted, #8b949e);
          font-size: 12px;
        }

        .quick-open-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 5px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.1s ease;
        }

        .quick-open-item--active,
        .quick-open-item:hover {
          background: var(--brand, #0070f3);
          color: #ffffff;
        }

        .quick-open-item--active .q-dir,
        .quick-open-item:hover .q-dir {
          color: rgba(255, 255, 255, 0.7);
        }

        .q-icon {
          font-family: var(--font-mono, monospace);
          font-weight: 700;
          font-size: 11px;
        }

        .q-name {
          font-weight: 500;
        }

        .q-dir {
          font-size: 10px;
          color: var(--text-muted, #8b949e);
          margin-left: auto;
        }

        /* ── Welcome Screen ──────────────────────────────────────── */
        .welcome-screen {
          height: 100%;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .welcome-card {
          max-width: 380px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .welcome-icon {
          margin-bottom: 20px;
        }

        .window-frame {
          width: 60px;
          height: 48px;
          background: var(--bg-surface, #161b22);
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.12));
          border-radius: 8px;
          padding: 6px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        }

        .window-dots {
          display: flex;
          gap: 3.5px;
          align-self: flex-start;
        }

        .dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        .dot-r { background: #ef4444; }
        .dot-y { background: #f59e0b; }
        .dot-g { background: #10b981; }

        .code-symbol {
          font-family: var(--font-mono, monospace);
          font-size: 15px;
          color: var(--text-muted, #8b949e);
          font-weight: 600;
        }

        .welcome-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary, #ffffff);
          margin-bottom: 6px;
        }

        .welcome-desc {
          font-size: 12px;
          color: var(--text-muted, #8b949e);
          line-height: 1.5;
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
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 4px;
          cursor: pointer;
        }

        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border-base, rgba(255, 255, 255, 0.12));
          color: var(--text-primary, #ffffff);
          font-size: 12px;
          font-weight: 500;
          padding: 7px 14px;
          border-radius: 4px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
