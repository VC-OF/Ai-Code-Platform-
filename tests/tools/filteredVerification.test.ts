import { describe, it, expect } from 'vitest';
import { filteredVerificationNote } from '@/lib/tools';

describe('filtered build/test commands cannot pass as verification', () => {
  it('flags build or test output that goes through a filter', () => {
    for (const cmd of [
      'cargo check --bin app 2>&1 | grep "main.rs" || echo "No errors in main.rs"',
      'cargo build --release 2>&1 | tail -20',
      'cargo test -q 2>&1 | head -5',
      'npm test | grep -c passed',
      'python3 -m pytest -q | tail -3',
      'go vet ./... 2>/dev/null',
      'tsc --noEmit | findstr error',
      'mvn -q test || true',
    ]) {
      expect(filteredVerificationNote(cmd), cmd).toMatch(/cannot show whether the build or tests actually succeeded/);
    }
  });

  it('leaves unfiltered or non-build commands alone', () => {
    for (const cmd of [
      'cargo test -q',
      'npm run build',
      'cargo check --lib 2>&1',
      'ls -la results/ | head -20',
      'cat Cargo.toml | grep version',
      'git log --oneline | head -5',
      'python3 scripts/analyze.py',
    ]) {
      expect(filteredVerificationNote(cmd), cmd).toBeNull();
    }
  });
});
