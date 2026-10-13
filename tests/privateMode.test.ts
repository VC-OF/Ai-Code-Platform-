import { describe, it, expect, beforeEach } from 'vitest';
import {
  isPrivateModeEnabled,
  setPrivateMode,
  togglePrivateMode,
  getPrivateTools,
  registerPrivateTool,
  isToolPrivate,
  guardToolExecution,
  shouldSuppressExternalLogging,
  _resetPrivateModeState,
} from '../src/lib/privateMode';
import { executeTool } from '../src/lib/tools';

describe('OpenCode Private Mode & Private Tools Architecture', () => {
  beforeEach(() => {
    _resetPrivateModeState();
    setPrivateMode(false);
  });

  describe('Private Mode State', () => {
    it('defaults to disabled', () => {
      expect(isPrivateModeEnabled()).toBe(false);
      expect(shouldSuppressExternalLogging()).toBe(false);
    });

    it('enables and disables explicitly', () => {
      setPrivateMode(true);
      expect(isPrivateModeEnabled()).toBe(true);
      expect(shouldSuppressExternalLogging()).toBe(true);

      setPrivateMode(false);
      expect(isPrivateModeEnabled()).toBe(false);
      expect(shouldSuppressExternalLogging()).toBe(false);
    });

    it('toggles mode state', () => {
      expect(togglePrivateMode()).toBe(true);
      expect(isPrivateModeEnabled()).toBe(true);

      expect(togglePrivateMode()).toBe(false);
      expect(isPrivateModeEnabled()).toBe(false);
    });
  });

  describe('Private Tools Catalog', () => {
    it('includes scaffolding private tools by default', () => {
      const tools = getPrivateTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain('private_code_vault');
      expect(names).toContain('private_credential_store');
      expect(names).toContain('private_local_eval');
      expect(names).toContain('private_airgap_fetch');
      expect(isToolPrivate('private_code_vault')).toBe(true);
      expect(isToolPrivate('read_file')).toBe(false);
    });

    it('allows registering custom private tools', () => {
      registerPrivateTool({
        name: 'custom_private_debugger',
        description: 'Isolated in-memory debugger',
        category: 'custom',
      });

      expect(isToolPrivate('custom_private_debugger')).toBe(true);
      const tools = getPrivateTools();
      expect(tools.some((t) => t.name === 'custom_private_debugger')).toBe(true);
    });
  });

  describe('Tool Execution Guarding', () => {
    it('permits non-private tools regardless of private mode', () => {
      setPrivateMode(false);
      expect(guardToolExecution('read_file')).toEqual({ allowed: true });
      expect(guardToolExecution('write_file')).toEqual({ allowed: true });

      setPrivateMode(true);
      expect(guardToolExecution('read_file')).toEqual({ allowed: true });
    });

    it('blocks private tools when private mode is OFF', () => {
      setPrivateMode(false);
      const guard = guardToolExecution('private_code_vault');
      expect(guard.allowed).toBe(false);
      expect(guard.reason).toContain('Private Tool');
      expect(guard.reason).toContain('enable Private Mode');
    });

    it('allows private tools when private mode is ON', () => {
      setPrivateMode(true);
      const guard = guardToolExecution('private_code_vault');
      expect(guard.allowed).toBe(true);
      expect(guard.reason).toBeUndefined();
    });
  });

  describe('Dispatcher Integration via executeTool', () => {
    function makeTurnContext(): import('../src/lib/tools').TurnContext {
      return {
        filesRead: new Set<string>(),
        filesEdited: new Set<string>(),
        filesCreated: new Set<string>(),
        commandsRun: [],
        hasEdits: false,
        hasRunLint: false,
        hasRunTests: false,
      };
    }

    it('returns an error when a private tool is invoked with Private Mode OFF', async () => {
      setPrivateMode(false);
      const res = await executeTool(
        'private_code_vault',
        { key: 'api_token' },
        process.cwd(),
        makeTurnContext()
      );

      expect(res.success).toBe(false);
      expect(res.output).toContain('Private Mode Required');
      expect(res.error).toBeDefined();
    });

    it('executes private tools successfully when Private Mode is ON', async () => {
      setPrivateMode(true);
      const res = await executeTool(
        'private_code_vault',
        { key: 'api_token' },
        process.cwd(),
        makeTurnContext()
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain('[Private Mode Tool: private_code_vault]');
      expect(res.output).toContain('isolated local storage');
    });
  });
});
