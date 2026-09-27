import { NextRequest, NextResponse } from 'next/server';
import { getDiscoverFeed, clearDiscoverCache, SOURCES } from '@/lib/discover';
import { loadSettings, saveSettings, detectRepo, resolveGithubToken, DEFAULT_SETTINGS, LIMITS } from '@/lib/discover/config';
import { startDigestScheduler } from '@/lib/discover/digest';

export const runtime = 'nodejs';

const ROOT = process.cwd();

async function respond(refresh?: boolean | string) {
  startDigestScheduler(ROOT);
  const feed = await getDiscoverFeed(ROOT, { refresh });
  return NextResponse.json({
    ...feed,
    settings: loadSettings(ROOT),
    defaults: DEFAULT_SETTINGS,
    limits: LIMITS,
    detectedRepo: detectRepo(ROOT),
    githubToken: !!(await resolveGithubToken()),
  });
}

/** GET /api/discover → feed from cache (fetching only what is due) + settings.
 *  Never forces a refresh: GETs are reachable cross-origin. */
export async function GET() {
  return respond();
}

/** POST /api/discover { refresh: true | '<sourceId>' } → forced refresh (CSRF-checked by the proxy) */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { refresh?: unknown };
  const r = body.refresh;
  const refresh = r === true ? true : typeof r === 'string' && SOURCES.some((s) => s.id === r) ? r : undefined;
  if (!refresh) return NextResponse.json({ error: 'refresh must be true or a source id' }, { status: 400 });
  return respond(refresh);
}

/** PUT /api/discover { keywords, newsKeywords, watchedRepos, topics, repo, digestHour } → saved settings; the cache is cleared */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Expected a JSON object with the settings' }, { status: 400 });
  }
  try {
    const settings = saveSettings(ROOT, body);
    clearDiscoverCache(ROOT);
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
