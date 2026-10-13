import fs from 'fs';
import path from 'path';

/**
 * OpenCode Private Mode & Private Tools Architecture
 *
 * When Private Mode is enabled:
 * - Local isolation mode is active.
 * - External network telemetry and cloud logging are suppressed.
 * - Private tools registered in the private tool catalog become accessible to the agent.
 *
 * When Private Mode is disabled:
 * - Private tools are guarded and blocked from invocation.
 * - Standard operation resumes.
 */

export interface PrivateToolDefinition {
  name: string;
  description: string;
  category: 'security' | 'vault' | 'airgap' | 'local_eval' | 'custom';
  tags?: string[];
}

const DEFAULT_PRIVATE_TOOLS: PrivateToolDefinition[] = [
  {
    name: 'private_code_vault',
    description: 'Secure, encrypted local vault for sensitive codebase secrets and private source tokens.',
    category: 'vault',
    tags: ['encryption', 'local-only'],
  },
  {
    name: 'private_credential_store',
    description: 'Isolated credential and token manager with zero network transmission.',
    category: 'security',
    tags: ['credentials', 'isolated'],
  },
  {
    name: 'private_local_eval',
    description: 'On-device air-gapped test runner and AST evaluator for sensitive algorithms.',
    category: 'local_eval',
    tags: ['evaluation', 'airgap'],
  },
  {
    name: 'private_airgap_fetch',
    description: 'Internal-only mock request handler preventing external socket leaks.',
    category: 'airgap',
    tags: ['networking', 'mock'],
  },
];

// Persistent state storage path
const PLATFORM_DIR = path.join(process.cwd(), '.platform');
const STATE_FILE = path.join(PLATFORM_DIR, 'private_mode.json');

let _inMemoryEnabled: boolean | null = null;
const _toolRegistry = new Map<string, PrivateToolDefinition>();

// Seed default scaffolding private tools
for (const tool of DEFAULT_PRIVATE_TOOLS) {
  _toolRegistry.set(tool.name, tool);
}

function loadPersistedState(): boolean {
  if (process.env.OPENCODE_PRIVATE_MODE === '1' || process.env.OPENCODE_PRIVATE_MODE === 'true') {
    return true;
  }
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      if (typeof data.enabled === 'boolean') {
        return data.enabled;
      }
    }
  } catch {
    // Ignore read errors, fall back to false
  }
  return false;
}

function persistState(enabled: boolean): void {
  try {
    if (!fs.existsSync(PLATFORM_DIR)) {
      fs.mkdirSync(PLATFORM_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled, updatedAt: Date.now() }, null, 2), 'utf-8');
  } catch {
    // Non-blocking in read-only / restricted environments
  }
}

/** Check whether Private Mode is currently active */
export function isPrivateModeEnabled(): boolean {
  if (_inMemoryEnabled === null) {
    _inMemoryEnabled = loadPersistedState();
  }
  return _inMemoryEnabled;
}

/** Explicitly enable or disable Private Mode */
export function setPrivateMode(enabled: boolean): boolean {
  _inMemoryEnabled = enabled;
  persistState(enabled);
  return _inMemoryEnabled;
}

/** Toggle Private Mode state */
export function togglePrivateMode(): boolean {
  return setPrivateMode(!isPrivateModeEnabled());
}

/** Register a tool into the private tools catalog */
export function registerPrivateTool(tool: PrivateToolDefinition): void {
  _toolRegistry.set(tool.name, tool);
}

/** Check if a given tool name is registered as a private tool */
export function isToolPrivate(toolName: string): boolean {
  return _toolRegistry.has(toolName);
}

/** List all registered private tools */
export function getPrivateTools(): PrivateToolDefinition[] {
  return Array.from(_toolRegistry.values());
}

/**
 * Guard execution of a tool.
 * Returns { allowed: true } if invocation is permitted.
 * If the tool is private but Private Mode is disabled, returns { allowed: false, reason: '...' }.
 */
export function guardToolExecution(toolName: string): { allowed: boolean; reason?: string } {
  if (isToolPrivate(toolName) && !isPrivateModeEnabled()) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" is a Private Tool. You must enable Private Mode in OpenCode before invoking it.`,
    };
  }
  return { allowed: true };
}

/** Whether external telemetry and outbound cloud logging should be suppressed */
export function shouldSuppressExternalLogging(): boolean {
  return isPrivateModeEnabled();
}

/** Reset in-memory state (useful for tests) */
export function _resetPrivateModeState(): void {
  _inMemoryEnabled = null;
  _toolRegistry.clear();
  for (const tool of DEFAULT_PRIVATE_TOOLS) {
    _toolRegistry.set(tool.name, tool);
  }
}
