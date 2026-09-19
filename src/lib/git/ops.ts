import type { Op } from "$lib/tauri";

/** Offsets use CodeMirror's UTF-16 coordinates; delete is old, insert is new. */
export function deriveOps(oldBody: string, newBody: string, author: string): Op[] {
  if (oldBody === newBody) return [];
  let start = 0;
  const maxPrefix = Math.min(oldBody.length, newBody.length);
  while (start < maxPrefix && oldBody.charCodeAt(start) === newBody.charCodeAt(start)) start++;
  let endOld = oldBody.length;
  let endNew = newBody.length;
  while (
    endOld > start && endNew > start &&
    oldBody.charCodeAt(endOld - 1) === newBody.charCodeAt(endNew - 1)
  ) {
    endOld--;
    endNew--;
  }
  const ts = Date.now();
  const ops: Op[] = [];
  const deleted = oldBody.slice(start, endOld);
  const inserted = newBody.slice(start, endNew);
  if (deleted) ops.push({ seq: 0, ts, author, kind: "delete", from: start, to: endOld, text: deleted });
  if (inserted)
    ops.push({ seq: 0, ts, author, kind: "insert", from: start, to: start + inserted.length, text: inserted });
  return ops;
}

interface Batch { body: string; ops: Op[] }

/** Serial writes retain their original body and stay queued until acknowledged. */
export class OpsLogger {
  private pending: Op[] = [];
  private pendingBody: string;
  private queue: Batch[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private lastBody: string;
  private disposed = false;

  constructor(
    private sink: (body: string, ops: Op[]) => Promise<unknown>,
    initialBody: string,
    private onError: (error: unknown) => void = () => {},
  ) {
    this.lastBody = this.pendingBody = initialBody;
  }

  track(newBody: string, author: string): void {
    this.trackOps(newBody, deriveOps(this.lastBody, newBody, author));
  }

  /** Accept precise editor transactions, including disjoint cursor edits. */
  trackOps(newBody: string, ops: Op[]): void {
    this.lastBody = newBody;
    if (!ops.length) return;
    this.pendingBody = newBody;
    this.pending.push(...ops);
    this.schedule(500);
  }

  addRaw(op: Op, body: string): void {
    this.trackOps(body, [op]);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushNow().catch((error) => {
        this.onError(error);
        this.schedule(1500);
      });
    }, delay);
  }

  private async drain(): Promise<void> {
    while (this.queue.length) {
      const batch = this.queue[0];
      await this.sink(batch.body, batch.ops);
      this.queue.shift();
    }
  }

  async flushNow(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.pending.length) {
      this.queue.push({ body: this.pendingBody, ops: this.pending });
      this.pending = [];
    }
    if (this.flushing) return this.flushing;
    if (!this.queue.length) return;
    const attempt = this.drain();
    this.flushing = attempt;
    try {
      await attempt;
    } finally {
      if (this.flushing === attempt) this.flushing = undefined;
    }
  }

  /** External updates change the comparison baseline, never discard queued edits. */
  reset(body: string): void {
    this.lastBody = body;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    void this.flushNow().catch(this.onError);
  }
}
