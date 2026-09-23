import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeResolve, SecurityError } from '@/lib/safeResolve';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

describe('safeResolve', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'src/index.ts': 'export const x = 1;',
      'src/nested/deep.ts': 'export const y = 2;',
    });
  });

  afterEach(() => ws.cleanup());

  // ── Happy paths ───────────────────────────────────────────────────────────
  describe('valid paths', () => {
    it('resolves a simple file path', () => {
      const result = safeResolve(ws.root, 'src/index.ts');
      expect(result).toBe(ws.resolve('src/index.ts'));
    });

    it('resolves nested paths', () => {
      const result = safeResolve(ws.root, 'src/nested/deep.ts');
      expect(result).toBe(ws.resolve('src/nested/deep.ts'));
    });

    it('resolves root itself', () => {
      const result = safeResolve(ws.root, '.');
      expect(result).toBe(ws.root);
    });

    it('handles forward slashes on all platforms', () => {
      const result = safeResolve(ws.root, 'src/index.ts');
      expect(result).toContain('src');
      expect(result).toContain('index.ts');
    });
  });

  // ── Path traversal attacks ────────────────────────────────────────────────
  describe('path traversal', () => {
    it('blocks simple .. traversal', () => {
      expect(() => safeResolve(ws.root, '../etc/passwd')).toThrow(
        SecurityError
      );
    });

    it('blocks deep .. traversal', () => {
      expect(() =>
        safeResolve(ws.root, 'src/../../../../../../etc/passwd')
      ).toThrow(SecurityError);
    });

    it('blocks URL-encoded traversal %2e%2e%2f', () => {
      expect(() =>
        safeResolve(ws.root, '%2e%2e%2fetc%2fpasswd')
      ).toThrow(SecurityError);
    });

    it('blocks double URL-encoded traversal %252e%252e', () => {
      expect(() =>
        safeResolve(ws.root, '%252e%252e%252fetc%252fpasswd')
      ).toThrow(SecurityError);
    });

    it('blocks backslash traversal on Windows-style paths', () => {
      expect(() =>
        safeResolve(ws.root, '..\\..\\etc\\passwd')
      ).toThrow(SecurityError);
    });

    it('blocks null byte injection', () => {
      expect(() =>
        safeResolve(ws.root, 'src/index.ts\0.jpg')
      ).toThrow(SecurityError);
    });

    it('blocks null byte after decoding', () => {
      expect(() =>
        safeResolve(ws.root, 'src/index.ts%00.jpg')
      ).toThrow(SecurityError);
    });
  });

  // ── Forbidden segments ────────────────────────────────────────────────────
  describe('forbidden segments', () => {
    it('blocks .git access', () => {
      expect(() =>
        safeResolve(ws.root, '.git/config')
      ).toThrow(SecurityError);
    });

    it('blocks .platform access', () => {
      expect(() =>
        safeResolve(ws.root, '.platform/projects.json')
      ).toThrow(SecurityError);
    });

    it('blocks .settings access', () => {
      expect(() =>
        safeResolve(ws.root, '.settings/env.json')
      ).toThrow(SecurityError);
    });

    it('blocks .env file access', () => {
      expect(() =>
        safeResolve(ws.root, '.env')
      ).toThrow(SecurityError);
    });

    it('blocks .env.local access', () => {
      expect(() =>
        safeResolve(ws.root, '.env.local')
      ).toThrow(SecurityError);
    });

    it('blocks nested .env access', () => {
      expect(() =>
        safeResolve(ws.root, 'src/.env')
      ).toThrow(SecurityError);
    });

    it('blocks .pem certificate access', () => {
      expect(() =>
        safeResolve(ws.root, 'certs/server.pem')
      ).toThrow(SecurityError);
    });

    it('blocks .ssh key access', () => {
      expect(() =>
        safeResolve(ws.root, '.ssh/id_rsa')
      ).toThrow(SecurityError);
    });
  });
});
