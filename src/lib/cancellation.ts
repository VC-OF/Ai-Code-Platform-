// ─── Types ────────────────────────────────────────────────────────────────────
export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly signal: AbortSignal;
  throwIfCancelled(): void;
  onCancel(cb: () => void): () => void; // returns unsubscribe fn
}

// ─── Token source (controls the token) ───────────────────────────────────────
export class CancellationSource {
  private controller = new AbortController();
  private callbacks: Set<() => void> = new Set();
  private _reason = '';

  readonly token: CancellationToken;

  constructor() {
    // Capture stable references so the token's getters don't need a
    // this-alias (object-literal getters rebind `this`)
    const controller = this.controller;
    const callbacks = this.callbacks;
    const getReason = () => this._reason;

    this.token = {
      get isCancelled() {
        return controller.signal.aborted;
      },
      get signal() {
        return controller.signal;
      },
      throwIfCancelled: () => {
        if (controller.signal.aborted) {
          throw new CancelledError(getReason());
        }
      },
      onCancel: (cb: () => void) => {
        callbacks.add(cb);
        return () => callbacks.delete(cb);
      },
    };
  }

  cancel(reason = 'User cancelled'): void {
    if (this.controller.signal.aborted) return;

    this._reason = reason;
    this.controller.abort(reason);

    // Notify all callbacks
    for (const cb of this.callbacks) {
      try { cb(); } catch {}
    }
    this.callbacks.clear();
  }

  get isCancelled(): boolean {
    return this.controller.signal.aborted;
  }
}

// ─── Cancelled error ──────────────────────────────────────────────────────────
export class CancelledError extends Error {
  constructor(reason = 'Operation was cancelled') {
    super(reason);
    this.name = 'CancelledError';
  }
}

// ─── Active stream registry ───────────────────────────────────────────────────
// Tracks one cancellation source per project
// Shared via globalThis so every module copy sees the same sources
const sharedSources = globalThis as unknown as { __ocStreamSources?: Map<string, CancellationSource> };

class StreamRegistry {
  private sources = (sharedSources.__ocStreamSources ??= new Map<string, CancellationSource>());

  // Register a new stream, cancelling any existing one
  register(projectId: string): CancellationSource {
    const existing = this.sources.get(projectId);
    if (existing && !existing.isCancelled) {
      existing.cancel('New request started');
    }

    const source = new CancellationSource();
    this.sources.set(projectId, source);
    return source;
  }

  // Cancel by project
  cancel(projectId: string, reason?: string): boolean {
    const source = this.sources.get(projectId);
    if (!source || source.isCancelled) return false;

    source.cancel(reason);
    return true;
  }

  // Check if a project has an active stream
  isActive(projectId: string): boolean {
    const source = this.sources.get(projectId);
    return !!source && !source.isCancelled;
  }

  // Clean up after stream ends
  cleanup(projectId: string): void {
    this.sources.delete(projectId);
  }

  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const [id, source] of this.sources) {
      status[id] = !source.isCancelled;
    }
    return status;
  }
}

export const streamRegistry = new StreamRegistry();

// ─── Cancellable sleep ────────────────────────────────────────────────────────
export function cancellableSleep(
  ms: number,
  token: CancellationToken
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (token.isCancelled) {
      return reject(new CancelledError());
    }

    const unsubscribe = token.onCancel(() => {
      clearTimeout(timer);
      reject(new CancelledError());
    });

    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, ms);
  });
}
