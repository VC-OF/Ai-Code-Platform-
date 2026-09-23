'use client';

import SettingsTab from '../SettingsTab';
import type { Project } from '@/types';

interface SettingsPanelProps {
  project: Project;
}

export default function SettingsPanel({ project }: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <SettingsTab projectId={project.id} />
      <style jsx>{`
        .settings-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
