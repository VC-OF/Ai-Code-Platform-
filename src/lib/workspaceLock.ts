// ─── Types ────────────────────────────────────────────────────────────────────
interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  requestedAt: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

interface LockInfo {
  projectId: string;
  acquiredAt: number;
  holder: string;       // description of who holds the lock
  timeoutHandle: ReturnType<typeof setTimeout>;
}

// ─── Per-project mutex ────────────────────────────────────────────────────────
class WorkspaceMutex {
  private locked = false;
  private queue: QueueEntry[] = [];
  private lockInfo: LockInfo | null = null;
  private readonly MAX_LOCK_MS = 10 * 60_000; // 10 min hard cap
  private readonly MAX_WAIT_MS = 2 * 60_000;  // 2 min queue wait cap

  constructor(private readonly projectId: string) {}

  // ── Acquire ─────────────────────────────────────────────────────────────
  async acquire(holder = 'unknown'): Promise<() => void> {
    if (!this.locked) {
      return this.lock(holder);
    }

    // Already locked — queue this request
    return new Promise<() => void>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve: () => {
          if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle);
          resolve(this.lock(holder));
        },
        reject: (err) => {
          if (entry.timeoutHandle) clearTimeout(entry.timeoutHandle);
          reject(err);
        },
        requestedAt: Date.now(),
      };

      this.queue.push(entry);

      // Timeout if waiting too long
      entry.timeoutHandle = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx >= 0) {
          this.queue.splice(idx, 1);
          entry.reject(
            new Error(
              `Workspace lock timeout for project '${this.projectId}' — ` +
              `waited ${this.MAX_WAIT_MS / 1000}s. ` +
              `Currently held by: ${this.lockInfo?.holder ?? 'unknown'}`
            )
          );
        }
      }, this.MAX_WAIT_MS);
    });
  }

  // ── Run with automatic release ───────────────────────────────────────────
  async run<T>(
    fn: () => Promise<T>,
    holder = 'unknown'
  ): Promise<T> {
    const release = await this.acquire(holder);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ── Lock state ───────────────────────────────────────────────────────────
  private lock(holder: string): () => void {
    this.locked = true;

    // Auto-release timeout (prevent deadlocks)
    const timeoutHandle = setTimeout(() => {
      console.error(
        `[WorkspaceLock] Force-releasing stale lock for ` +
        `project '${this.projectId}' held by '${holder}' ` +
        `after ${this.MAX_LOCK_MS / 1000}s`
      );
      this.release();
    }, this.MAX_LOCK_MS);

    this.lockInfo = {
      projectId: this.projectId,
      acquiredAt: Date.now(),
      holder,
      timeoutHandle,
    };

    // Return release function
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.release();
      }
    };
  }

  private release(): void {
    if (this.lockInfo) {
      clearTimeout(this.lockInfo.timeoutHandle);
      this.lockInfo = null;
    }

    const next = this.queue.shift();
    if (next) {
      next.resolve();
    } else {
      this.locked = false;
    }
  }

  // ── Info ─────────────────────────────────────────────────────────────────
  isLocked(): boolean { return this.locked; }
  getQueueLength(): number { return this.queue.length; }
  getLockInfo(): LockInfo | null { return this.lockInfo; }
  getHeldFor(): number {
    if (!this.lockInfo) return 0;
    return Date.now() - this.lockInfo.acquiredAt;
  }
}

// ─── Global registry ──────────────────────────────────────────────────────────
class LockRegistry {
  private mutexes = new Map<string, WorkspaceMutex>();

  get(projectId: string): WorkspaceMutex {
    if (!this.mutexes.has(projectId)) {
      this.mutexes.set(projectId, new WorkspaceMutex(projectId));
    }
    return this.mutexes.get(projectId)!;
  }

  async run<T>(
    projectId: string,
    fn: () => Promise<T>,
    holder = 'agent'
  ): Promise<T> {
    return this.get(projectId).run(fn, holder);
  }

  getStatus(): Record<string, {
    locked: boolean;
    queueLength: number;
    holder: string | null;
    heldForMs: number;
  }> {
    const status: Record<string, {
      locked: boolean;
      queueLength: number;
      holder: string | null;
      heldForMs: number;
    }> = {};
    for (const [id, mutex] of this.mutexes) {
      status[id] = {
        locked:      mutex.isLocked(),
        queueLength: mutex.getQueueLength(),
        holder:      mutex.getLockInfo()?.holder ?? null,
        heldForMs:   mutex.getHeldFor(),
      };
    }
    return status;
  }

  // Clean up mutexes for deleted projects
  remove(projectId: string): void {
    this.mutexes.delete(projectId);
  }
}

export const workspaceLocks = new LockRegistry();
