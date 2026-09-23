'use client';

import PreviewTab from '../PreviewTab';

interface PreviewPanelProps {
  projectId: string;
  /** Increments whenever the agent changes files — boots/reloads the preview */
  autoStartToken?: number;
}

export default function PreviewPanel({ projectId, autoStartToken }: PreviewPanelProps) {
  return (
    <div className="preview-panel">
      <PreviewTab projectId={projectId} autoStartToken={autoStartToken} />
      <style jsx>{`
        .preview-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
