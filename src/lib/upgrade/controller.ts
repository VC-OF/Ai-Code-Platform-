import fs from 'fs';
import { agentManager } from '../agentManager';
import { projectDb, messageDb } from '../db';
import { EventEmitter } from '../events';
import { TOOL_SCHEMAS } from '../tools';
import { buildPromptParts } from '../contextBreakdown';
import { composeSystemPrompt } from '../promptComposer';
import { getModel, type LLMTool } from '../llmClient';
import { streamRegistry } from '../cancellation';
import { upgradeStore, nextUpgradeId, sha256, type UpgradeRecord } from './store';
import { PROTECTED_PATHS } from './guard';
import { createCandidateWorktree, removeWorktree, candidateDiff, git } from './worktree';
import { runGate } from './gate';
import { parseAnalysis, parseReview } from './parse';

/**
 * Upgrade controller — owned by the main process, never by the candidate.
 *
 *   start()   create worktree from the recorded base, run the read-only Analyze stage
 *   develop() implement + test + fix in the worktree, then an independent review,
 *             then the gate (main-checkout code) → ready | rejected | inconclusive
 *   commit()  only when the gate passed on exactly the current diff
 *   push()    only on an explicit, separate user action; opens a PR when gh exists
 *
 * Agent stages run through the normal agent manager on a project whose
 * workspace is the worktree, so the transcript is visible in the chat UI.
 * Candidate code only ever runs as child processes (tests, typecheck), so a
 * crashing candidate cannot take the controller down.
 */

const MAIN_ROOT = process.cwd();

const state = globalThis as unknown as { __ocUpgradeBusy?: Set<string>; __ocUpgradeLog?: Map<string, string[]> };
const busy = (state.__ocUpgradeBusy ??= new Set<string>());
const logs = (state.__ocUpgradeLog ??= new Map<string, string[]>());

function log(id: string, msg: string) {
  const l = logs.get(id) ?? [];
  l.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  logs.set(id, l.slice(-200));
}

export function upgradeLog(id: string): string[] {
  return logs.get(id) ?? [];
}

export function isBusy(id: string): boolean {
  return busy.has(id);
}

function background(id: string, work: () => Promise<void>) {
  busy.add(id);
  void work()
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      log(id, `Error: ${msg}`);
      upgradeStore.update(id, { status: 'failed', error: msg, completed_at: Date.now() });
    })
    .finally(() => busy.delete(id));
}

// ─── Agent stages ──────────────────────────────────────────────────────────────

/** Answers the loop's interactive questions: nobody sits at an upgrade run's chat. */
function autoAnswer(question: string): string {
  if (question.startsWith('📋')) {
    return 'Keep planning: this is the read-only Analyze stage. Do not call exit_plan_mode — end with your analysis JSON block as instructed.';
  }
  if (question.startsWith('🛡️')) return 'Deny';
  return 'No one is available to answer during an upgrade run. Decide yourself, state your assumption, and continue.';
}

async function runStage(rec: UpgradeRecord, prompt: string, mode: 'auto' | 'plan'): Promise<string> {
  const pid = rec.project_id;
  if (agentManager.isRunning(pid)) throw new Error('An agent is already running on this upgrade.');
  const stream = agentManager.startAgent(pid, [{ role: 'user', content: prompt }], undefined, undefined, mode);
  const reader = stream.getReader();
  void (async () => { try { while (!(await reader.read()).done) {} } catch {} })();

  const agent = agentManager.getRunningAgent(pid);
  const answerer = setInterval(() => {
    const a = agentManager.getRunningAgent(pid);
    if (a?.pendingInput) {
      log(rec.id, `Auto-answered: ${a.pendingInput.question.split('\n')[0].slice(0, 80)}`);
      agentManager.provideUserInput(pid, autoAnswer(a.pendingInput.question));
    }
  }, 1000);
  try {
    await agent?.promise;
  } finally {
    clearInterval(answerer);
  }
  const last = messageDb.getRecent(pid, 80).filter((m) => m.role === 'assistant' && m.content?.trim()).at(-1);
  return last?.content ?? '';
}

const RULES = `
You are working on the OpenCode platform's OWN source code, in an isolated git worktree (your workspace root).
Rules for upgrade mode:
- Change only files inside this worktree. Never touch the main checkout or any other repository.
- These paths are the protected core and must not be modified: ${PROTECTED_PATHS.join(', ')}.
- Do not commit, push, switch branches or run gh — the Upgrade controller owns git. Leave changes uncommitted.
- Do not install, remove or update dependencies (node_modules is shared with the main checkout).
- Understand the current implementation before changing it.`.trim();

function analyzePrompt(goal: string): string {
  return `# Upgrade OpenCode — Analyze stage (read-only)

Goal: ${goal}

${RULES}

This stage is READ-ONLY: investigate, do not modify anything. Read CLAUDE.md, the relevant modules under src/, and their tests under tests/.
Then end your reply with exactly one fenced \`\`\`json block:
{
  "analysis": "how the relevant parts work today and what limits the goal (with file paths)",
  "affected_areas": ["src/lib/...", "..."],
  "proposed_plan": ["step 1", "step 2", "..."],
  "risk": "low | medium | high",
  "risk_notes": "what could regress"
}
Do not call exit_plan_mode.`;
}

function developPrompt(rec: UpgradeRecord): string {
  const plan: string[] = rec.proposed_plan ? JSON.parse(rec.proposed_plan) : [];
  const areas: string[] = rec.affected_areas ? JSON.parse(rec.affected_areas) : [];
  return `# Upgrade OpenCode — Develop stage

Goal: ${rec.goal}

${RULES}

## Analysis (from the Analyze stage)
${rec.analysis ?? ''}

## Affected areas
${areas.map((a) => `- ${a}`).join('\n') || '- (not specified)'}

## Plan
${plan.map((p, i) => `${i + 1}. ${p}`).join('\n') || '(no plan recorded — make one first)'}

Work through: Plan → Implement → Test → Fix.
- Add or update tests under tests/ for the new behaviour. Never delete tests or add .skip/.only/.todo.
- Before finishing, run \`npx tsc --noEmit\` and \`npx vitest run\` (or the relevant test files) and fix every failure you caused.
- Finish with a short change summary: files changed, what each change does, and the verification you ran with its result.`;
}

function reviewPrompt(rec: UpgradeRecord, diff: string): string {
  const clipped = diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n…[diff truncated: ${diff.length - 60_000} chars omitted — read the files directly]` : diff;
  return `Independently review a proposed change to the OpenCode platform's own source code (you are in its worktree).

Goal of the change: ${rec.goal}

Check: does the diff achieve the goal; is it correct (read the surrounding code); does it add adequate tests; could it regress existing behaviour; does it weaken security or permissions; does it touch anything outside the goal's scope?
You may read files and run tests/typecheck. Do NOT modify anything.

End with exactly one fenced \`\`\`json block:
{ "verdict": "PASS | FAIL | INCONCLUSIVE", "findings": ["severity: file:line — issue", "..."] }
PASS only if you would merge it as is.

## Diff (base ${rec.base_commit.slice(0, 8)} → candidate)
\`\`\`diff
${clipped}
\`\`\``;
}

/** Collects a nested run's final text and forwards nothing (its tools are logged). */
class ReviewEmitter extends EventEmitter {
  lastText = '';
  constructor(private id: string) { super(null as unknown as ReadableStreamDefaultController); }
  override emit(event: Record<string, unknown>) {
    if (event.type === 'text_done' && typeof event.content === 'string') this.lastText = event.content;
    if (event.type === 'subagent_event') {
      const e = event.event as Record<string, unknown>;
      if (e?.type === 'tool_start') log(this.id, `Reviewer: ${String(e.toolName ?? e.name ?? 'tool')}`);
      if (e?.type === 'text_done' && typeof e.content === 'string') this.lastText = e.content;
    }
  }
}

async function runReview(rec: UpgradeRecord, diff: string): Promise<{ verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; findings: string }> {
  const project = projectDb.getById(rec.project_id);
  if (!project) throw new Error('Upgrade project missing');
  const { runSubagent } = await import('../subagents');
  const { parts, mcpTools } = await buildPromptParts(project, { mode: 'auto' });
  const emitter = new ReviewEmitter(rec.id);
  const cancellation = streamRegistry.register(`${rec.project_id}-review`);
  try {
    const res = await runSubagent(
      { kind: 'verify', task: reviewPrompt(rec, diff), label: 'Upgrade reviewer' },
      {
        projectId: rec.project_id,
        workspaceRoot: rec.worktree,
        llmConfig: { model: getModel() },
        tools: [...(TOOL_SCHEMAS as unknown as LLMTool[]), ...(mcpTools as unknown as LLMTool[])],
        systemPrompt: composeSystemPrompt(parts),
        emitter,
        cancellation,
        turnIndex: messageDb.getLatestTurnIndex(rec.project_id) + 1,
        parentStep: 0,
        toolCallId: `review-${rec.id}`,
        depth: 0,
      },
    );
    return parseReview(res.output);
  } finally {
    streamRegistry.cleanup(`${rec.project_id}-review`);
  }
}

// ─── Public actions ────────────────────────────────────────────────────────────

export async function startUpgrade(goal: string): Promise<UpgradeRecord> {
  const g = goal.trim();
  if (g.length < 8) throw new Error('Describe the improvement in a sentence.');
  const base = await git(MAIN_ROOT, ['rev-parse', 'HEAD']);
  const baseBranch = await git(MAIN_ROOT, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const id = nextUpgradeId();
  const branch = `opencode-upgrade/${id}`;
  const dir = await createCandidateWorktree(MAIN_ROOT, id, base, branch);

  projectDb.create({ id, name: `Upgrade ${id}: ${g.slice(0, 60)}`, workspace: dir, description: `Upgrade OpenCode — ${g}`, kind: 'build' });
  const rec = upgradeStore.create({ id, goal: g, status: 'analyzing', base_commit: base, base_branch: baseBranch, candidate_branch: branch, worktree: dir, project_id: id });
  log(id, `Created worktree ${dir} on ${branch} from ${baseBranch} @ ${base.slice(0, 8)}`);
  analyze(rec);
  return rec;
}

function analyze(rec: UpgradeRecord) {
  background(rec.id, async () => {
    log(rec.id, 'Analyze: read-only investigation started');
    const text = await runStage(rec, analyzePrompt(rec.goal), 'plan');
    const a = parseAnalysis(text);
    if (!a.analysis) throw new Error('The Analyze stage produced no analysis (check the model/provider in the upgrade chat).');
    upgradeStore.update(rec.id, {
      status: 'analyzed', error: null, analysis: a.analysis, affected_areas: JSON.stringify(a.affected_areas),
      proposed_plan: JSON.stringify(a.proposed_plan), risk: a.risk,
    });
    log(rec.id, `Analyze: done (${a.proposed_plan.length} plan steps, risk ${a.risk})`);
  });
}

/** Re-run the Analyze stage of an upgrade that failed before producing an analysis. */
export function retryAnalysis(id: string): UpgradeRecord {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (busy.has(id)) throw new Error('This upgrade is already running a stage.');
  if (rec.status !== 'failed' || rec.analysis) throw new Error('Only an upgrade that failed during Analyze can retry it.');
  if (!fs.existsSync(rec.worktree)) throw new Error('The worktree no longer exists. Start a new upgrade.');
  const updated = upgradeStore.update(id, { status: 'analyzing', error: null });
  analyze(updated);
  return updated;
}

export function developUpgrade(id: string): UpgradeRecord {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (busy.has(id)) throw new Error('This upgrade is already running a stage.');
  const retryable = ['analyzed', 'rejected', 'inconclusive'].includes(rec.status) || (rec.status === 'failed' && !!rec.analysis);
  if (!retryable) throw new Error(`Cannot develop from status "${rec.status}".`);
  const updated = upgradeStore.update(id, { status: 'developing', error: null, gate_result: null, gate_checks: null, gate_diff_hash: null });

  background(id, async () => {
    const retry = rec.status !== 'analyzed' && rec.gate_checks
      ? `\n\n## The previous attempt did not pass the gate\n${(JSON.parse(rec.gate_checks) as { name: string; result: string; detail: string }[]).filter((c) => c.result !== 'PASS').map((c) => `- ${c.name}: ${c.result} — ${c.detail}`).join('\n')}\nFix these.`
      : '';
    log(id, 'Develop: implement → test → fix started');
    await runStage(updated, developPrompt(updated) + retry, 'auto');

    upgradeStore.update(id, { status: 'reviewing' });
    const { diff, files } = await candidateDiff(rec.worktree, rec.base_commit);
    upgradeStore.setChanges(id, files);
    log(id, `Develop: done (${files.length} files changed). Review started`);
    const review = files.length
      ? await runReview(upgradeStore.get(id)!, diff)
      : { verdict: 'FAIL' as const, findings: 'The candidate made no changes.' };
    upgradeStore.addReview({ upgrade_id: id, verdict: review.verdict, findings: review.findings, reviewer: 'verify sub-agent' });
    log(id, `Review: ${review.verdict}`);

    await gate(id);
  });
  return updated;
}

async function gate(id: string) {
  upgradeStore.update(id, { status: 'verifying' });
  log(id, 'Gate: started (main-checkout code)');
  const { result, checks, diffHash } = await runGate(upgradeStore.get(id)!, MAIN_ROOT, (m) => log(id, `Gate: ${m}`));
  upgradeStore.update(id, {
    status: result === 'PASS' ? 'ready' : result === 'FAIL' ? 'rejected' : 'inconclusive',
    gate_result: result, gate_checks: JSON.stringify(checks), gate_diff_hash: diffHash, completed_at: Date.now(),
  });
  log(id, `Gate: ${result}`);
}

export function rerunGate(id: string): UpgradeRecord {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (busy.has(id)) throw new Error('This upgrade is already running a stage.');
  if (!['ready', 'rejected', 'inconclusive'].includes(rec.status)) throw new Error(`Cannot verify from status "${rec.status}".`);
  background(id, () => gate(id));
  return upgradeStore.update(id, { status: 'verifying' });
}

/** Commit exactly what the gate passed, as one commit on the candidate branch. */
export async function commitUpgrade(id: string): Promise<UpgradeRecord> {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (busy.has(id)) throw new Error('This upgrade is busy.');
  if (rec.status !== 'ready' || rec.gate_result !== 'PASS') throw new Error('Only an upgrade whose gate passed can be committed.');
  const { diff } = await candidateDiff(rec.worktree, rec.base_commit);
  if (sha256(diff) !== rec.gate_diff_hash) {
    throw new Error('The candidate changed after the gate ran. Re-run the gate before committing.');
  }
  // Drop the agent's checkpoint commits; keep the staged tree
  await git(rec.worktree, ['reset', '--soft', rec.base_commit]);
  const plan: string[] = rec.proposed_plan ? JSON.parse(rec.proposed_plan) : [];
  const files = upgradeStore.changes(id);
  const msg = [
    `Upgrade ${id}: ${rec.goal}`.slice(0, 200),
    '',
    ...plan.map((p) => `- ${p}`),
    '',
    `Files: ${files.length} (+${files.reduce((s, f) => s + f.additions, 0)} / -${files.reduce((s, f) => s + f.deletions, 0)})`,
    `Gate: PASS (base ${rec.base_commit.slice(0, 8)})`,
    `Review: ${upgradeStore.latestReview(id)?.verdict ?? 'n/a'}`,
  ].join('\n');
  const msgFile = `${rec.worktree}.commitmsg`;
  fs.writeFileSync(msgFile, msg);
  try {
    await git(rec.worktree, ['commit', '-F', msgFile]);
  } finally {
    fs.rmSync(msgFile, { force: true });
  }
  const commit = await git(rec.worktree, ['rev-parse', 'HEAD']);
  log(id, `Committed ${commit.slice(0, 8)} on ${rec.candidate_branch}`);
  return upgradeStore.update(id, { status: 'committed', candidate_commit: commit });
}

/** Separate, explicit action: push the candidate branch and open a PR. */
export async function pushUpgrade(id: string, confirm: { branch?: string; commit?: string }): Promise<UpgradeRecord> {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (rec.status !== 'committed' || !rec.candidate_commit) throw new Error('Commit the upgrade before pushing it.');
  if (confirm.branch !== rec.candidate_branch || confirm.commit !== rec.candidate_commit) {
    throw new Error('Push confirmation does not match the committed branch and commit.');
  }
  const head = await git(rec.worktree, ['rev-parse', 'HEAD']);
  if (head !== rec.candidate_commit) throw new Error('The branch moved since it was committed. Refusing to push.');
  await git(rec.worktree, ['push', '-u', 'origin', `${rec.candidate_branch}:${rec.candidate_branch}`]);
  log(id, `Pushed ${rec.candidate_branch} to origin`);

  let prUrl: string | null = null;
  let note: string | null = null;
  try {
    const { runCmd } = await import('./gate');
    const body = `${rec.goal}\n\n${upgradeStore.latestReview(id)?.findings ? `Reviewer findings:\n${upgradeStore.latestReview(id)!.findings}\n\n` : ''}Gate: PASS on base ${rec.base_commit.slice(0, 8)}.\n\nCreated by Upgrade OpenCode (${id}).`;
    const bodyFile = `${rec.worktree}.prbody`;
    fs.writeFileSync(bodyFile, body);
    const title = `Upgrade ${id}: ${rec.goal}`.slice(0, 120).replace(/"/g, "'");
    const r = await runCmd(`gh pr create --base "${rec.base_branch}" --head "${rec.candidate_branch}" --title "${title}" --body-file "${bodyFile}"`, rec.worktree, 120_000);
    fs.rmSync(bodyFile, { force: true });
    const url = r.output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0];
    if (url) prUrl = url; else note = `Pushed, but the PR was not created: ${r.output.trim().slice(0, 300)}`;
  } catch (e) {
    note = `Pushed, but the PR was not created: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (prUrl) log(id, `Opened ${prUrl}`);
  return upgradeStore.update(id, { status: 'pushed', pr_url: prUrl, error: note, completed_at: Date.now() });
}

export async function discardUpgrade(id: string): Promise<UpgradeRecord> {
  const rec = upgradeStore.get(id);
  if (!rec) throw new Error('Upgrade not found');
  if (busy.has(id) || agentManager.isRunning(rec.project_id)) throw new Error('Stop the running stage before discarding.');
  await removeWorktree(MAIN_ROOT, rec.worktree);
  if (rec.status !== 'pushed') await git(MAIN_ROOT, ['branch', '-D', rec.candidate_branch]).catch(() => {});
  try { projectDb.delete(rec.project_id); } catch {}
  log(id, 'Discarded: worktree removed');
  return upgradeStore.update(id, { status: 'discarded', completed_at: Date.now() });
}
