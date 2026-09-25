"use client";

import { useEffect, useLayoutEffect, useState, useRef, useCallback } from "react";
import type { BeforeMount } from "@monaco-editor/react";
import dynamic from "next/dynamic";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const MonacoDiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

import { languageFor, getFileIcon } from "@/lib/file-utils";

const EDITOR_FONT = "'JetBrains Mono', 'SFMono-Regular', ui-monospace, Consolas, monospace";

// Warm-neutral Monaco themes matching the design tokens
const defineEditorThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme("oc-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "comment", foreground: "7d7b74", fontStyle: "italic" }],
    colors: {
      "editor.background": "#262624",
      "editor.foreground": "#eceae3",
      "editorLineNumber.foreground": "#65635d",
      "editorLineNumber.activeForeground": "#c3c0b6",
      "editor.lineHighlightBackground": "#2c2b29",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#d977572e",
      "editor.inactiveSelectionBackground": "#d977571a",
      "editorCursor.foreground": "#d97757",
      "editorIndentGuide.background1": "#34332f",
      "editorWhitespace.foreground": "#3a3936",
      "editorGutter.background": "#262624",
      "minimap.background": "#262624",
      "scrollbarSlider.background": "#eceae31a",
      "scrollbarSlider.hoverBackground": "#eceae333",
      "editorWidget.background": "#30302e",
      "editorWidget.border": "#eceae31f",
      "diffEditor.insertedTextBackground": "#7fb88f22",
      "diffEditor.removedTextBackground": "#e5776b22",
    },
  });
  monaco.editor.defineTheme("oc-light", {
    base: "vs",
    inherit: true,
    rules: [{ token: "comment", foreground: "8a887f", fontStyle: "italic" }],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1f1e1d",
      "editorLineNumber.foreground": "#a8a69e",
      "editorLineNumber.activeForeground": "#3d3c38",
      "editor.lineHighlightBackground": "#f5f4ef",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#d977572e",
      "editor.inactiveSelectionBackground": "#d977571a",
      "editorCursor.foreground": "#c6613f",
      "editorIndentGuide.background1": "#ebe9e1",
      "editorGutter.background": "#ffffff",
      "minimap.background": "#ffffff",
      "scrollbarSlider.background": "#1f1e1d1a",
      "scrollbarSlider.hoverBackground": "#1f1e1d33",
      "editorWidget.background": "#f5f4ef",
      "editorWidget.border": "#1f1e1d1f",
      "diffEditor.insertedTextBackground": "#2f7d4f1c",
      "diffEditor.removedTextBackground": "#b53b2f1c",
    },
  });
};

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
  const [savingFile, setSavingFile] = useState(false);
  const [revertingFile, setRevertingFile] = useState(false);
  const [editorTheme, setEditorTheme] = useState<"oc-light" | "oc-dark">(() =>
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
      ? "oc-light"
      : "oc-dark"
  );
  const [diffModified, setDiffModified] = useState("");

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
  const [selectedCodeRange, setSelectedCodeRange] = useState<{
    startLine: number;
    endLine: number;
    text: string;
  } | null>(null);

  // Monaco editor instance refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const splitEditorRef = useRef<any>(null);

  const handleAskAIAboutSelection = useCallback(() => {
    if (!activePath) return;
    const editor = editorRef.current;
    let text = "";
    let rangeStr = "";
    if (editor) {
      const sel = editor.getSelection();
      if (sel && (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)) {
        text = editor.getModel()?.getValueInRange(sel) || "";
        rangeStr = ` (lines ${sel.startLineNumber}-${sel.endLineNumber})`;
      }
    }
    if (!text && selectedCodeRange) {
      text = selectedCodeRange.text;
      rangeStr = ` (lines ${selectedCodeRange.startLine}-${selectedCodeRange.endLine})`;
    }
    const prompt = text
      ? `Regarding \`${activePath}\`${rangeStr}:\n\`\`\`${languageFor(activePath)}\n${text}\n\`\`\`\nCan you review or modify this code: `
      : `Regarding \`${activePath}\`:\nCan you explain or update this file: `;
    window.dispatchEvent(new CustomEvent("oc-inject-prompt", { detail: { prompt } }));
  }, [activePath, selectedCodeRange]);

  // Inline edit (Ctrl+I) state
  const [showInlineEdit, setShowInlineEdit] = useState(false);
  const [inlinePrompt, setInlinePrompt] = useState('');
  const [inlineLoading, setInlineLoading] = useState(false);
  const [inlineProposed, setInlineProposed] = useState<string | null>(null);
  const [inlineOriginal, setInlineOriginal] = useState('');
  const inlineRangeRef = useRef<{ startLine: number; startCol: number; endLine: number; endCol: number } | null>(null);
  const inlineOriginalTextRef = useRef<string>('');
  const inlinePathRef = useRef<string | null>(null);

  const handleOpenInlineEdit = useCallback(() => {
    if (!editorRef.current || !activePath) return;
    const editor = editorRef.current;
    const sel = editor.getSelection();
    let text = '';
    if (sel && !sel.isEmpty()) {
      text = editor.getModel()?.getValueInRange(sel) || '';
      inlineRangeRef.current = {
        startLine: sel.startLineNumber,
        startCol: sel.startColumn,
        endLine: sel.endLineNumber,
        endCol: sel.endColumn,
      };
    } else {
      const pos = editor.getPosition();
      if (pos) {
        const lineContent = editor.getModel()?.getLineContent(pos.lineNumber) || '';
        text = lineContent;
        inlineRangeRef.current = {
          startLine: pos.lineNumber,
          startCol: 1,
          endLine: pos.lineNumber,
          endCol: lineContent.length + 1,
        };
      }
    }
    inlineOriginalTextRef.current = text;
    inlinePathRef.current = activePath;
    setInlineOriginal(text);
    setInlineProposed(null);
    setShowInlineEdit(true);
  }, [activePath]);
  // Monaco commands are registered once on mount; route through a ref so they see the current activePath
  const openInlineEditRef = useRef(handleOpenInlineEdit);
  const activePathRef = useRef(activePath);
  useLayoutEffect(() => {
    openInlineEditRef.current = handleOpenInlineEdit;
    activePathRef.current = activePath;
  }, [handleOpenInlineEdit, activePath]);

  const handleRunInlineEdit = useCallback(async (customInstruction?: string) => {
    const instruction = customInstruction || inlinePrompt;
    if (!instruction.trim() || !activePath) return;
    const requestPath = activePath;
    setInlineLoading(true);
    try {
      const res = await fetch('/api/ai/inline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction,
          code: inlineOriginalTextRef.current,
          language: languageFor(activePath),
        }),
      });
      const data = await res.json();
      // The user switched files while generating; the proposal belongs to the old file
      if (activePathRef.current !== requestPath) return;
      if (data.success && data.replacement !== undefined) {
        setInlineProposed(data.replacement);
      } else {
        alert(data.error || 'Inline edit generation failed');
      }
    } catch (err) {
      alert(`Error: ${String(err)}`);
    } finally {
      setInlineLoading(false);
    }
  }, [inlinePrompt, activePath]);

  const handleAcceptInlineEdit = useCallback(() => {
    if (!editorRef.current || inlineProposed === null || !inlineRangeRef.current) return;
    if (inlinePathRef.current !== activePath) return;
    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;
    const range = {
      startLineNumber: inlineRangeRef.current.startLine,
      startColumn: inlineRangeRef.current.startCol,
      endLineNumber: inlineRangeRef.current.endLine,
      endColumn: inlineRangeRef.current.endCol,
    };
    editor.executeEdits('inline-ai', [{
      range,
      text: inlineProposed,
      forceMoveMarkers: true,
    }]);
    setShowInlineEdit(false);
    setInlineProposed(null);
    setInlinePrompt('');
  }, [inlineProposed, activePath]);

  const handleRejectInlineEdit = useCallback(() => {
    setShowInlineEdit(false);
    setInlineProposed(null);
    setInlinePrompt('');
  }, []);

  // Close the inline edit if the active file changes; its captured range belongs to the old file.
  // (Render-time adjustment; handleAcceptInlineEdit also guards on inlinePathRef.)
  const [inlineResetPath, setInlineResetPath] = useState(activePath);
  if (inlineResetPath !== activePath) {
    setInlineResetPath(activePath);
    setShowInlineEdit(false);
    setInlineProposed(null);
    setInlinePrompt('');
  }

  // Theme observer
  useEffect(() => {
    const updateTheme = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      setEditorTheme(theme === "light" ? "oc-light" : "oc-dark");
    };
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  // Sync external activeFile prop to openTabs and activePath
  // (Render-time adjustment keyed on the prop, instead of an effect.)
  const [syncedActiveFile, setSyncedActiveFile] = useState<string | null | undefined>(undefined);
  if (syncedActiveFile !== activeFile) {
    setSyncedActiveFile(activeFile);
    if (activeFile) {
      setOpenTabs((prev) => (prev.includes(activeFile) ? prev : [...prev, activeFile]));
      setActivePath(activeFile);
    }
  }

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
    let cancelled = false;
    fetch(`/api/files?projectId=${encodeURIComponent(projectId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.tree) return;
        const filesOnly = (data.tree as { path: string; isDirectory: boolean }[])
          .filter((item) => !item.isDirectory)
          .map((item) => item.path.replace(/\\/g, "/"));
        setAllProjectFiles(filesOnly);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  // Reset the diff view whenever the file (or its on-disk version) changes
  const loadKey = `${projectId}|${activePath ?? ""}|${refreshKey}`;
  const [diffResetKey, setDiffResetKey] = useState(loadKey);
  if (diffResetKey !== loadKey) {
    setDiffResetKey(loadKey);
    setShowDiff(false);
  }
  // Loading is derived: the file is loading until the load for the current key resolves
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loadingFile = activePath !== null && loadedKey !== loadKey;

  // Load file content when activePath changes
  useEffect(() => {
    const key = `${projectId}|${activePath ?? ""}|${refreshKey}`;
    if (!activePath) {
      Promise.resolve().then(() => {
        setCurrentContent("");
        setCurrentGitContent("");
        setLoadedKey(key);
      });
      return;
    }

    // If we already have unsaved in-memory content, use it immediately
    if (fileContents.current[activePath] !== undefined) {
      const cached = fileContents.current[activePath];
      const cachedGit = gitContents.current[activePath] ?? "";
      Promise.resolve().then(() => {
        setCurrentContent(cached);
        setCurrentGitContent(cachedGit);
        setLoadedKey(key);
      });
      return;
    }

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
      .finally(() => setLoadedKey(key));
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
                    aria-label={`Close ${fileName}`}
                  >
                    {isMod && <span className="dirty-dot" aria-hidden="true" />}
                    <svg className="tab-close-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={11} height={11} aria-hidden="true">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
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
              title="Quick open (Ctrl+P)" aria-label="Quick open"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
            </button>
            <button
              onClick={createNewFile}
              className="tab-action-icon-btn"
              title="New file" aria-label="New file"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={13} height={13}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              onClick={toggleSplitView}
              className={`tab-action-icon-btn ${isSplit ? "tab-action-icon-btn--active" : ""}`}
              title={isSplit ? "Close split editor" : "Split editor right"} aria-label="Toggle split editor"
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
                {i > 0 && <span className="path-sep">/</span>}
                <span className={i === arr.length - 1 ? "path-file" : "path-folder"}>
                  {seg}
                </span>
              </span>
            ))}
            {isCurrentModified && (
              <span className="modified-badge">Modified</span>
            )}
          </div>

          <div className="editor-actions">
            {/* Inline Edit (Ctrl+I) button */}
            <button
              onClick={handleOpenInlineEdit}
              className="tool-action-btn"
              title="Edit inline (Ctrl+I)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} width={13} height={13} aria-hidden="true">
                <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              <span>Edit</span>
            </button>

            {/* Ask AI Bridge button */}
            <button
              onClick={handleAskAIAboutSelection}
              className={`tool-action-btn ${selectedCodeRange ? 'tool-action-btn--active' : ''}`}
              title={
                selectedCodeRange
                  ? `Ask about lines ${selectedCodeRange.startLine}-${selectedCodeRange.endLine} (Ctrl+K)`
                  : `Ask about ${activePath} (Ctrl+K)`
              }
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} width={13} height={13} aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>{selectedCodeRange ? `Ask (${selectedCodeRange.endLine - selectedCodeRange.startLine + 1} lines)` : 'Ask'}</span>
            </button>

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
              title="Toggle word wrap"
            >
              <span>Wrap</span>
            </button>

            <button
              onClick={() => {
                if (!showDiff && activePath) {
                  setDiffModified(fileContents.current[activePath] ?? currentContent);
                }
                setShowDiff(!showDiff);
              }}
              className={`tool-action-btn ${showDiff ? "tool-action-btn--active" : ""}`}
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
                className="tool-action-btn"
                title="Revert unsaved changes"
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
              className="btn btn--accent btn--sm"
              title="Save (Ctrl+S)"
            >
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
              <div className="welcome-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width={28} height={28}>
                  <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <path d="M14 3v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" />
                </svg>
              </div>
              <h2 className="welcome-title">No file open</h2>
              <p className="welcome-desc">
                Select a file in the explorer, or press <kbd className="kbd">Ctrl+P</kbd> to open one quickly.
              </p>
              <div className="welcome-actions">
                <button
                  onClick={() => {
                    setShowQuickOpen(true);
                    setQuickOpenFilter("");
                  }}
                  className="btn btn--secondary"
                >
                  Quick open
                </button>
                <button onClick={createNewFile} className="btn btn--ghost">
                  New file
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Primary Editor Pane */}
        {activePath && showDiff && (
          <MonacoDiffEditor
            key={activePath + "-diff"}
            beforeMount={defineEditorThemes}
            height="100%"
            theme={editorTheme}
            language={languageFor(activePath)}
            original={loadingFile ? "// loading..." : currentGitContent}
            modified={loadingFile ? "// loading..." : diffModified}
            options={{
              minimap: { enabled: true },
              fontSize,
              fontFamily: EDITOR_FONT,
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
              beforeMount={defineEditorThemes}
              onChange={(val) => handleContentChange(val ?? "", activePath)}
              onMount={(editor, monaco) => {
                editorRef.current = editor;

                // Register Ctrl+S save command directly inside Monaco
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                  saveFile();
                });

                // Register Ctrl+K / Cmd+K Ask AI command inside Monaco
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
                  handleAskAIAboutSelection();
                });

                // Register Ctrl+I / Cmd+I inline edit command
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => {
                  openInlineEditRef.current();
                });

                // Track cursor position for the status bar
                editor.onDidChangeCursorPosition((e: { position: { lineNumber: number; column: number } }) => {
                  setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                });

                // Track selection for "Ask AI" context action
                editor.onDidChangeCursorSelection((e) => {
                  const sel = e.selection;
                  if (sel && (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)) {
                    const txt = editor.getModel()?.getValueInRange(sel) || "";
                    if (txt.trim().length > 0) {
                      setSelectedCodeRange({
                        startLine: sel.startLineNumber,
                        endLine: sel.endLineNumber,
                        text: txt,
                      });
                      return;
                    }
                  }
                  setSelectedCodeRange(null);
                });
              }}
              options={{
                minimap: {
                  enabled: true,
                  renderCharacters: false,
                  maxColumn: 90,
                },
                fontSize,
                fontFamily: EDITOR_FONT,
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

            {/* Inline edit (Ctrl+I) */}
            {showInlineEdit && (
              <div className="inline-edit-overlay" role="dialog" aria-label="Inline edit">
                <div className="inline-edit-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} width={14} height={14} aria-hidden="true" className="inline-edit-icon">
                    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <input
                    type="text"
                    autoFocus
                    aria-label="Describe the change"
                    placeholder="Describe the change"
                    value={inlinePrompt}
                    onChange={(e) => {
                      setInlinePrompt(e.target.value);
                      // Editing the prompt invalidates a previously generated proposal
                      if (inlineProposed !== null) setInlineProposed(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (inlineProposed !== null) {
                          handleAcceptInlineEdit();
                        } else {
                          handleRunInlineEdit();
                        }
                      } else if (e.key === 'Escape') {
                        handleRejectInlineEdit();
                      }
                    }}
                    className="inline-edit-input"
                  />
                  <button
                    type="button"
                    onClick={handleRejectInlineEdit}
                    className="icon-btn"
                    title="Close (Esc)"
                    aria-label="Close inline edit"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={12} height={12} aria-hidden="true">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {inlineProposed === null && (
                  <div className="inline-edit-chips">
                    {['Add error handling', 'Add types', 'Add docstrings', 'Refactor', 'Optimize'].map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        disabled={inlineLoading}
                        onClick={() => {
                          setInlinePrompt(chip);
                          handleRunInlineEdit(chip);
                        }}
                        className="inline-chip"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}

                {inlineProposed !== null && (
                  <div className="inline-diff" aria-label="Proposed change">
                    {inlineOriginal !== '' && (
                      <pre className="inline-diff-block inline-diff-block--del">{inlineOriginal}</pre>
                    )}
                    <pre className="inline-diff-block inline-diff-block--add">{inlineProposed}</pre>
                  </div>
                )}

                <div className="inline-edit-footer">
                  <span className="inline-hint">
                    {inlineLoading
                      ? 'Generating…'
                      : inlineProposed !== null
                        ? 'Enter to accept · Esc to discard'
                        : 'Enter to generate · Esc to cancel'}
                  </span>
                  <div className="inline-footer-actions">
                    <button
                      type="button"
                      onClick={handleRejectInlineEdit}
                      className="btn btn--ghost"
                    >
                      {inlineProposed !== null ? 'Discard' : 'Cancel'}
                    </button>
                    {inlineProposed === null ? (
                      <button
                        type="button"
                        onClick={() => handleRunInlineEdit()}
                        disabled={inlineLoading || !inlinePrompt.trim()}
                        className="btn btn--accent"
                      >
                        {inlineLoading ? 'Generating…' : 'Generate'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleAcceptInlineEdit}
                        className="btn btn--accent"
                      >
                        Accept
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Floating selection quick actions */}
            {selectedCodeRange && !showInlineEdit && (
              <div className="floating-selection-bar">
                <button
                  type="button"
                  onClick={handleOpenInlineEdit}
                  className="floating-btn"
                  title="Edit selection inline (Ctrl+I)"
                >
                  <span>Edit</span>
                  <kbd className="kbd">Ctrl+I</kbd>
                </button>
                <span className="floating-sep" aria-hidden="true" />
                <button
                  type="button"
                  onClick={handleAskAIAboutSelection}
                  className="floating-btn"
                  title="Ask about this selection in chat (Ctrl+K)"
                >
                  <span>Ask in chat</span>
                  <kbd className="kbd">Ctrl+K</kbd>
                </button>
              </div>
            )}
          </div>
        )}

        {/* Secondary Split Pane */}
        {isSplit && splitPath && (
          <div className="editor-pane editor-pane--secondary">
            <div className="split-pane-header">
              <span className="split-pane-title">
                <span className="split-pane-icon" style={{ color: getFileIcon(splitPath).color }}>
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
                  className="icon-btn"
                  title="Close split pane"
                  aria-label="Close split pane"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={11} height={11} aria-hidden="true">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="split-editor-wrapper">
              <MonacoEditor
                key={"split-" + splitPath}
                height="100%"
                theme={editorTheme}
                language={languageFor(splitPath)}
                defaultValue={splitContent}
                beforeMount={defineEditorThemes}
                onChange={(val) => handleContentChange(val ?? "", splitPath)}
                onMount={(editor, monaco) => {
                  splitEditorRef.current = editor;
                  // Prefer unsaved in-memory content for this file over the last-loaded snapshot
                  const cached = fileContents.current[splitPath];
                  if (cached !== undefined && cached !== editor.getValue()) {
                    editor.setValue(cached);
                  }
                  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                    saveFile(splitPath);
                  });
                }}
                options={{
                  minimap: { enabled: false },
                  fontSize,
                  fontFamily: EDITOR_FONT,
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
                <span className="sb-dot" aria-hidden="true" />
                Unsaved
              </span>
            )}
            {isSplit && (
              <span className="sb-item sb-item--split">
                Split
              </span>
            )}
          </div>

          <div className="sb-right">
            <button
              type="button"
              className="sb-item sb-clickable"
              onClick={() => setFontSize((s) => (s >= 18 ? 12 : s + 1))}
              title="Change font size"
            >
              {fontSize}px
            </button>
            <span className="sb-item">
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
            <span className="sb-item">Spaces: 2</span>
            <span className="sb-item">UTF-8</span>
            <span className="sb-item">LF</span>
            <span className="sb-item sb-item--lang">
              {languageFor(activePath)}
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
                placeholder="Search files by name"
                aria-label="Search files"
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
          background: var(--bg-surface);
          color: var(--text-primary);
          font-family: var(--font-sans);
          position: relative;
          overflow: hidden;
        }

        button {
          font-family: inherit;
        }
        button:focus-visible,
        select:focus-visible,
        input:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 1px;
        }

        /* ── Shared controls ─────────────────────────────────────── */
        .btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 28px;
          padding: 0 12px;
          font-size: 12px;
          font-weight: 500;
          border-radius: var(--radius-md);
          border: 1px solid transparent;
          cursor: pointer;
          transition: background-color var(--transition-fast), color var(--transition-fast);
        }
        .btn--sm {
          height: 24px;
          padding: 0 10px;
        }
        .btn--accent {
          background: var(--accent);
          color: var(--text-on-accent);
        }
        .btn--accent:hover:not(:disabled) {
          background: var(--accent-dim);
        }
        .btn--secondary {
          background: var(--bg-elevated);
          border-color: var(--border-base);
          color: var(--text-primary);
        }
        .btn--secondary:hover {
          background: var(--bg-overlay);
        }
        .btn--ghost {
          background: transparent;
          color: var(--text-secondary);
        }
        .btn--ghost:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .icon-btn {
          width: 22px;
          height: 22px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          cursor: pointer;
        }
        .icon-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .kbd {
          font-family: var(--font-mono);
          font-size: 10.5px;
          padding: 0 4px;
          border: 1px solid var(--border-base);
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          background: var(--bg-elevated);
        }

        /* ── Tab bar ─────────────────────────────────────────────── */
        .vscode-tabs-bar {
          height: var(--tab-bar-height, 34px);
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          background: var(--bg-base);
          border-bottom: 1px solid var(--border-subtle);
          user-select: none;
          flex-shrink: 0;
          overflow: hidden;
        }

        .vscode-tabs-list {
          display: flex;
          align-items: stretch;
          height: 100%;
          overflow-x: auto;
          scrollbar-width: none;
        }
        .vscode-tabs-list::-webkit-scrollbar {
          display: none;
        }

        .vscode-tab {
          position: relative;
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 0 8px 0 12px;
          font-size: 12px;
          color: var(--text-muted);
          border-right: 1px solid var(--border-subtle);
          cursor: pointer;
          white-space: nowrap;
          transition: color var(--transition-fast), background-color var(--transition-fast);
        }
        .vscode-tab:hover {
          color: var(--text-secondary);
          background: var(--bg-hover);
        }
        .vscode-tab--active,
        .vscode-tab--active:hover {
          color: var(--text-primary);
          background: var(--bg-surface);
        }
        .vscode-tab--active::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 2px;
          background: var(--accent);
        }

        .tab-icon {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .tab-title {
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .tab-close-btn {
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--text-muted);
          cursor: pointer;
          margin-left: 2px;
        }
        .tab-close-x {
          opacity: 0;
        }
        .vscode-tab:hover .tab-close-x,
        .vscode-tab--active .tab-close-x,
        .tab-close-btn:focus-visible .tab-close-x {
          opacity: 1;
        }
        .tab-close-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .dirty-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--text-secondary);
        }
        .tab-close-btn--modified .tab-close-x {
          display: none;
        }
        .tab-close-btn--modified:hover .dirty-dot,
        .tab-close-btn--modified:focus-visible .dirty-dot {
          display: none;
        }
        .tab-close-btn--modified:hover .tab-close-x,
        .tab-close-btn--modified:focus-visible .tab-close-x {
          display: block;
          opacity: 1;
        }

        .vscode-tabs-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 6px;
        }

        .tab-action-icon-btn {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          border: none;
          border-radius: var(--radius-md);
          color: var(--text-muted);
          cursor: pointer;
        }
        .tab-action-icon-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .tab-action-icon-btn--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        /* ── Breadcrumb bar ──────────────────────────────────────── */
        .editor-bar {
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 8px 0 12px;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          flex-shrink: 0;
          min-width: 0;
          overflow: hidden;
          gap: 8px;
        }

        .breadcrumb-path {
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          min-width: 0;
          flex: 1;
          overflow: hidden;
          white-space: nowrap;
        }

        .breadcrumb-file-icon {
          font-weight: 600;
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
          color: var(--text-disabled);
          flex-shrink: 0;
        }
        .path-folder {
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100px;
          white-space: nowrap;
        }
        .path-file {
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .modified-badge {
          font-family: var(--font-sans);
          font-size: 11px;
          color: var(--text-muted);
          margin-left: 8px;
          flex-shrink: 0;
        }

        .editor-actions {
          display: flex;
          align-items: center;
          gap: 2px;
          flex-shrink: 0;
        }

        .tool-action-btn {
          display: flex;
          align-items: center;
          gap: 5px;
          height: 24px;
          font-size: 12px;
          color: var(--text-muted);
          background: transparent;
          border: none;
          padding: 0 7px;
          border-radius: var(--radius-md);
          cursor: pointer;
          transition: background-color var(--transition-fast), color var(--transition-fast);
        }
        .tool-action-btn:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .tool-action-btn--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }
        .tool-action-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .editor-actions .btn {
          margin-left: 4px;
        }

        /* ── Editor container & split pane ───────────────────────── */
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
          border-left: 1px solid var(--border-base);
          display: flex;
          flex-direction: column;
        }

        .split-pane-header {
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 6px 0 10px;
          background: var(--bg-base);
          border-bottom: 1px solid var(--border-subtle);
          font-size: 12px;
        }

        .split-pane-title {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .split-pane-icon {
          font-weight: 600;
        }

        .split-pane-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .split-file-select {
          max-width: 180px;
          height: 22px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          color: var(--text-primary);
          border-radius: var(--radius-md);
          font-size: 11px;
          font-family: var(--font-mono);
          padding: 0 4px;
        }

        .split-editor-wrapper {
          flex: 1;
          min-height: 0;
        }

        /* ── Status bar ──────────────────────────────────────────── */
        .vscode-statusbar {
          height: 24px;
          background: var(--bg-base);
          border-top: 1px solid var(--border-subtle);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px;
          font-size: 11px;
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
          gap: 5px;
        }

        .sb-clickable {
          background: transparent;
          border: none;
          padding: 0 4px;
          border-radius: var(--radius-sm);
          color: inherit;
          font-size: inherit;
          cursor: pointer;
        }
        .sb-clickable:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .sb-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--warning);
        }

        .sb-item--warn {
          color: var(--text-secondary);
        }

        .sb-item--lang {
          color: var(--text-secondary);
        }

        /* ── Quick open ──────────────────────────────────────────── */
        .quick-open-overlay {
          position: absolute;
          inset: 0;
          background: var(--scrim);
          z-index: 100;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          padding-top: 48px;
        }

        .quick-open-modal {
          width: 520px;
          max-width: calc(100% - 32px);
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          max-height: 380px;
        }

        .quick-open-input-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-muted);
        }

        .quick-open-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--text-primary);
          font-size: 13px;
          font-family: var(--font-sans);
        }
        .quick-open-input:focus-visible {
          outline: none;
        }
        .quick-open-input::placeholder {
          color: var(--text-disabled);
        }

        .quick-open-results {
          overflow-y: auto;
          padding: 4px;
        }

        .quick-open-empty {
          padding: 12px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }

        .quick-open-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: 12.5px;
          color: var(--text-secondary);
        }
        .quick-open-item--active {
          background: var(--bg-overlay);
          color: var(--text-primary);
        }

        .q-icon {
          font-family: var(--font-mono);
          font-weight: 600;
          font-size: 10.5px;
        }
        .q-name {
          font-weight: 500;
        }
        .q-dir {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-muted);
          margin-left: auto;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* ── Empty state ─────────────────────────────────────────── */
        .welcome-screen {
          height: 100%;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
        }

        .welcome-card {
          max-width: 340px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .welcome-icon {
          color: var(--text-disabled);
          margin-bottom: 14px;
        }

        .welcome-title {
          font-size: 14px;
          font-weight: 500;
          color: var(--text-primary);
          margin-bottom: 6px;
        }

        .welcome-desc {
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.55;
          margin-bottom: 18px;
        }

        .welcome-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        /* ── Floating selection actions ──────────────────────────── */
        .floating-selection-bar {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 40;
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 3px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          animation: oc-fade-in 120ms ease-out;
        }

        .floating-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 26px;
          padding: 0 8px;
          background: transparent;
          color: var(--text-primary);
          border: none;
          border-radius: var(--radius-md);
          font-size: 12px;
          cursor: pointer;
        }
        .floating-btn:hover {
          background: var(--bg-hover);
        }
        .floating-sep {
          width: 1px;
          height: 14px;
          background: var(--border-base);
        }

        @keyframes oc-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* ── Inline edit (Ctrl+I) ────────────────────────────────── */
        .inline-edit-overlay {
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 50;
          width: calc(100% - 32px);
          max-width: 560px;
          display: flex;
          flex-direction: column;
          background: var(--bg-elevated);
          border: 1px solid var(--border-base);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
          overflow: hidden;
          animation: oc-fade-in 120ms ease-out;
        }

        .inline-edit-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 8px 8px 12px;
        }
        .inline-edit-icon {
          color: var(--text-muted);
          flex-shrink: 0;
        }

        .inline-edit-input {
          flex: 1;
          min-width: 0;
          height: 28px;
          background: transparent;
          border: none;
          font-size: 13px;
          color: var(--text-primary);
          outline: none;
          font-family: var(--font-sans);
        }
        .inline-edit-input:focus-visible {
          outline: none;
        }
        .inline-edit-row:focus-within {
          box-shadow: inset 0 -1px 0 var(--accent-border);
        }
        .inline-edit-input::placeholder {
          color: var(--text-disabled);
        }

        .inline-edit-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 2px;
          padding: 0 8px 8px 30px;
        }

        .inline-chip {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 12px;
          padding: 2px 6px;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .inline-chip:hover:not(:disabled) {
          background: var(--bg-hover);
          color: var(--text-primary);
        }
        .inline-chip:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .inline-diff {
          max-height: 220px;
          overflow: auto;
          margin: 0 8px 8px;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
        }

        .inline-diff-block {
          margin: 0;
          padding: 6px 10px;
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-primary);
          white-space: pre-wrap;
          word-break: break-word;
          border-left: 2px solid transparent;
        }
        .inline-diff-block--del {
          background: var(--error-dim);
          border-left-color: var(--error);
          color: var(--text-secondary);
          text-decoration: line-through;
          text-decoration-color: var(--text-disabled);
        }
        .inline-diff-block--add {
          background: var(--success-dim);
          border-left-color: var(--success);
        }

        .inline-edit-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 6px 8px 6px 12px;
          border-top: 1px solid var(--border-subtle);
        }

        .inline-hint {
          font-size: 11.5px;
          color: var(--text-muted);
        }

        .inline-footer-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .inline-footer-actions .btn {
          height: 26px;
        }

        @media (prefers-reduced-motion: reduce) {
          .floating-selection-bar,
          .inline-edit-overlay {
            animation: none;
          }
          .btn,
          .vscode-tab,
          .tool-action-btn {
            transition: none;
          }
        }
      `}</style>
    </div>
  );
}
