import { execFileSync } from 'child_process';

/**
 * Sandbox image resolution — single source of truth for safeExec,
 * dockerService and the docker exec route allowlist.
 *
 * Order: SANDBOX_IMAGE env > POLYGLOT_SANDBOX_IMAGE (if built locally) > node:20.
 * The polyglot image (docker/sandbox/Dockerfile, `npm run sandbox:build`)
 * adds python/pip/uv, rust, go, java/maven, git and compilers.
 */
export const POLYGLOT_SANDBOX_IMAGE = 'open-code-sandbox:1';
export const FALLBACK_SANDBOX_IMAGE = 'node:20';

/** Named volume holding cargo/go/pip/maven caches, mounted at /cache. */
export const SANDBOX_CACHE_VOLUME = 'open-code-sandbox-cache';
export const SANDBOX_CACHE_MOUNT = '/cache';

export type ImageChecker = (image: string) => boolean;

const PRESENT_TTL_MS = 10 * 60_000;
const ABSENT_TTL_MS = 30_000; // re-check soon so a fresh build is picked up
let cache: { present: boolean; at: number } | null = null;

function dockerImageExists(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

/** Cached check whether the polyglot image exists locally. */
export function isPolyglotImageBuilt(checker: ImageChecker = dockerImageExists): boolean {
  const now = Date.now();
  if (cache && now - cache.at < (cache.present ? PRESENT_TTL_MS : ABSENT_TTL_MS)) {
    return cache.present;
  }
  const present = checker(POLYGLOT_SANDBOX_IMAGE);
  cache = { present, at: now };
  return present;
}

export function resetSandboxImageCache(): void {
  cache = null;
}

export function getSandboxImage(checker?: ImageChecker): string {
  const fromEnv = process.env.SANDBOX_IMAGE?.trim();
  if (fromEnv) return fromEnv;
  return isPolyglotImageBuilt(checker) ? POLYGLOT_SANDBOX_IMAGE : FALLBACK_SANDBOX_IMAGE;
}

/** Images the platform itself may run (exec route allowlist base set). */
export function knownSandboxImages(): string[] {
  const list = [POLYGLOT_SANDBOX_IMAGE, FALLBACK_SANDBOX_IMAGE, 'node:20-slim'];
  const fromEnv = process.env.SANDBOX_IMAGE?.trim();
  if (fromEnv) list.push(fromEnv);
  return list;
}

/** docker run flags that mount the shared toolchain cache volume. */
export function sandboxCacheArgs(): string[] {
  return ['-v', `${SANDBOX_CACHE_VOLUME}:${SANDBOX_CACHE_MOUNT}`];
}

export const SANDBOX_BUILD_HINT = 'Run npm run sandbox:build for Python/Rust/Go/Java support';
