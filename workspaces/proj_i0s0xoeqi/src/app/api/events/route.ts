import { NextRequest, NextResponse } from "next/server";
import {
  closeOpenWebsiteVisits,
  getAttempt,
  pushEvent,
  recordAppActivity,
  recordSearch,
  recordWebsiteVisit,
  setStatus,
} from "@/lib/store-impl";
import { getCurrentSession } from "@/lib/session";
import { detectSite } from "@/lib/known-sites";
import type { SecurityEventType, SiteCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_TYPES: SecurityEventType[] = [
  "tab_switch",
  "fullscreen_exit",
  "fullscreen_enter",
  "copy_attempt",
  "paste_attempt",
  "cut_attempt",
  "right_click",
  "devtools_open",
  "devtools_close",
  "window_blur",
  "window_focus",
  "face_missing",
  "multiple_faces",
  "screenshot_attempt",
  "idle_timeout",
  "disconnected",
  "reconnected",
  "auto_submit",
  "terminated",
  "cheat_key",
];

export async function POST(req: NextRequest) {
  const s = await getCurrentSession();
  if (!s)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const {
    attemptId,
    type,
    detail,
    severity,
    website,
    url,
    query,
    appName,
    detectionMethod,
  } = body as {
    attemptId: string;
    type: SecurityEventType;
    detail?: string;
    severity?: "low" | "medium" | "high" | "critical";
    website?: string;
    url?: string;
    query?: string;
    appName?: string;
    detectionMethod?: "visible" | "heartbeat" | "synthetic";
  };
  if (!attemptId || !type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  const a = getAttempt(attemptId);
  if (!a)
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
  if (s.role === "candidate" && a.candidateId !== s.sub) {
    return NextResponse.json({ error: "Not your attempt" }, { status: 403 });
  }

  // 1) Push the security event.
  const event = pushEvent(attemptId, { type, detail, severity });

  // 2) Mark attempt as suspicious on high-severity events.
  if (severity === "high" || severity === "critical") {
    setStatus(attemptId, "suspicious");
  }

  // 3) Record website visit.
  if (
    url &&
    (type === "window_blur" || type === "tab_switch" || type === "cheat_key")
  ) {
    const detected = detectSite(url);
    if (detected) {
      const cat: SiteCategory = detected.category;
      recordWebsiteVisit(attemptId, {
        website: website || detected.name,
        url,
        category: cat,
      });
      if (query) {
        recordSearch(attemptId, {
          engine: website || detected.name,
          query,
          url: url.includes("?")
            ? url
            : `${url}?q=${encodeURIComponent(query)}`,
        });
      }
    } else {
      recordWebsiteVisit(attemptId, {
        website: website || "Unknown",
        url,
        category: "other",
      });
    }
  }
  // Close open website visits on focus.
  if (type === "window_focus" || type === "fullscreen_enter") {
    closeOpenWebsiteVisits(attemptId);
  }
  // 4) Application activity.
  if (appName && (type === "window_blur" || type === "cheat_key")) {
    recordAppActivity(attemptId, {
      appName,
      detectionMethod: detectionMethod ?? "heartbeat",
    });
  }
  if (appName && (type === "window_focus" || type === "fullscreen_enter")) {
    recordAppActivity(attemptId, {
      appName,
      detectionMethod: detectionMethod ?? "heartbeat",
    });
  }

  return NextResponse.json({ ok: true, event });
}
