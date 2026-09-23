import { NextResponse } from "next/server";
import { PROVIDERS, providerBaseURL } from "@/lib/models";
import { getDecryptedEnv } from "@/lib/settingsStore";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const PING_TIMEOUT_MS = 1500;

interface ProviderStatus {
  id: string;
  label: string;
  kind: "cloud" | "local";
  baseURL: string;
  keyEnv: string | null;
  prefix: string | null;
  /** Cloud: key present (env or settings). Local: endpoint responded. */
  available: boolean;
  /** Local providers: model ids reported by the endpoint */
  models?: string[];
}

async function pingLocal(baseURL: string): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseURL}/models`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const models: string[] = (data?.data ?? [])
      .map((m: { id?: string }) => m.id)
      .filter(Boolean)
      .slice(0, 25);
    return models;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const settingsKeys = await getDecryptedEnv().catch(() => ({} as Record<string, string>));

  const providers: ProviderStatus[] = await Promise.all(
    PROVIDERS.map(async (p) => {
      const baseURL = providerBaseURL(p);
      if (p.kind === "local") {
        const models = await pingLocal(baseURL);
        return {
          ...p,
          baseURL,
          available: models !== null,
          models: models ?? undefined,
        };
      }
      const hasKey = !!(p.keyEnv && (settingsKeys[p.keyEnv] || process.env[p.keyEnv]));
      return { ...p, baseURL, available: hasKey };
    })
  );

  // Usage per model (all projects) so the UI can show where tokens went
  let usageByModel: {
    model: string;
    calls: number;
    total_tokens: number;
    cost_usd: number;
  }[] = [];
  try {
    usageByModel = getDb()
      .prepare(
        `SELECT model,
                COUNT(*) as calls,
                SUM(total_tokens) as total_tokens,
                SUM(cost_usd) as cost_usd
         FROM usage_log GROUP BY model ORDER BY total_tokens DESC LIMIT 20`
      )
      .all() as typeof usageByModel;
  } catch {}

  return NextResponse.json({
    providers,
    usageByModel,
    fallbacks: (process.env.LLM_FALLBACKS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });
}
