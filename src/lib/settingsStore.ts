import fs from "fs/promises";
import path from "path";
import { encrypt, decrypt, mask } from "./crypto";

/**
 * Small file-backed store for encrypted env vars.
 *
 * Scoping: vars can be **global** (legacy `.settings/env.json`, shared by
 * every project) or **per-project** (`.settings/env.<projectId>.json`).
 * `getDecryptedEnv(projectId)` merges the two with project values winning,
 * so existing global setups keep working.
 *
 * Encrypted values live in .settings/ which is NOT served to the client —
 * only key names + masked values ever leave the server via /api/settings.
 */

const SETTINGS_DIR = path.join(process.cwd(), ".settings");

function envFileFor(projectId?: string): string {
  if (!projectId || projectId === "global") {
    return path.join(SETTINGS_DIR, "env.json");
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    throw new Error(`Invalid project id: '${projectId}'`);
  }
  return path.join(SETTINGS_DIR, `env.${projectId}.json`);
}

type EnvStore = Record<string, string>; // key -> encrypted value

async function readStore(projectId?: string): Promise<EnvStore> {
  try {
    const raw = await fs.readFile(envFileFor(projectId), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeStore(store: EnvStore, projectId?: string) {
  await fs.mkdir(SETTINGS_DIR, { recursive: true });
  await fs.writeFile(
    envFileFor(projectId),
    JSON.stringify(store, null, 2),
    "utf8"
  );
}

export async function listEnvVarsMasked(
  projectId?: string
): Promise<{ key: string; value: string; scope: "project" | "global" }[]> {
  const globalStore = await readStore();
  const projectStore = projectId ? await readStore(projectId) : {};

  const out: { key: string; value: string; scope: "project" | "global" }[] = [];
  for (const key of Object.keys(globalStore).sort()) {
    if (!(key in projectStore)) {
      out.push({ key, value: mask(globalStore[key]), scope: "global" });
    }
  }
  for (const key of Object.keys(projectStore).sort()) {
    out.push({ key, value: mask(projectStore[key]), scope: "project" });
  }
  return out;
}

export async function setEnvVar(
  key: string,
  value: string,
  projectId?: string
) {
  if (!/^[A-Z0-9_]+$/i.test(key)) {
    throw new Error(
      "Env var keys should only contain letters, numbers, and underscores"
    );
  }
  const store = await readStore(projectId);
  store[key] = encrypt(value);
  await writeStore(store, projectId);
}

export async function deleteEnvVar(key: string, projectId?: string) {
  // Remove from the requested scope; if scoped to a project but the key
  // only exists globally, remove it there so the UI action always works
  const store = await readStore(projectId);
  if (key in store) {
    delete store[key];
    await writeStore(store, projectId);
    return;
  }
  if (projectId) {
    const globalStore = await readStore();
    if (key in globalStore) {
      delete globalStore[key];
      await writeStore(globalStore);
    }
  }
}

/** Server-only: decrypt global + project vars (project wins) for injection
 *  into a sandboxed process env. */
export async function getDecryptedEnv(
  projectId?: string
): Promise<Record<string, string>> {
  const merged: EnvStore = {
    ...(await readStore()),
    ...(projectId ? await readStore(projectId) : {}),
  };
  const out: Record<string, string> = {};
  for (const key of Object.keys(merged)) {
    out[key] = decrypt(merged[key]);
  }
  return out;
}
