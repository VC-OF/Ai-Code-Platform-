import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { getSandboxImage, isPolyglotImageBuilt, sandboxCacheArgs, SANDBOX_BUILD_HINT } from './sandboxImage';

const execFileAsync = promisify(execFile);

export interface DockerInfo {
  available: boolean;
  version?: string;
  serverVersion?: string;
  containersRunning: number;
  containersTotal: number;
  imagesCount: number;
  cpus?: number;
  memoryGiB?: string;
  osType?: string;
  defaultImage: string;
  /** open-code-sandbox:1 (python/rust/go/java) exists locally */
  polyglotImageBuilt?: boolean;
  sandboxHint?: string;
  error?: string;
}

export interface DockerContainer {
  id: string;
  image: string;
  command: string;
  status: string;
  ports: string;
  names: string;
}


let cachedStatus: { info: DockerInfo; timestamp: number } | null = null;
const CACHE_TTL_MS = 10_000;

/**
 * Check if Docker CLI is installed and the daemon is reachable.
 * Caches results for 10s to keep UI and API fast.
 */
export async function getDockerStatus(forceRefresh = false): Promise<DockerInfo> {
  const now = Date.now();
  if (!forceRefresh && cachedStatus && now - cachedStatus.timestamp < CACHE_TTL_MS) {
    return cachedStatus.info;
  }

  try {
    const { stdout: versionOut } = await execFileAsync('docker', ['--version'], { timeout: 4000 });
    const version = versionOut.trim();

    const { stdout: infoOut } = await execFileAsync(
      'docker',
      ['info', '--format', '{{json .}}'],
      { timeout: 6000 }
    );

    let parsed: {
      MemTotal?: number; ServerVersion?: string; ContainersRunning?: number;
      Containers?: number; Images?: number; NCPU?: number; OSType?: string;
    } = {};
    try {
      parsed = JSON.parse(infoOut);
    } catch {
      // Fallback text parsing if JSON format is unsupported in older daemons
    }

    const memoryBytes = parsed.MemTotal || 0;
    const memoryGiB = memoryBytes > 0 ? (memoryBytes / (1024 * 1024 * 1024)).toFixed(2) : undefined;

    const info: DockerInfo = {
      available: true,
      version,
      serverVersion: parsed.ServerVersion || undefined,
      containersRunning: parsed.ContainersRunning ?? 0,
      containersTotal: parsed.Containers ?? 0,
      imagesCount: parsed.Images ?? 0,
      cpus: parsed.NCPU || undefined,
      memoryGiB,
      osType: parsed.OSType || 'linux',
      defaultImage: getSandboxImage(),
      polyglotImageBuilt: isPolyglotImageBuilt(),
      sandboxHint: isPolyglotImageBuilt() ? undefined : SANDBOX_BUILD_HINT,
    };

    cachedStatus = { info, timestamp: now };
    return info;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const info: DockerInfo = {
      available: false,
      containersRunning: 0,
      containersTotal: 0,
      imagesCount: 0,
      defaultImage: getSandboxImage(),
      polyglotImageBuilt: isPolyglotImageBuilt(),
      sandboxHint: isPolyglotImageBuilt() ? undefined : SANDBOX_BUILD_HINT,
      error: errorMsg.includes('connect')
        ? 'Docker daemon is not running. Start Docker Desktop.'
        : 'Docker CLI not found or failed to execute.',
    };
    cachedStatus = { info, timestamp: now };
    return info;
  }
}

/**
 * List active Docker containers formatted for display.
 */
export async function listDockerContainers(all = false): Promise<DockerContainer[]> {
  try {
    const args = ['ps', '--format', '{{json .}}'];
    if (all) args.push('-a');

    const { stdout } = await execFileAsync('docker', args, { timeout: 6000 });
    const lines = stdout.trim().split('\n').filter(Boolean);

    return lines.map((line) => {
      try {
        const item = JSON.parse(line);
        return {
          id: item.ID || '',
          image: item.Image || '',
          command: item.Command || '',
          status: item.Status || '',
          ports: item.Ports || '',
          names: item.Names || '',
        };
      } catch {
        return {
          id: '',
          image: line,
          command: '',
          status: '',
          ports: '',
          names: '',
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Format Windows or Unix workspace path for safe Docker volume binding.
 */
export function formatDockerMount(workspaceRoot: string): string {
  // Normalize Windows paths like "C:\ai-code-platform\workspaces\proj_123" to "c:/ai-code-platform/workspaces/proj_123"
  const resolved = path.resolve(workspaceRoot).replace(/\\/g, '/');
  return `${resolved}:/workspace`;
}

/**
 * Execute command inside an isolated Docker container with the workspace mounted.
 */
export async function execInDocker(
  command: string,
  workspaceRoot: string,
  options?: {
    image?: string;
    network?: 'none' | 'bridge' | 'host';
    extraEnv?: Record<string, string>;
    timeoutMs?: number;
  }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const image = options?.image || getSandboxImage();
  const network = options?.network || 'bridge';
  const mount = formatDockerMount(workspaceRoot);
  const containerName = `opencode_exec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(options?.extraEnv ?? {})) {
    if (/^[A-Z0-9_]+$/i.test(key)) {
      envFlags.push('-e', `${key}=${value}`);
    }
  }

  const args = [
    'run',
    '--rm',
    '--init',
    '--name',
    containerName,
    '--network',
    network,
    '--memory',
    '2g',
    '--cpus',
    '2',
    '-v',
    mount,
    ...sandboxCacheArgs(),
    '-w',
    '/workspace',
    '-e',
    // Not the project dir: `cargo init/new` refuses to run in $HOME
    'HOME=/tmp/home',
    '-e',
    'PYTHONUSERBASE=/workspace/.local',
    '-e',
    'CI=true',
    ...envFlags,
    image,
    'sh',
    '-c',
    command,
  ];

  try {
    const result = await execFileAsync('docker', args, {
      timeout: options?.timeoutMs || 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: 0,
    };
  } catch (caught: unknown) {
    const err = caught as {
      killed?: boolean; stdout?: string; stderr?: string; message?: string; code?: unknown;
    };
    // On timeout execFile only kills the docker CLI; the container keeps running
    if (err?.killed) {
      execFile('docker', ['kill', containerName], () => {});
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || '',
      exitCode: typeof err.code === 'number' ? err.code : 1,
    };
  }
}
