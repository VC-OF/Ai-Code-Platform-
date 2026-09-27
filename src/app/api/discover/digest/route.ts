import { NextRequest, NextResponse } from 'next/server';
import { createDigest, ensureDailyDigest, listDigests, readDigest, localDate, startDigestScheduler } from '@/lib/discover/digest';
import { loadSettings } from '@/lib/discover/config';

export const runtime = 'nodejs';

const ROOT = process.cwd();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/discover/digest[?date=YYYY-MM-DD] → that day's (default: latest) "Today in AI" digest + available dates */
export async function GET(req: NextRequest) {
  startDigestScheduler(ROOT);
  const date = req.nextUrl.searchParams.get('date');
  if (date && !DATE_RE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  // Today's digest also starts on the first request after the digest hour,
  // not only from the timer — in the background, so this answers at once
  const today = localDate(Date.now());
  const digestHour = loadSettings(ROOT).digestHour;
  const building = !readDigest(ROOT, today) && new Date().getHours() >= digestHour;
  if (building) void ensureDailyDigest(ROOT).catch(() => null);
  const dates = listDigests(ROOT);
  const digest = readDigest(ROOT, date ?? dates[0] ?? '');
  return NextResponse.json({ digest, dates, today, digestHour, building });
}

let lastManual = 0;

/** POST /api/discover/digest → build today's digest now (at most once a minute) */
export async function POST() {
  if (Date.now() - lastManual < 60_000) {
    return NextResponse.json({ error: 'A digest was just built — try again in a minute.' }, { status: 429 });
  }
  lastManual = Date.now();
  try {
    const digest = await createDigest(ROOT);
    return NextResponse.json({ digest, dates: listDigests(ROOT) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
