'use client';

import CodeTab from '../CodeTab';

interface EditorPanelProps {
  projectId: string;
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  changedFiles: string[];
}

export default function EditorPanel({
  projectId,
  activeFile,
  onFileSelect,
  changedFiles,
}: EditorPanelProps) {
  return (
    <div className="editor-panel">
      <CodeTab
        projectId={projectId}
        activeFile={activeFile}
        onFileSelect={onFileSelect}
        refreshKey={changedFiles.length}
      />
      <style jsx>{`
        .editor-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
