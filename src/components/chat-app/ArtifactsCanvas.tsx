'use client';

import React, { useState } from 'react';
import type { ExtractedArtifact } from '@/lib/db';
import { useRouter } from 'next/navigation';

interface ArtifactsCanvasProps {
  artifact: ExtractedArtifact | null;
  onClose: () => void;
  onOpenProject?: (projectId: string) => void;
}

export default function ArtifactsCanvas({ artifact, onClose, onOpenProject }: ArtifactsCanvasProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<{ artifactId: string; tab: 'preview' | 'code' } | null>(null);
  const [copied, setCopied] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [key, setKey] = useState(0);

  if (!artifact) return null;

  const currentTab = activeTab?.artifactId === artifact.id ? activeTab.tab : 'preview';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    const ext =
      artifact.type === 'html'
        ? 'html'
        : artifact.type === 'svg'
        ? 'svg'
        : artifact.type === 'mermaid'
        ? 'mmd'
        : artifact.type === 'react'
        ? 'tsx'
        : artifact.language || 'txt';

    const safeTitle = artifact.title.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `${safeTitle}.${ext}`;
    const blob = new Blob([artifact.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleOpenInOpenCode = async () => {
    setCreatingProject(true);
    try {
      const template = artifact.type === 'react' ? 'nextjs' : 'vanilla';
      const ext =
        artifact.type === 'html'
          ? 'html'
          : artifact.type === 'svg'
          ? 'svg'
          : artifact.type === 'react'
          ? 'tsx'
          : 'txt';
      const fileName = artifact.type === 'html' ? 'index.html' : `App.${ext}`;

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: artifact.title || 'Chat Export',
          template,
        }),
      });

      if (!res.ok) throw new Error('Failed to create project');
      const data = await res.json();
      const projectId = data.project?.id;

      if (projectId) {
        try {
          await fetch(`/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(fileName)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: artifact.content }),
          });
        } catch {}

        if (onOpenProject) {
          onOpenProject(projectId);
        } else {
          router.push(`/?projectId=${encodeURIComponent(projectId)}`);
        }
      }
    } catch (err) {
      console.error('Error bridging to Open Code:', err);
    } finally {
      setCreatingProject(false);
    }
  };

  const lineCount = artifact.content.split('\n').length;
  const byteSize = new Blob([artifact.content]).size;
  const formattedSize = byteSize > 1024 ? `${(byteSize / 1024).toFixed(1)} KB` : `${byteSize} B`;

  return (
    <div className="flex flex-col h-full bg-[#181816] border-l border-[#2b2a26] text-[#ede8de] shadow-2xl overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2b2a26] bg-[#1f1e1b]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[#272622] border border-[#3b3a35] flex items-center justify-center text-[#da7756] shrink-0">
            {artifact.type === 'html' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
            )}
            {artifact.type === 'svg' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            )}
            {(artifact.type === 'mermaid' || artifact.type === 'react' || artifact.type === 'code' || artifact.type === 'markdown') && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate text-[#f7f4ee]">{artifact.title}</h3>
            <div className="flex items-center gap-2 text-[11px] text-[#9c978b]">
              <span className="uppercase tracking-wider font-mono text-[10px] text-[#7d796f]">
                {artifact.language || artifact.type}
              </span>
              <span>•</span>
              <span>{lineCount} lines</span>
              <span>•</span>
              <span>{formattedSize}</span>
            </div>
          </div>
        </div>

        {/* View Mode Tabs & Actions */}
        <div className="flex items-center gap-2">
          {/* Segmented Tab */}
          <div className="flex items-center p-0.5 rounded-lg bg-[#272622] border border-[#383632]">
            <button
              type="button"
              onClick={() => setActiveTab({ artifactId: artifact.id, tab: 'preview' })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                currentTab === 'preview'
                  ? 'bg-[#181816] text-[#f7f4ee] shadow-sm'
                  : 'text-[#9c978b] hover:text-[#ede8de]'
              }`}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab({ artifactId: artifact.id, tab: 'code' })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                currentTab === 'code'
                  ? 'bg-[#181816] text-[#f7f4ee] shadow-sm'
                  : 'text-[#9c978b] hover:text-[#ede8de]'
              }`}
            >
              Code
            </button>
          </div>

          {/* Action buttons */}
          <button
            type="button"
            onClick={handleCopy}
            title="Copy code"
            className="p-1.5 rounded-lg text-[#9c978b] hover:text-[#f7f4ee] hover:bg-[#282723] transition-colors"
          >
            {copied ? (
              <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            title="Download file"
            className="p-1.5 rounded-lg text-[#9c978b] hover:text-[#f7f4ee] hover:bg-[#282723] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>

          {/* Bridge: Open in Open Code */}
          <button
            type="button"
            onClick={handleOpenInOpenCode}
            disabled={creatingProject}
            title="Open in Open Code IDE"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#da7756] hover:bg-[#c96c4d] text-white shadow-sm transition-all disabled:opacity-50"
          >
            {creatingProject ? (
              <span>Opening…</span>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
                <span>Open in Open Code</span>
              </>
            )}
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            title="Close Canvas"
            className="p-1.5 rounded-lg text-[#9c978b] hover:text-[#f7f4ee] hover:bg-[#282723] transition-colors ml-1"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Canvas Body */}
      <div className="flex-1 relative overflow-auto bg-[#141412]">
        {currentTab === 'preview' ? (
          <div className="w-full h-full flex flex-col">
            {/* Refresh Toolbar */}
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#1b1a18] border-b border-[#2b2a26] text-[11px] text-[#9c978b]">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Interactive Preview Sandbox</span>
              </span>
              <button
                type="button"
                onClick={() => setKey((k) => k + 1)}
                className="flex items-center gap-1 hover:text-[#ede8de]"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reload</span>
              </button>
            </div>

            {artifact.type === 'html' ? (
              <iframe
                key={key}
                title={artifact.title}
                srcDoc={artifact.content}
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                className="w-full flex-1 border-0 bg-white"
              />
            ) : artifact.type === 'svg' ? (
              <div
                key={key}
                className="w-full flex-1 flex items-center justify-center p-8 overflow-auto"
                style={{
                  backgroundImage: `radial-gradient(circle, #383632 1px, transparent 1px)`,
                  backgroundSize: '16px 16px',
                }}
              >
                <div
                  className="max-w-full max-h-full transition-transform hover:scale-105"
                  dangerouslySetInnerHTML={{ __html: artifact.content }}
                />
              </div>
            ) : artifact.type === 'mermaid' ? (
              <div key={key} className="w-full flex-1 p-6 font-mono text-xs overflow-auto bg-[#181816] text-cyan-200">
                <div className="mb-2 text-[#7d796f] uppercase tracking-widest text-[10px]">
                  Mermaid Source Specification
                </div>
                <pre className="p-4 rounded-xl bg-[#21201d] border border-[#312f2c] text-cyan-200 whitespace-pre-wrap">
                  {artifact.content}
                </pre>
              </div>
            ) : (
              <div key={key} className="w-full flex-1 p-6 font-mono text-xs overflow-auto bg-[#181816] text-[#ded9cc]">
                <div className="mb-2 text-[#7d796f] uppercase tracking-widest text-[10px]">
                  Component / File Content
                </div>
                <pre className="p-4 rounded-xl bg-[#21201d] border border-[#312f2c] text-[#ede8de] whitespace-pre-wrap">
                  {artifact.content}
                </pre>
              </div>
            )}
          </div>
        ) : (
          /* Code View */
          <div className="w-full h-full flex flex-col font-mono text-xs">
            <div className="flex-1 overflow-auto p-4 bg-[#141412] text-[#ded9cc] select-text leading-relaxed">
              <pre className="relative flex">
                <div className="pr-4 select-none text-right text-[#5f5b53] border-r border-[#2b2a26] mr-4 font-mono text-[11px]">
                  {artifact.content.split('\n').map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <code className="flex-1 font-mono text-[12px] whitespace-pre overflow-x-auto text-[#f5f1e8]">
                  {artifact.content}
                </code>
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
