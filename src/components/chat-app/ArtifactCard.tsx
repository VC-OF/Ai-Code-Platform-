'use client';

import React from 'react';
import type { ExtractedArtifact } from '@/lib/db';

interface ArtifactCardProps {
  artifact: ExtractedArtifact;
  isActive?: boolean;
  onSelect: (artifact: ExtractedArtifact) => void;
}

export default function ArtifactCard({ artifact, isActive = false, onSelect }: ArtifactCardProps) {
  const getBadgeInfo = () => {
    switch (artifact.type) {
      case 'html':
        return { label: 'Interactive App', color: 'bg-[#da7756]/15 text-[#da7756] border-[#da7756]/30' };
      case 'svg':
        return { label: 'SVG Illustration', color: 'bg-purple-500/15 text-purple-300 border-purple-500/30' };
      case 'mermaid':
        return { label: 'Mermaid Diagram', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' };
      case 'react':
        return { label: 'React Component', color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' };
      default:
        return { label: artifact.language?.toUpperCase() || 'CODE', color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
    }
  };

  const badge = getBadgeInfo();

  return (
    <div
      onClick={() => onSelect(artifact)}
      className={`my-3.5 group relative flex items-center justify-between p-3.5 rounded-xl border transition-all duration-200 cursor-pointer shadow-2xs ${
        isActive
          ? 'bg-[#f7f5ed] border-[#da7756]/70 dark:bg-[#2b2a26] dark:border-[#da7756]/70 shadow-md shadow-[#da7756]/10 ring-1 ring-[#da7756]/40'
          : 'bg-white hover:bg-[#faf9f5] border-[#e5e2da] dark:bg-[#252421] dark:hover:bg-[#2c2b27] dark:border-[#383632] hover:border-[#da7756]/40'
      }`}
    >
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="w-10 h-10 rounded-lg bg-[#f0eee6] border border-[#e5e2da] dark:bg-[#1e1d1a] dark:border-[#383632] flex items-center justify-center shrink-0 text-[#737067] dark:text-[#e6e1d6] group-hover:text-[#da7756] group-hover:border-[#da7756]/40 transition-colors">
          {artifact.type === 'html' && (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          )}
          {artifact.type === 'svg' && (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
          {artifact.type === 'mermaid' && (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
            </svg>
          )}
          {artifact.type === 'react' && (
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 9a3 3 0 100 6 3 3 0 000-6zm0-7c-5.52 0-10 4.48-10 10s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
            </svg>
          )}
          {artifact.type === 'code' && (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          )}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-[#1f1e1d] dark:text-[#f5f1e8] group-hover:text-[#da7756] transition-colors truncate">
              {artifact.title}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${badge.color}`}>
              {badge.label}
            </span>
          </div>
          <div className="text-xs text-[#737067] dark:text-[#9c978b] mt-0.5 truncate">
            Click to view and interact with artifact
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pl-3 text-xs font-medium text-[#737067] dark:text-[#9c978b] group-hover:text-[#da7756] dark:group-hover:text-[#f5f1e8] transition-colors shrink-0">
        <span>Open</span>
        <svg className="w-4 h-4 transform group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );
}
