import { describe, expect, it } from 'vitest';
import { Narrator, isChatterTool, spokenCommand, spokenToolLine, type NarrationEvent, type Utterance } from '@/lib/voice/narration';

const texts = (u: Utterance[]) => u.map((x) => x.text);

function feed(n: Narrator, events: [number, NarrationEvent][]): Utterance[] {
  return events.flatMap(([at, e]) => n.handle(e, at));
}

describe('Narrator: replies', () => {
  it('holds a step text and speaks it once no tool call follows', () => {
    const n = new Narrator({ level: 'replies' });
    expect(n.handle({ type: 'text_done', content: 'All **done**: see `README.md`.' }, 1_000)).toEqual([]);
    expect(n.tick(2_000)).toEqual([]);
    expect(n.tick(2_600)).toEqual([{ text: 'All done: see README.md.', priority: 'normal', kind: 'reply' }]);
    expect(n.tick(5_000)).toEqual([]);
  });

  it('drops step texts that are followed by tool calls at the replies level', () => {
    const n = new Narrator({ level: 'replies' });
    const out = feed(n, [
      [0, { type: 'text_done', content: 'Let me look at the tests first.' }],
      [10, { type: 'tool_start', toolName: 'read_file', args: { path: 'a.ts' } }],
      [20, { type: 'tool_start', toolName: 'edit_file', args: { path: 'src/a.ts' } }],
      [5_000, { type: 'text_done', content: 'Fixed the bug in a.ts.' }],
    ]);
    expect(out).toEqual([]);
    expect(texts(n.tick(7_000))).toEqual(['Fixed the bug in a.ts.']);
  });

  it('flushes the final reply before the done summary', () => {
    const n = new Narrator({ level: 'replies' });
    const out = feed(n, [
      [0, { type: 'text_done', content: 'The app now has a dark mode toggle.' }],
      [100, { type: 'done', reason: 'completed', filesChanged: ['src/app/page.tsx', 'src/styles.css'] }],
    ]);
    expect(out).toEqual([
      { text: 'The app now has a dark mode toggle.', priority: 'normal', kind: 'reply' },
      { text: 'Done. I changed 2 files.', priority: 'normal', kind: 'done' },
    ]);
  });

  it('cuts long replies at a sentence boundary', () => {
    const n = new Narrator({ level: 'replies', replyMaxChars: 50 });
    n.handle({ type: 'text_done', content: 'First part is short. Second part is much longer and goes past the limit.' }, 0);
    expect(texts(n.tick(10_000))).toEqual(['First part is short.']);
  });

  it('skips empty or code-only step text gracefully', () => {
    const n = new Narrator({ level: 'replies' });
    n.handle({ type: 'text_done', content: '   ' }, 0);
    expect(n.tick(10_000)).toEqual([]);
    n.handle({ type: 'text_done', content: '```\ncode\n```' }, 0);
    expect(texts(n.tick(10_000))).toEqual(['(code omitted)']);
  });
});

describe('Narrator: done and errors', () => {
  it.each([
    ['completed', [], 'Done.'],
    ['completed', ['src/lib/a.ts'], 'Done. I changed a.ts.'],
    ['user_cancelled', [], 'Stopped.'],
    ['max_steps', [], 'I hit the step limit. Say "continue" to keep going.'],
    ['timeout', [], 'I ran out of time for this turn. Say "continue" to keep going.'],
  ])('done (%s) → %s', (reason, files, expected) => {
    const n = new Narrator({ level: 'replies' });
    expect(n.handle({ type: 'done', reason, filesChanged: files }, 0)).toEqual([
      { text: expected as string, priority: 'normal', kind: 'done' },
    ]);
  });

  it('speaks fatal errors and stays quiet on retry notices', () => {
    const n = new Narrator({ level: 'replies' });
    expect(n.handle({ type: 'error', message: 'Model call failed — retrying (1/3)', recoverable: true }, 0)).toEqual([]);
    expect(n.handle({ type: 'error', message: 'Request failed: 500' }, 10)).toEqual([
      { text: 'Something went wrong: Request failed: 500.', priority: 'normal', kind: 'error' },
    ]);
  });

  it('reports the last error when a run ends with reason "error"', () => {
    const n = new Narrator({ level: 'replies' });
    n.handle({ type: 'error', message: 'Rate limit exceeded', recoverable: true }, 0);
    expect(n.handle({ type: 'done', reason: 'error' }, 10)).toEqual([
      { text: 'Something went wrong: Rate limit exceeded.', priority: 'normal', kind: 'error' },
    ]);
  });

  it('does not repeat an error that was already spoken', () => {
    const n = new Narrator({ level: 'replies' });
    n.handle({ type: 'error', message: 'Boom' }, 0);
    expect(texts(n.handle({ type: 'done', reason: 'error' }, 10))).toEqual(['Stopped.']);
  });
});

describe('Narrator: questions', () => {
  it('speaks the question with numbered options at high priority', () => {
    const n = new Narrator({ level: 'replies+questions' });
    const out = n.handle({ type: 'user_input_request', question: 'Which **test runner** should I use?', options: ['Jest', 'Vitest'] }, 0);
    expect(out).toEqual([
      { text: 'Which test runner should I use? Option 1: Jest. Option 2: Vitest.', priority: 'high', kind: 'question' },
    ]);
  });

  it('mentions options beyond the first five', () => {
    const n = new Narrator({ level: 'everything' });
    const [u] = n.handle({ type: 'user_input_request', question: 'Pick one', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 0);
    expect(u.text).toContain('Option 5: e.');
    expect(u.text).not.toContain('Option 6');
    expect(u.text).toContain('And 2 more on screen.');
  });

  it('drops the preamble before a question instead of reading both', () => {
    const n = new Narrator({ level: 'everything' });
    const out = feed(n, [
      [0, { type: 'text_done', content: 'I found two ways to do this.' }],
      [5, { type: 'tool_start', toolName: 'ask_user', args: { question: 'Which?' } }],
      [10, { type: 'user_input_request', question: 'Which approach?', options: [] }],
    ]);
    expect(texts(out)).toEqual(['Which approach?']);
    expect(n.tick(10_000)).toEqual([]);
  });

  it('does not speak questions at the replies level', () => {
    const n = new Narrator({ level: 'replies' });
    expect(n.handle({ type: 'user_input_request', question: 'Which?' }, 0)).toEqual([]);
  });
});

describe('Narrator: progress (everything)', () => {
  it('announces the in-progress plan task only when it changes', () => {
    const n = new Narrator({ level: 'everything' });
    const plan = (current: string) => ({
      type: 'plan_update',
      tasks: [
        { title: 'Scaffold', status: 'completed' },
        { title: current, status: 'in_progress' },
        { title: 'Later', status: 'pending' },
      ],
    });
    expect(n.handle(plan('Add the API route'), 0)).toEqual([{ text: 'Now: Add the API route.', priority: 'low', kind: 'progress' }]);
    expect(n.handle(plan('Add the API route'), 20_000)).toEqual([]);
    expect(texts(n.handle(plan('Write tests'), 21_000))).toEqual(['Now: Write tests.']);
    expect(n.handle({ type: 'plan_update', tasks: [{ title: 'x', status: 'completed' }] }, 30_000)).toEqual([]);
  });

  it('narrates tool calls at most every 8 seconds', () => {
    const n = new Narrator({ level: 'everything' });
    const tool = (path: string) => ({ type: 'tool_start', toolName: 'edit_file', args: { path } });
    expect(texts(n.handle(tool('src/a.ts'), 0))).toEqual(['Editing a.ts']);
    expect(n.handle(tool('src/b.ts'), 3_000)).toEqual([]);
    expect(n.handle(tool('src/c.ts'), 7_999)).toEqual([]);
    expect(texts(n.handle(tool('src/d.ts'), 8_000))).toEqual(['Editing d.ts']);
  });

  it('never narrates read-only chatter', () => {
    const n = new Narrator({ level: 'everything' });
    const out = feed(n, [
      [0, { type: 'tool_start', toolName: 'read_file', args: { path: 'a' } }],
      [100, { type: 'tool_start', toolName: 'grep_files', args: { pattern: 'x' } }],
      [200, { type: 'tool_start', toolName: 'list_files', args: {} }],
      [300, { type: 'tool_start', toolName: 'lsp_hover', args: {} }],
    ]);
    expect(out).toEqual([]);
    // Chatter does not use up the throttle either
    expect(texts(n.handle({ type: 'tool_start', toolName: 'run_tests', args: {} }, 400))).toEqual(['Running the tests']);
  });

  it('speaks an occasional intermediate step text and suppresses the tool line after it', () => {
    const n = new Narrator({ level: 'everything' });
    const first = feed(n, [
      [0, { type: 'text_done', content: 'I will add the route first.' }],
      [10, { type: 'tool_start', toolName: 'create_file', args: { path: 'src/app/api/x/route.ts' } }],
    ]);
    expect(first).toEqual([{ text: 'I will add the route first.', priority: 'low', kind: 'progress' }]);
    // Within the 20 s window the next preamble is skipped, the tool line throttled
    const second = feed(n, [
      [5_000, { type: 'text_done', content: 'Now the tests.' }],
      [5_010, { type: 'tool_start', toolName: 'create_file', args: { path: 'tests/x.test.ts' } }],
    ]);
    expect(second).toEqual([]);
  });

  it('can be configured to never speak intermediate text', () => {
    const n = new Narrator({ level: 'everything', intermediateReplies: 'never' });
    const out = feed(n, [
      [0, { type: 'text_done', content: 'Looking around.' }],
      [10, { type: 'tool_start', toolName: 'run_command', args: { command: 'npm run build' } }],
    ]);
    expect(texts(out)).toEqual(['Running npm run build']);
  });

  it('reports verification results', () => {
    const n = new Narrator({ level: 'everything' });
    expect(texts(n.handle({ type: 'verification', tool: 'run_tests', passed: true }, 0))).toEqual(['Tests passed.']);
    expect(texts(n.handle({ type: 'verification', tool: 'run_lint', passed: false, errorCount: 3 }, 1))).toEqual(['Lint found 3 problems.']);
  });

  it('stays quiet about progress below the everything level', () => {
    const n = new Narrator({ level: 'replies+questions' });
    const out = feed(n, [
      [0, { type: 'plan_update', tasks: [{ title: 'A', status: 'in_progress' }] }],
      [10, { type: 'tool_start', toolName: 'run_tests', args: {} }],
      [20, { type: 'verification', tool: 'run_tests', passed: true }],
    ]);
    expect(out).toEqual([]);
  });

  it('ignores unknown events and status noise', () => {
    const n = new Narrator();
    expect(n.handle({ type: 'status', status: 'reading' }, 0)).toEqual([]);
    expect(n.handle({ type: 'text_delta', delta: 'x' }, 0)).toEqual([]);
    expect(n.handle({ type: 'mystery' }, 0)).toEqual([]);
  });
});

describe('Narrator: replayed history', () => {
  it('skips replayed events until the replay_done marker, whatever their timestamps', () => {
    const n = new Narrator({ level: 'everything' });
    n.setReplaying(true);
    // Stamped by a server clock that runs ahead of the client's: still history
    expect(n.handle({ type: 'text_done', content: 'Old reply', ts: 90_000 }, 20_000)).toEqual([]);
    expect(n.handle({ type: 'user_input_request', question: 'Old?', ts: 90_000 }, 20_000)).toEqual([]);
    expect(n.handle({ type: 'plan_update', ts: 90_000, tasks: [{ title: 'Old task', status: 'in_progress' }] }, 20_000)).toEqual([]);
    expect(n.tick(30_000)).toEqual([]);
    expect(n.handle({ type: 'replay_done' }, 20_000)).toEqual([]);
    // The replayed plan task is remembered, so it is not announced again
    expect(n.handle({ type: 'plan_update', ts: 1_000, tasks: [{ title: 'Old task', status: 'in_progress' }] }, 20_000)).toEqual([]);
    // Live events are spoken, even when stamped by a clock that runs behind
    expect(texts(n.handle({ type: 'user_input_request', question: 'New?', ts: 1_000 }, 20_000))).toEqual(['New?']);
  });

  it('reset clears a held reply', () => {
    const n = new Narrator({ level: 'replies' });
    n.handle({ type: 'text_done', content: 'Pending' }, 0);
    n.reset();
    expect(n.tick(10_000)).toEqual([]);
  });

  it('dropPending discards a held reply without resetting the turn', () => {
    const n = new Narrator({ level: 'everything' });
    const writing = { type: 'plan_update', tasks: [{ title: 'Write tests', status: 'in_progress' }] };
    expect(texts(n.handle(writing, 0))).toEqual(['Now: Write tests.']);
    n.handle({ type: 'text_done', content: 'All set.' }, 100);
    n.dropPending();
    expect(n.tick(10_000)).toEqual([]);
    // Unlike reset(), the current plan task is still known and not announced twice
    expect(n.handle(writing, 10_100)).toEqual([]);
    expect(n.handle({ type: 'done', reason: 'completed' }, 10_200)).toEqual([{ text: 'Done.', priority: 'normal', kind: 'done' }]);
  });

  it('setLevel changes what is spoken', () => {
    const n = new Narrator({ level: 'replies' });
    expect(n.handle({ type: 'tool_start', toolName: 'run_tests' }, 0)).toEqual([]);
    n.setLevel('everything');
    expect(n.level).toBe('everything');
    expect(texts(n.handle({ type: 'tool_start', toolName: 'run_tests' }, 1))).toEqual(['Running the tests']);
  });
});

describe('spokenToolLine', () => {
  it('uses file names instead of paths', () => {
    expect(spokenToolLine('create_file', { path: 'src/components/voice/Button.tsx' })).toBe('Creating Button.tsx');
    expect(spokenToolLine('delete_file', { path: 'C:\\repo\\old.ts' })).toBe('Deleting old.ts');
    expect(spokenToolLine('multi_edit', { path: 'a/b.ts', edits: [] })).toBe('Editing b.ts');
  });

  it('shortens commands', () => {
    expect(spokenToolLine('run_command', { command: 'NODE_ENV=test npx vitest run tests/voice --reporter=dot' })).toBe('Running npx vitest run');
    expect(spokenCommand('npm install && npm test')).toBe('npm install');
    expect(spokenCommand('')).toBe('a command');
  });

  it('falls back to the timeline label, made speakable', () => {
    expect(spokenToolLine('view_image', { path: 'x.png' })).toBeNull(); // chatter
    expect(spokenToolLine('http_request', { method: 'POST', url: 'https://api.example.com/v1' })).toBe('Calling an API');
    expect(spokenToolLine('spawn_agent', { kind: 'explore', label: 'scan' })).toBe('Delegating to explore sub-agent "scan"');
    expect(spokenToolLine('execute_code', { language: 'python', code: 'a\nb' })).toBe('Running some python');
    expect(spokenToolLine('browser_click', { ref: 'e12' })).toBe('Clicking e12');
  });

  it('stays silent for questions, plan updates and chatter', () => {
    expect(spokenToolLine('ask_user', {})).toBeNull();
    expect(spokenToolLine('update_plan', {})).toBeNull();
    expect(isChatterTool('grep_files')).toBe(true);
    expect(isChatterTool('lsp_references')).toBe(true);
    expect(isChatterTool('edit_file')).toBe(false);
  });

  it('humanises unknown tools', () => {
    expect(spokenToolLine('custom_magic_tool', {})).toBe('Using custom magic tool');
    expect(spokenToolLine('mcp_github_create_issue', {})).toBe('Calling an external tool');
  });
});
