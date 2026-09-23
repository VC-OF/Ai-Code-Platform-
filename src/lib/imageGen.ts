/**
 * Image generation for the agent — free/open providers only.
 *
 * Primary: Pollinations (keyless, Flux-based, simple GET API).
 * Fallback: Hugging Face Inference API (FLUX.1-schnell) when
 * HUGGINGFACE_API_KEY is configured.
 *
 * Both endpoints are fixed hosts we chose (not LLM-controlled URLs), so the
 * webTools SSRF guard is not needed here; size and time caps still apply.
 */

const GENERATION_TIMEOUT_MS = 60_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export interface ImageGenOptions {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
  /** Pollinations model name; "flux" is the sensible default */
  model?: string;
}

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
  provider: string;
  width: number;
  height: number;
}

export function buildPollinationsUrl(opts: ImageGenOptions): string {
  const width = clampDim(opts.width ?? 1024);
  const height = clampDim(opts.height ?? 1024);
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    model: opts.model || "flux",
    nologo: "true",
  });
  if (opts.seed !== undefined) params.set("seed", String(opts.seed));
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(
    opts.prompt
  )}?${params.toString()}`;
}

function clampDim(n: number): number {
  return Math.max(64, Math.min(2048, Math.round(n)));
}

async function fetchImage(
  url: string,
  init: RequestInit,
  provider: string
): Promise<{ bytes: Buffer; contentType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${provider}: HTTP ${res.status} ${detail.slice(0, 200)}`);
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/^image\//i.test(contentType)) {
      throw new Error(`${provider}: expected an image, got ${contentType}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`${provider}: image exceeds ${MAX_IMAGE_BYTES} bytes`);
    }
    if (buf.byteLength === 0) {
      throw new Error(`${provider}: empty image response`);
    }
    return { bytes: buf, contentType };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateImage(
  opts: ImageGenOptions
): Promise<GeneratedImage> {
  const width = clampDim(opts.width ?? 1024);
  const height = clampDim(opts.height ?? 1024);
  const errors: string[] = [];

  // ── Pollinations (keyless) ────────────────────────────────────────────────
  try {
    const { bytes, contentType } = await fetchImage(
      buildPollinationsUrl(opts),
      { headers: { "User-Agent": "OpenCodeAgent/1.0" } },
      "pollinations"
    );
    return { bytes, contentType, provider: "pollinations", width, height };
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // ── Hugging Face fallback (needs a key) ───────────────────────────────────
  const hfKey = process.env.HUGGINGFACE_API_KEY;
  if (hfKey) {
    try {
      const { bytes, contentType } = await fetchImage(
        "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${hfKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            inputs: opts.prompt,
            parameters: { width, height, seed: opts.seed },
          }),
        },
        "huggingface"
      );
      return { bytes, contentType, provider: "huggingface", width, height };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    errors.push(
      "huggingface: skipped (set HUGGINGFACE_API_KEY to enable fallback)"
    );
  }

  throw new Error(`Image generation failed — ${errors.join(" | ")}`);
}
