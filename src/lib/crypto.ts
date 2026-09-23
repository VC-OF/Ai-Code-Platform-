import crypto from "crypto";

/**
 * Simple at-rest encryption for project env vars / secrets.
 * Uses AES-256-GCM with a key derived from SETTINGS_ENCRYPTION_KEY
 * (server-only env var, never sent to the client).
 *
 * In production you'd swap this for a KMS-backed secret manager,
 * but this demonstrates the correct pattern: secrets are encrypted
 * on disk/DB and only ever decrypted server-side, right before
 * being injected into a sandboxed process's environment.
 */

function getKey(): Buffer {
  const secret =
    process.env.SETTINGS_ENCRYPTION_KEY ||
    "dev-only-insecure-default-key-change-me";
  return crypto.createHash("sha256").update(secret).digest();
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

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const encrypted = buf.subarray(28);
  const key = getKey();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function mask(encryptedValue: string): string {
  return "••••••••";
}
