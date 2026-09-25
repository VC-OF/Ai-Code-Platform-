import { describe, it, expect } from 'vitest';
import { normalizeToolArgs } from '@/lib/toolArgNormalize';
import { validateTool } from '@/lib/toolValidator';

describe('normalizeToolArgs', () => {
  it('accepts TodoWrite-style plan tasks (content/activeForm, numeric ids, status aliases)', () => {
    const raw = {
      tasks: [
        { id: 1, content: 'Create project', activeForm: 'Creating project', status: 'in_progress' },
        { content: 'Write tests', status: 'done' },
        'Run lint',
      ],
    };
    expect(validateTool('update_plan', raw).ok).toBe(false);
    const fixed = normalizeToolArgs('update_plan', raw) as { tasks: unknown[] };
    expect(validateTool('update_plan', fixed)).toEqual({ ok: true });
    expect(fixed.tasks).toEqual([
      { id: '1', title: 'Create project', activeForm: 'Creating project', status: 'in_progress' },
      { id: 't2', title: 'Write tests', status: 'completed' },
      { id: 't3', title: 'Run lint', status: 'pending' },
    ]);
  });

  it('maps common file-tool aliases', () => {
    const edit = normalizeToolArgs('edit_file', { file_path: 'a.ts', old_string: 'x', new_string: 'y' });
    expect(validateTool('edit_file', edit)).toEqual({ ok: true });
    const lines = normalizeToolArgs('replace_lines', { path: 'a', start_line: '2', end_line: '3', new_content: '' });
    expect(validateTool('replace_lines', lines)).toEqual({ ok: true });
  });

  it('clamps an over-long command timeout instead of rejecting the call', () => {
    const args = normalizeToolArgs('run_command', { command: 'mvn test', timeout_seconds: 1800 });
    expect(args).toEqual({ command: 'mvn test', timeout_seconds: 900 });
    expect(validateTool('run_command', args)).toEqual({ ok: true });
  });

  it('never overrides a correctly named field', () => {
    expect(normalizeToolArgs('create_file', { path: 'a', file_path: 'b', content: 'c' }))
      .toEqual({ path: 'a', file_path: 'b', content: 'c' });
  });
});
