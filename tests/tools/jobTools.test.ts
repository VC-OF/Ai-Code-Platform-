import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { executeTool, createTurnContext } from '@/lib/tools';
import { listJobs, getJob, killJob } from '@/lib/jobTools';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

// Host mode: run_background spawns allowlisted binaries (`node script.js`)
const prevMode = process.env.SANDBOX_MODE;

const SCRIPTS = {
  'quick.js': "console.log('one'); console.log('two'); console.error('three'); process.exit(3);\n",
  'slow.js': "let i = 0; const t = setInterval(() => { console.log('tick ' + ++i); if (i === 3) { clearInterval(t); console.log('done'); } }, 300);\n",
  'forever.js': "console.log('started'); setInterval(() => {}, 1000);\n",
};

async function start(ws: TestWorkspace, command: string) {
  const r = await executeTool('run_background', { command }, ws.root, createTurnContext());
  expect(r.success, r.output).toBe(true);
  return String((r.extra as { jobId: string }).jobId);
}

describe('background jobs', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    delete process.env.SANDBOX_MODE;
    ws = await createWorkspace(SCRIPTS);
  });

  afterEach(async () => {
    for (const j of listJobs(ws.root)) killJob(j);
    await new Promise((r) => setTimeout(r, 300));
    if (prevMode !== undefined) process.env.SANDBOX_MODE = prevMode;
    await ws.cleanup().catch(() => {});
  });

  it('starts a job, waits for exit and reports output and exit code', async () => {
    const id = await start(ws, 'node quick.js');
    const out = await executeTool('job_output', { job_id: id, wait_seconds: 10 }, ws.root, createTurnContext());
    expect(out.success).toBe(true);
    // Wait for exit if the first read returned early on output
    const job = getJob(ws.root, id)!;
    for (let i = 0; i < 50 && job.status === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
    const all = await executeTool('job_output', { job_id: id, since_line: 0 }, ws.root, createTurnContext());
    expect(all.output).toContain('one');
    expect(all.output).toContain('two');
    expect(all.output).toContain('three');
    expect(all.output).toMatch(/exited \(exit 3\)/);
    expect((all.extra as { exitCode: number }).exitCode).toBe(3);
  }, 45_000);

  it('returns only new lines on subsequent polls and waits for output', async () => {
    const id = await start(ws, 'node slow.js');
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await executeTool('job_output', { job_id: id, wait_seconds: 5 }, ws.root, createTurnContext());
      seen.push(...r.output.split('\n').filter((l) => /^(tick|done)/.test(l)));
      if (getJob(ws.root, id)!.status !== 'running' && /no new output/.test(r.output)) break;
    }
    expect(seen).toEqual(['tick 1', 'tick 2', 'tick 3', 'done']);
    expect(getJob(ws.root, id)!.exitCode).toBe(0);
  }, 45_000);

  it('kills a running job and lists jobs', async () => {
    const id = await start(ws, 'node forever.js');
    await executeTool('job_output', { job_id: id, wait_seconds: 10 }, ws.root, createTurnContext());
    const list = await executeTool('list_jobs', {}, ws.root, createTurnContext());
    expect(list.output).toContain(id);
    expect(list.output).toContain('running');

    const k = await executeTool('kill_job', { job_id: id }, ws.root, createTurnContext());
    expect(k.success).toBe(true);
    expect(getJob(ws.root, id)!.status).toBe('killed');
    const after = await executeTool('list_jobs', {}, ws.root, createTurnContext());
    expect(after.output).toMatch(new RegExp(`${id}\\s+killed`));
  }, 45_000);

  it('appends output to .open-code/jobs/<id>.log', async () => {
    const id = await start(ws, 'node quick.js');
    const job = getJob(ws.root, id)!;
    for (let i = 0; i < 100 && !job.endedAt; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    const log = await ws.read(`.open-code/jobs/${id}.log`);
    expect(log).toContain('$ node quick.js');
    expect(log).toContain('one');
    expect(log).toContain('exit code 3');
  }, 45_000);

  it('applies the host allowlist and reports unknown jobs', async () => {
    const r = await executeTool('run_background', { command: 'curl http://example.com' }, ws.root, createTurnContext());
    expect(r.success).toBe(false);
    expect(r.output).toMatch(/not in the allowed list/);
    const u = await executeTool('job_output', { job_id: 'job_nope' }, ws.root, createTurnContext());
    expect(u.success).toBe(false);
  });
});
