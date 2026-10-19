import { describe, it, expect } from 'vitest';
import { parseArgs } from '../bin/open-code.mjs';
import path from 'path';

describe('Phase 3: CLI Companion & CWD Detection', () => {
  it('parses --dir and attaches project to directory path', () => {
    const testDir = path.resolve('./workspaces');
    const opts = parseArgs(['-p', 'audit this repository', '--dir', testDir]);
    expect(opts.dir).toBe(testDir);
    expect(opts.prompt).toBe('audit this repository');
  });

  it('parses --cwd to attach to current working directory', () => {
    const opts = parseArgs(['-p', 'run lint', '--cwd']);
    expect(opts.dir).toBe(process.cwd());
  });

  it('supports shorthand prompt with --dir flag', () => {
    const opts = parseArgs(['fix build errors', '-d', './src']);
    expect(opts.prompt).toBe('fix build errors');
    expect(opts.dir).toBe(path.resolve('./src'));
  });
});
