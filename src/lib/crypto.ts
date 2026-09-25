import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Simple at-rest encryption for project env vars / secrets.
 * Uses AES-256-GCM with a key derived from SETTINGS_ENCRYPTION_KEY
 * (server-only env var, never sent to the client).
 *
 * If SETTINGS_ENCRYPTION_KEY is unset, a random key is generated once and
 * persisted to .platform/settings.key (mode 0600 where supported), then
 * reused. Values encrypted with the old hardcoded dev key still decrypt via
 * a legacy fallback (they are not re-encrypted).
 */

const LEGACY_SECRET = "dev-only-insecure-default-key-change-me";
const KEY_FILE = path.join(process.cwd(), ".platform", "settings.key");

let cachedKey: Buffer | null = null;

function deriveKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function loadOrCreateSecret(): string {
  try {
    const existing = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (existing) return existing;
  } catch {
    // not created yet
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  try {
    // "wx" so a concurrent creator wins and we re-read its key
    fs.writeFileSync(KEY_FILE, secret, { mode: 0o600, flag: "wx" });
  } catch {
    return fs.readFileSync(KEY_FILE, "utf8").trim();
  }
  return secret;
}

function getKey(): Buffer {
  if (process.env.SETTINGS_ENCRYPTION_KEY) {
    return deriveKey(process.env.SETTINGS_ENCRYPTION_KEY);
  }
  if (!cachedKey) cachedKey = deriveKey(loadOrCreateSecret());
  return cachedKey;
}

export function encrypt(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptWith(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function decrypt(payload: string): string {
  try {
    return decryptWith(getKey(), payload);
  } catch (err) {
    // Backward compatibility: data written with the old hardcoded dev key.
    try {
      return decryptWith(deriveKey(LEGACY_SECRET), payload);
    } catch {
      throw err;
    }
  }
}

export function mask(encryptedValue: string): string {
  void encryptedValue;
  return "••••••••";
}
