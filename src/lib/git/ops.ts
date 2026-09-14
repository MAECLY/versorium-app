import type { Op } from "$lib/tauri";

/**
 * Derive character-level ops from two versions of a body.
 * Convention: delete positions reference the OLD doc, insert positions
 * reference the NEW doc (matches how the editor applies them).
 */
export function deriveOps(oldBody: string, newBody: string, author: string): Op[] {
  if (oldBody === newBody) return [];
  let start = 0;
  const maxPrefix = Math.min(oldBody.length, newBody.length);
  while (start < maxPrefix && oldBody.charCodeAt(start) === newBody.charCodeAt(start)) start++;
  let endOld = oldBody.length;
  let endNew = newBody.length;
  while (
    endOld > start &&
    endNew > start &&
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

/**
 * Batched, debounced ops logger. Accumulates ops from keystrokes and
 * flushes them to Rust (JSONL packs + snapshots) after a pause.
 * Best-effort: a failed flush never blocks writing.
 */
export class OpsLogger {
  private pending: Op[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastBody: string;

  constructor(
    private flush: (body: string, ops: Op[]) => Promise<unknown>,
    initialBody: string,
  ) {
    this.lastBody = initialBody;
  }

  track(newBody: string, author: string): void {
    const ops = deriveOps(this.lastBody, newBody, author);
    if (ops.length === 0) return;
    this.lastBody = newBody;
    this.pending.push(...ops);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flushNow(), 500);
  }

  /** Record an op directly (e.g. rollback) without deriving from bodies. */
  addRaw(op: Op): void {
    this.pending.push(op);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flushNow(), 500);
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.pending.length === 0) return;
    const ops = this.pending;
    this.pending = [];
    try {
      await this.flush(this.lastBody, ops);
    } catch {
      // ops log is best-effort
    }
  }

  reset(body: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = [];
    this.lastBody = body;
  }
}
