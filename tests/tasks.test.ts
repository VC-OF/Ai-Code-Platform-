import { describe, it, expect, beforeAll } from 'vitest';
import { taskDb, projectDb, type TaskTimelineEntry } from '@/lib/db';
import { applyEvent, answerTask, cancelTask, isActive } from '@/lib/tasks';
import { createProject } from '@/lib/projects';

let projectId: string;
let n = 0;
function newTask() {
  const id = `task_test_${Date.now()}_${n++}`;
  taskDb.create({ id, project_id: projectId, goal: 'Build a thing', model: null });
  return id;
}
const timeline = (id: string) => JSON.parse(taskDb.get(id)!.timeline) as TaskTimelineEntry[];

describe('delegated tasks', () => {
  beforeAll(async () => {
    projectId = (await createProject('Tasks test project', 'blank')).id;
    expect(projectDb.getById(projectId)).toBeTruthy();
  });

  it('records tool results, checkpoints and verification in the timeline', () => {
    const id = newTask();
    applyEvent(id, { type: 'tool_end', toolName: 'create_file', result: { success: true, summary: 'Created app.js' } });
    applyEvent(id, { type: 'tool_end', toolName: 'run_command', result: { success: false, summary: 'exit 1' } });
    applyEvent(id, { type: 'checkpoint', sha: 'abcdef1234' });
    applyEvent(id, { type: 'verification', tool: 'run_tests', passed: true, summary: '12 passed' });
    applyEvent(id, { type: 'text_delta', delta: 'ignored' });
    expect(timeline(id).map((e) => [e.kind, e.text, e.ok])).toEqual([
      ['tool', 'create_file: Created app.js', true],
      ['tool', 'run_command: exit 1', false],
      ['checkpoint', 'Checkpoint abcdef1', undefined],
      ['verification', '12 passed', true],
    ]);
  });

  it('moves to needs_input on a question and back to running when work resumes', () => {
    const id = newTask();
    applyEvent(id, { type: 'user_input_request', question: 'Which database?' });
    expect(taskDb.get(id)).toMatchObject({ status: 'needs_input', question: 'Which database?' });
    applyEvent(id, { type: 'tool_start', toolName: 'read_file' });
    expect(taskDb.get(id)).toMatchObject({ status: 'running', question: null });
  });

  it.each([
    ['completed', 'done'],
    ['user_cancelled', 'cancelled'],
    ['max_steps', 'failed'],
    ['error', 'failed'],
  ])('done reason %s → status %s with summary and file count', (reason, status) => {
    const id = newTask();
    applyEvent(id, { type: 'done', reason, filesChanged: ['a.js', 'b.js'] }, 'All set.');
    const task = taskDb.get(id)!;
    expect(task).toMatchObject({ status, summary: 'All set.', files_changed: 2 });
    expect(task.finished_at).toBeTypeOf('number');
    expect(isActive(task.status)).toBe(false);
  });

  it('a cancelled task is not overwritten by a later done event', () => {
    const id = newTask();
    taskDb.update(id, { status: 'cancelled' });
    applyEvent(id, { type: 'done', reason: 'completed', filesChanged: [] });
    expect(taskDb.get(id)!.status).toBe('cancelled');
  });

  it('answer and cancel refuse tasks that are not in the right state', () => {
    const id = newTask();
    taskDb.update(id, { status: 'done' });
    expect(answerTask(id, 'yes')).toBe(false);
    expect(cancelTask(id)).toBe(false);
    expect(answerTask('task_missing', 'yes')).toBe(false);
  });
});

describe('deployed tasks', () => {
  it('captures the live URL from a successful deploy_app result', () => {
    const id = newTask();
    applyEvent(id, { type: 'tool_end', toolName: 'deploy_app', result: { success: true, summary: 'Deployed → https://habit-tracker.vercel.app' } });
    expect(taskDb.get(id)!.result_url).toBe('https://habit-tracker.vercel.app');
  });

  it('ignores failed deploys and URLs from other tools', () => {
    const id = newTask();
    applyEvent(id, { type: 'tool_end', toolName: 'deploy_app', result: { success: false, summary: 'No VERCEL_TOKEN configured' } });
    applyEvent(id, { type: 'tool_end', toolName: 'fetch_url', result: { success: true, summary: 'Fetched https://example.com' } });
    expect(taskDb.get(id)!.result_url).toBeNull();
  });
});
