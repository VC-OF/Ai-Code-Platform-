import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractMentions, resolveMentions, MAX_MENTION_CHARS } from '@/lib/mentions';
import { getMentionQuery, fuzzyMatchPaths, completeMention } from '@/lib/mentionMatch';

let root: string;
let ws: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-mention-'));
  ws = path.join(root, 'ws');
  fs.mkdirSync(path.join(ws, 'src', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'src', 'app.ts'), 'export const app = 1;\n');
  fs.writeFileSync(path.join(ws, 'src', 'lib', 'util.ts'), 'util');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'SECRET');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extractMentions', () => {
  it('finds @paths but not emails, trimming trailing punctuation', () => {
    expect(extractMentions('fix @src/app.ts, then (@README.md). mail a@b.com')).toEqual(['src/app.ts', 'README.md']);
  });
});

describe('resolveMentions', () => {
  it('attaches files and directory listings', async () => {
    const r = await resolveMentions('look at @src/app.ts and @src', ws);
    expect(r.attached).toEqual(['src/app.ts', 'src']);
    expect(r.text).toContain('[Attached file @src/app.ts]\n```\nexport const app = 1;\n\n```');
    expect(r.text).toContain('[Attached directory @src]');
    expect(r.text).toContain('lib/');
    expect(r.text.startsWith('look at @src/app.ts and @src')).toBe(true);
  });

  it('rejects traversal and leaves unknown paths as text', async () => {
    const r = await resolveMentions('see @../outside.txt and @nope.ts and @types/node', ws);
    expect(r.attached).toEqual([]);
    expect(r.text).toBe('see @../outside.txt and @nope.ts and @types/node');
    expect(r.text).not.toContain('SECRET');
  });

  it('caps file content', async () => {
    fs.writeFileSync(path.join(ws, 'big.txt'), 'x'.repeat(MAX_MENTION_CHARS + 500));
    const r = await resolveMentions('@big.txt', ws);
    expect(r.text).toContain('truncated');
    expect(r.text.length).toBeLessThan(MAX_MENTION_CHARS + 200);
  });
});

describe('composer helpers', () => {
  it('detects the @query at the caret', () => {
    expect(getMentionQuery('see @src/ap', 11)).toEqual({ query: 'src/ap', start: 4 });
    expect(getMentionQuery('a@b', 3)).toBeNull();
    expect(getMentionQuery('@', 1)).toEqual({ query: '', start: 0 });
  });

  it('fuzzy-matches with basename preference', () => {
    const paths = ['src/lib/util.ts', 'src/app.ts', 'docs/application.md', 'README.md'];
    expect(fuzzyMatchPaths('app', paths)[0]).toBe('src/app.ts');
    expect(fuzzyMatchPaths('slu', paths)).toEqual(['src/lib/util.ts']);
    expect(fuzzyMatchPaths('zzz', paths)).toEqual([]);
  });

  it('completes the mention', () => {
    expect(completeMention('see @ap now', 4, 7, 'src/app.ts')).toEqual({ value: 'see @src/app.ts  now', caret: 16 });
    expect(completeMention('@sr', 0, 3, 'src', true)).toEqual({ value: '@src/', caret: 5 });
  });
});
