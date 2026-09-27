import { describe, it, expect } from 'vitest';
import { agentManager, type RunningAgent } from '@/lib/agentManager';
import { REPLAY_DONE_EVENT } from '@/lib/events';

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

  it('replays a running agent\'s events to a new subscriber, then marks where live events begin', async () => {
    const projectId = 'test-project-replay';
    const agents = (globalThis as unknown as { __ocActiveAgents: Map<string, RunningAgent> }).__ocActiveAgents;
    const history = [JSON.stringify({ type: 'text_done', content: 'Earlier reply', ts: 1 })];
    agents.set(projectId, { projectId, events: history, status: 'running', controllers: new Set(), queuedMessages: [] });
    try {
      const reader = agentManager.subscribeClient(projectId).getReader();
      const decoder = new TextDecoder();
      const lines: string[] = [];
      while (lines.length < 2) {
        const { value } = await reader.read();
        lines.push(...decoder.decode(value).split('\n').filter(Boolean));
      }
      expect(lines.map((l) => JSON.parse(l).type)).toEqual(['text_done', REPLAY_DONE_EVENT]);
      // The marker goes to this subscriber only; it is not part of the run's history
      expect(agents.get(projectId)?.events).toEqual(history);
      await reader.cancel();
    } finally {
      agents.delete(projectId);
    }
  });
});
