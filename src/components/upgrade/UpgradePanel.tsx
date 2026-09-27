'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import s from './upgrade.module.css';

type Status =
  | 'analyzing' | 'analyzed' | 'developing' | 'reviewing' | 'verifying'
  | 'ready' | 'rejected' | 'inconclusive' | 'committed' | 'pushed' | 'failed' | 'discarded';

interface Upgrade {
  id: string; goal: string; status: Status; base_commit: string; base_branch: string;
  candidate_branch: string; worktree: string; project_id: string;
  analysis: string | null; affected_areas: string | null; proposed_plan: string | null; risk: string | null;
  gate_result: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | null; gate_checks: string | null;
  candidate_commit: string | null; pr_url: string | null; error: string | null; created_at: number;
}
interface Change { path: string; additions: number; deletions: number; status: string }
interface TestRow { target: 'base' | 'candidate'; command: string; passed: number; failed: number; skipped: number; total: number; exit_code: number | null }
interface Review { verdict: string; findings: string; reviewer: string }
interface Detail { upgrade: Upgrade; busy: boolean; changes: Change[]; tests: TestRow[]; review: Review | null; log: string[] }
interface GateCheck { name: string; result: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; detail: string }

const STAGES = ['Analyze', 'Develop', 'Verify', 'Commit', 'Push'] as const;
const ACTIVE: Status[] = ['analyzing', 'developing', 'reviewing', 'verifying'];

/** Stage index reached, and whether the current stage is running / failed. */
function stageState(st: Status): { at: number; running: boolean; bad: boolean } {
  switch (st) {
    case 'analyzing': return { at: 0, running: true, bad: false };
    case 'analyzed': return { at: 1, running: false, bad: false };
    case 'developing': case 'reviewing': return { at: 1, running: true, bad: false };
    case 'verifying': return { at: 2, running: true, bad: false };
    case 'rejected': case 'inconclusive': return { at: 2, running: false, bad: true };
    case 'ready': return { at: 3, running: false, bad: false };
    case 'committed': return { at: 4, running: false, bad: false };
    case 'pushed': return { at: 5, running: false, bad: false };
    default: return { at: 0, running: false, bad: true };
  }
}

const STATUS_LABEL: Record<Status, string> = {
  analyzing: 'Analyzing', analyzed: 'Analyzed', developing: 'Developing', reviewing: 'Reviewing',
  verifying: 'Verifying', ready: 'Ready', rejected: 'Rejected', inconclusive: 'Inconclusive',
  committed: 'Committed', pushed: 'Pushed', failed: 'Failed', discarded: 'Discarded',
};

function tone(st: Status | string | null): string {
  if (!st) return s.toneMuted;
  if (['ready', 'committed', 'pushed', 'PASS'].includes(st)) return s.toneGood;
  if (['rejected', 'failed', 'FAIL'].includes(st)) return s.toneBad;
  if (['inconclusive', 'INCONCLUSIVE'].includes(st)) return s.toneWarn;
  if (ACTIVE.includes(st as Status)) return s.toneActive;
  return s.toneMuted;
}

// The panel can remount (mobile/desktop layouts each render it), so the
// selection and an unsent goal survive in sessionStorage
const KEY = 'oc-upgrade-panel';
function readSaved(): { selected: string | null; goal: string } {
  try { return { selected: null, goal: '', ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}') }; } catch { return { selected: null, goal: '' }; }
}
function save(v: { selected: string | null; goal: string }) {
  try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch {}
}

const parseList = (v: string | null): string[] => { try { return v ? JSON.parse(v) : []; } catch { return []; } };

export default function UpgradePanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Upgrade[]>([]);
  const [base, setBase] = useState<{ commit: string; branch: string }>({ commit: '', branch: '' });
  const [selected, setSelected] = useState<string | null>(() => readSaved().selected);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [goal, setGoal] = useState(() => readSaved().goal);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const loadList = useCallback(async () => {
    const r = await fetch('/api/upgrade').then((x) => x.json()).catch(() => null);
    if (r?.upgrades) { setList(r.upgrades); setBase(r.base); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const r = await fetch(`/api/upgrade?id=${encodeURIComponent(id)}`).then((x) => x.json()).catch(() => null);
    if (r?.upgrade) setDetail(r);
  }, []);

  useEffect(() => {
    fetch('/api/upgrade').then((x) => x.json()).then((r) => { if (r?.upgrades) { setList(r.upgrades); setBase(r.base); } }).catch(() => {});
    const saved = readSaved().selected;
    if (saved) fetch(`/api/upgrade?id=${encodeURIComponent(saved)}`).then((x) => x.json()).then((r) => { if (r?.upgrade) setDetail(r); else setSelected(null); }).catch(() => {});
  }, []);
  useEffect(() => { save({ selected, goal }); }, [selected, goal]);

  const select = (id: string | null) => {
    setDiff(null); setConfirmPush(false); setConfirmDiscard(false); setError('');
    setDetail(null);
    setSelected(id);
    if (id) void loadDetail(id);
  };

  const live = !!detail && (detail.busy || ACTIVE.includes(detail.upgrade.status));
  useEffect(() => {
    if (!selected || !live) return;
    const t = setInterval(() => { void loadDetail(selected); void loadList(); }, 2500);
    return () => clearInterval(t);
  }, [selected, live, loadDetail, loadList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (payload: Record<string, unknown>) => {
    setPending(true); setError('');
    try {
      const r = await fetch('/api/upgrade', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
      await loadList();
      if (j.upgrade?.id) {
        if (payload.action === 'start') setGoal('');
        setSelected(j.upgrade.id);
        await loadDetail(j.upgrade.id);
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setPending(false);
    }
  };

  const showDiff = async () => {
    if (!selected) return;
    const r = await fetch(`/api/upgrade?id=${encodeURIComponent(selected)}&diff=1`).then((x) => x.json()).catch(() => null);
    setDiff(r?.diff ?? 'Diff unavailable.');
  };

  const nextId = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const n = list.filter((u) => u.id.startsWith(`upg-${day}-`)).length + 1;
    return `upg-${day}-${String(n).padStart(3, '0')}`;
  }, [list]);

  return (
    <div className={s.scrim} role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.panel}>
        <header className={s.head}>
          <div>
            <h2 id="upgrade-title" className={s.title}>Upgrade OpenCode</h2>
            <p className={s.sub}>Improve OpenCode&apos;s own source in an isolated worktree. A gate in the main checkout decides whether the result is acceptable; commit and push are separate actions you take.</p>
          </div>
          <button className={s.iconBtn} onClick={onClose} aria-label="Close">✕</button>
        </header>

        <div className={s.body}>
          <aside className={s.history}>
            <button className={`${s.btn} ${selected === null ? s.btnPrimary : ''}`} onClick={() => select(null)}>New upgrade</button>
            <div className={s.histLabel}>Upgrade history</div>
            {list.length === 0 && <div className={s.muted}>No upgrades yet.</div>}
            {list.map((u) => (
              <button key={u.id} className={`${s.histItem} ${selected === u.id ? s.histActive : ''}`} onClick={() => select(u.id)}>
                <span className={s.histTop}>
                  <span className={s.mono}>{u.id}</span>
                  <span className={`${s.chip} ${tone(u.status)}`}>{STATUS_LABEL[u.status]}</span>
                </span>
                <span className={s.histGoal}>{u.goal}</span>
              </button>
            ))}
          </aside>

          <main className={s.main}>
            {error && <div className={s.error} role="alert">{error}</div>}

            {selected === null ? (
              <form className={s.form} onSubmit={(e) => { e.preventDefault(); void act({ action: 'start', goal }); }}>
                <label htmlFor="upgrade-goal" className={s.label}>What should OpenCode improve?</label>
                <textarea id="upgrade-goal" className={s.textarea} rows={4} value={goal} onChange={(e) => setGoal(e.target.value)}
                  placeholder="Improve OpenCode's repository understanding and context selection" />
                <dl className={s.meta}>
                  <div><dt>Base</dt><dd className={s.mono}>{base.branch || '—'} @ {base.commit.slice(0, 7) || '—'}</dd></div>
                  <div><dt>Worktree</dt><dd className={s.mono}>.claude/worktrees/upgrade-{nextId}</dd></div>
                  <div><dt>Branch</dt><dd className={s.mono}>opencode-upgrade/{nextId}</dd></div>
                </dl>
                <Stepper status="analyzing" idle />
                <p className={s.note}>Starting runs the <b>Analyze</b> stage only: the agent reads OpenCode&apos;s source and proposes a plan, without changing anything. You review the plan before any code is written.</p>
                <div className={s.actions}>
                  <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={pending || goal.trim().length < 8}>
                    {pending ? 'Starting…' : 'Start upgrade'}
                  </button>
                </div>
              </form>
            ) : detail ? (
              <DetailView
                d={detail} pending={pending} diff={diff}
                confirmPush={confirmPush} setConfirmPush={setConfirmPush}
                confirmDiscard={confirmDiscard} setConfirmDiscard={setConfirmDiscard}
                onAct={act} onDiff={showDiff} onHideDiff={() => setDiff(null)}
              />
            ) : (
              <div className={s.muted}>Loading…</div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function Stepper({ status, idle = false }: { status: Status; idle?: boolean }) {
  const { at, running, bad } = stageState(status);
  return (
    <ol className={s.stepper} aria-label="Upgrade stages">
      {STAGES.map((name, i) => {
        const cls = idle
          ? (i === 0 ? s.stepCurrent : '')
          : i < at ? s.stepDone : i === at ? (bad ? s.stepBad : running ? s.stepRunning : s.stepCurrent) : '';
        return (
          <li key={name} className={`${s.step} ${cls}`}>
            <span className={s.dot} aria-hidden="true" />
            {name}
          </li>
        );
      })}
    </ol>
  );
}

function DetailView(props: {
  d: Detail; pending: boolean; diff: string | null;
  confirmPush: boolean; setConfirmPush: (v: boolean) => void;
  confirmDiscard: boolean; setConfirmDiscard: (v: boolean) => void;
  onAct: (p: Record<string, unknown>) => Promise<boolean>; onDiff: () => void; onHideDiff: () => void;
}) {
  const { d, pending } = props;
  const u = d.upgrade;
  const checks: GateCheck[] = u.gate_checks ? JSON.parse(u.gate_checks) : [];
  const plan = parseList(u.proposed_plan);
  const areas = parseList(u.affected_areas);
  const cand = d.tests.find((t) => t.target === 'candidate' && t.command.includes('vitest'));
  const baseT = d.tests.find((t) => t.target === 'base' && t.command.includes('vitest'));
  const adds = d.changes.reduce((n, c) => n + c.additions, 0);
  const dels = d.changes.reduce((n, c) => n + c.deletions, 0);
  const protectedCheck = checks.find((c) => c.name === 'No protected paths changed');
  const running = d.busy || ACTIVE.includes(u.status);

  return (
    <div className={s.detail}>
      <div className={s.detailHead}>
        <div>
          <div className={s.mono}>{u.id}</div>
          <h3 className={s.goal}>{u.goal}</h3>
        </div>
        <span className={`${s.chip} ${tone(u.status)}`}>{STATUS_LABEL[u.status]}</span>
      </div>

      <Stepper status={u.status} />

      <dl className={s.meta}>
        <div><dt>Base</dt><dd className={s.mono}>{u.base_branch} @ {u.base_commit.slice(0, 7)}</dd></div>
        <div><dt>Candidate</dt><dd className={s.mono}>{u.candidate_branch}{u.candidate_commit ? ` @ ${u.candidate_commit.slice(0, 7)}` : ''}</dd></div>
        {u.risk && <div><dt>Risk</dt><dd>{u.risk}</dd></div>}
        <div><dt>Chat</dt><dd>Open project &ldquo;Upgrade {u.id}&rdquo; in the sidebar to watch the agent.</dd></div>
      </dl>

      {u.error && <div className={u.status === 'pushed' ? s.warn : s.error}>{u.error}</div>}

      {running && (
        <section className={s.section}>
          <h4>Progress</h4>
          <pre className={s.log}>{d.log.slice(-14).join('\n') || 'Starting…'}</pre>
        </section>
      )}

      {u.analysis && (
        <section className={s.section}>
          <h4>Analysis</h4>
          <p className={s.prose}>{u.analysis}</p>
          {areas.length > 0 && (<><h5>Affected areas</h5><ul className={s.list}>{areas.map((a) => <li key={a} className={s.mono}>{a}</li>)}</ul></>)}
          {plan.length > 0 && (<><h5>Proposed plan</h5><ol className={s.list}>{plan.map((p, i) => <li key={i}>{p}</li>)}</ol></>)}
        </section>
      )}

      {(u.gate_result || d.changes.length > 0) && (
        <section className={s.section}>
          <h4>Upgrade result</h4>
          <div className={s.result}>
            <Stat label="Files changed" value={String(d.changes.length)} />
            <Stat label="Lines" value={`+${adds} / -${dels}`} />
            <Stat label="Tests" value={cand ? `${cand.passed} passed · ${cand.failed} failed` : '—'} sub={baseT ? `base ${baseT.passed} passed · ${baseT.failed} failed` : undefined} />
            <Stat label="Protected paths" value={protectedCheck ? (protectedCheck.result === 'PASS' ? '0 violations' : 'Violations') : '—'} tone={protectedCheck?.result} />
            <Stat label="Reviewer" value={d.review?.verdict ?? '—'} tone={d.review?.verdict} />
            <Stat label="Gate" value={u.gate_result ?? (running ? 'Running' : '—')} tone={u.gate_result} />
          </div>

          {checks.length > 0 && (
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Gate check</th><th>Result</th><th>Detail</th></tr></thead>
                <tbody>
                  {checks.map((c, i) => (
                    <tr key={i}><td>{c.name}</td><td><span className={`${s.chip} ${tone(c.result)}`}>{c.result}</span></td><td className={s.pre}>{c.detail}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {d.review?.findings && (
            <details className={s.details}>
              <summary>Reviewer findings</summary>
              <pre className={s.pre}>{d.review.findings}</pre>
            </details>
          )}
          {d.changes.length > 0 && (
            <details className={s.details}>
              <summary>Changed files</summary>
              <ul className={s.list}>{d.changes.map((c) => <li key={c.path} className={s.mono}>{c.status} {c.path} <span className={s.muted}>+{c.additions} -{c.deletions}</span></li>)}</ul>
            </details>
          )}
        </section>
      )}

      {props.diff !== null && (
        <section className={s.section}>
          <div className={s.rowBetween}><h4>Diff</h4><button className={s.btn} onClick={props.onHideDiff}>Hide diff</button></div>
          <pre className={s.diff}>{props.diff || '(empty)'}</pre>
        </section>
      )}

      {props.confirmPush && u.candidate_commit && (
        <section className={`${s.section} ${s.confirm}`}>
          <h4>Push contribution</h4>
          <dl className={s.meta}>
            <div><dt>Remote</dt><dd className={s.mono}>origin</dd></div>
            <div><dt>Branch</dt><dd className={s.mono}>{u.candidate_branch}</dd></div>
            <div><dt>Commit</dt><dd className={s.mono}>{u.candidate_commit.slice(0, 7)}</dd></div>
            <div><dt>Pull request</dt><dd>into <span className={s.mono}>{u.base_branch}</span>, if the GitHub CLI is signed in</dd></div>
          </dl>
          <div className={s.actions}>
            <button className={s.btn} onClick={() => props.setConfirmPush(false)}>Cancel</button>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={pending}
              onClick={async () => { if (await props.onAct({ action: 'push', id: u.id, branch: u.candidate_branch, commit: u.candidate_commit })) props.setConfirmPush(false); }}>
              {pending ? 'Pushing…' : 'Push'}
            </button>
          </div>
        </section>
      )}

      {props.confirmDiscard && (
        <section className={`${s.section} ${s.confirm}`}>
          <h4>Discard this upgrade?</h4>
          <p className={s.prose}>This removes the worktree{u.status !== 'pushed' ? ` and deletes branch ${u.candidate_branch}` : ''}. The history entry stays.</p>
          <div className={s.actions}>
            <button className={s.btn} onClick={() => props.setConfirmDiscard(false)}>Cancel</button>
            <button className={`${s.btn} ${s.btnDanger}`} disabled={pending} onClick={async () => { if (await props.onAct({ action: 'discard', id: u.id })) props.setConfirmDiscard(false); }}>Discard</button>
          </div>
        </section>
      )}

      {u.pr_url && <p className={s.prose}>Pull request: <a href={u.pr_url} target="_blank" rel="noreferrer">{u.pr_url}</a></p>}

      <div className={s.actions}>
        {(d.changes.length > 0 || u.candidate_commit) && <button className={s.btn} onClick={props.onDiff}>View diff</button>}
        {u.status === 'analyzed' && <button className={`${s.btn} ${s.btnPrimary}`} disabled={pending} onClick={() => props.onAct({ action: 'develop', id: u.id })}>Approve plan &amp; develop</button>}
        {u.status === 'failed' && !u.analysis && <button className={`${s.btn} ${s.btnPrimary}`} disabled={pending} onClick={() => props.onAct({ action: 'analyze', id: u.id })}>Retry analysis</button>}
        {(u.status === 'rejected' || u.status === 'inconclusive' || (u.status === 'failed' && !!u.analysis)) && <button className={s.btn} disabled={pending} onClick={() => props.onAct({ action: 'develop', id: u.id })}>Develop again</button>}
        {['ready', 'rejected', 'inconclusive'].includes(u.status) && <button className={s.btn} disabled={pending} onClick={() => props.onAct({ action: 'gate', id: u.id })}>Re-run gate</button>}
        {u.status === 'ready' && <button className={`${s.btn} ${s.btnPrimary}`} disabled={pending} onClick={() => props.onAct({ action: 'commit', id: u.id })}>Commit</button>}
        {u.status === 'committed' && !props.confirmPush && <button className={`${s.btn} ${s.btnPrimary}`} onClick={() => props.setConfirmPush(true)}>Push contribution</button>}
        {!running && !['discarded'].includes(u.status) && !props.confirmDiscard && <button className={`${s.btn} ${s.btnGhostDanger}`} onClick={() => props.setConfirmDiscard(true)}>Discard</button>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone: t }: { label: string; value: string; sub?: string; tone?: string | null }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={`${s.statValue} ${t ? tone(t) : ''}`}>{value}</div>
      {sub && <div className={s.statSub}>{sub}</div>}
    </div>
  );
}
