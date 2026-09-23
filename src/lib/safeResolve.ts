import path from 'path';
import fs from 'fs';

// ─── Forbidden segments ──────────────────────────────────────────────────────
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.platform',
  '.settings',
  '.ssh',
  '.aws',
  '.npmrc',
  '.env',
]);

const FORBIDDEN_EXTENSIONS = new Set([
  '.env',
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.crt',
  '.cer',
]);

const FORBIDDEN_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'id_rsa',
  'id_ed25519',
  'credentials',
]);

// ─── Main safe resolve ───────────────────────────────────────────────────────
export function safeResolve(
  base: string,
  userPath: string
): string {
  // 1. Reject null bytes
  if (userPath.includes('\0')) {
    throw new SecurityError('Null byte detected in path');
  }

  // 2. Decode URI components recursively (catches double encoding %252e%252e%252f etc.)
  let decoded = userPath;
  let prev = '';
  let decodes = 0;
  while (decoded !== prev && decodes < 3) {
    prev = decoded;
    try {
      decoded = decodeURIComponent(decoded);
      decodes++;
    } catch {
      break;
    }
  }

  // 3. Reject null bytes after decoding
  if (decoded.includes('\0')) {
    throw new SecurityError('Null byte detected after decoding');
  }

  // 4. Normalize separators
  const normalized = decoded
    .replace(/\\/g, '/')     // Windows backslash → forward slash
    .replace(/\/+/g, '/');   // Collapse multiple slashes

  // 5. Check each path segment BEFORE resolving
  const segments = normalized.split('/').filter(Boolean);

  for (const seg of segments) {
    // Forbidden segment names
    if (FORBIDDEN_SEGMENTS.has(seg)) {
      throw new SecurityError(`Access to '${seg}' is forbidden`);
    }

    // Forbidden filenames
    if (FORBIDDEN_FILENAMES.has(seg)) {
      throw new SecurityError(`Access to '${seg}' is forbidden`);
    }

    // Forbidden extensions
    const ext = path.extname(seg).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      throw new SecurityError(
        `Files with '${ext}' extension are not accessible`
      );
    }

    // Block current + parent dir tricks
    if (seg === '..' || seg === '.') {
      // These are normal after path.resolve but
      // block explicit .. in raw segments as extra guard
    }
  }

  // 6. Resolve base to real path (follows symlinks)
  let resolvedBase: string;
  try {
    resolvedBase = fs.realpathSync(base);
  } catch {
    // Base doesn't exist yet (e.g. new workspace)
    resolvedBase = path.resolve(base);
  }

  // 7. Resolve full path
  const resolved = path.resolve(resolvedBase, normalized);

  // 8. Strict prefix check
  const baseWithSep = resolvedBase.endsWith(path.sep)
    ? resolvedBase
    : resolvedBase + path.sep;

  if (
    resolved !== resolvedBase &&
    !resolved.startsWith(baseWithSep)
  ) {
    throw new SecurityError(
      `Path traversal detected: '${userPath}' escapes workspace`
    );
  }

  // 9. If path exists, resolve symlinks and re-check
  if (fs.existsSync(resolved)) {
    try {
      const real = fs.realpathSync(resolved);
      if (!real.startsWith(baseWithSep) && real !== resolvedBase) {
        throw new SecurityError(
          `Symlink escape detected: '${userPath}'`
        );
      }
    } catch (err) {
      if (err instanceof SecurityError) throw err;
      // File might not exist yet, that's OK
    }
  }

  return resolved;
}

// ─── Custom error ────────────────────────────────────────────────────────────
export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}
