// Priority rules for the text-to-speech queue, kept pure for testing.
//   high   (questions, "read this message")  interrupts anything lower and jumps the queue
//   normal (replies, done, errors)           interrupts progress chatter, queues otherwise
//   low    (progress narration)              never interrupts; only the newest waits, and it
//                                            goes stale after a few seconds

export type SpeechPriority = 'low' | 'normal' | 'high';

export interface QueuedSpeech {
  id: number;
  text: string;
  priority: SpeechPriority;
  /** Enqueue time (ms) */
  at: number;
  /** Caller label, e.g. which chat message is being read */
  tag?: string;
}

const RANK: Record<SpeechPriority, number> = { low: 0, normal: 1, high: 2 };
export const MAX_QUEUE = 12;
export const LOW_PRIORITY_MAX_AGE_MS = 6_000;

export function enqueueSpeech(
  queue: readonly QueuedSpeech[],
  item: QueuedSpeech,
  current: Pick<QueuedSpeech, 'priority'> | null
): { queue: QueuedSpeech[]; interrupt: boolean } {
  const rank = RANK[item.priority];
  const interrupt = !!current && RANK[current.priority] < rank;

  // Any waiting progress update is superseded by whatever comes next
  let next = queue.filter((q) => q.priority !== 'low');
  if (item.priority === 'low') {
    // Progress is only worth saying if nothing more important is waiting
    if (next.length > 0) return { queue: next, interrupt: false };
    next = [item];
  } else {
    // Stable insert: after everything of equal or higher priority
    let at = next.length;
    for (let i = 0; i < next.length; i++) {
      if (RANK[next[i].priority] < rank) {
        at = i;
        break;
      }
    }
    next = [...next.slice(0, at), item, ...next.slice(at)];
  }
  if (next.length > MAX_QUEUE) {
    // Drop the oldest lowest-priority items first
    const sorted = [...next].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.at - b.at);
    const drop = new Set(sorted.slice(0, next.length - MAX_QUEUE).map((q) => q.id));
    next = next.filter((q) => !drop.has(q.id));
  }
  return { queue: next, interrupt };
}

/** Take the next item to speak, discarding stale progress updates. */
export function nextSpeech(
  queue: readonly QueuedSpeech[],
  now: number,
  maxLowAgeMs = LOW_PRIORITY_MAX_AGE_MS
): { item: QueuedSpeech | null; queue: QueuedSpeech[] } {
  const fresh = queue.filter((q) => q.priority !== 'low' || now - q.at <= maxLowAgeMs);
  if (!fresh.length) return { item: null, queue: [] };
  const [item, ...rest] = fresh;
  return { item, queue: rest };
}
