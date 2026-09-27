import { describe, it, expect } from 'vitest';
import { USER_AGENT, plainText, type DiscoverConfig, type FetchLike } from '@/lib/discover/types';
import {
  hfPapersSource, parseHfDailyPapers, matchKeywords, paperGoal, paperTarget, paperSummary, authorLine,
} from '@/lib/discover/sources/hfPapers';
import {
  arxivSource, parseArxivFeed, parseArxivEntries, buildArxivQuery, arxivQueryUrl, arxivError,
} from '@/lib/discover/sources/arxiv';

const cfg: DiscoverConfig = {
  keywords: ['coding agent', 'tool use', 'LLM agents', 'Model Context Protocol'],
  watchedRepos: [],
  topics: [],
  repo: null,
  root: '/repo',
  now: () => Date.parse('2026-09-27T12:00:00Z'),
};

function fakeFetch(body: string, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { fetchImpl, calls };
}

const headersOf = (init?: RequestInit) => (init?.headers ?? {}) as Record<string, string>;

// ─── Hugging Face daily papers ───────────────────────────────────────────────

// Trimmed from GET https://huggingface.co/api/daily_papers?limit=50 (2026-09-27)
const HF_FIXTURE = [
  {
    paper: {
      id: '2609.30233',
      authors: [
        { _id: '6ab62e3e8b8b18c15163dd07', name: 'Matteo Merler', hidden: false },
        { _id: '6ab62e3e8b8b18c15163dd08', name: 'Bowen Li', hidden: false },
      ],
      publishedAt: '2026-09-24T00:00:00.000Z',
      title: 'Coding Agents for Generalized Task and Motion Planning Problems',
      summary: 'Task and motion planning (TAMP) problems remain difficult even with full observability. We investigate whether coding agents can automate this process.',
      upvotes: 10,
      discussionId: '6ab62e3f8b8b18c15163dd0e',
    },
    publishedAt: '2026-09-23T20:00:00.000Z',
    title: 'Coding Agents for Generalized Task and Motion Planning Problems',
    numComments: 2,
  },
  {
    paper: {
      id: '2609.28654',
      authors: [{ _id: '6ab5d5f08b8b18c15163db00', name: 'Haotian Zhang', hidden: false }],
      publishedAt: '2026-09-23T00:00:00.000Z',
      title: 'Training Object Permanence in World Models',
      summary: 'Object permanence and solidity are hallmarks of human cognitive priors.',
      upvotes: 202,
      discussionId: '6ab5d5f08b8b18c15163db1f',
    },
    publishedAt: '2026-09-22T20:00:00.000Z',
    title: 'Training Object Permanence in World Models',
    numComments: 2,
  },
  {
    paper: {
      id: '2609.27334',
      authors: [
        { _id: '6ab49289bf93a1a9ceb45181', name: 'Yefan Zhou', hidden: false },
        { _id: '6ab49289bf93a1a9ceb45182', name: 'Yang Li', hidden: false },
        { _id: '6ab49289bf93a1a9ceb45183', name: 'Zeyu Leo Liu', hidden: false },
        { _id: '6ab49289bf93a1a9ceb45184', name: 'Semih Yavuz', hidden: false },
      ],
      publishedAt: '2026-09-23T00:00:00.000Z',
      title: 'Just-in-Time Memory: Learning to Curate Task-Adaptive Memory for LLM Agents',
      summary: 'Agentic memory systems reuse past experience to improve future performance, yet most existing designs curate memory at write time.',
      upvotes: 35,
      discussionId: '6ab49289bf93a1a9ceb45186',
    },
    publishedAt: '2026-09-22T20:00:00.000Z',
    title: 'Just-in-Time Memory: Learning to Curate Task-Adaptive Memory for LLM Agents',
    numComments: 2,
  },
];

describe('hf-papers parse', () => {
  it('ranks keyword matches first, then by upvotes', () => {
    const items = parseHfDailyPapers(HF_FIXTURE, cfg.keywords);
    expect(items.map((i) => i.id)).toEqual(['hf-papers:2609.27334', 'hf-papers:2609.30233', 'hf-papers:2609.28654']);
    const [memory, coding, world] = items;
    expect(memory).toMatchObject({
      category: 'research',
      source: 'hf-papers',
      sourceLabel: 'Hugging Face papers',
      title: 'Just-in-Time Memory: Learning to Curate Task-Adaptive Memory for LLM Agents',
      url: 'https://huggingface.co/papers/2609.27334',
      date: '2026-09-23T00:00:00.000Z',
      score: 35,
      tags: ['llm agents', 'paper'],
    });
    expect(memory.summary).toMatch(/^Yefan Zhou, Yang Li, Zeyu Leo Liu et al\. — Agentic memory systems/);
    expect(coding.tags).toEqual(['coding agent', 'paper']);
    expect(coding.summary).toMatch(/^Matteo Merler, Bowen Li — Task and motion/);
    expect(world.tags).toEqual(['paper']);
  });

  it('sorts by upvotes alone without keywords', () => {
    expect(parseHfDailyPapers(HF_FIXTURE).map((i) => i.score)).toEqual([202, 35, 10]);
  });

  it('matches keywords case-insensitively and once each', () => {
    expect(matchKeywords('Tool Use for LLM AGENTS', ['llm agents', 'LLM agents', ' tool use ', 'mcp', ''])).toEqual(['llm agents', 'tool use']);
  });

  it('drops entries without a safe URL or title', () => {
    const base = HF_FIXTURE[1].paper;
    const raw = [
      { paper: { ...base, id: '../../evil' } },
      { paper: { ...base, id: 'javascript:alert(1)' } },
      { paper: { ...base, id: '..' } },
      { paper: { ...base, id: undefined } },
      { paper: { ...base, id: 42 } },
      { paper: { ...base, id: '2609.00001', title: '   ' } },
      { title: 'no paper object' },
      null,
      'junk',
      { paper: { ...base, id: '2609.00002' } },
    ];
    const items = parseHfDailyPapers(raw);
    expect(items.map((i) => i.url)).toEqual(['https://huggingface.co/papers/2609.00002']);
    expect(parseHfDailyPapers({ error: 'nope' })).toEqual([]);
  });

  it('keeps at most 15 items and dedupes ids', () => {
    const paper = (n: number, upvotes = n) => ({ paper: { ...HF_FIXTURE[0].paper, id: `2609.${String(n).padStart(5, '0')}`, upvotes, title: 'T'.repeat(300), summary: 'word '.repeat(200) } });
    const items = parseHfDailyPapers(Array.from({ length: 40 }, (_, n) => paper(n)));
    expect(items).toHaveLength(15);
    expect(items[0].score).toBe(39);
    expect(items.every((i) => i.title.length <= 200 && (i.summary ?? '').length <= 400)).toBe(true);
    const dupes = parseHfDailyPapers([paper(1, 5), paper(2), paper(1, 99)]);
    expect(dupes.map((i) => [i.id, i.score])).toEqual([['hf-papers:2609.00001', 5], ['hf-papers:2609.00002', 2]]);
  });

  it('produces stable ids across refreshes', () => {
    const again = HF_FIXTURE.map((e) => ({ ...e, paper: { ...e.paper, upvotes: e.paper.upvotes + 100 } })).reverse();
    const ids = (x: unknown) => parseHfDailyPapers(x, cfg.keywords).map((i) => i.id).sort();
    expect(ids(again)).toEqual(ids(HF_FIXTURE));
  });

  it('writes a plain-text goal naming the paper, its URL and an OpenCode area', () => {
    const [memory, coding] = parseHfDailyPapers(HF_FIXTURE, cfg.keywords);
    expect(memory.goal).toContain(memory.title);
    expect(memory.goal).toContain(memory.url);
    expect(memory.goal).toContain('src/lib/contextManager.ts');
    expect(coding.goal).toContain('https://huggingface.co/papers/2609.30233');
    expect(memory.goal).not.toMatch(/[*`#]|\]\(/);
    for (const i of [memory, coding]) expect(i.goal).not.toMatch(/package\.json|npm (i|install)|bump/i);
    expect(paperGoal('MCP servers at scale', 'https://x.test/p', '')).toContain('src/lib/mcpClient.ts');
    expect(paperGoal('A new optimizer', 'https://x.test/p', '')).toContain('src/lib/agentLoop.ts');
    expect(paperGoal('Agents that audit themselves', 'https://x.test/p', 'We test Claude and Qwen.')).toContain('src/lib/agentLoop.ts');
    expect(paperGoal('Faster GGUF quantization', 'https://x.test/p', '')).toContain('src/lib/llmClient.ts');
  });

  it('sets canonicalId to the versionless arXiv id', () => {
    const items = parseHfDailyPapers(HF_FIXTURE);
    expect(items.map((i) => i.canonicalId).sort()).toEqual(['arxiv:2609.27334', 'arxiv:2609.28654', 'arxiv:2609.30233']);
    const base = HF_FIXTURE[1].paper;
    const [versioned, other] = parseHfDailyPapers([{ paper: { ...base, id: '2609.00001v2' } }, { paper: { ...base, id: 'not-arxiv', upvotes: 1 } }]);
    expect(versioned.canonicalId).toBe('arxiv:2609.00001');
    expect(other.id).toBe('hf-papers:not-arxiv');
    expect(other.canonicalId).toBeUndefined();
  });

  it('keeps plain-text < and > and decodes entities exactly once', () => {
    const [item] = parseHfDailyPapers([{ paper: { ...HF_FIXTURE[1].paper, authors: [{ name: 'Ann &amp;amp; Bo' }], title: 'Agents <3 Array<string> &amp;amp;', summary: 'For n < 10 and m > 3, A&amp;B holds; &amp;lt;b&amp;gt; stays.' } }]);
    expect(item.title).toBe('Agents <3 Array<string> &amp;');
    expect(item.title).toBe(plainText('Agents <3 Array<string> &amp;amp;'));
    expect(item.summary).toBe('Ann &amp; Bo — For n < 10 and m > 3, A&B holds; &lt;b&gt; stays.');
  });

  it('formats author bylines and clips summaries without decoding again', () => {
    expect(authorLine([])).toBe('');
    expect(authorLine([' ', 'A'])).toBe('A');
    expect(authorLine(['A', 'B', 'C', 'D'])).toBe('A, B, C et al.');
    expect(paperSummary('A', 'x &amp; y')).toBe('A — x &amp; y');
    expect(paperSummary('A', '')).toBe('');
    expect(paperSummary('', 'abstract')).toBe('abstract');
    const long = paperSummary('A', `${'x'.repeat(391)} 😀😀😀😀😀`);
    expect(Array.from(long)).toHaveLength(400);
    expect(long.endsWith('😀…')).toBe(true);
  });
});

describe('paper goal targets', () => {
  const where = (title: string, abstract = '', category?: string) => paperTarget(title, abstract, category).where;

  it('does not pick the evaluation target just because the abstract evaluates something', () => {
    const t = paperTarget('Just-in-Time Memory for LLM Agents', 'We report an evaluation on three benchmarks.');
    expect(t).toMatchObject({ area: 'Context & memory', benchmark: false });
    expect(paperGoal('Just-in-Time Memory for LLM Agents', 'https://x.test/p', 'An evaluation on SWE-bench.')).not.toContain('tests/agent');
    expect(paperTarget('Planning agents', 'Extensive evaluation shows gains.')).toMatchObject({ area: 'Agent loop', benchmark: false });
  });

  it('writes a regression-scenario goal for benchmark papers', () => {
    const t = paperTarget('MCP-Bench: benchmarking tool-using agents', 'Tasks need Model Context Protocol servers.');
    expect(t).toMatchObject({ area: 'Tools & MCP', benchmark: true });
    const goal = paperGoal('SWE-Bench Pro: long-horizon software engineering tasks', 'https://arxiv.org/abs/2609.00009', 'Agents fix issues.', 'cs.SE');
    expect(goal).toContain('"SWE-Bench Pro: long-horizon software engineering tasks" (https://arxiv.org/abs/2609.00009)');
    expect(goal).toMatch(/add a regression scenario inspired by its benchmark tasks to OpenCode's agent regression tests \(tests\/agent/);
    expect(goal).toContain('src/lib/tools.ts');
    expect(goal).not.toMatch(/behind a setting|package\.json/);
    expect(paperTarget('Evaluating LLM agents on terminal tasks').benchmark).toBe(true);
    expect(paperTarget('A leaderboard for agents').benchmark).toBe(true);
  });

  it('uses the evaluation target when evaluation is the only matched area', () => {
    expect(paperTarget('Metrics that correlate with humans', 'We release a benchmark of 500 tasks.')).toMatchObject({ area: 'Agent loop', benchmark: true });
    expect(paperGoal('Metrics that correlate with humans', 'https://x.test/p', 'We release a benchmark of 500 tasks.')).toContain('tests/agent');
  });

  it('does not treat workbenches or self-evaluation as benchmarks', () => {
    expect(paperTarget('An agent workbench for chemists').benchmark).toBe(false);
    expect(paperTarget('Self-evaluation makes reasoning agents better').benchmark).toBe(false);
  });

  it('falls back to the arXiv primary category when the text names nothing specific', () => {
    expect(where('LLM agents can tamper with their own traces', 'Agents fail to enforce this boundary.', 'cs.CR')).toContain('src/lib/safeExec.ts');
    expect(where('LLM agents can tamper with their own traces', '', 'cs.CR')).toContain('src/lib/permissionRules.ts');
    expect(where('Agents that finish long tasks', '', 'cs.SE')).toBe('code-editing tools and agent loop (src/lib/tools.ts, src/lib/agentLoop.ts)');
    expect(where('Agents that follow instructions', '', 'cs.CL')).toBe('system prompt and context management (src/lib/systemPrompt.ts, src/lib/contextManager.ts)');
    expect(where('A new optimizer', '', 'cs.LG')).toContain('src/lib/agentLoop.ts');
    expect(where('A new optimizer', '', 'cs.AI')).toContain('src/lib/agentLoop.ts');
    expect(where('Teams of agents', '', 'cs.MA')).toContain('src/lib/subagents.ts');
    expect(where('Neural solvers', '', 'physics.comp-ph')).toContain('src/lib/scienceTools.ts');
    expect(where('A new optimizer', '', 'cs.RO')).toContain('src/lib/agentLoop.ts');
  });

  it('prefers an area named in the title, then the one the abstract mentions first', () => {
    expect(where('EmbodiedSWE: Coding Agents for Dexterous Robotics', 'Policies are trained in physics simulation.')).toContain('src/lib/systemPrompt.ts');
    expect(where('Governance in real-world repositories', 'Coding agents made progress. We also check security issues.')).toContain('src/lib/tools.ts');
    expect(where('Governance in real-world repositories', 'We check security issues made by coding agents.')).toContain('src/lib/safeExec.ts');
    expect(paperTarget('Measuring engineering governance of coding agents').benchmark).toBe(true);
    // Science only from the title (or a physics category): abstracts mention it in passing
    expect(where('Agents that plan', 'Useful for scientific discovery and simulation.', 'cs.AI')).toContain('src/lib/agentLoop.ts');
    expect(where('Agents for PDE solving', 'We use tool calling.')).toContain('src/lib/scienceTools.ts');
  });

  it('prefers a specific area from the text over the category', () => {
    expect(where('Tool calling for agents', '', 'cs.CR')).toContain('src/lib/mcpClient.ts');
    expect(where('Prompt injection in coding agents', '', 'cs.CL')).toContain('src/lib/safeExec.ts');
    // Models only without an agent angle, and never over a specific category
    expect(where('Faster GGUF quantization', '', 'cs.LG')).toContain('src/lib/models.ts');
    expect(where('Membership inference attacks on LLMs', '', 'cs.CR')).toContain('src/lib/safeExec.ts');
    expect(where('Agents that audit themselves', 'We test Claude and Qwen.', 'cs.LG')).toContain('src/lib/agentLoop.ts');
  });
});

describe('hf-papers fetch', () => {
  it('GETs the daily papers API with the injected fetch', async () => {
    const { fetchImpl, calls } = fakeFetch(JSON.stringify(HF_FIXTURE));
    const items = await hfPapersSource.fetch(fetchImpl, cfg);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://huggingface.co/api/daily_papers?limit=50');
    expect(headersOf(calls[0].init)['User-Agent']).toBe(USER_AGENT);
    expect(headersOf(calls[0].init).Accept).toBe('application/json');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(items[0].id).toBe('hf-papers:2609.27334');
    expect(hfPapersSource).toMatchObject({ id: 'hf-papers', label: 'Hugging Face papers', category: 'research', ttlMs: 60 * 60_000 });
  });

  it('throws on a non-OK response or an unexpected payload', async () => {
    await expect(hfPapersSource.fetch(fakeFetch('busy', 503).fetchImpl, cfg)).rejects.toThrow('huggingface.co returned 503');
    await expect(hfPapersSource.fetch(fakeFetch('{"error":"x"}').fetchImpl, cfg)).rejects.toThrow(/unexpected/);
  });
});

// ─── arXiv ───────────────────────────────────────────────────────────────────

// Trimmed from GET https://export.arxiv.org/api/query?search_query=… (2026-09-27)
const ARXIV_FIXTURE = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom" xmlns="http://www.w3.org/2005/Atom">
  <id>https://arxiv.org/api/nlOq6KD1Fiwl6uuahzIPF09yR54</id>
  <title>arXiv Query: search_query=(abs:"coding agent")&amp;id_list=&amp;start=0&amp;max_results=3</title>
  <updated>2026-09-27T11:46:23Z</updated>
  <opensearch:totalResults>6629</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/abs/2609.30266v1</id>
    <title>LLM Agents Can Easily Tamper With Their
      Own Traces</title>
    <updated>2026-09-24T17:59:54Z</updated>
    <link href="https://arxiv.org/abs/2609.30266v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2609.30266v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Asynchronous monitoring, incident investigations, and compliance audits primarily rely on agent traces.
    We show that local LLM agents fail to enforce this boundary.</summary>
    <category term="cs.CR" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-09-24T17:59:54Z</published>
    <arxiv:primary_category term="cs.CR"/>
    <author>
      <name>Jeremy Qin</name>
    </author>
    <author>
      <name>David Schmotz</name>
    </author>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2609.30233v1</id>
    <title>Coding Agents for Generalized Task and Motion Planning Problems</title>
    <updated>2026-09-24T17:53:35Z</updated>
    <link href="https://arxiv.org/abs/2609.30233v1" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/2609.30233v1" rel="related" type="application/pdf" title="pdf"/>
    <summary>Task and motion planning (TAMP) problems remain difficult even with full observability.</summary>
    <category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <published>2026-09-24T17:53:35Z</published>
    <arxiv:comment>9 pages, 4 figures, 3 tables</arxiv:comment>
    <arxiv:primary_category term="cs.RO"/>
    <author>
      <name>Matteo Merler</name>
    </author>
    <author>
      <name>Bowen Li</name>
    </author>
    <author>
      <name>Josh Roy</name>
    </author>
    <author>
      <name>Tom&#225;s Lozano-P&#233;rez</name>
    </author>
  </entry>
</feed>`;

/** One entry in the older API format (http links, namespaced primary_category). */
function oldEntry(id: string, title = 'Tool use for SWE agents', extra = '') {
  return `<entry>
    <id>http://arxiv.org/abs/${id}</id>
    <updated>2024-01-02T00:00:00Z</updated>
    <published>2024-01-02T00:00:00Z</published>
    <title>${title}</title>
    <summary>  Abstract for ${id}.  </summary>
    <author><name>Ada Lovelace</name></author>
    <link href="http://arxiv.org/abs/${id}" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/${id}" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.SE" scheme="http://arxiv.org/schemas/atom"/>
    ${extra}
  </entry>`;
}
const feed = (...entries: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('\n')}</feed>`;

describe('arxiv query', () => {
  it('ORs abs: phrases and ANDs the category filter', () => {
    expect(buildArxivQuery(cfg.keywords)).toBe(
      '(abs:"coding agent" OR abs:"tool use" OR abs:"LLM agents" OR abs:"Model Context Protocol") AND (cat:cs.SE OR cat:cs.CL OR cat:cs.AI OR cat:cs.LG)'
    );
    expect(buildArxivQuery([])).toBe('(cat:cs.SE OR cat:cs.CL OR cat:cs.AI OR cat:cs.LG)');
    expect(buildArxivQuery(['  ', 'a  b', 'a b'])).toBe('(abs:"a b") AND (cat:cs.SE OR cat:cs.CL OR cat:cs.AI OR cat:cs.LG)');
  });

  it('cannot break out of the phrase or the query string', () => {
    const q = buildArxivQuery(['x" OR cat:hep-th OR abs:"y', 'a) OR (b']);
    expect(q.startsWith('(abs:"x OR cat:hep-th OR abs: y" OR abs:"a OR b") AND')).toBe(true);
    const url = new URL(arxivQueryUrl(['q&max_results=1000#frag']));
    expect(url.host).toBe('export.arxiv.org');
    expect(url.pathname).toBe('/api/query');
    expect(url.searchParams.getAll('max_results')).toEqual(['15']);
    expect(url.searchParams.get('search_query')).toContain('abs:"q&max_results=1000#frag"');
    expect(url.searchParams.get('sortBy')).toBe('submittedDate');
    expect(url.searchParams.get('sortOrder')).toBe('descending');
    expect(url.hash).toBe('');
  });
});

describe('arxiv parse', () => {
  it('parses Atom entries', () => {
    const items = parseArxivFeed(ARXIV_FIXTURE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'arxiv:2609.30266',
      category: 'research',
      source: 'arxiv',
      sourceLabel: 'arXiv',
      title: 'LLM Agents Can Easily Tamper With Their Own Traces',
      url: 'https://arxiv.org/abs/2609.30266v1',
      date: '2026-09-24T17:59:54.000Z',
      tags: ['cs.cr', 'paper'],
    });
    expect(items[0].score).toBeUndefined();
    expect(items[0].summary).toBe('Jeremy Qin, David Schmotz — Asynchronous monitoring, incident investigations, and compliance audits primarily rely on agent traces. We show that local LLM agents fail to enforce this boundary.');
    expect(items[1].tags).toEqual(['cs.ro', 'paper']);
    expect(items[1].summary).toMatch(/^Matteo Merler, Bowen Li, Josh Roy et al\. — Task and motion/);
  });

  it('extracts authors (entity-decoded) and the primary category', () => {
    const [, coding] = parseArxivEntries(ARXIV_FIXTURE);
    expect(coding.authors).toEqual(['Matteo Merler', 'Bowen Li', 'Josh Roy', 'Tomás Lozano-Pérez']);
    expect(coding.primaryCategory).toBe('cs.RO');
    expect(coding.published).toBe('2026-09-24T17:53:35.000Z');
  });

  it('handles the older format and upgrades abs links to https', () => {
    const [item] = parseArxivFeed(feed(oldEntry('2401.01234v2'), oldEntry('cs/0112017v1', 'Old style')));
    expect(item).toMatchObject({ id: 'arxiv:2401.01234', url: 'https://arxiv.org/abs/2401.01234v2', tags: ['cs.se', 'paper'], summary: 'Ada Lovelace — Abstract for 2401.01234v2.' });
    expect(parseArxivFeed(feed(oldEntry('cs/0112017v1')))[0].id).toBe('arxiv:cs/0112017');
  });

  it('decodes XML entities once without losing text around < and >', () => {
    const [item] = parseArxivFeed(feed(oldEntry('2401.00001v1', 'Q&amp;A with &lt;tools&gt; &#8212; it&apos;s &#x3b1; &#60;b&#62;', '')
      .replace('Abstract for 2401.00001v1.', 'n &lt; 10 and m &gt; 3; &amp;lt;b&amp;gt; &amp;amp; Array&lt;string&gt;')
      .replace('Ada Lovelace', 'Ann &amp;amp; Bo')));
    expect(item.title).toBe("Q&A with <tools> — it's α <b>");
    expect(item.summary).toBe('Ann &amp; Bo — n < 10 and m > 3; &lt;b&gt; &amp; Array<string>');
  });

  it('drops error entries and entries without a safe abs URL', () => {
    const error = `<entry><id>https://arxiv.org/api/errors#incorrect_id_format_for_x</id><title>Error</title>
      <link href="https://arxiv.org/api/errors#incorrect_id_format_for_x" rel="alternate" type="text/html"/>
      <summary>incorrect id format for x</summary></entry>`;
    const foreign = oldEntry('2401.00002v1').replace(/http:\/\/arxiv\.org/g, 'https://evil.example');
    const scriptLink = oldEntry('2401.00003v1').replace(/<id>[^<]*<\/id>/, '<id>not-an-id</id>').replace('http://arxiv.org/abs/2401.00003v1', 'javascript:alert(1)');
    const noTitle = oldEntry('2401.00004v1', '   ');
    const items = parseArxivFeed(feed(error, foreign, scriptLink, noTitle, oldEntry('2401.00005v1')));
    expect(items.map((i) => i.id)).toEqual(['arxiv:2401.00005']);
    expect(parseArxivFeed('not xml')).toEqual([]);
  });

  it('prefers the alternate link but falls back to the entry id', () => {
    const noLink = oldEntry('2401.00006v3').replace(/<link[^>]*rel="alternate"[^>]*\/>/, '');
    expect(parseArxivFeed(feed(noLink))[0].url).toBe('https://arxiv.org/abs/2401.00006v3');
    const scriptLink = oldEntry('2401.00008v1').replace('href="http://arxiv.org/abs/2401.00008v1"', 'href="javascript:alert(1)"');
    expect(parseArxivFeed(feed(scriptLink))[0].url).toBe('https://arxiv.org/abs/2401.00008v1');
  });

  it('keeps at most 15 items, one per paper, with version-independent ids', () => {
    const entries = Array.from({ length: 20 }, (_, n) => oldEntry(`2401.${String(n).padStart(5, '0')}v1`));
    expect(parseArxivFeed(feed(...entries))).toHaveLength(15);
    const both = parseArxivFeed(feed(oldEntry('2401.00007v2'), oldEntry('2401.00007v1')));
    expect(both.map((i) => i.id)).toEqual(['arxiv:2401.00007']);
    expect(parseArxivFeed(feed(oldEntry('2401.00007v1')))[0].id).toBe(both[0].id);
  });

  it('writes a goal naming the paper and its URL', () => {
    const [traces, coding] = parseArxivFeed(ARXIV_FIXTURE);
    expect(traces.goal).toContain('"LLM Agents Can Easily Tamper With Their Own Traces"');
    expect(traces.goal).toContain('https://arxiv.org/abs/2609.30266v1');
    expect(coding.goal).toContain(coding.title);
    expect(coding.goal).toContain(coding.url);
    expect(coding.goal).toMatch(/OpenCode/);
    for (const i of [traces, coding]) expect(i.goal).not.toMatch(/package\.json|npm (i|install)|bump|[*`#]/i);
  });

  it('uses the primary category when the text names no specific area', () => {
    const [traces, coding] = parseArxivFeed(ARXIV_FIXTURE);
    // cs.CR, and the text only says "agents"
    expect(traces.goal).toContain('sandboxed execution and permission rules (src/lib/safeExec.ts, src/lib/permissionRules.ts)');
    expect(traces.goal).not.toContain('tests/agent');
    // "Coding" in the title beats the category (cs.RO has no mapping anyway)
    expect(coding.goal).toContain('src/lib/tools.ts');
    const [se] = parseArxivFeed(feed(oldEntry('2401.00010v1', 'Agents that finish long tasks')));
    expect(se.tags).toEqual(['cs.se', 'paper']);
    expect(se.goal).toContain('code-editing tools and agent loop (src/lib/tools.ts, src/lib/agentLoop.ts)');
    const bench = oldEntry('2401.00011v1', 'TermBench: a benchmark for agents').replace('term="cs.SE"', 'term="cs.CL"');
    const [b] = parseArxivFeed(feed(bench));
    expect(b.goal).toMatch(/regression scenario inspired by its benchmark tasks to OpenCode's agent regression tests \(tests\/agent/);
    expect(b.goal).toContain('src/lib/systemPrompt.ts');
  });

  it('sets canonicalId to the versionless id, matching the Hugging Face item', () => {
    const [traces, coding] = parseArxivFeed(ARXIV_FIXTURE);
    expect(traces.canonicalId).toBe('arxiv:2609.30266');
    const hf = parseHfDailyPapers(HF_FIXTURE).find((i) => i.url.endsWith('/2609.30233'));
    expect(hf?.canonicalId).toBe(coding.canonicalId);
    expect(coding.canonicalId).toBe('arxiv:2609.30233');
    expect(parseArxivFeed(feed(oldEntry('cs/0112017v1')))[0].canonicalId).toBe('arxiv:cs/0112017');
  });
});

describe('arxiv fetch', () => {
  it('GETs the encoded query with the injected fetch', async () => {
    const { fetchImpl, calls } = fakeFetch(ARXIV_FIXTURE);
    const items = await arxivSource.fetch(fetchImpl, cfg);
    expect(items).toHaveLength(2);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(arxivQueryUrl(cfg.keywords));
    expect(calls[0].url).not.toMatch(/[ "]/);
    expect(new URL(calls[0].url).searchParams.get('search_query')).toBe(buildArxivQuery(cfg.keywords));
    expect(headersOf(calls[0].init)['User-Agent']).toBe(USER_AGENT);
    expect(headersOf(calls[0].init).Accept).toBe('application/atom+xml');
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(arxivSource).toMatchObject({ id: 'arxiv', label: 'arXiv', category: 'research', ttlMs: 3 * 60 * 60_000, minRefreshMs: 5 * 60_000 });
  });

  it('throws on non-OK responses, API error entries and non-Atom payloads', async () => {
    await expect(arxivSource.fetch(fakeFetch('Rate exceeded', 503).fetchImpl, cfg)).rejects.toThrow('export.arxiv.org returned 503');
    const errorFeed = feed('<entry><id>https://arxiv.org/api/errors#bad</id><title>Error</title><summary>malformed query</summary></entry>');
    expect(arxivError(errorFeed)).toBe('malformed query');
    expect(arxivError(ARXIV_FIXTURE)).toBeNull();
    await expect(arxivSource.fetch(fakeFetch(errorFeed).fetchImpl, cfg)).rejects.toThrow('arXiv API error: malformed query');
    await expect(arxivSource.fetch(fakeFetch('<html>maintenance</html>').fetchImpl, cfg)).rejects.toThrow(/unexpected payload/);
  });

  it('returns [] for an empty result feed', async () => {
    const empty = feed('<opensearch:totalResults>0</opensearch:totalResults>');
    expect(await arxivSource.fetch(fakeFetch(empty).fetchImpl, cfg)).toEqual([]);
  });
});
