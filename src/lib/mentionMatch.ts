/**
 * Client-safe helpers for the composer's `@file` autocomplete.
 */

/** The `@query` being typed at `caret`, or null. The `@` must start the
 *  text or follow whitespace (so emails don't trigger it). */
export function getMentionQuery(value: string, caret: number): { query: string; start: number } | null {
  const before = value.slice(0, caret);
  const m = before.match(/(^|\s)@([^\s@]*)$/);
  if (!m) return null;
  return { query: m[2], start: before.length - m[2].length - 1 };
}

/** Subsequence score: lower is better, null when `query` is not a
 *  subsequence of `target`. Rewards basename hits and contiguous runs. */
function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return t.length;
  const base = t.slice(t.lastIndexOf('/') + 1);
  if (base.startsWith(q)) return -1000 + t.length;
  const sub = t.indexOf(q);
  if (sub !== -1) return -500 + sub + t.length;
  let score = 0;
  let ti = 0;
  let last = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += last === -1 ? found : (found - last - 1) * 2;
    last = found;
    ti = found + 1;
  }
  return score + t.length;
}

export function fuzzyMatchPaths(query: string, paths: string[], limit = 8): string[] {
  const scored: { p: string; s: number }[] = [];
  for (const p of paths) {
    const s = fuzzyScore(query, p);
    if (s !== null) scored.push({ p, s });
  }
  scored.sort((a, b) => a.s - b.s || a.p.localeCompare(b.p));
  return scored.slice(0, limit).map((x) => x.p);
}

/** Replace the `@query` at `start..caret` with `@path ` (dirs keep a
 *  trailing slash and no space so the user can keep drilling down). */
export function completeMention(
  value: string,
  start: number,
  caret: number,
  filePath: string,
  isDirectory = false
): { value: string; caret: number } {
  const insert = isDirectory ? `@${filePath.replace(/\/?$/, '/')}` : `@${filePath} `;
  return { value: value.slice(0, start) + insert + value.slice(caret), caret: start + insert.length };
}
