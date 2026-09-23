import { NextRequest } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { subscribe } from "@/lib/store-impl";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events stream for the invigilator live dashboard.
export async function GET(_req: NextRequest) {
  const s = await getCurrentSession();
  if (!s) return new Response("Unauthorized", { status: 401 });
  if (s.role === "candidate") return new Response("Forbidden", { status: 403 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: any) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
      // Initial hello
      send({ type: "hello", ts: Date.now() });
      const unsubscribe = subscribe(send);
      // Heartbeat
      const hb = setInterval(() => {
        try {
          controller.enqueue(enc.encode(`: hb\n\n`));
        } catch {
          /* closed */
        }
      }, 15000);
      // Cleanup on close
      (controller as any)._cleanup = () => {
        clearInterval(hb);
        unsubscribe();
      };
    },
    cancel(reason) {
      // try to clean up
      try {
        (this as any)._cleanup?.();
      } catch {
        /* noop */
      }
      void reason;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
