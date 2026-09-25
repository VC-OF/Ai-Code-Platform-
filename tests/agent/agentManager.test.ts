import { describe, it, expect } from 'vitest';
import { agentManager } from '@/lib/agentManager';

describe('AgentManager', () => {
  it('should report correct running and status states initially', () => {
    const projectId = 'test-project-123';
    expect(agentManager.isRunning(projectId)).toBe(false);
    expect(agentManager.getStatus(projectId)).toBe('done');
  });

  it('should get running agent instance if one exists', () => {
    const projectId = 'test-project-456';
    expect(agentManager.getRunningAgent(projectId)).toBeUndefined();
  });
});
