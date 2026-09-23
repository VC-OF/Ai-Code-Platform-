import { NextRequest, NextResponse } from 'next/server';

// ─── Rate limit store ────────────────────────────────────────────────────────
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Inline cleanup of expired entries
  for (const [k, b] of buckets.entries()) {
    if (now > b.resetAt) {
      buckets.delete(k);
    }
  }

  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count++;
  return { allowed: true };
}

// ─── Route-specific limits ───────────────────────────────────────────────────
// Sized for a local single-page app that legitimately polls status
// endpoints (preview every 2s, health every 15s) — the limits guard
// against runaway loops and remote abuse, not normal UI behavior.
const ROUTE_LIMITS: Record<
  string,
  { limit: number; windowMs: number }
> = {
  '/api/chat':        { limit: 20,  windowMs: 60_000  }, // starts LLM turns
  '/api/files':       { limit: 300, windowMs: 60_000  },
  '/api/projects':    { limit: 60,  windowMs: 60_000  },
  '/api/git':         { limit: 30,  windowMs: 60_000  },
  '/api/preview':     { limit: 240, windowMs: 60_000  }, // 2s status polling
  '/api/command':     { limit: 30,  windowMs: 60_000  },
  '/api/download':    { limit: 5,   windowMs: 60_000  },
  default:            { limit: 300, windowMs: 60_000  },
};

// ─── CSRF / cross-origin check ───────────────────────────────────────────────
/**
 * Browsers attach an Origin header to cross-origin requests (and to all
 * non-GET fetches). Any state-changing API call whose Origin doesn't match
 * our own host is CSRF — e.g. a malicious page (including an AI-generated
 * app running in the preview iframe on another port) POSTing to
 * /api/command. Non-browser clients (curl, scripts) send no Origin and are
 * unaffected.
 */
function checkOrigin(req: NextRequest): boolean {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return true;
  }

  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser client (curl, scripts)
  if (origin === 'null') return false; // sandboxed iframe / file://

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = req.headers.get('host');
  if (originHost === host) return true;

  // Optional extra origin (e.g. a separate UI dev server)
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed) {
    try {
      if (new URL(allowed).host === originHost) return true;
    } catch {}
  }

  return false;
}

// ─── Auth check ──────────────────────────────────────────────────────────────
function checkAuth(req: NextRequest): boolean {
  const requiredToken = process.env.AUTH_TOKEN;

  // Auth not configured → local dev mode, allow all
  if (!requiredToken) return true;

  // Check header first
  const headerToken = req.headers.get('x-api-key');
  if (headerToken === requiredToken) return true;

  // Check cookie
  const cookieToken = req.cookies.get('auth')?.value;
  if (cookieToken === requiredToken) return true;

  // Check bearer token
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const bearerToken = authHeader.slice(7);
    if (bearerToken === requiredToken) return true;
  }

  return false;
}

// ─── Proxy ───────────────────────────────────────────────────────────────────
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect API routes
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // ── CSRF ──
  if (!checkOrigin(req)) {
    return new NextResponse(
      JSON.stringify({ error: 'Cross-origin request rejected' }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ── Auth ──
  if (!checkAuth(req)) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthorized' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // ── Rate limit ──
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'local';

  // Find matching route limit
  const routeKey = Object.keys(ROUTE_LIMITS).find(
    (r) => r !== 'default' && pathname.startsWith(r)
  );
  const { limit, windowMs } =
    ROUTE_LIMITS[routeKey ?? 'default'];

  const { allowed, retryAfter } = rateLimit(
    `${ip}:${routeKey ?? 'default'}`,
    limit,
    windowMs
  );

  if (!allowed) {
    return new NextResponse(
      JSON.stringify({
        error: 'Too many requests',
        retryAfter,
      }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Reset': String(
            Date.now() + (retryAfter ?? 60) * 1000
          ),
        },
      }
    );
  }

  // ── Security headers ──
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  );

  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
