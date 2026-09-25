import dns from "dns/promises";

/**
 * Web tools for the agent: URL fetching and web search.
 *
 * Security model: the LLM controls the URLs, so every request is treated as
 * hostile. Only http/https, every hostname is DNS-resolved and rejected if
 * any address is private/loopback/link-local (SSRF guard), redirects are
 * re-validated hop by hop, and responses are size- and time-capped.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_500_000; // 1.5 MB raw cap
const MAX_TEXT_CHARS = 20_000;        // What the model actually sees
const MAX_REDIRECTS = 3;

// ─── SSRF guard ──────────────────────────────────────────────────────────────

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // WHATWG URL normalizes [::ffff:127.0.0.1] to [::ffff:7f00:1] — decode the
  // hex form of IPv4-mapped addresses so it can't bypass the IPv4 check
  const mappedHex = lower.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80") ||
    // IPv4-mapped (::ffff:a.b.c.d)
    (lower.includes(".") && isPrivateIpv4(lower.split(":").pop() ?? ""))
  );
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http/https URLs are allowed (got ${url.protocol})`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$/i.test(host) || host.endsWith(".local")) {
    throw new Error("Requests to local hosts are not allowed");
  }

  // Literal IPs
  if (/^[\d.]+$/.test(host)) {
    if (isPrivateIpv4(host)) throw new Error("Requests to private IPs are not allowed");
    return;
  }
  if (host.includes(":")) {
    if (isPrivateIpv6(host)) throw new Error("Requests to private IPs are not allowed");
    return;
  }

  // Hostnames: resolve and check every address (anti DNS-rebinding-ish)
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dns.lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  for (const { address, family } of addrs) {
    const bad = family === 4 ? isPrivateIpv4(address) : isPrivateIpv6(address);
    if (bad) {
      throw new Error(`Host ${host} resolves to a private address — blocked`);
    }
  }
}

// ─── Capped fetch with per-hop redirect validation ───────────────────────────

async function safeFetch(rawUrl: string): Promise<{ body: string; finalUrl: string; contentType: string }> {
  let current = new URL(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; OpenCodeAgent/1.0)",
          Accept: "text/html,application/json,text/plain,*/*",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect without location (HTTP ${res.status})`);
        current = new URL(loc, current);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Empty response body");

      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }

      const body = Buffer.concat(chunks).toString("utf8");
      return {
        body,
        finalUrl: current.toString(),
        contentType: res.headers.get("content-type") ?? "",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

// ─── HTML → readable text ────────────────────────────────────────────────────

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

// ─── Public tools ────────────────────────────────────────────────────────────

export async function fetchUrl(rawUrl: string): Promise<{
  url: string;
  contentType: string;
  text: string;
  truncated: boolean;
}> {
  const { body, finalUrl, contentType } = await safeFetch(rawUrl);

  const isHtml = /text\/html/i.test(contentType) || /^\s*</.test(body);
  const text = isHtml ? htmlToText(body) : body;
  const truncated = text.length > MAX_TEXT_CHARS;

  return {
    url: finalUrl,
    contentType,
    text: truncated ? text.slice(0, MAX_TEXT_CHARS) + "\n...[truncated]" : text,
    truncated,
  };
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Keyless web search via DuckDuckGo's lite HTML endpoint. */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const { body } = await safeFetch(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`
  );

  const results: SearchResult[] = [];
  // lite.duckduckgo.com rows: <a rel="nofollow" href="URL" class='result-link'>TITLE</a>
  // followed (in the next table row) by <td class='result-snippet'>SNIPPET</td>
  const anchorRe =
    /<a[^>]+href=["']([^"']+)["'][^>]*class=["']result-link["'][^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class=["']result-snippet["'][^>]*>([\s\S]*?)<\/td>/i;

  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(body)) !== null && results.length < 8) {
    let url = m[1];
    // DDG sometimes wraps: //duckduckgo.com/l/?uddg=<encoded>
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch {}
    }
    if (url.startsWith("//")) url = "https:" + url;
    if (!/^https?:\/\//i.test(url)) continue;

    // The snippet sits shortly after the anchor, before the next result
    const after = body.slice(anchorRe.lastIndex, anchorRe.lastIndex + 2000);
    const sm = after.match(snippetRe);

    results.push({
      title: htmlToText(m[2]).slice(0, 200),
      url,
      snippet: htmlToText(sm?.[1] ?? "").slice(0, 300),
    });
  }

  return results;
}
